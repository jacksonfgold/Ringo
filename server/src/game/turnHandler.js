import { updateGameState, getCurrentPlayer, advanceTurn, checkWinCondition, checkPileClosing, shuffleDiscardIntoDraw } from './gameState.js'
import { validatePlayMove, checkRINGOPossibility, validateCombo, validateBeat } from './moveValidation.js'

function getResolvedValue(card) {
  if (card.resolvedValue !== undefined && card.resolvedValue !== null) {
    return card.resolvedValue
  }
  if (card.isSplit) {
    // Fallback: prefer higher value if not explicitly resolved
    return Math.max(...card.splitValues)
  }
  return card.value
}

function applyResolvedValues(cards, resolvedValues = []) {
  return cards.map((card, idx) => {
    if (!card.isSplit) return card
    const resolvedValue = resolvedValues[idx]
    return {
      ...card,
      resolvedValue: resolvedValue !== undefined ? resolvedValue : getResolvedValue(card)
    }
  })
}
import { TurnPhase } from './gameState.js'

export function handlePlay(state, playerId, cardIndices, splitResolutions = {}) {
  const player = state.players.find(p => p.id === playerId)
  if (!player) {
    return { success: false, error: 'Player not found', state }
  }

  // Auto-resolve split cards
  const autoSplitResolutions = { ...splitResolutions }
  // Validate indices are within bounds (validatePlayMove will catch invalid indices, but this prevents undefined access)
  const cards = cardIndices.map(idx => player.hand[idx]).filter(card => card !== undefined)
  if (cards.length !== cardIndices.length) {
    return { success: false, error: 'Invalid card indices', state }
  }
  let targetValue = null
  
  // First pass: find a non-split card value or use provided resolutions
  for (const card of cards) {
    if (!card.isSplit) {
      targetValue = card.value
      break
    } else if (autoSplitResolutions[card.id]) {
      targetValue = autoSplitResolutions[card.id]
      break
    }
  }
  
  // Second pass: resolve split cards
  for (const card of cards) {
    if (card.isSplit && !autoSplitResolutions[card.id]) {
      if (targetValue && card.splitValues.includes(targetValue)) {
        // Match the target value
        autoSplitResolutions[card.id] = targetValue
      } else if (!targetValue) {
        // Playing alone - use higher value
        autoSplitResolutions[card.id] = Math.max(...card.splitValues)
        targetValue = autoSplitResolutions[card.id]
      } else {
        // Can't match - this will fail validation
        autoSplitResolutions[card.id] = card.splitValues[0]
      }
    }
  }

  const validation = validatePlayMove(state, playerId, cardIndices, autoSplitResolutions)
  if (!validation.valid) {
    return { success: false, error: validation.reason, state }
  }

  const cardsToPlay = applyResolvedValues(
    cardIndices.map(idx => player.hand[idx]),
    validation.combo?.resolvedValues || []
  )
  
  // Remove cards from hand
  const newHand = player.hand.filter((_, idx) => !cardIndices.includes(idx))
  
  // Take previous combo if it exists and was beaten
  let newDiscardPile = [...state.discardPile]
  let previousCombo = null
  if (state.currentCombo) {
    previousCombo = [...state.currentCombo]
  }

  // Update player's hand
  const updatedPlayers = state.players.map(p => 
    p.id === playerId ? { ...p, hand: newHand } : p
  )

  // Update state
  let newState = {
    ...state,
    players: updatedPlayers,
    currentCombo: cardsToPlay,
    currentComboOwner: playerId,
    turnPhase: TurnPhase.PROCESSING_PLAY,
    discardPile: newDiscardPile
  }

  // Check win condition
  newState = checkWinCondition(newState)
  if (newState.status === 'GAME_OVER') {
    return { success: true, state: newState, previousCombo: previousCombo }
  }

  // If there was a previous combo, player must decide to discard or insert it
  if (previousCombo && previousCombo.length > 0) {
    newState = {
      ...newState,
      pendingCapture: { playerId, cards: previousCombo },
      turnPhase: TurnPhase.WAITING_FOR_CAPTURE_DECISION
    }
    return { 
      success: true, 
      state: newState, 
      previousCombo: previousCombo,
      playedCombo: cardsToPlay
    }
  }

  // Advance turn
  newState = advanceTurn(newState)
  
  // Check pile closing before advancing (this happens at start of next turn)
  newState = checkPileClosing(newState)

  return { 
    success: true, 
    state: newState, 
    previousCombo: previousCombo,
    playedCombo: cardsToPlay
  }
}

