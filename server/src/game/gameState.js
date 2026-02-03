import { createDeck, shuffleDeck } from './cardModel.js'

export const GameStatus = {
  LOBBY: 'LOBBY',
  PLAYING: 'PLAYING',
  GAME_OVER: 'GAME_OVER'
}

export const TurnPhase = {
  WAITING_FOR_PLAY_OR_DRAW: 'WAITING_FOR_PLAY_OR_DRAW',
  PROCESSING_PLAY: 'PROCESSING_PLAY',
  PROCESSING_DRAW: 'PROCESSING_DRAW',
  RINGO_CHECK: 'RINGO_CHECK',
  WAITING_FOR_CAPTURE_DECISION: 'WAITING_FOR_CAPTURE_DECISION'
}

export function createGameState(players, previousWinner = null, settings = {}) {
  const numPlayers = players.length
  // Use settings handSize if provided, otherwise use default logic
  const handSize = settings?.handSize || (numPlayers <= 3 ? 10 : 8)

  const deck = createDeck()
  const gamePlayers = players.map((player, index) => ({
    id: player.id,
    name: player.name,
    hand: [],
    handSize: 0
  }))

  // Deal cards
  for (let i = 0; i < handSize; i++) {
    for (const player of gamePlayers) {
      if (deck.length > 0) {
        player.hand.push(deck.pop())
      }
    }
  }

  // Set hand sizes
  gamePlayers.forEach(player => {
    player.handSize = player.hand.length
  })

  // Determine first player
  let currentPlayerIndex = 0
  if (previousWinner) {
    const winnerIndex = gamePlayers.findIndex(p => p.id === previousWinner)
    if (winnerIndex !== -1) {
      currentPlayerIndex = winnerIndex
    } else {
      currentPlayerIndex = Math.floor(Math.random() * numPlayers)
    }
  } else {
    currentPlayerIndex = Math.floor(Math.random() * numPlayers)
  }

  return {
    status: GameStatus.PLAYING,
    players: gamePlayers,
    drawPile: deck,
    discardPile: [],
    currentCombo: null,
    currentComboOwner: null,
    currentPlayerIndex,
    turnPhase: TurnPhase.WAITING_FOR_PLAY_OR_DRAW,
    previousWinner: null,
    winner: null
  }
}

export function updateGameState(state, updates) {
  return {
    ...state,
    ...updates
  }
}

export function getCurrentPlayer(state) {
  return state.players[state.currentPlayerIndex]
}

export function getPlayerById(state, playerId) {
  return state.players.find(p => p.id === playerId)
}

export function getPlayerIndex(state, playerId) {
  return state.players.findIndex(p => p.id === playerId)
}

export function advanceTurn(state) {
  const nextIndex = (state.currentPlayerIndex + 1) % state.players.length
  return updateGameState(state, {
    currentPlayerIndex: nextIndex,
    turnPhase: TurnPhase.WAITING_FOR_PLAY_OR_DRAW
  })
}

export function checkWinCondition(state) {
  for (const player of state.players) {
    if (player.hand.length === 0) {
      return {
        ...state,
        status: GameStatus.GAME_OVER,
        winner: player.id,
        previousWinner: player.id
      }
    }
  }
  return state
}

export function checkPileClosing(state) {
  if (!state.currentCombo || !state.currentComboOwner) {
    return state
  }

  const currentPlayer = getCurrentPlayer(state)
  if (currentPlayer.id === state.currentComboOwner) {
    // Pile closes - discard current combo and reset table
    const newDiscardPile = [...state.discardPile, ...state.currentCombo]
    return updateGameState(state, {
      currentCombo: null,
      currentComboOwner: null,
      discardPile: newDiscardPile
    })
  }

  return state
}

export function shuffleDiscardIntoDraw(state) {
  if (state.drawPile.length === 0 && state.discardPile.length > 0) {
    // Shuffle the discard pile and make it the new draw pile
    const shuffled = shuffleDeck([...state.discardPile])
    return updateGameState(state, {
      drawPile: shuffled,
      discardPile: []
    })
  }
  return state
}

export function getPublicGameState(state, playerId) {
  const player = getPlayerById(state, playerId)
  if (!player) {
    return null
  }

  return {
    status: state.status,
    players: state.players.map(p => ({
      id: p.id,
      name: p.name,
      handSize: p.id === playerId ? p.hand.length : p.hand.length,
      hand: p.id === playerId ? p.hand : undefined
    })),
    drawPileSize: state.drawPile.length,
    discardPileSize: state.discardPile.length,
    currentCombo: state.currentCombo,
    currentComboOwner: state.currentComboOwner,
    currentPlayerIndex: state.currentPlayerIndex,
    turnPhase: state.turnPhase,
    pendingCapture: state.pendingCapture && state.pendingCapture.playerId === playerId
      ? state.pendingCapture
      : null,
    winner: state.winner
  }
}
