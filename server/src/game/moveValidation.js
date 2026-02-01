import { Card, createCardFromData } from './cardModel.js'

export function validateAdjacentCards(hand, cardIndices) {
  if (cardIndices.length === 0) {
    return false
  }

  const sortedIndices = [...cardIndices].sort((a, b) => a - b)
  
  // Check if indices are consecutive
  for (let i = 1; i < sortedIndices.length; i++) {
    if (sortedIndices[i] !== sortedIndices[i - 1] + 1) {
      return false
    }
  }

  // Check if indices are within hand bounds
  return sortedIndices.every(idx => idx >= 0 && idx < hand.length)
}

// Auto-resolve split cards to find a common value
export function autoResolveSplitCards(cards, providedResolutions = {}) {
  const resolutions = { ...providedResolutions }
  
  // First, find all possible values that cards can resolve to
  let possibleValues = null
  
  for (const card of cards) {
    if (resolutions[card.id]) {
      // Already resolved - this is our target
      const cardValues = new Set([resolutions[card.id]])
      if (possibleValues === null) {
        possibleValues = cardValues
      } else {
        possibleValues = new Set([...possibleValues].filter(v => cardValues.has(v)))
      }
    } else if (!card.isSplit) {
      // Regular card - must be this value
      const cardValues = new Set([card.value])
      if (possibleValues === null) {
        possibleValues = cardValues
      } else {
        possibleValues = new Set([...possibleValues].filter(v => cardValues.has(v)))
      }
    } else {
      // Split card - could be either value
      const cardValues = new Set(card.splitValues)
      if (possibleValues === null) {
        possibleValues = cardValues
      } else {
        possibleValues = new Set([...possibleValues].filter(v => cardValues.has(v)))
      }
    }
  }
  
  if (!possibleValues || possibleValues.size === 0) {
    return { valid: false, resolutions: {}, targetValue: null }
  }
  
  // Pick the highest possible value (for maximum beat potential)
  const targetValue = Math.max(...possibleValues)
  
  // Resolve all split cards to this value
  for (const card of cards) {
    if (card.isSplit && !resolutions[card.id]) {
      if (card.splitValues.includes(targetValue)) {
        resolutions[card.id] = targetValue
      } else {
        // Can't resolve - shouldn't happen if we got here
        return { valid: false, resolutions: {}, targetValue: null }
      }
    }
  }
  
  return { valid: true, resolutions, targetValue }
}

export function validateCombo(hand, cardIndices, splitResolutions = {}, autoResolve = true) {
  if (!validateAdjacentCards(hand, cardIndices)) {
    return { valid: false, reason: 'Cards must be adjacent' }
  }

  if (cardIndices.length === 0) {
    return { valid: false, reason: 'Must play at least one card' }
  }

  const cards = cardIndices.map(idx => {
    // Reconstruct Card object to ensure methods exist
    const cardData = hand[idx]
    return createCardFromData(cardData)
  })
  
  // Auto-resolve split cards if needed
  let finalResolutions = splitResolutions
  if (autoResolve) {
    const autoResult = autoResolveSplitCards(cards, splitResolutions)
    if (!autoResult.valid) {
      return { valid: false, reason: 'Cards cannot resolve to a common value' }
    }
    finalResolutions = autoResult.resolutions
  }
  
  const resolvedValues = cards.map((card) => {
    const cardId = card.id
    if (card.isSplit) {
      const resolution = finalResolutions[cardId]
      if (resolution === undefined) {
        return null
      }
      return card.resolveValue(resolution)
    }
    return card.value
  })

  // Check if any value is null (unresolved split card)
  if (resolvedValues.some(v => v === null)) {
    return { valid: false, reason: 'All split cards must have resolved values' }
  }

  // Check if all resolved values are the same
  const firstValue = resolvedValues[0]
  const allSame = resolvedValues.every(v => v === firstValue)

  if (!allSame) {
    return { valid: false, reason: 'All cards must resolve to the same value' }
  }

  return {
    valid: true,
    value: firstValue,
    size: cardIndices.length,
    cards: cards,
    resolvedValues: resolvedValues,
    splitResolutions: finalResolutions
  }
}