export function handleDraw(state, playerId) {
  const player = state.players.find(p => p.id === playerId)
  if (!player) {
    return { success: false, error: 'Player not found', state }
  }

  if (state.currentPlayerIndex !== state.players.findIndex(p => p.id === playerId)) {
    return { success: false, error: 'Not your turn', state }
  }

  if (state.turnPhase !== TurnPhase.WAITING_FOR_PLAY_OR_DRAW) {
    return { success: false, error: 'Invalid turn phase', state }
  }

  // Shuffle discard into draw if needed
  let newState = shuffleDiscardIntoDraw(state)
  
  if (newState.drawPile.length === 0) {
    return { success: false, error: 'No cards to draw', state: newState }
  }

  // Draw card
  const drawnCard = newState.drawPile.pop()
  
  newState = {
    ...newState,
    turnPhase: TurnPhase.PROCESSING_DRAW,
    drawPile: newState.drawPile
  }

  // Check for RINGO possibility - must beat the current combo
  const currentComboInfo = newState.currentCombo ? {
    size: newState.currentCombo.length,
    value: getResolvedValue(newState.currentCombo[0])
  } : null
  
  const ringoCheck = checkRINGOPossibility(player.hand, drawnCard, currentComboInfo)
  
  return {
    success: true,
    state: newState,
    drawnCard,
    ringoPossible: ringoCheck.possible,
    ringoInfo: ringoCheck.possible ? ringoCheck : null
  }
}

export function handleRINGO(state, playerId, insertPosition, splitResolutions = {}) {
  const player = state.players.find(p => p.id === playerId)
  if (!player) {
    return { success: false, error: 'Player not found', state }
  }

  if (state.turnPhase !== TurnPhase.PROCESSING_DRAW && state.turnPhase !== TurnPhase.RINGO_CHECK) {
    return { success: false, error: 'RINGO not available', state }
  }

  // The drawn card should be in a temporary state - we need to reconstruct
  // For now, assume the client sends the full combo including drawn card
  // This is a simplified version - in practice, you'd track the drawn card separately
  
  return { success: false, error: 'RINGO implementation needs drawn card tracking', state }
}

export function handleInsertCard(state, playerId, insertPosition) {
  const player = state.players.find(p => p.id === playerId)
  if (!player) {
    return { success: false, error: 'Player not found', state }
  }

  if (state.turnPhase !== TurnPhase.PROCESSING_DRAW && state.turnPhase !== TurnPhase.RINGO_CHECK) {
    return { success: false, error: 'Cannot insert card now', state }
  }

  // The drawn card should be tracked separately - for now, this is a placeholder
  // In practice, you'd have a temporary drawnCard in the state
  return { success: false, error: 'Card insertion needs drawn card tracking', state }
}

export function handleDiscardDrawnCard(state, playerId) {
  const player = state.players.find(p => p.id === playerId)
  if (!player) {
    return { success: false, error: 'Player not found', state }
  }

  if (state.turnPhase !== TurnPhase.PROCESSING_DRAW && state.turnPhase !== TurnPhase.RINGO_CHECK) {
    return { success: false, error: 'Cannot discard card now', state }
  }

  // Similar to insert - needs drawn card tracking
  // For now, advance turn
  let newState = advanceTurn(state)
  newState = checkPileClosing(newState)
  
  return { success: true, state: newState }
}

