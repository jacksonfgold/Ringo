import { roomManager } from '../rooms/roomManager.js'
import { createGameState, getPublicGameState, getSpectatorGameState, GameStatus, TurnPhase, advanceTurn, checkPileClosing, checkWinCondition } from '../game/gameState.js'
import { 
  handlePlay, 
  handleDrawWithTracking, 
  handleRINGOWithTracking,
  handleInsertCardWithTracking,
  handleDiscardDrawnCardWithTracking,
  handleCaptureDecision
} from '../game/turnHandler.js'
import { 
  createBot, 
  getBotDecision, 
  isBot, 
  BotDifficulty,
  findRingoOpportunity
} from '../game/aiBot.js'

const rateLimiter = new Map()

// Track which games have already had wins incremented to prevent double-counting
const gamesWithWinsIncremented = new Set()

function incrementWinnerWins(room, previousStatus) {
  // Only increment if the game just became GAME_OVER (wasn't already GAME_OVER)
  if (room.gameState.status === GameStatus.GAME_OVER && 
      previousStatus !== GameStatus.GAME_OVER &&
      room.gameState.winner) {
    const gameKey = `${room.code}-${room.gameState.winner}`
    
    // Check if we've already incremented for this game/winner combination
    if (!gamesWithWinsIncremented.has(gameKey)) {
      const winner = room.players.find(p => p.id === room.gameState.winner)
      if (winner) {
        winner.wins = (winner.wins || 0) + 1
        gamesWithWinsIncremented.add(gameKey)
        
        // Clean up old entries (keep only last 100 games)
        if (gamesWithWinsIncremented.size > 100) {
          const firstKey = gamesWithWinsIncremented.values().next().value
          gamesWithWinsIncremented.delete(firstKey)
        }
        
        return true // Wins were incremented
      }
    }
  }
  return false // Wins were not incremented
}

function buildPublicState(room, playerId) {
  if (!room?.gameState) return null
  const publicState = getPublicGameState(room.gameState, playerId)
  if (!publicState) return null
  publicState.players = publicState.players.map(p => ({
    ...p,
    wins: room.players.find(rp => rp.id === p.id)?.wins ?? 0
  }))
  publicState.hostId = room.hostId
  return publicState
}

function buildSpectatorState(room) {
  if (!room?.gameState) return null
  const state = getSpectatorGameState(room.gameState)
  if (!state) return null
  state.players = state.players.map(p => ({
    ...p,
    wins: room.players.find(rp => rp.id === p.id)?.wins ?? 0
  }))
  state.hostId = room.hostId
  return state
}

function emitRoomUpdate(io, room) {
  io.to(room.code).emit('roomUpdate', {
    players: room.players,
    spectators: room.spectators || [],
    roomCode: room.code,
    hostId: room.hostId
  })
}

function emitGameStateToSpectators(io, room, roomCode, extra = {}) {
  if (!room.spectators?.length || !room.gameState) return
  const spectatorState = buildSpectatorState(room)
  if (!spectatorState) return
  const payload = { gameState: { ...spectatorState, roomCode }, ...extra }
  room.spectators.forEach(spectator => {
    io.to(spectator.id).emit('gameStateUpdate', payload)
  })
}

// Store pending bot actions
const botActionTimers = new Map()

// Turn timer: roomCode -> timeoutId (for human players only)
const turnTimers = new Map()

function clearTurnTimer(roomCode) {
  if (turnTimers.has(roomCode)) {
    clearTimeout(turnTimers.get(roomCode))
    turnTimers.delete(roomCode)
  }
}

function startTurnTimer(io, room, roomCode) {
  const code = room?.code || roomCode
  clearTurnTimer(code)
  const seconds = room.settings?.turnTimer
  if (!seconds || seconds <= 0) return
  const currentPlayer = room.gameState.players[room.gameState.currentPlayerIndex]
  const roomPlayer = room.players.find(p => p.id === currentPlayer.id)
  if (roomPlayer?.isBot) return
  const timeoutId = setTimeout(() => {
    turnTimers.delete(code)
    executeTurnTimeout(io, code)
  }, seconds * 1000)
  turnTimers.set(code, timeoutId)
  io.to(currentPlayer.id).emit('turnTimerStarted', { turnTimerSeconds: seconds, startedAt: Date.now() })
}

/** Get values a card can represent (for matching). */
function getCardValues(card) {
  if (!card) return []
  if (card.isSplit && card.splitValues) return [...card.splitValues]
  return [card.value]
}

/** Find insert position so drawn card is placed next to a matching card (same value), or -1 if no match. */
function findInsertPositionNextToMatching(hand, drawnCard) {
  const drawnValues = new Set(getCardValues(drawnCard))
  if (drawnValues.size === 0) return -1
  for (let i = 0; i < hand.length; i++) {
    const card = hand[i]
    const cardValues = getCardValues(card)
    if (cardValues.some(v => drawnValues.has(v))) return i
  }
  return -1
}

