import { roomManager } from '../rooms/roomManager.js'
import { createGameState, getPublicGameState, GameStatus } from '../game/gameState.js'
import { 
  handlePlay, 
  handleDrawWithTracking, 
  handleRINGOWithTracking,
  handleInsertCardWithTracking,
  handleDiscardDrawnCardWithTracking,
  handleCaptureDecision
} from '../game/turnHandler.js'

const rateLimiter = new Map()

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

export function setupSocketHandlers(io) {
  io.on('connection', (socket) => {
    console.log('Client connected:', socket.id)

    socket.on('createRoom', (data, callback) => {
      if (!checkRateLimit(socket.id)) {
        return callback({ error: 'Rate limit exceeded' })
      }

      try {
        const room = roomManager.createRoom(socket.id, data.playerName || 'Player')
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
        socket.join(room.code)
        
        io.to(room.code).emit('roomUpdate', {
          players: room.players,
          roomCode: room.code,
          hostId: room.hostId
        })

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
        socket.join(room.code)
        
        // If game is in progress, update player ID in game state
        if (room.gameState) {
          const normalizedName = (data.playerName || '').trim().toLowerCase()
          const playerInGame = room.gameState.players.find(
            p => (p.name || '').trim().toLowerCase() === normalizedName
          ) || (previousPlayerId ? room.gameState.players.find(p => p.id === previousPlayerId) : null)
          if (playerInGame) {
            const oldId = playerInGame.id
            console.log(`[REJOIN] Updating player ${data.playerName} ID from ${oldId} to ${socket.id}`)
            console.log(`[REJOIN] Current player index: ${room.gameState.currentPlayerIndex}`)
            console.log(`[REJOIN] Player index before update: ${room.gameState.players.findIndex(p => p.id === oldId)}`)
            playerInGame.id = socket.id
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
        
        io.to(room.code).emit('roomUpdate', {
          players: room.players,
          roomCode: room.code,
          hostId: room.hostId
        })

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

    socket.on('leaveRoom', (data) => {
      const room = roomManager.leaveRoom(data.roomCode, socket.id)
      socket.leave(data.roomCode)
      
      if (room) {
        io.to(data.roomCode).emit('roomUpdate', {
          players: room.players,
          roomCode: data.roomCode,
          hostId: room.hostId
        })
      }
    })

    socket.on('startGame', (data, callback) => {
      if (!checkRateLimit(socket.id)) {
        return callback({ error: 'Rate limit exceeded' })
      }

      try {
        const room = roomManager.getRoom(data.roomCode)
        if (!room) {
          return callback({ error: 'Room not found' })
        }

        if (room.hostId !== socket.id) {
          return callback({ error: 'Only host can start the game' })
        }

        if (room.players.length < 2) {
          return callback({ error: 'Need at least 2 players to start' })
        }

        if (room.gameState && room.gameState.status === GameStatus.PLAYING) {
          return callback({ error: 'Game already in progress' })
        }

        const previousWinner = room.gameState?.previousWinner || null
        room.gameState = createGameState(room.players, previousWinner)

        // Broadcast game state to all players
        room.players.forEach(player => {
          try {
            const publicState = buildPublicState(room, player.id)
            io.to(player.id).emit('gameStateUpdate', {
              gameState: { ...publicState, roomCode: data.roomCode }
            })
          } catch (error) {
            console.error(`Error sending game state to player ${player.id}:`, error)
          }
        })

        callback({ success: true })
      } catch (error) {
        console.error('Error starting game:', error)
        callback({ error: error.message || 'Failed to start game' })
      }
    })

    socket.on('playCards', (data, callback) => {
      if (!checkRateLimit(socket.id)) {
        return callback({ error: 'Rate limit exceeded' })
      }

      const room = roomManager.getRoom(data.roomCode)
      if (!room || !room.gameState) {
        return callback({ error: 'Room or game not found' })
      }

      const result = handlePlay(
        room.gameState,
        socket.id,
        data.cardIndices,
        data.splitResolutions || {}
      )

      if (!result.success) {
        return callback({ error: result.error })
      }

      room.gameState = result.state

      if (room.gameState.status === GameStatus.GAME_OVER && room.gameState.winner) {
        const winner = room.players.find(p => p.id === room.gameState.winner)
        if (winner) {
          winner.wins = (winner.wins || 0) + 1
        }
        io.to(room.code).emit('roomUpdate', {
          players: room.players,
          roomCode: room.code,
          hostId: room.hostId
        })
      }

      // Broadcast updated game state to all players
      room.players.forEach(player => {
        io.to(player.id).emit('gameStateUpdate', {
          gameState: { ...buildPublicState(room, player.id), roomCode: data.roomCode },
          previousCombo: result.previousCombo,
          playedCombo: result.playedCombo
        })
      })

      callback({ success: true })
    })

    socket.on('drawCard', (data, callback) => {
      if (!checkRateLimit(socket.id)) {
        return callback({ error: 'Rate limit exceeded' })
      }

      const room = roomManager.getRoom(data.roomCode)
      if (!room || !room.gameState) {
        return callback({ error: 'Room or game not found' })
      }

      const result = handleDrawWithTracking(room.gameState, socket.id)

      if (!result.success) {
        return callback({ error: result.error })
      }

      room.gameState = result.state

      // Send drawn card only to the player who drew it
      io.to(socket.id).emit('cardDrawn', {
        card: result.drawnCard,
        ringoPossible: result.ringoPossible,
        ringoInfo: result.ringoInfo
      })

      // Broadcast updated game state (without drawn card info) to all players
      room.players.forEach(player => {
        io.to(player.id).emit('gameStateUpdate', {
          gameState: { ...buildPublicState(room, player.id), roomCode: data.roomCode }
        })
      })

      callback({ success: true, ringoPossible: result.ringoPossible })
    })

    socket.on('ringo', (data, callback) => {
      if (!checkRateLimit(socket.id)) {
        return callback({ error: 'Rate limit exceeded' })
      }

      const room = roomManager.getRoom(data.roomCode)
      if (!room || !room.gameState) {
        return callback({ error: 'Room or game not found' })
      }

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

      room.gameState = result.state

      if (room.gameState.status === GameStatus.GAME_OVER && room.gameState.winner) {
        const winner = room.players.find(p => p.id === room.gameState.winner)
        if (winner) {
          winner.wins = (winner.wins || 0) + 1
        }
        io.to(room.code).emit('roomUpdate', {
          players: room.players,
          roomCode: room.code,
          hostId: room.hostId
        })
      }

      // Broadcast updated game state to all players
      room.players.forEach(player => {
        io.to(player.id).emit('gameStateUpdate', {
          gameState: { ...buildPublicState(room, player.id), roomCode: data.roomCode },
          previousCombo: result.previousCombo,
          playedCombo: result.playedCombo,
          ringo: true
        })
      })

      callback({ success: true })
    })

    socket.on('insertCard', (data, callback) => {
      if (!checkRateLimit(socket.id)) {
        return callback({ error: 'Rate limit exceeded' })
      }

      const room = roomManager.getRoom(data.roomCode)
      if (!room || !room.gameState) {
        return callback({ error: 'Room or game not found' })
      }

      const result = handleInsertCardWithTracking(room.gameState, socket.id, data.insertPosition)

      if (!result.success) {
        return callback({ error: result.error })
      }

      room.gameState = result.state

      // If game ended, update win counts and send roomUpdate
      if (room.gameState.status === GameStatus.GAME_OVER && room.gameState.winner) {
        const winner = room.players.find(p => p.id === room.gameState.winner)
        if (winner) {
          winner.wins = (winner.wins || 0) + 1
        }
        io.to(room.code).emit('roomUpdate', {
          players: room.players,
          roomCode: room.code,
          hostId: room.hostId
        })
      }

      // Broadcast updated game state to all players
      room.players.forEach(player => {
        io.to(player.id).emit('gameStateUpdate', {
          gameState: { ...buildPublicState(room, player.id), roomCode: data.roomCode }
        })
      })

      callback({ success: true })
    })

    socket.on('discardCard', (data, callback) => {
      if (!checkRateLimit(socket.id)) {
        return callback({ error: 'Rate limit exceeded' })
      }

      const room = roomManager.getRoom(data.roomCode)
      if (!room || !room.gameState) {
        return callback({ error: 'Room or game not found' })
      }

      const result = handleDiscardDrawnCardWithTracking(room.gameState, socket.id)

      if (!result.success) {
        return callback({ error: result.error })
      }

      room.gameState = result.state

      // If game ended, update win counts and send roomUpdate
      if (room.gameState.status === GameStatus.GAME_OVER && room.gameState.winner) {
        const winner = room.players.find(p => p.id === room.gameState.winner)
        if (winner) {
          winner.wins = (winner.wins || 0) + 1
        }
        io.to(room.code).emit('roomUpdate', {
          players: room.players,
          roomCode: room.code,
          hostId: room.hostId
        })
      }

      // Broadcast updated game state to all players
      room.players.forEach(player => {
        io.to(player.id).emit('gameStateUpdate', {
          gameState: { ...buildPublicState(room, player.id), roomCode: data.roomCode }
        })
      })

      callback({ success: true })
    })

    socket.on('captureCombo', (data, callback) => {
      if (!checkRateLimit(socket.id)) {
        return callback({ error: 'Rate limit exceeded' })
      }

      const room = roomManager.getRoom(data.roomCode)
      if (!room || !room.gameState) {
        return callback({ error: 'Room or game not found' })
      }

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

      // If game ended, update win counts and send roomUpdate
      if (room.gameState.status === GameStatus.GAME_OVER && room.gameState.winner) {
        const winner = room.players.find(p => p.id === room.gameState.winner)
        if (winner) {
          winner.wins = (winner.wins || 0) + 1
        }
        io.to(room.code).emit('roomUpdate', {
          players: room.players,
          roomCode: room.code,
          hostId: room.hostId
        })
      }

      room.players.forEach(player => {
        io.to(player.id).emit('gameStateUpdate', {
          gameState: { ...buildPublicState(room, player.id), roomCode: data.roomCode }
        })
      })

      callback({ success: true })
    })

    socket.on('disconnect', () => {
      console.log('Client disconnected:', socket.id)
      
      // Find and remove player from any rooms
      for (const [code, room] of roomManager.rooms.entries()) {
        if (room.getPlayer(socket.id)) {
          // If a game is in progress, keep the player in the room and mark disconnected
          if (room.gameState && room.gameState.status === GameStatus.PLAYING) {
            const player = room.getPlayer(socket.id)
            if (player) {
              player.disconnected = true
            }
            io.to(code).emit('roomUpdate', {
              players: room.players,
              roomCode: code,
              hostId: room.hostId
            })
          } else {
            const updatedRoom = roomManager.leaveRoom(code, socket.id)
            if (updatedRoom) {
              io.to(code).emit('roomUpdate', {
                players: updatedRoom.players,
                roomCode: code,
                hostId: updatedRoom.hostId
              })
            }
          }
        }
      }
    })
  })
}