// Enhanced version that tracks drawn card in state
export function handleDrawWithTracking(state, playerId) {
  const result = handleDraw(state, playerId)
  if (!result.success) {
    return result
  }

  // Store drawn card in state for RINGO/insert/discard
  const newState = {
    ...result.state,
    drawnCard: result.drawnCard,
    drawnCardPlayer: playerId,
    turnPhase: result.ringoPossible ? TurnPhase.RINGO_CHECK : TurnPhase.PROCESSING_DRAW
  }

  return {
    ...result,
    state: newState
  }
}

export function handleRINGOWithTracking(state, playerId, comboIndices, insertPosition, splitResolutions = {}) {
  if (state.drawnCardPlayer !== playerId || !state.drawnCard) {
    return { success: false, error: 'No drawn card available for RINGO', state }
  }

  // Verify turn phase is correct for RINGO
  if (state.turnPhase !== TurnPhase.RINGO_CHECK && state.turnPhase !== TurnPhase.PROCESSING_DRAW) {
    return { success: false, error: 'RINGO not available in current turn phase', state }
  }

  const player = state.players.find(p => p.id === playerId)
  if (!player) {
    return { success: false, error: 'Player not found', state }
  }
  
  // comboIndices are indices from the original hand (without drawn card)
  const sortedIndices = [...comboIndices].sort((a, b) => a - b)
  
  // Find the best position to insert the drawn card
  // It should be adjacent to the selected cards
  let bestInsertPos = sortedIndices.length > 0 ? sortedIndices[sortedIndices.length - 1] + 1 : 0
  
  // Build test hand with drawn card inserted
  const testHand = [...player.hand]
  testHand.splice(bestInsertPos, 0, state.drawnCard)
  
  // Build the final combo indices in the test hand (cards + drawn card)
  const finalComboIndices = sortedIndices.map(idx => idx >= bestInsertPos ? idx + 1 : idx)
  finalComboIndices.push(bestInsertPos) // Add the drawn card position
  finalComboIndices.sort((a, b) => a - b)
  
  // Validate the combo (auto-resolves split cards)
  const comboValidation = validateCombo(testHand, finalComboIndices, {}, true)
  if (!comboValidation.valid) {
    return { success: false, error: comboValidation.reason, state }
  }
  
  // Check if it beats the current combo
  const currentComboInfo = state.currentCombo ? {
    size: state.currentCombo.length,
    value: getResolvedValue(state.currentCombo[0])
  } : null
  
  const beatCheck = validateBeat(currentComboInfo, comboValidation)
  if (!beatCheck.valid) {
    return { success: false, error: beatCheck.reason, state }
  }

  // Execute the play with drawn card
  const cardsToPlay = applyResolvedValues(
    finalComboIndices.map(idx => testHand[idx]),
    comboValidation.resolvedValues || []
  )
  
  // Remove cards from hand (including drawn card)
  const remainingIndices = testHand
    .map((_, idx) => idx)
    .filter(idx => !finalComboIndices.includes(idx))
  const newHand = remainingIndices.map(idx => testHand[idx])

  let newDiscardPile = [...state.discardPile]
  let previousCombo = null
  if (state.currentCombo) {
    previousCombo = [...state.currentCombo]
  }

  const updatedPlayers = state.players.map(p => 
    p.id === playerId ? { ...p, hand: newHand } : p
  )

  let newState = {
    ...state,
    players: updatedPlayers,
    currentCombo: cardsToPlay,
    currentComboOwner: playerId,
    turnPhase: TurnPhase.PROCESSING_PLAY,
    discardPile: newDiscardPile,
    drawnCard: null,
    drawnCardPlayer: null
  }

  newState = checkWinCondition(newState)
  if (newState.status === 'GAME_OVER') {
    return { success: true, state: newState, previousCombo, playedCombo: cardsToPlay }
  }

  if (previousCombo && previousCombo.length > 0) {
    newState = {
      ...newState,
      pendingCapture: { playerId, cards: previousCombo },
      turnPhase: TurnPhase.WAITING_FOR_CAPTURE_DECISION
    }
    return { 
      success: true, 
      state: newState, 
      previousCombo,
      playedCombo: cardsToPlay
    }
  }

  newState = advanceTurn(newState)
  newState = checkPileClosing(newState)

  return { 
    success: true, 
    state: newState, 
    previousCombo,
    playedCombo: cardsToPlay
  }
}