function executeTurnTimeout(io, roomCode) {
  const room = roomManager.getRoom(roomCode)
  if (!room?.gameState || room.gameState.status !== GameStatus.PLAYING) {
    return
  }
  const currentPlayer = room.gameState.players[room.gameState.currentPlayerIndex]
  if (!currentPlayer) return
  const roomPlayer = room.players.find(p => p.id === currentPlayer.id)
  if (roomPlayer?.isBot) return

  const phase = room.gameState.turnPhase
  const playerId = currentPlayer.id
  let didAct = false
  let timeoutMessage = ''

  if (phase === TurnPhase.WAITING_FOR_PLAY_OR_DRAW) {
    const drawResult = handleDrawWithTracking(room.gameState, playerId)
    if (drawResult.success) {
      room.gameState = drawResult.state
      const player = room.gameState.players.find(p => p.id === playerId)
      const hand = player.hand || []
      const drawnCard = room.gameState.drawnCard
      const insertPos = hand.length > 0 ? findInsertPositionNextToMatching(hand, drawnCard) : -1
      if (insertPos >= 0) {
        const insertResult = handleInsertCardWithTracking(room.gameState, playerId, insertPos)
        if (insertResult.success) {
          room.gameState = insertResult.state
          didAct = true
          timeoutMessage = 'ran out of time – drew and added to hand'
        }
      }
      if (!didAct) {
        const discardResult = handleDiscardDrawnCardWithTracking(room.gameState, playerId)
        if (discardResult.success) {
          room.gameState = discardResult.state
          didAct = true
          timeoutMessage = 'ran out of time – drew and discarded'
        }
      }
    } else {
      room.gameState = advanceTurn(room.gameState)
      room.gameState = checkPileClosing(room.gameState)
      room.gameState = checkWinCondition(room.gameState)
      didAct = true
      timeoutMessage = 'ran out of time – turn skipped'
    }
  } else if (phase === TurnPhase.PROCESSING_DRAW || phase === TurnPhase.RINGO_CHECK) {
    const player = room.gameState.players.find(p => p.id === playerId)
    const hand = player?.hand || []
    const drawnCard = room.gameState.drawnCard
    const insertPos = hand.length > 0 ? findInsertPositionNextToMatching(hand, drawnCard) : -1
    if (insertPos >= 0) {
      const insertResult = handleInsertCardWithTracking(room.gameState, playerId, insertPos)
      if (insertResult.success) {
        room.gameState = insertResult.state
        didAct = true
        timeoutMessage = 'ran out of time – added drawn card to hand'
      }
    }
    if (!didAct) {
      const discardResult = handleDiscardDrawnCardWithTracking(room.gameState, playerId)
      if (discardResult.success) {
        room.gameState = discardResult.state
        didAct = true
        timeoutMessage = 'ran out of time – discarded drawn card'
      }
    }
  }

  if (!didAct) return

  room.updateActivity()
  const playerName = roomPlayer?.name || 'Player'
  io.to(room.code).emit('playerNotification', {
    type: 'info',
    message: timeoutMessage,
    playerName,
    cardInfo: []
  })

  const previousStatus = room.gameState?.status
  const winsIncremented = incrementWinnerWins(room, previousStatus)
  if (room.gameState.status === GameStatus.GAME_OVER && previousStatus !== GameStatus.GAME_OVER) {
    emitRoomUpdate(io, room)
  } else if (winsIncremented) {
    emitRoomUpdate(io, room)
  }
  room.players.forEach(p => {
    if (!p.isBot) {
      io.to(p.id).emit('gameStateUpdate', {
        gameState: { ...buildPublicState(room, p.id), roomCode },
        turnTimeout: true
      })
    }
  })
  emitGameStateToSpectators(io, room, roomCode)
  if (room.gameState.status === GameStatus.PLAYING) {
    processBotTurn(io, room, roomCode)
  }
}

function maybeStartTurnTimer(io, room, roomCode) {
  if (!room?.gameState || room.gameState.status !== GameStatus.PLAYING) return
  const currentPlayer = room.gameState.players[room.gameState.currentPlayerIndex]
  const roomPlayer = room.players.find(p => p.id === currentPlayer.id)
  if (roomPlayer?.isBot) return
  startTurnTimer(io, room, roomCode)
}

// Process bot turn with delay for realism
async function processBotTurn(io, room, roomCode) {
  if (!room || !room.gameState || room.gameState.status !== GameStatus.PLAYING) return
  
  const currentPlayer = room.gameState.players[room.gameState.currentPlayerIndex]
  const roomPlayer = room.players.find(p => p.id === currentPlayer.id)
  
  if (!roomPlayer || !roomPlayer.isBot) {
    maybeStartTurnTimer(io, room, roomCode)
    return
  }
  
  const botId = currentPlayer.id
  const difficulty = roomPlayer.difficulty || BotDifficulty.EASY
  
  // Add delay for realism (1-2 seconds)
  const delay = 1000 + Math.random() * 1000
  
  // Clear any existing timer for this room
  if (botActionTimers.has(roomCode)) {
    clearTimeout(botActionTimers.get(roomCode))
  }
  
  const timer = setTimeout(async () => {
    try {
      await executeBotTurn(io, room, roomCode, botId, difficulty)
    } catch (error) {
      console.error('Bot turn error:', error)
    }
  }, delay)
  
  botActionTimers.set(roomCode, timer)
}

async function executeBotTurn(io, room, roomCode, botId, difficulty) {
  if (!room || !room.gameState || room.gameState.status !== GameStatus.PLAYING) return
  
  const currentPlayer = room.gameState.players[room.gameState.currentPlayerIndex]
  if (currentPlayer.id !== botId) return // Not bot's turn anymore
  
  const turnPhase = room.gameState.turnPhase
  
  if (turnPhase === 'WAITING_FOR_PLAY_OR_DRAW') {
    // Bot decides to play or draw
    const decision = getBotDecision(room.gameState, botId, difficulty, { phase: 'turn', roomCode })
    
    if (decision && decision.action === 'play') {
      const result = handlePlay(room.gameState, botId, decision.indices, {})
      
      if (result.success) {
        const previousStatus = room.gameState?.status
        room.gameState = result.state
        room.updateActivity()
        
        const winsIncremented = incrementWinnerWins(room, previousStatus)
        if (winsIncremented) {
emitRoomUpdate(io, room)
        }
        
        // Broadcast to all players
        room.players.forEach(player => {
          if (!player.isBot) {
            io.to(player.id).emit('gameStateUpdate', {
              gameState: { ...buildPublicState(room, player.id), roomCode }
            })
          }
        })
        emitGameStateToSpectators(io, room, roomCode)
        
        // Notify about bot action
        io.to(room.code).emit('playerNotification', {
          type: 'info',
          message: `played ${decision.indices.length} card${decision.indices.length > 1 ? 's' : ''}`,
          playerName: room.players.find(p => p.id === botId)?.name || 'Bot',
          cardInfo: []
        })
        
        // Check for capture decision or continue
        if (room.gameState.turnPhase === 'WAITING_FOR_CAPTURE_DECISION') {
          setTimeout(() => executeBotCapture(io, room, roomCode, botId, difficulty), 800)
        } else if (room.gameState.status === GameStatus.PLAYING) {
          processBotTurn(io, room, roomCode)
        }
      }
    } else {
      // Draw
      const result = handleDrawWithTracking(room.gameState, botId)
      
      if (result.success) {
        room.gameState = result.state
        room.updateActivity()
        
        // Notify about draw
        io.to(room.code).emit('playerNotification', {
          type: 'draw',
          message: 'drew a card',
          playerName: room.players.find(p => p.id === botId)?.name || 'Bot',
          cardInfo: []
        })
        
        // Broadcast to all players
        room.players.forEach(player => {
          if (!player.isBot) {
            io.to(player.id).emit('gameStateUpdate', {
              gameState: { ...buildPublicState(room, player.id), roomCode }
            })
          }
        })
        emitGameStateToSpectators(io, room, roomCode)
        
        // Bot decides what to do with drawn card
        setTimeout(() => executeBotDrawDecision(io, room, roomCode, botId, difficulty, result.drawnCard), 800)
      }
    }
  } else if (turnPhase === 'WAITING_FOR_CAPTURE_DECISION') {
    await executeBotCapture(io, room, roomCode, botId, difficulty)
  }
}