export function validateBeat(currentCombo, newCombo) {
  if (!currentCombo) {
    // Empty table - any legal combo can be played
    return { valid: true, reason: 'Empty table' }
  }

  // You can play MORE cards than the current combo
  if (newCombo.size > currentCombo.size) {
    return { valid: true, reason: 'More cards beats fewer cards' }
  }

  // If same size, value must be strictly higher
  if (newCombo.size === currentCombo.size) {
    if (newCombo.value <= currentCombo.value) {
      return { 
        valid: false, 
        reason: `Same size combo must be strictly higher value (current: ${currentCombo.value}, played: ${newCombo.value})` 
      }
    }
    return { valid: true }
  }

  // Cannot play fewer cards
  return { 
    valid: false, 
    reason: `Cannot play fewer cards than current combo (current: ${currentCombo.size}, played: ${newCombo.size})` 
  }
}

export function checkRINGOPossibility(hand, drawnCard, currentCombo = null) {
  if (!drawnCard) {
    return { possible: false }
  }

  // Try inserting drawn card at each possible position
  for (let insertPos = 0; insertPos <= hand.length; insertPos++) {
    const testHand = [...hand]
    testHand.splice(insertPos, 0, drawnCard)

    // Check all possible adjacent combos that include the drawn card
    for (let start = Math.max(0, insertPos - 4); start <= insertPos; start++) {
      for (let length = 1; length <= 5; length++) {
        const end = start + length
        if (end > testHand.length) break
        if (end <= insertPos || start > insertPos) continue // Must include drawn card

        const cardIndices = []
        for (let i = start; i < end; i++) {
          cardIndices.push(i)
        }

        // Auto-resolve split cards
        const combo = validateCombo(testHand, cardIndices, {}, true)
        if (combo.valid) {
          // Check if this combo can beat the current combo
          const beatCheck = validateBeat(currentCombo, combo)
          if (beatCheck.valid) {
            return {
              possible: true,
              insertPosition: insertPos,
              comboIndices: cardIndices.map(idx => idx < insertPos ? idx : idx - 1), // Map back to original hand indices
              combo: combo,
              splitResolutions: combo.splitResolutions
            }
          }
        }
      }
    }
  }

  return { possible: false }
}

export function findValidCombos(hand, currentCombo = null, splitResolutions = {}) {
  const validCombos = []

  // Try all possible adjacent card combinations
  for (let start = 0; start < hand.length; start++) {
    for (let length = 1; length <= hand.length - start; length++) {
      const cardIndices = []
      for (let i = start; i < start + length; i++) {
        cardIndices.push(i)
      }

      const combo = validateCombo(hand, cardIndices, splitResolutions)
      if (combo.valid) {
        const beatCheck = validateBeat(currentCombo, combo)
        if (beatCheck.valid) {
          validCombos.push({
            cardIndices,
            combo,
            insertPosition: null
          })
        }
      }
    }
  }

  return validCombos
}

export function validatePlayMove(state, playerId, cardIndices, splitResolutions = {}) {
  const player = state.players.find(p => p.id === playerId)
  if (!player) {
    return { valid: false, reason: 'Player not found' }
  }

  if (state.currentPlayerIndex !== state.players.findIndex(p => p.id === playerId)) {
    return { valid: false, reason: 'Not your turn' }
  }

  if (state.turnPhase !== 'WAITING_FOR_PLAY_OR_DRAW') {
    return { valid: false, reason: 'Invalid turn phase' }
  }

  // Validate combo
  const comboResult = validateCombo(player.hand, cardIndices, splitResolutions)
  if (!comboResult.valid) {
    return comboResult
  }

  // Check if beats current combo (or if table is empty)
  // Get resolved value from current combo card
  let currentComboValue = null
  if (state.currentCombo && state.currentCombo.length > 0) {
    const firstCard = state.currentCombo[0]
    if (firstCard.resolvedValue !== undefined && firstCard.resolvedValue !== null) {
      currentComboValue = firstCard.resolvedValue
    } else if (firstCard.isSplit) {
      // Fallback: use higher value for split cards
      currentComboValue = Math.max(...firstCard.splitValues)
    } else {
      currentComboValue = firstCard.value
    }
  }
  
  const currentCombo = state.currentCombo ? {
    size: state.currentCombo.length,
    value: currentComboValue
  } : null

  const beatResult = validateBeat(currentCombo, comboResult)
  if (!beatResult.valid) {
    return beatResult
  }

  return {
    valid: true,
    combo: comboResult,
    cardIndices
  }
}