export function handleCaptureDecision(state, playerId, action, insertPosition, cardId) {
  if (!state.pendingCapture || state.pendingCapture.playerId !== playerId) {
    return { success: false, error: 'No pending capture for player', state }
  }

  if (state.turnPhase !== TurnPhase.WAITING_FOR_CAPTURE_DECISION) {
    return { success: false, error: 'Not waiting for capture decision', state }
  }

  const player = state.players.find(p => p.id === playerId)
  if (!player) {
    return { success: false, error: 'Player not found', state }
  }

  let newHand = [...player.hand]
  let newDiscardPile = [...state.discardPile]
  let remainingCaptured = [...state.pendingCapture.cards]

  if (action === 'discard_all') {
    newDiscardPile = [...newDiscardPile, ...remainingCaptured]
    remainingCaptured = []
  } else if (action === 'insert_one') {
    const cardIdx = remainingCaptured.findIndex(c => c.id === cardId)
    if (cardIdx === -1) return { success: false, error: 'Card not found in capture', state }
    
    const [card] = remainingCaptured.splice(cardIdx, 1)
    const position = Math.max(0, Math.min(insertPosition ?? newHand.length, newHand.length))
    newHand.splice(position, 0, card)
  } else {
    return { success: false, error: 'Invalid capture action', state }
  }

  const updatedPlayers = state.players.map(p =>
    p.id === playerId ? { ...p, hand: newHand } : p
  )

  let newState = {
    ...state,
    players: updatedPlayers,
    discardPile: newDiscardPile,
    pendingCapture: remainingCaptured.length > 0 
      ? { ...state.pendingCapture, cards: remainingCaptured }
      : null,
    turnPhase: remainingCaptured.length > 0 
      ? TurnPhase.WAITING_FOR_CAPTURE_DECISION 
      : TurnPhase.WAITING_FOR_PLAY_OR_DRAW
  }

  // Only advance turn if all cards are handled
  if (remainingCaptured.length === 0) {
    newState = advanceTurn(newState)
    newState = checkPileClosing(newState)
    newState = checkWinCondition(newState)
  }

  return { success: true, state: newState }
}

export function handleInsertCardWithTracking(state, playerId, insertPosition) {
  if (state.drawnCardPlayer !== playerId || !state.drawnCard) {
    return { success: false, error: 'No drawn card available', state }
  }

  const player = state.players.find(p => p.id === playerId)
  const newHand = [...player.hand]
  newHand.splice(insertPosition, 0, state.drawnCard)

  const updatedPlayers = state.players.map(p => 
    p.id === playerId ? { ...p, hand: newHand } : p
  )

  const insertedCard = state.drawnCard

  let newState = {
    ...state,
    players: updatedPlayers,
    drawnCard: null,
    drawnCardPlayer: null
  }

  newState = advanceTurn(newState)
  newState = checkPileClosing(newState)
  newState = checkWinCondition(newState)

  return { success: true, state: newState, insertedCard }
}

export function handleDiscardDrawnCardWithTracking(state, playerId) {
  if (state.drawnCardPlayer !== playerId || !state.drawnCard) {
    return { success: false, error: 'No drawn card available', state }
  }

  const discardedCard = state.drawnCard
  const newDiscardPile = [...state.discardPile, discardedCard]

  let newState = {
    ...state,
    discardPile: newDiscardPile,
    drawnCard: null,
    drawnCardPlayer: null
  }

  newState = advanceTurn(newState)
  newState = checkPileClosing(newState)

  return { success: true, state: newState, discardedCard }
}