async function executeBotDrawDecision(io, room, roomCode, botId, difficulty, drawnCard) {
  if (!room || !room.gameState) return
  
  const bot = room.gameState.players.find(p => p.id === botId)
  if (!bot) return
  
  // Check for RINGO opportunity
  const ringoInfo = findRingoOpportunity(bot.hand, drawnCard, room.gameState.currentCombo)
  const ringoPossible = ringoInfo !== null
  
  const decision = getBotDecision(room.gameState, botId, difficulty, {
    phase: 'ringo',
    drawnCard,
    ringoPossible,
    ringoInfo,
    roomCode
  })
  
  if (decision && decision.action === 'ringo' && ringoPossible) {
    // Execute RINGO
    const result = handleRINGOWithTracking(
      room.gameState,
      botId,
      ringoInfo.comboIndices,
      ringoInfo.insertPosition,
      {}
    )
    
    if (result.success) {
      const previousStatus = room.gameState?.status
      room.gameState = result.state
      room.updateActivity()
      
      const winsIncremented = incrementWinnerWins(room, previousStatus)
      if (winsIncremented) {
        emitRoomUpdate(io, room)
      }
      
      room.players.forEach(player => {
        if (!player.isBot) {
          io.to(player.id).emit('gameStateUpdate', {
            gameState: { ...buildPublicState(room, player.id), roomCode },
            ringo: true
          })
        }
      })
      emitGameStateToSpectators(io, room, roomCode)
      
      io.to(room.code).emit('playerNotification', {
        type: 'info',
        message: 'called RINGO!',
        playerName: room.players.find(p => p.id === botId)?.name || 'Bot',
        cardInfo: []
      })
      
      if (room.gameState.turnPhase === 'WAITING_FOR_CAPTURE_DECISION') {
        setTimeout(() => executeBotCapture(io, room, roomCode, botId, difficulty), 800)
      } else if (room.gameState.status === GameStatus.PLAYING) {
        processBotTurn(io, room, roomCode)
      }
    }
  } else {
    // Insert or discard the card
    const bot = room.gameState.players.find(p => p.id === botId)
    const insertDecision = getBotDecision(room.gameState, botId, difficulty, {
      phase: 'insert',
      drawnCard,
      roomCode
    })
    
    // Check if bot wants to discard instead of insert
    if (insertDecision?.action === 'discard') {
      const result = handleDiscardDrawnCardWithTracking(room.gameState, botId)
      
      if (result.success) {
        const previousStatus = room.gameState?.status
        room.gameState = result.state
        
        const winsIncremented = incrementWinnerWins(room, previousStatus)
        if (winsIncremented) {
emitRoomUpdate(io, room)
        }
        
        room.players.forEach(player => {
          const publicState = getPublicGameState(room.gameState, player.id)
          if (publicState) {
            io.to(player.id).emit('gameStateUpdate', { gameState: { ...publicState, roomCode } })
          }
        })
        emitGameStateToSpectators(io, room, roomCode)
        
        // Continue bot turns if needed
        if (room.gameState.status === GameStatus.PLAYING) {
          processBotTurn(io, room, roomCode)
        }
      }
      return
    }
    
    const result = handleInsertCardWithTracking(room.gameState, botId, insertDecision?.position || 0)
    
    if (result.success) {
      const previousStatus = room.gameState?.status
      room.gameState = result.state
      room.updateActivity()
      
      const winsIncremented = incrementWinnerWins(room, previousStatus)
      if (winsIncremented) {
        emitRoomUpdate(io, room)
      }
      
      room.players.forEach(player => {
        if (!player.isBot) {
          io.to(player.id).emit('gameStateUpdate', {
            gameState: { ...buildPublicState(room, player.id), roomCode }
          })
        }
      })
      emitGameStateToSpectators(io, room, roomCode)
      
      io.to(room.code).emit('playerNotification', {
        type: 'info',
        message: 'added a card to their hand',
        playerName: room.players.find(p => p.id === botId)?.name || 'Bot',
        cardInfo: []
      })
      
      if (room.gameState.status === GameStatus.PLAYING) {
        processBotTurn(io, room, roomCode)
      }
    }
  }
}

async function executeBotCapture(io, room, roomCode, botId, difficulty) {
  if (!room || !room.gameState || !room.gameState.pendingCapture) return
  
  const capturedCards = room.gameState.pendingCapture.cards
  const decision = getBotDecision(room.gameState, botId, difficulty, {
    phase: 'capture',
    capturedCards,
    roomCode
  })
  
  if (!decision || decision.action === 'discard_all') {
    const result = handleCaptureDecision(room.gameState, botId, 'discard_all')
    
    if (result.success) {
      const previousStatus = room.gameState?.status
      room.gameState = result.state
      room.updateActivity()
      
      const winsIncremented = incrementWinnerWins(room, previousStatus)
      if (winsIncremented) {
        emitRoomUpdate(io, room)
      }
      
      room.players.forEach(player => {
        if (!player.isBot) {
          io.to(player.id).emit('gameStateUpdate', {
            gameState: { ...buildPublicState(room, player.id), roomCode }
          })
        }
      })
      emitGameStateToSpectators(io, room, roomCode)
      
      io.to(room.code).emit('playerNotification', {
        type: 'info',
        message: 'discarded captured cards',
        playerName: room.players.find(p => p.id === botId)?.name || 'Bot',
        cardInfo: []
      })
      
      if (room.gameState.status === GameStatus.PLAYING) {
        processBotTurn(io, room, roomCode)
      }
    }
  } else {
    // Insert cards one by one
    await insertCapturedCardsSequentially(io, room, roomCode, botId, difficulty, capturedCards)
  }
}

async function insertCapturedCardsSequentially(io, room, roomCode, botId, difficulty, cards) {
  for (const card of cards) {
    if (!room.gameState || !room.gameState.pendingCapture) break
    
    const bot = room.gameState.players.find(p => p.id === botId)
    const insertDecision = getBotDecision(room.gameState, botId, difficulty, {
      phase: 'insert',
      drawnCard: card,
      roomCode
    })
    
    // For capture, check if bot wants to discard this card
    const captureAction = insertDecision?.action === 'discard' ? 'discard_all' : 'insert_one'
    
    const result = handleCaptureDecision(
      room.gameState,
      botId,
      captureAction,
      insertDecision?.position || 0,
      card.id
    )
    
    if (result.success) {
      const previousStatus = room.gameState?.status
      room.gameState = result.state
      room.updateActivity()
      
      const winsIncremented = incrementWinnerWins(room, previousStatus)
      if (winsIncremented) {
        emitRoomUpdate(io, room)
      }
      
      room.players.forEach(player => {
        if (!player.isBot) {
          io.to(player.id).emit('gameStateUpdate', {
            gameState: { ...buildPublicState(room, player.id), roomCode }
          })
        }
      })
      emitGameStateToSpectators(io, room, roomCode)
      
      // Small delay between insertions
      await new Promise(resolve => setTimeout(resolve, 300))
    }
  }
  
  io.to(room.code).emit('playerNotification', {
    type: 'info',
    message: 'picked up captured cards',
    playerName: room.players.find(p => p.id === botId)?.name || 'Bot',
    cardInfo: []
  })
  
  if (room.gameState && room.gameState.status === GameStatus.PLAYING) {
    processBotTurn(io, room, roomCode)
  }
}

function checkRateLimit(socketId) {
  const now = Date.now()
  const windowMs = 60000 // 1 minute
  const maxEvents = 100

  if (!rateLimiter.has(socketId)) {
    rateLimiter.set(socketId, { count: 1, resetAt: now + windowMs })
    return true
  }

  const limit = rateLimiter.get(socketId)
  if (now > limit.resetAt) {
    limit.count = 1
    limit.resetAt = now + windowMs
    return true
  }

  if (limit.count >= maxEvents) {
    return false
  }

  limit.count++
  return true
}

// Room cleanup interval - runs every 5 minutes
let roomCleanupInterval = null

export function setupSocketHandlers(io) {
  // Start periodic room cleanup
  const INACTIVITY_TIMEOUT = 30 * 60 * 1000 // 30 minutes of inactivity
  const CLEANUP_INTERVAL = 5 * 60 * 1000 // Check every 5 minutes
  
  roomCleanupInterval = setInterval(() => {
    const roomsToClose = roomManager.cleanupInactiveRooms(INACTIVITY_TIMEOUT)
    
    for (const { code, room } of roomsToClose) {
      console.log(`[Room Cleanup] Closing inactive room: ${code}`)
      
      // Notify all players in the room that it's being closed
      io.to(code).emit('roomClosed', {
        reason: room.isEmpty() 
          ? 'Room is empty' 
          : room.isInactive(INACTIVITY_TIMEOUT)
          ? 'Room inactive for too long'
          : 'All players disconnected',
        roomCode: code
      })
      
      // Close the room
      roomManager.closeRoom(code)
    }
    
    if (roomsToClose.length > 0) {
      console.log(`[Room Cleanup] Closed ${roomsToClose.length} inactive room(s)`)
    }
  }, CLEANUP_INTERVAL)
  
  console.log('[Socket Handlers] Room cleanup started (checks every 5 minutes)')
  io.on('connection', (socket) => {
    console.log('Client connected:', socket.id)

    socket.on('createRoom', (data, callback) => {
      if (!checkRateLimit(socket.id)) {
        return callback({ error: 'Rate limit exceeded' })
      }

      try {
        const room = roomManager.createRoom(socket.id, data.playerName || 'Player')
        room.updateActivity()
        socket.join(room.code)
        callback({ 
          success: true, 
          roomCode: room.code,
          players: room.players,
          hostId: room.hostId
        })
      } catch (error) {
        callback({ error: error.message })
      }
    })

    socket.on('joinRoom', (data, callback) => {
      if (!checkRateLimit(socket.id)) {
        return callback({ error: 'Rate limit exceeded' })
      }

      try {
        const room = roomManager.joinRoom(data.roomCode, socket.id, data.playerName || 'Player')
        room.updateActivity()
        socket.join(room.code)
        
        emitRoomUpdate(io, room)

        callback({ 
          success: true, 
          players: room.players,
          hostId: room.hostId,
          gameState: buildPublicState(room, socket.id)
        })
      } catch (error) {
        callback({ error: error.message })
      }
    })

    socket.on('rejoinRoom', (data, callback) => {
      if (!checkRateLimit(socket.id)) {
        return callback({ error: 'Rate limit exceeded' })
      }

      try {
        const rejoinResult = roomManager.rejoinRoom(data.roomCode, socket.id, data.playerName || 'Player')
        const room = rejoinResult.room
        const previousPlayerId = rejoinResult.oldId
        room.updateActivity()
        socket.join(room.code)
        
        // If game is in progress, update player ID and name in game state
        if (room.gameState) {
          const normalizedName = (data.playerName || '').trim().toLowerCase()
          const trimmedName = (data.playerName || '').trim()
          const playerInGame = room.gameState.players.find(
            p => (p.name || '').trim().toLowerCase() === normalizedName
          ) || (previousPlayerId ? room.gameState.players.find(p => p.id === previousPlayerId) : null)
          if (playerInGame) {
            const oldId = playerInGame.id
            console.log(`[REJOIN] Updating player ${data.playerName} ID from ${oldId} to ${socket.id}`)
            console.log(`[REJOIN] Current player index: ${room.gameState.currentPlayerIndex}`)
            console.log(`[REJOIN] Player index before update: ${room.gameState.players.findIndex(p => p.id === oldId)}`)
            playerInGame.id = socket.id
            // Update name in game state if it changed
            if (playerInGame.name !== trimmedName) {
              playerInGame.name = trimmedName
              console.log(`[REJOIN] Updated player name to ${trimmedName}`)
            }
            console.log(`[REJOIN] Player index after update: ${room.gameState.players.findIndex(p => p.id === socket.id)}`)
            console.log(`[REJOIN] Is rejoining player's turn? ${room.gameState.currentPlayerIndex === room.gameState.players.findIndex(p => p.id === socket.id)}`)
            
            // Also update currentComboOwner if it was this player
            if (room.gameState.currentComboOwner === oldId) {
              room.gameState.currentComboOwner = socket.id
              console.log(`[REJOIN] Updated currentComboOwner to ${socket.id}`)
            }
          } else {
            console.log(`[REJOIN] Player ${data.playerName} not found in game state`)
          }
        }
        
        emitRoomUpdate(io, room)

        // Get the updated game state for the rejoining player BEFORE broadcasting
        const rejoiningPlayerGameState = buildPublicState(room, socket.id)
        if (rejoiningPlayerGameState) {
          console.log(`[REJOIN] Sending game state to rejoining player ${socket.id}`)
          console.log(`[REJOIN] Rejoining player's index in game state: ${rejoiningPlayerGameState.players.findIndex(p => p.id === socket.id)}`)
          console.log(`[REJOIN] Current player index in game state: ${rejoiningPlayerGameState.currentPlayerIndex}`)
        }

        // Broadcast updated game state to all players (do this before callback to ensure state is synced)
        if (room.gameState) {
          room.players.forEach(player => {
            const publicState = buildPublicState(room, player.id)
            console.log(`[REJOIN] Sending game state to player ${player.id} (${player.name})`)
            console.log(`[REJOIN] Player ${player.id} index: ${publicState.players.findIndex(p => p.id === player.id)}`)
            io.to(player.id).emit('gameStateUpdate', {
              gameState: { ...publicState, roomCode: data.roomCode }
            })
          })
          emitGameStateToSpectators(io, room, data.roomCode)
        }

        callback({ 
          success: true, 
          players: room.players,
          hostId: room.hostId,
          gameState: rejoiningPlayerGameState
        })
      } catch (error) {
        callback({ error: error.message })
      }
    })

    socket.on('joinAsSpectator', (data, callback) => {
      if (!checkRateLimit(socket.id)) {
        return callback({ error: 'Rate limit exceeded' })
      }
      try {
        const room = roomManager.joinRoomAsSpectator(data.roomCode, socket.id, data.playerName || 'Spectator')
        room.updateActivity()
        socket.join(room.code)
        emitRoomUpdate(io, room)
        const spectatorState = buildSpectatorState(room)
        callback({
          success: true,
          players: room.players,
          spectators: room.spectators,
          hostId: room.hostId,
          isSpectator: true,
          gameState: spectatorState ? { ...spectatorState, roomCode: room.code } : null
        })
      } catch (error) {
        callback({ error: error.message })
      }
    })

    socket.on('leaveRoom', (data) => {
      const room = roomManager.leaveRoom(data.roomCode, socket.id)
      socket.leave(data.roomCode)
      if (room) {
        room.updateActivity()
        emitRoomUpdate(io, room)
      }
    })

    // Add bot to room
    socket.on('addBot', (data, callback) => {
      if (!checkRateLimit(socket.id)) {
        return callback({ error: 'Rate limit exceeded' })
      }

      try {
        const room = roomManager.getRoom(data.roomCode)
        if (!room) {
          socket.emit('roomClosed', {
            reason: 'Room no longer exists',
            roomCode: data.roomCode
          })
          return callback({ error: 'Room not found' })
        }
        room.updateActivity()

        if (room.hostId !== socket.id) {
          return callback({ error: 'Only host can add bots' })
        }

        if (room.players.length >= 5) {
          return callback({ error: 'Room is full (max 5 players)' })
        }

        if (room.gameState && room.gameState.status === GameStatus.PLAYING) {
          return callback({ error: 'Cannot add bots during a game' })
        }

        const difficulty = data.difficulty || BotDifficulty.EASY
        const botNumber = room.players.filter(p => p.isBot).length + 1
        const bot = createBot(difficulty, botNumber)
        
        room.players.push(bot)

        emitRoomUpdate(io, room)

        callback({ success: true, players: room.players })
      } catch (error) {
        callback({ error: error.message })
      }
    })

    // Remove bot from room
    socket.on('removeBot', (data, callback) => {
      if (!checkRateLimit(socket.id)) {
        return callback({ error: 'Rate limit exceeded' })
      }

      try {
        const room = roomManager.getRoom(data.roomCode)
        if (!room) {
          socket.emit('roomClosed', {
            reason: 'Room no longer exists',
            roomCode: data.roomCode
          })
          return callback({ error: 'Room not found' })
        }
        room.updateActivity()

        if (room.hostId !== socket.id) {
          return callback({ error: 'Only host can remove bots' })
        }

        if (room.gameState && room.gameState.status === GameStatus.PLAYING) {
          return callback({ error: 'Cannot remove bots during a game' })
        }

        const botIndex = room.players.findIndex(p => p.id === data.botId && p.isBot)
        if (botIndex === -1) {
          return callback({ error: 'Bot not found' })
        }

        room.players.splice(botIndex, 1)

        emitRoomUpdate(io, room)

        callback({ success: true, players: room.players })
      } catch (error) {
        callback({ error: error.message })
      }
    })

    // Rename bot
    socket.on('renameBot', (data, callback) => {
      if (!checkRateLimit(socket.id)) {
        return callback({ error: 'Rate limit exceeded' })
      }

      try {
        const room = roomManager.getRoom(data.roomCode)
        if (!room) {
          socket.emit('roomClosed', {
            reason: 'Room no longer exists',
            roomCode: data.roomCode
          })
          return callback({ error: 'Room not found' })
        }
        room.updateActivity()

        if (room.hostId !== socket.id) {
          return callback({ error: 'Only host can rename bots' })
        }

        if (room.gameState && room.gameState.status === GameStatus.PLAYING) {
          return callback({ error: 'Cannot rename bots during a game' })
        }

        const bot = room.players.find(p => p.id === data.botId && p.isBot)
        if (!bot) {
          return callback({ error: 'Bot not found' })
        }

        const newName = (data.newName || '').trim()
        if (!newName) {
          return callback({ error: 'Name cannot be empty' })
        }

        if (newName.length > 20) {
          return callback({ error: 'Name too long (max 20 characters)' })
        }

        bot.name = newName

        emitRoomUpdate(io, room)

        callback({ success: true, players: room.players })
      } catch (error) {
        callback({ error: error.message })
      }
    })

    socket.on('reorderPlayers', (data, callback) => {
      if (!checkRateLimit(socket.id)) {
        return callback({ error: 'Rate limit exceeded' })
      }

      try {
        const room = roomManager.getRoom(data.roomCode)
        if (!room) {
          return callback({ error: 'Room not found' })
        }
        room.updateActivity()

        if (room.hostId !== socket.id) {
          return callback({ error: 'Only host can reorder players' })
        }

        if (room.gameState && room.gameState.status === GameStatus.PLAYING) {
          return callback({ error: 'Cannot reorder players during a game' })
        }

        if (!data.playerOrder || !Array.isArray(data.playerOrder)) {
          return callback({ error: 'Invalid player order' })
        }

        // Reorder players array based on provided order
        const playerMap = new Map(room.players.map(p => [p.id, p]))
        const reorderedPlayers = data.playerOrder
          .map(id => playerMap.get(id))
          .filter(p => p !== undefined)

        // Add any players not in the order (shouldn't happen, but safety check)
        const orderedIds = new Set(data.playerOrder)
        const missingPlayers = room.players.filter(p => !orderedIds.has(p.id))
        reorderedPlayers.push(...missingPlayers)

        room.players = reorderedPlayers

        emitRoomUpdate(io, room)

        callback({ success: true, players: room.players })
      } catch (error) {
        callback({ error: error.message })
      }
    })

    socket.on('updateRoomSettings', (data, callback) => {
      if (!checkRateLimit(socket.id)) {
        return callback({ error: 'Rate limit exceeded' })
      }

      try {
        const room = roomManager.getRoom(data.roomCode)
        if (!room) {
          return callback({ error: 'Room not found' })
        }
        room.updateActivity()

        if (room.hostId !== socket.id) {
          return callback({ error: 'Only host can update settings' })
        }

        if (room.gameState && room.gameState.status === GameStatus.PLAYING) {
          return callback({ error: 'Cannot update settings during a game' })
        }

        // Store settings in room
        room.settings = { ...room.settings, ...data.settings }

        io.to(room.code).emit('roomSettingsUpdate', {
          settings: room.settings,
          roomCode: room.code
        })

        callback({ success: true, settings: room.settings })
      } catch (error) {
        callback({ error: error.message })
      }
    })

    socket.on('startGame', (data, callback) => {
      if (!checkRateLimit(socket.id)) {
        return callback({ error: 'Rate limit exceeded' })
      }

      try {
        const room = roomManager.getRoom(data.roomCode)
        if (!room) {
          socket.emit('roomClosed', {
            reason: 'Room no longer exists',
            roomCode: data.roomCode
          })
          return callback({ error: 'Room not found' })
        }
        room.updateActivity()

        if (room.hostId !== socket.id) {
          return callback({ error: 'Only host can start the game' })
        }

        if (room.players.length < 2) {
          return callback({ error: 'Need at least 2 players to start' })
        }

        if (room.gameState && room.gameState.status === GameStatus.PLAYING) {
          return callback({ error: 'Game already in progress' })
        }

        // Store settings if provided
        if (data.settings) {
          room.settings = { ...room.settings, ...data.settings }
        }

        const previousWinner = room.gameState?.previousWinner || null
        
        // Clear wins tracking for the new game
        const roomKey = room.code
        for (const key of gamesWithWinsIncremented.keys()) {
          if (key.startsWith(`${roomKey}-`)) {
            gamesWithWinsIncremented.delete(key)
          }
        }
        
        room.gameState = createGameState(room.players, previousWinner, room.settings)
        room.updateActivity()

        // Emit a signal to clear old game state before sending new one
        io.to(room.code).emit('gameStateReset')
        
        // Emit roomUpdate to refresh lobby with latest player data (including wins)
        emitRoomUpdate(io, room)

        // Broadcast game state to all players (only non-bots)
        room.players.forEach(player => {
          if (!player.isBot) {
            try {
              const publicState = buildPublicState(room, player.id)
              io.to(player.id).emit('gameStateUpdate', {
                gameState: { ...publicState, roomCode: data.roomCode },
                isNewGame: true // Flag to indicate this is a fresh game
              })
            } catch (error) {
              console.error(`Error sending game state to player ${player.id}:`, error)
            }
          }
        })
        emitGameStateToSpectators(io, room, data.roomCode, { isNewGame: true })

        callback({ success: true })
        
        // Start bot turn if bot, or turn timer if human
        processBotTurn(io, room, data.roomCode)
      } catch (error) {
        console.error('Error starting game:', error)
        callback({ error: error.message || 'Failed to start game' })
      }
    })

    socket.on('playCards', (data, callback) => {
      if (!checkRateLimit(socket.id)) {
        return callback({ error: 'Rate limit exceeded' })
      }
      clearTurnTimer(data.roomCode)

      const room = roomManager.getRoom(data.roomCode)
      if (!room) {
        socket.emit('roomClosed', {
          reason: 'Room no longer exists',
          roomCode: data.roomCode
        })
        return callback({ error: 'Room not found' })
      }
      if (!room.gameState) {
        return callback({ error: 'Game not found' })
      }
      room.updateActivity()

      const result = handlePlay(
        room.gameState,
        socket.id,
        data.cardIndices,
        data.splitResolutions || {}
      )

      if (!result.success) {
        return callback({ error: result.error })
      }

      const previousStatus = room.gameState?.status
      room.gameState = result.state

      const winsIncremented = incrementWinnerWins(room, previousStatus)
      // Emit roomUpdate when game ends (GAME_OVER) to ensure clients have latest player data
      if (room.gameState.status === GameStatus.GAME_OVER && previousStatus !== GameStatus.GAME_OVER) {
        emitRoomUpdate(io, room)
      } else if (winsIncremented) {
        emitRoomUpdate(io, room)
      }

      // Broadcast updated game state to all players
      room.players.forEach(player => {
        if (!player.isBot) {
          io.to(player.id).emit('gameStateUpdate', {
            gameState: { ...buildPublicState(room, player.id), roomCode: data.roomCode },
            previousCombo: result.previousCombo,
            playedCombo: result.playedCombo
          })
        }
      })
      emitGameStateToSpectators(io, room, data.roomCode)

      callback({ success: true })
      
      // Trigger bot turn if needed
      if (room.gameState.status === GameStatus.PLAYING) {
        processBotTurn(io, room, data.roomCode)
      }
    })

    socket.on('drawCard', (data, callback) => {
      if (!checkRateLimit(socket.id)) {
        return callback({ error: 'Rate limit exceeded' })
      }
      clearTurnTimer(data.roomCode)

      const room = roomManager.getRoom(data.roomCode)
      if (!room) {
        socket.emit('roomClosed', {
          reason: 'Room no longer exists',
          roomCode: data.roomCode
        })
        return callback({ error: 'Room not found' })
      }
      if (!room.gameState) {
        return callback({ error: 'Game not found' })
      }
      room.updateActivity()

      const result = handleDrawWithTracking(room.gameState, socket.id)

      if (!result.success) {
        return callback({ error: result.error })
      }

      room.gameState = result.state
      room.updateActivity()

      const player = room.players.find(p => p.id === socket.id)
      const playerName = player?.name || 'Player'

      // Emit notification to all other players (without card details)
      io.to(room.code).except(socket.id).emit('playerNotification', {
        type: 'draw',
        message: 'drew a card',
        playerName,
        cardInfo: []
      })

      // Send drawn card only to the player who drew it
      io.to(socket.id).emit('cardDrawn', {
        card: result.drawnCard,
        ringoPossible: result.ringoPossible,
        ringoInfo: result.ringoInfo
      })

      // Broadcast updated game state (without drawn card info) to all players
      room.players.forEach(player => {
        if (!player.isBot) {
          io.to(player.id).emit('gameStateUpdate', {
            gameState: { ...buildPublicState(room, player.id), roomCode: data.roomCode }
          })
        }
      })
      emitGameStateToSpectators(io, room, data.roomCode)

      callback({ success: true, ringoPossible: result.ringoPossible })
      startTurnTimer(io, room, data.roomCode)
    })

    socket.on('ringo', (data, callback) => {
      if (!checkRateLimit(socket.id)) {
        return callback({ error: 'Rate limit exceeded' })
      }
      clearTurnTimer(data.roomCode)

      const room = roomManager.getRoom(data.roomCode)
      if (!room) {
        socket.emit('roomClosed', {
          reason: 'Room no longer exists',
          roomCode: data.roomCode
        })
        return callback({ error: 'Room not found' })
      }
      if (!room.gameState) {
        return callback({ error: 'Game not found' })
      }
      room.updateActivity()

      const result = handleRINGOWithTracking(
        room.gameState,
        socket.id,
        data.comboIndices,
        data.insertPosition,
        data.splitResolutions || {}
      )

      if (!result.success) {
        return callback({ error: result.error })
      }

      const previousStatus = room.gameState?.status
      room.gameState = result.state

      const winsIncremented = incrementWinnerWins(room, previousStatus)
      // Emit roomUpdate when game ends (GAME_OVER) to ensure clients have latest player data
      if (room.gameState.status === GameStatus.GAME_OVER && previousStatus !== GameStatus.GAME_OVER) {
        emitRoomUpdate(io, room)
      } else if (winsIncremented) {
        emitRoomUpdate(io, room)
      }

      // Broadcast updated game state to all players
      room.players.forEach(player => {
        if (!player.isBot) {
          io.to(player.id).emit('gameStateUpdate', {
            gameState: { ...buildPublicState(room, player.id), roomCode: data.roomCode },
            previousCombo: result.previousCombo,
            playedCombo: result.playedCombo,
            ringo: true
          })
        }
      })
      emitGameStateToSpectators(io, room, data.roomCode)

      callback({ success: true })
      
      // Trigger bot turn if needed
      if (room.gameState.status === GameStatus.PLAYING) {
        processBotTurn(io, room, data.roomCode)
      }
    })

    socket.on('insertCard', (data, callback) => {
      if (!checkRateLimit(socket.id)) {
        return callback({ error: 'Rate limit exceeded' })
      }
      clearTurnTimer(data.roomCode)

      const room = roomManager.getRoom(data.roomCode)
      if (!room) {
        socket.emit('roomClosed', {
          reason: 'Room no longer exists',
          roomCode: data.roomCode
        })
        return callback({ error: 'Room not found' })
      }
      if (!room.gameState) {
        return callback({ error: 'Game not found' })
      }
      room.updateActivity()

      const result = handleInsertCardWithTracking(room.gameState, socket.id, data.insertPosition)

      if (!result.success) {
        return callback({ error: result.error })
      }

      room.gameState = result.state
      room.updateActivity()

      const player = room.players.find(p => p.id === socket.id)
      const playerName = player?.name || 'Player'

      // Emit notification for card insertion (without card details - it's from draw)
      if (result.insertedCard) {
        io.to(room.code).except(socket.id).emit('playerNotification', {
          type: 'info',
          message: 'added a card to their hand',
          playerName,
          cardInfo: []
        })
      }

      // If game ended, update win counts and send roomUpdate
      const previousStatus = room.gameState?.status
      const winsIncremented = incrementWinnerWins(room, previousStatus)
      // Emit roomUpdate when game ends (GAME_OVER) to ensure clients have latest player data
      if (room.gameState.status === GameStatus.GAME_OVER && previousStatus !== GameStatus.GAME_OVER) {
        emitRoomUpdate(io, room)
      } else if (winsIncremented) {
        emitRoomUpdate(io, room)
      }

      // Broadcast updated game state to all players
      room.players.forEach(player => {
        if (!player.isBot) {
          io.to(player.id).emit('gameStateUpdate', {
            gameState: { ...buildPublicState(room, player.id), roomCode: data.roomCode }
          })
        }
      })
      emitGameStateToSpectators(io, room, data.roomCode)

      callback({ success: true })
      
      // Trigger bot turn if needed
      if (room.gameState.status === GameStatus.PLAYING) {
        processBotTurn(io, room, data.roomCode)
      }
    })

    socket.on('discardCard', (data, callback) => {
      if (!checkRateLimit(socket.id)) {
        return callback({ error: 'Rate limit exceeded' })
      }
      clearTurnTimer(data.roomCode)

      const room = roomManager.getRoom(data.roomCode)
      if (!room) {
        socket.emit('roomClosed', {
          reason: 'Room no longer exists',
          roomCode: data.roomCode
        })
        return callback({ error: 'Room not found' })
      }
      if (!room.gameState) {
        return callback({ error: 'Game not found' })
      }
      room.updateActivity()

      const result = handleDiscardDrawnCardWithTracking(room.gameState, socket.id)

      if (!result.success) {
        return callback({ error: result.error })
      }

      room.gameState = result.state
      room.updateActivity()

      const player = room.players.find(p => p.id === socket.id)
      const playerName = player?.name || 'Player'

      // Emit notification for card discard (without card details)
      io.to(room.code).except(socket.id).emit('playerNotification', {
        type: 'info',
        message: 'discarded a card',
        playerName,
        cardInfo: []
      })

      // If game ended, update win counts and send roomUpdate
      const previousStatus = room.gameState?.status
      const winsIncremented = incrementWinnerWins(room, previousStatus)
      // Emit roomUpdate when game ends (GAME_OVER) to ensure clients have latest player data
      if (room.gameState.status === GameStatus.GAME_OVER && previousStatus !== GameStatus.GAME_OVER) {
        emitRoomUpdate(io, room)
      } else if (winsIncremented) {
        emitRoomUpdate(io, room)
      }

      // Broadcast updated game state to all players
      room.players.forEach(player => {
        if (!player.isBot) {
          io.to(player.id).emit('gameStateUpdate', {
            gameState: { ...buildPublicState(room, player.id), roomCode: data.roomCode }
          })
        }
      })
      emitGameStateToSpectators(io, room, data.roomCode)

      callback({ success: true })
      
      // Trigger bot turn if needed
      if (room.gameState.status === GameStatus.PLAYING) {
        processBotTurn(io, room, data.roomCode)
      }
    })

    socket.on('captureCombo', (data, callback) => {
      if (!checkRateLimit(socket.id)) {
        return callback({ error: 'Rate limit exceeded' })
      }
      clearTurnTimer(data.roomCode)

      const room = roomManager.getRoom(data.roomCode)
      if (!room) {
        socket.emit('roomClosed', {
          reason: 'Room no longer exists',
          roomCode: data.roomCode
        })
        return callback({ error: 'Room not found' })
      }
      if (!room.gameState) {
        return callback({ error: 'Game not found' })
      }
      room.updateActivity()

      // Get captured card info BEFORE processing (since it will be removed from state)
      const allCapturedCardsBefore = room.gameState.pendingCapture?.cards || []
      const capturedCardBefore = data.action === 'insert_one' && data.cardId
        ? allCapturedCardsBefore.find(c => c.id === data.cardId)
        : null

      const result = handleCaptureDecision(
        room.gameState,
        socket.id,
        data.action,
        data.insertPosition,
        data.cardId
      )

      if (!result.success) {
        return callback({ error: result.error })
      }

      room.gameState = result.state
      room.updateActivity()

      const player = room.players.find(p => p.id === socket.id)
      const playerName = player?.name || 'Player'

      // Emit notification for capture decision
      if (data.action === 'discard_all') {
        // Don't show card details for discard
        io.to(room.code).except(socket.id).emit('playerNotification', {
          type: 'info',
          message: 'discarded captured cards',
          playerName,
          cardInfo: []
        })
      } else if (data.action === 'insert_one' && capturedCardBefore) {
        // Show the captured card that was picked up
        const cardInfo = [{
          value: capturedCardBefore.resolvedValue || capturedCardBefore.value,
          isSplit: capturedCardBefore.isSplit,
          splitValues: capturedCardBefore.splitValues
        }]

        io.to(room.code).except(socket.id).emit('playerNotification', {
          type: 'info',
          message: 'picked up a captured card',
          playerName,
          cardInfo
        })
      }

      // If game ended, update win counts and send roomUpdate
      const previousStatus = room.gameState?.status
      const winsIncremented = incrementWinnerWins(room, previousStatus)
      // Emit roomUpdate when game ends (GAME_OVER) to ensure clients have latest player data
      if (room.gameState.status === GameStatus.GAME_OVER && previousStatus !== GameStatus.GAME_OVER) {
        emitRoomUpdate(io, room)
      } else if (winsIncremented) {
        emitRoomUpdate(io, room)
      }

      room.players.forEach(player => {
        if (!player.isBot) {
          io.to(player.id).emit('gameStateUpdate', {
            gameState: { ...buildPublicState(room, player.id), roomCode: data.roomCode }
          })
        }
      })
      emitGameStateToSpectators(io, room, data.roomCode)

      callback({ success: true })
      
      // Trigger bot turn if needed
      if (room.gameState.status === GameStatus.PLAYING) {
        processBotTurn(io, room, data.roomCode)
      }
    })

    socket.on('disconnect', () => {
      console.log('Client disconnected:', socket.id)
      for (const [code, room] of roomManager.rooms.entries()) {
        const isSpectator = room.spectators?.some(s => s.id === socket.id)
        if (isSpectator) {
          room.removeSpectator(socket.id)
          if (room.isEmpty()) {
            roomManager.rooms.delete(code)
          } else {
            emitRoomUpdate(io, room)
          }
          continue
        }
        if (room.getPlayer(socket.id)) {
          if (room.gameState && room.gameState.status === GameStatus.PLAYING) {
            const player = room.getPlayer(socket.id)
            if (player) player.disconnected = true
            emitRoomUpdate(io, room)
          } else {
            const updatedRoom = roomManager.leaveRoom(code, socket.id)
            if (updatedRoom) emitRoomUpdate(io, updatedRoom)
          }
        }
      }
    })
  })
}
