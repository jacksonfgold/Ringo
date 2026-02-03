// AI Bot implementation with 4 difficulty levels
import { randomUUID } from 'crypto'
import {
  nightmareModeDecision,
  nightmareModeCapture,
  nightmareModeInsert,
  nightmareModeRingo
} from './nightmareBot.js'
import { validateCombo, validateBeat, findValidCombos } from './moveValidation.js'
import { createDeck } from './cardModel.js'

export const BotDifficulty = {
  EASY: 'EASY',
  MEDIUM: 'MEDIUM',
  HARD: 'HARD',
  NIGHTMARE: 'NIGHTMARE'
}

// Create a bot player
export function createBot(difficulty, botNumber) {
  const difficultyNames = {
    [BotDifficulty.EASY]: 'Rookie',
    [BotDifficulty.MEDIUM]: 'Pro',
    [BotDifficulty.HARD]: 'Master',
    [BotDifficulty.NIGHTMARE]: 'Nightmare'
  }
  
  return {
    id: `bot-${randomUUID()}`,
    name: `${difficultyNames[difficulty]} Bot ${botNumber}`,
    isBot: true,
    difficulty,
    disconnected: false,
    wins: 0
  }
}

// ============ HAND ANALYSIS HELPERS ============

// Find all adjacent groups of same value in hand
export function findAdjacentGroups(hand) {
  if (!hand || hand.length === 0) return []
  
  const groups = []
  let currentGroup = [0]
  
  for (let i = 1; i < hand.length; i++) {
    const prevCard = hand[i - 1]
    const currCard = hand[i]
    
    // Check if cards can share a value (considering splits)
    const prevValues = prevCard.isSplit ? prevCard.splitValues : [prevCard.value]
    const currValues = currCard.isSplit ? currCard.splitValues : [currCard.value]
    
    const sharedValue = prevValues.find(v => currValues.includes(v))
    
    if (sharedValue !== undefined) {
      currentGroup.push(i)
    } else {
      if (currentGroup.length >= 1) {
        groups.push({ indices: [...currentGroup], size: currentGroup.length })
      }
      currentGroup = [i]
    }
  }
  
  if (currentGroup.length >= 1) {
    groups.push({ indices: [...currentGroup], size: currentGroup.length })
  }
  
  return groups
}

// Get the resolved value for a group (highest common value)
function getGroupValue(hand, indices) {
  if (indices.length === 0) return 0
  
  let possibleValues = null
  
  for (const idx of indices) {
    const card = hand[idx]
    const cardValues = new Set(card.isSplit ? card.splitValues : [card.value])
    
    if (possibleValues === null) {
      possibleValues = cardValues
    } else {
      possibleValues = new Set([...possibleValues].filter(v => cardValues.has(v)))
    }
  }
  
  return possibleValues ? Math.max(...possibleValues) : 0
}

// Calculate "messiness" - how fragmented the hand is
export function calculateMessiness(hand) {
  if (!hand || hand.length === 0) return 0
  
  const groups = findAdjacentGroups(hand)
  // Messiness = number of groups - 1 (more groups = messier)
  // Also add penalty for blockers between same values
  
  let messiness = groups.length - 1
  
  // Count blockers (cards between same-value cards)
  const valuePositions = {}
  hand.forEach((card, idx) => {
    const values = card.isSplit ? card.splitValues : [card.value]
    values.forEach(v => {
      if (!valuePositions[v]) valuePositions[v] = []
      valuePositions[v].push(idx)
    })
  })
  
  for (const positions of Object.values(valuePositions)) {
    if (positions.length >= 2) {
      // Count gaps between same-value cards
      for (let i = 1; i < positions.length; i++) {
        const gap = positions[i] - positions[i - 1] - 1
        if (gap > 0) messiness += gap * 0.5
      }
    }
  }
  
  return messiness
}

// Find all valid plays that can beat the current combo
function findValidPlays(hand, currentCombo) {
  const plays = []
  const groups = findAdjacentGroups(hand)
  
  // For each possible starting position and length
  for (let start = 0; start < hand.length; start++) {
    for (let len = 1; len <= hand.length - start; len++) {
      const indices = []
      for (let i = start; i < start + len; i++) {
        indices.push(i)
      }
      
      // Check if all cards can resolve to same value
      let possibleValues = null
      let valid = true
      
      for (const idx of indices) {
        const card = hand[idx]
        const cardValues = new Set(card.isSplit ? card.splitValues : [card.value])
        
        if (possibleValues === null) {
          possibleValues = cardValues
        } else {
          possibleValues = new Set([...possibleValues].filter(v => cardValues.has(v)))
          if (possibleValues.size === 0) {
            valid = false
            break
          }
        }
      }
      
      if (!valid || !possibleValues || possibleValues.size === 0) continue
      
      const maxValue = Math.max(...possibleValues)
      
      // Check if it beats current combo
      if (!currentCombo || currentCombo.length === 0) {
        // Empty table - any play is valid
        plays.push({ indices, size: indices.length, value: maxValue })
      } else {
        const comboSize = currentCombo.length
        const comboValue = currentCombo[0].resolvedValue || 
          (currentCombo[0].isSplit ? Math.max(...currentCombo[0].splitValues) : currentCombo[0].value)
        
        // Can beat with more cards, or same cards with higher value
        if (indices.length > comboSize || 
            (indices.length === comboSize && maxValue > comboValue)) {
          plays.push({ indices, size: indices.length, value: maxValue })
        }
      }
    }
  }
  
  return plays
}

// Find best insertion position for a card
function findBestInsertPosition(hand, card, difficulty) {
  if (!hand || hand.length === 0) return 0
  
  const cardValues = card.isSplit ? card.splitValues : [card.value]
  let bestPos = hand.length
  let bestScore = -Infinity
  
  for (let pos = 0; pos <= hand.length; pos++) {
    let score = 0
    
    // Check adjacency with neighbors
    if (pos > 0) {
      const leftCard = hand[pos - 1]
      const leftValues = leftCard.isSplit ? leftCard.splitValues : [leftCard.value]
      if (cardValues.some(v => leftValues.includes(v))) {
        score += 10 // Can form group with left neighbor
      }
    }
    
    if (pos < hand.length) {
      const rightCard = hand[pos]
      const rightValues = rightCard.isSplit ? rightCard.splitValues : [rightCard.value]
      if (cardValues.some(v => rightValues.includes(v))) {
        score += 10 // Can form group with right neighbor
      }
    }
    
    // For medium/hard: check if it bridges two same-value cards
    if (difficulty !== BotDifficulty.EASY) {
      // Check if inserting here would join separated same-value cards
      const testHand = [...hand]
      testHand.splice(pos, 0, card)
      const newMessiness = calculateMessiness(testHand)
      const oldMessiness = calculateMessiness(hand)
      score += (oldMessiness - newMessiness) * 5
    }
    
    if (score > bestScore) {
      bestScore = score
      bestPos = pos
    }
  }
  
  return bestPos
}

// ============ EASY MODE AI ============

function easyModeDecision(gameState, botId) {
  const bot = gameState.players.find(p => p.id === botId)
  if (!bot || !bot.hand) return null
  
  const hand = bot.hand
  const currentCombo = gameState.currentCombo
  
  // Find valid plays
  const validPlays = findValidPlays(hand, currentCombo)
  
  // Check if opponent is very close to winning (≤2 cards) - even easy mode should try to prevent this
  const opponents = gameState.players.filter(p => p.id !== botId && p.hand)
  const minOpponentCards = Math.min(...opponents.map(p => p.hand?.length || 99))
  const opponentVeryClose = minOpponentCards <= 2
  
  if (!currentCombo || currentCombo.length === 0) {
    // Table is empty - play largest group, tie-break by highest value
    if (validPlays.length === 0) return { action: 'draw' }
    
    validPlays.sort((a, b) => {
      if (b.size !== a.size) return b.size - a.size
      return b.value - a.value
    })
    
    return { action: 'play', indices: validPlays[0].indices }
  }
  
  // Table has combo - ALWAYS beat if opponent is very close to winning
  if (validPlays.length === 0) {
    return { action: 'draw' }
  }
  
  // If opponent is very close, beat immediately
  if (opponentVeryClose) {
    validPlays.sort((a, b) => {
      if (a.size !== b.size) return a.size - b.size
      return a.value - b.value
    })
    return { action: 'play', indices: validPlays[0].indices }
  }
  
  // Otherwise, try to beat with smallest number of cards, lowest value
  validPlays.sort((a, b) => {
    if (a.size !== b.size) return a.size - b.size
    return a.value - b.value
  })
  
  return { action: 'play', indices: validPlays[0].indices }
}

function easyModeCapture(gameState, botId, capturedCards) {
  const bot = gameState.players.find(p => p.id === botId)
  if (!bot || !bot.hand) return { action: 'discard_all' }
  
  // Easy mode: only take doubles (they're too valuable to pass up)
  if (capturedCards.some(c => c.isSplit)) {
    return { action: 'insert_all' }
  }
  
  // Otherwise always discard (keep it simple but not completely dumb)
  return { action: 'discard_all' }
}

function easyModeInsert(gameState, botId, card) {
  const bot = gameState.players.find(p => p.id === botId)
  // Insert randomly or at end
  const pos = Math.random() < 0.5 ? bot.hand.length : Math.floor(Math.random() * (bot.hand.length + 1))
  return { position: pos }
}

function easyModeRingo(gameState, botId, drawnCard, ringoPossible) {
  // 50% chance to take RINGO opportunity
  if (ringoPossible && Math.random() < 0.5) {
    return { action: 'ringo' }
  }
  return { action: 'insert' }
}

// ============ MEDIUM MODE AI ============

function mediumModeDecision(gameState, botId) {
  const bot = gameState.players.find(p => p.id === botId)
  if (!bot || !bot.hand) return null
  
  const hand = bot.hand
  const currentCombo = gameState.currentCombo
  const validPlays = findValidPlays(hand, currentCombo)
  
  // Check if any opponent is close to winning (≤4 cards is dangerous)
  const opponents = gameState.players.filter(p => p.id !== botId && p.hand)
  const opponentCards = opponents.map(p => p.hand?.length || 99)
  const minOpponentCards = Math.min(...opponentCards)
  const opponentInDanger = minOpponentCards <= 4
  const opponentVeryClose = minOpponentCards <= 2
  const nextPlayerIndex = (gameState.currentPlayerIndex + 1) % gameState.players.length
  const nextPlayer = gameState.players[nextPlayerIndex]
  const nextPlayerCards = nextPlayer?.hand?.length || 99
  
  if (!currentCombo || currentCombo.length === 0) {
    // Table is empty - use smart lead selection
    if (validPlays.length === 0) return { action: 'draw' }
    
    // If opponent is very close, lead with something hard to beat
    if (opponentVeryClose) {
      validPlays.sort((a, b) => {
        const aScore = a.size * 15 + a.value
        const bScore = b.size * 15 + b.value
        return bScore - aScore
      })
      return { action: 'play', indices: validPlays[0].indices }
    }
    
    // Find plays that reduce messiness most and unblock cards
    let bestPlay = null
    let bestScore = -Infinity
    
    for (const play of validPlays) {
      const testHand = hand.filter((_, i) => !play.indices.includes(i))
      const oldMessiness = calculateMessiness(hand)
      const newMessiness = calculateMessiness(testHand)
      const messinessReduction = oldMessiness - newMessiness
      
      // Check if this play unblocks cards (creates new adjacent groups)
      const oldGroups = findAdjacentGroups(hand)
      const newGroups = findAdjacentGroups(testHand)
      // Bonus if we reduce number of groups or create larger groups
      let unblockBonus = 0
      if (newGroups.length < oldGroups.length) {
        unblockBonus += 12 // Fewer groups = unblocked cards
      }
      const oldMaxSize = Math.max(...oldGroups.map(g => g.size), 0)
      const newMaxSize = Math.max(...newGroups.map(g => g.size), 0)
      if (newMaxSize > oldMaxSize) {
        unblockBonus += 10 // Created a larger group
      }
      
      const score = messinessReduction * 5 + unblockBonus + play.size * 2 + play.value
      
      if (score > bestScore) {
        bestScore = score
        bestPlay = play
      }
    }
    
    return { action: 'play', indices: bestPlay?.indices || validPlays[0].indices }
  }
  
  // Table has combo - ALWAYS beat if opponent is close to winning
  if (validPlays.length === 0) {
    return { action: 'draw' }
  }
  
  // CRITICAL: If opponent is very close (≤2 cards), beat immediately with any play
  if (opponentVeryClose) {
    // Prefer efficient beats but will use anything
    validPlays.sort((a, b) => {
      if (a.size !== b.size) return a.size - b.size
      return a.value - b.value
    })
    return { action: 'play', indices: validPlays[0].indices }
  }
  
  // If opponent in danger (≤4 cards), prioritize beating
  if (opponentInDanger) {
    // Prefer efficient beats
    validPlays.sort((a, b) => {
      if (a.size !== b.size) return a.size - b.size
      return a.value - b.value
    })
    return { action: 'play', indices: validPlays[0].indices }
  }
  
  // If next player is close, prefer larger plays to force them to draw
  if (nextPlayerCards <= 3) {
    validPlays.sort((a, b) => {
      if (b.size !== a.size) return b.size - a.size
      return a.value - b.value
    })
    return { action: 'play', indices: validPlays[0].indices }
  }
  
  // Otherwise, prefer plays that reduce messiness and unblock cards
  let bestPlay = null
  let bestScore = -Infinity
  
  for (const play of validPlays) {
    const testHand = hand.filter((_, i) => !play.indices.includes(i))
    const oldMessiness = calculateMessiness(hand)
    const newMessiness = calculateMessiness(testHand)
    const messinessReduction = oldMessiness - newMessiness
    
    // Check if this play unblocks cards (creates new adjacent groups)
    const oldGroups = findAdjacentGroups(hand)
    const newGroups = findAdjacentGroups(testHand)
    // Bonus if we reduce number of groups (unblocked cards)
    let unblockBonus = 0
    if (newGroups.length < oldGroups.length) {
      unblockBonus += 18 // Fewer groups = unblocked cards
    }
    // Bonus if we create a larger group
    const oldMaxSize = Math.max(...oldGroups.map(g => g.size), 0)
    const newMaxSize = Math.max(...newGroups.map(g => g.size), 0)
    if (newMaxSize > oldMaxSize) {
      unblockBonus += 15 // Created a larger group by unblocking
    }
    
    const score = messinessReduction * 6 + unblockBonus - play.size * 2 + play.value
    
    if (score > bestScore) {
      bestScore = score
      bestPlay = play
    }
  }
  
  return { action: 'play', indices: bestPlay?.indices || validPlays[0].indices }
}

function mediumModeCapture(gameState, botId, capturedCards) {
  const bot = gameState.players.find(p => p.id === botId)
  if (!bot || !bot.hand) return { action: 'discard_all' }
  
  // Check if opponent is close to winning - if so, be more selective
  const opponents = gameState.players.filter(p => p.id !== botId && p.hand)
  const minOpponentCards = Math.min(...opponents.map(p => p.hand?.length || 99))
  const opponentClose = minOpponentCards <= 3
  
  // Always take doubles (they're too valuable)
  if (capturedCards.some(c => c.isSplit)) {
    return { action: 'insert_all' }
  }
  
  // Be more selective - only take if it creates/extends a group of 3+
  let takeScore = 0
  let wouldCreateTriple = false
  
  for (const card of capturedCards) {
    const cardValues = card.isSplit ? card.splitValues : [card.value]
    
    // Check if it would create a triple or larger group
    for (const value of cardValues) {
      const matchingCards = bot.hand.filter(c => {
        const values = c.isSplit ? c.splitValues : [c.value]
        return values.includes(value)
      }).length
      
      if (matchingCards >= 2) {
        wouldCreateTriple = true
        takeScore += 10 // Triples are very valuable
      } else if (matchingCards === 1) {
        takeScore += 3 // Would create a pair
      }
    }
  }
  
  // Penalty for taking cards (adds to hand size)
  const takePenalty = capturedCards.length * (opponentClose ? 4 : 3)
  
  // Only take if it significantly helps (creates triple, or good value)
  if (wouldCreateTriple || takeScore > takePenalty) {
    return { action: 'insert_all' }
  }
  
  return { action: 'discard_all' }
}

function mediumModeInsert(gameState, botId, card) {
  const bot = gameState.players.find(p => p.id === botId)
  const pos = findBestInsertPosition(bot.hand, card, BotDifficulty.MEDIUM)
  return { position: pos }
}

function mediumModeRingo(gameState, botId, drawnCard, ringoPossible) {
  // Always take RINGO
  if (ringoPossible) {
    return { action: 'ringo' }
  }
  return { action: 'insert' }
}

// ============ HARD MODE AI ============

// Track seen cards for hard mode
const seenCards = new Map() // roomCode -> { value: count }

export function initSeenCards(roomCode) {
  seenCards.set(roomCode, {
    values: { 1: 4, 2: 4, 3: 4, 4: 4, 5: 4, 6: 4, 7: 4, 8: 4 },
    splits: { '5/6': 4 }
  })
}

export function updateSeenCards(roomCode, cards, action) {
  const seen = seenCards.get(roomCode)
  if (!seen) return
  
  for (const card of cards) {
    if (action === 'discard') {
      if (card.isSplit) {
        // Split cards are harder to track
      } else {
        seen.values[card.value] = Math.max(0, (seen.values[card.value] || 0) - 1)
      }
    }
  }
}

function hardModeDecision(gameState, botId) {
  const bot = gameState.players.find(p => p.id === botId)
  if (!bot || !bot.hand) return null
  
  const hand = bot.hand
  const currentCombo = gameState.currentCombo
  const validPlays = findValidPlays(hand, currentCombo)
  
  // Check opponents - be more aggressive about defensive play
  const opponents = gameState.players.filter(p => p.id !== botId && p.hand)
  const minOpponentCards = Math.min(...opponents.map(p => p.hand?.length || 99))
  const opponentInDanger = minOpponentCards <= 4
  const opponentVeryClose = minOpponentCards <= 2
  const nextPlayerIndex = (gameState.currentPlayerIndex + 1) % gameState.players.length
  const nextPlayer = gameState.players[nextPlayerIndex]
  const nextPlayerCards = nextPlayer?.hand?.length || 99
  
  if (!currentCombo || currentCombo.length === 0) {
    // Table is empty - strategic lead
    if (validPlays.length === 0) return { action: 'draw' }
    
    if (opponentInDanger) {
      // Lead with something hard to beat
      // Prefer larger groups or high-value pairs
      validPlays.sort((a, b) => {
        const aScore = a.size * 10 + a.value
        const bScore = b.size * 10 + b.value
        return bScore - aScore
      })
    } else {
      // Minimize turns to empty
      let bestPlay = null
      let bestScore = -Infinity
      
      for (const play of validPlays) {
        const testHand = hand.filter((_, i) => !play.indices.includes(i))
        const turnsToEmpty = estimateTurnsToEmpty(testHand)
        const messinessReduction = calculateMessiness(hand) - calculateMessiness(testHand)
        const score = -turnsToEmpty * 5 + messinessReduction * 3 + play.size * 2
        
        if (score > bestScore) {
          bestScore = score
          bestPlay = play
        }
      }
      
      if (bestPlay) return { action: 'play', indices: bestPlay.indices }
    }
    
    return { action: 'play', indices: validPlays[0].indices }
  }
  
  // Table has combo - CRITICAL: Always beat if opponent is very close
  if (validPlays.length === 0) {
    return { action: 'draw' }
  }
  
  // EMERGENCY: If opponent is very close (≤2 cards), beat immediately with ANY play
  if (opponentVeryClose) {
    // Use most efficient beat available
    validPlays.sort((a, b) => {
      if (a.size !== b.size) return a.size - b.size
      return a.value - b.value
    })
    return { action: 'play', indices: validPlays[0].indices }
  }
  
  let bestPlay = null
  let bestScore = -Infinity
  
  for (const play of validPlays) {
    const testHand = hand.filter((_, i) => !play.indices.includes(i))
    
    // Score components
    const cardsShed = play.size
    const oldMessiness = calculateMessiness(hand)
    const newMessiness = calculateMessiness(testHand)
    const messinessReduction = oldMessiness - newMessiness
    
    // Check if this play unblocks cards (creates new adjacent groups)
    const oldGroups = findAdjacentGroups(hand)
    const newGroups = findAdjacentGroups(testHand)
    // Bonus if we create larger groups or reduce group count significantly
    let unblockBonus = 0
    if (newGroups.length < oldGroups.length) {
      unblockBonus += 20 // Reduced number of groups is good
    }
    const oldMaxGroupSize = Math.max(...oldGroups.map(g => g.size), 0)
    const newMaxGroupSize = Math.max(...newGroups.map(g => g.size), 0)
    if (newMaxGroupSize > oldMaxGroupSize) {
      unblockBonus += 15 // Created a larger group
    }
    
    const tempoGain = opponentInDanger ? 15 : (minOpponentCards <= 5 ? 8 : 0) // Much higher priority
    const ammoSpent = play.size >= 3 ? play.size : 0
    
    // Denial: if next player has few cards, prefer plays that force them to draw
    let denialBonus = 0
    if (nextPlayerCards <= 3) {
      // Prefer larger combos that opponent likely can't match
      denialBonus = play.size * 5
      // Extra bonus if it's a triple or larger
      if (play.size >= 3) denialBonus += 10
    }
    
    // Defensive bonus: if we can prevent opponent from winning
    let defensiveBonus = 0
    if (opponentInDanger) {
      defensiveBonus = 20 // Strong preference to beat
    }
    
    const score = 6 * cardsShed + 6 * messinessReduction + unblockBonus + tempoGain - 3 * ammoSpent + denialBonus + defensiveBonus
    
    // Add small randomness (5%)
    const randomFactor = (Math.random() - 0.5) * score * 0.05
    
    if (score + randomFactor > bestScore) {
      bestScore = score + randomFactor
      bestPlay = play
    }
  }
  
  return { action: 'play', indices: bestPlay?.indices || validPlays[0].indices }
}

function estimateTurnsToEmpty(hand) {
  if (!hand || hand.length === 0) return 0
  
  const groups = findAdjacentGroups(hand)
  const messiness = calculateMessiness(hand)
  
  // Rough estimate: number of groups + penalty for messiness
  return groups.length + messiness * 0.5
}

function hardModeCapture(gameState, botId, capturedCards) {
  const bot = gameState.players.find(p => p.id === botId)
  if (!bot || !bot.hand) return { action: 'discard_all' }
  
  // Check if opponent is close to winning - be very selective
  const opponents = gameState.players.filter(p => p.id !== botId && p.hand)
  const minOpponentCards = Math.min(...opponents.map(p => p.hand?.length || 99))
  const opponentClose = minOpponentCards <= 4
  
  // Always take doubles (they're too valuable)
  if (capturedCards.some(c => c.isSplit)) {
    return { action: 'insert_all' }
  }
  
  // Be very selective - only take if it creates a triple or significantly improves hand
  let takeScore = 0
  let wouldCreateTriple = false
  let wouldCreateLargeGroup = false
  
  for (const card of capturedCards) {
    const cardValues = card.isSplit ? card.splitValues : [card.value]
    
    // Check if it would create a triple or larger group
    for (const value of cardValues) {
      const matchingCards = bot.hand.filter(c => {
        const values = c.isSplit ? c.splitValues : [c.value]
        return values.includes(value)
      }).length
      
      if (matchingCards >= 2) {
        wouldCreateTriple = true
        takeScore += 15 // Triples are extremely valuable
        if (matchingCards >= 3) {
          wouldCreateLargeGroup = true
          takeScore += 10 // Even larger groups
        }
      } else if (matchingCards === 1) {
        takeScore += 2 // Would create a pair (less valuable)
      }
    }
    
    // High cards late game (hand ≤5) are more valuable
    if (bot.hand.length <= 5 && Math.max(...cardValues) >= 7) {
      takeScore += 3
    }
  }
  
  // Higher penalty when opponent is close (don't want to add cards)
  const takePenalty = capturedCards.length * (opponentClose ? 5 : 3)
  
  // Only take if it creates a triple, or significantly helps
  if (wouldCreateTriple || wouldCreateLargeGroup || takeScore > takePenalty + 5) {
    return { action: 'insert_all' }
  }
  
  return { action: 'discard_all' }
}

function hardModeInsert(gameState, botId, card) {
  const bot = gameState.players.find(p => p.id === botId)
  if (!bot) return { position: 0 }
  
  // Find position that minimizes turns to empty
  let bestPos = 0
  let bestTurns = Infinity
  
  for (let pos = 0; pos <= bot.hand.length; pos++) {
    const testHand = [...bot.hand]
    testHand.splice(pos, 0, card)
    const turns = estimateTurnsToEmpty(testHand)
    
    if (turns < bestTurns) {
      bestTurns = turns
      bestPos = pos
    }
  }
  
  return { position: bestPos }
}

function hardModeRingo(gameState, botId, drawnCard, ringoPossible, ringoInfo) {
  if (!ringoPossible) return { action: 'insert' }
  
  const bot = gameState.players.find(p => p.id === botId)
  
  // Check if RINGO sheds ≥2 cards or increases tempo
  const comboSize = (ringoInfo?.comboIndices?.length || 0) + 1 // +1 for drawn card
  
  // Check if any opponent is close to winning
  const opponentInDanger = gameState.players.some(p => 
    p.id !== botId && p.hand && p.hand.length <= 2
  )
  
  if (comboSize >= 2 || opponentInDanger) {
    return { action: 'ringo' }
  }
  
  // Sometimes decline single-card RINGO if it doesn't help
  if (comboSize === 1 && Math.random() < 0.3) {
    return { action: 'insert' }
  }
  
  return { action: 'ringo' }
}

// ============ MAIN DECISION ROUTER ============

export function getBotDecision(gameState, botId, difficulty, context = {}) {
  const { phase, drawnCard, ringoPossible, ringoInfo, capturedCards, roomCode } = context
  
  // Nightmare mode uses belief-MCTS
  if (difficulty === BotDifficulty.NIGHTMARE) {
    switch (phase) {
      case 'turn':
        return nightmareModeDecision(gameState, botId, roomCode || '')
      case 'capture':
        return nightmareModeCapture(gameState, botId, capturedCards, roomCode || '')
      case 'insert':
        return nightmareModeInsert(gameState, botId, drawnCard, roomCode || '')
      case 'ringo':
        return nightmareModeRingo(gameState, botId, drawnCard, ringoPossible, ringoInfo, roomCode || '')
      default:
        return null
    }
  }
  
  switch (phase) {
    case 'turn':
      switch (difficulty) {
        case BotDifficulty.EASY: return easyModeDecision(gameState, botId)
        case BotDifficulty.MEDIUM: return mediumModeDecision(gameState, botId)
        case BotDifficulty.HARD: return hardModeDecision(gameState, botId)
        default: return easyModeDecision(gameState, botId)
      }
      
    case 'capture':
      switch (difficulty) {
        case BotDifficulty.EASY: return easyModeCapture(gameState, botId, capturedCards)
        case BotDifficulty.MEDIUM: return mediumModeCapture(gameState, botId, capturedCards)
        case BotDifficulty.HARD: return hardModeCapture(gameState, botId, capturedCards)
        default: return easyModeCapture(gameState, botId, capturedCards)
      }
      
    case 'insert':
      switch (difficulty) {
        case BotDifficulty.EASY: return easyModeInsert(gameState, botId, drawnCard)
        case BotDifficulty.MEDIUM: return mediumModeInsert(gameState, botId, drawnCard)
        case BotDifficulty.HARD: return hardModeInsert(gameState, botId, drawnCard)
        default: return easyModeInsert(gameState, botId, drawnCard)
      }
      
    case 'ringo':
      switch (difficulty) {
        case BotDifficulty.EASY: return easyModeRingo(gameState, botId, drawnCard, ringoPossible)
        case BotDifficulty.MEDIUM: return mediumModeRingo(gameState, botId, drawnCard, ringoPossible)
        case BotDifficulty.HARD: return hardModeRingo(gameState, botId, drawnCard, ringoPossible, ringoInfo)
        default: return easyModeRingo(gameState, botId, drawnCard, ringoPossible)
      }
      
    default:
      return null
  }
}

// Check if a player is a bot
export function isBot(player) {
  return player && player.isBot === true
}

// Find RINGO opportunity for bot
export function findRingoOpportunity(hand, drawnCard, currentCombo) {
  if (!hand || !drawnCard) return null
  
  // Try inserting drawn card at each position
  for (let insertPos = 0; insertPos <= hand.length; insertPos++) {
    const testHand = [...hand]
    testHand.splice(insertPos, 0, drawnCard)
    
    // Check all possible adjacent combos that include the drawn card
    for (let start = Math.max(0, insertPos - 4); start <= insertPos; start++) {
      for (let length = 1; length <= 5; length++) {
        const end = start + length
        if (end > testHand.length) break
        if (end <= insertPos || start > insertPos) continue // Must include drawn card
        
        const indices = []
        for (let i = start; i < end; i++) {
          indices.push(i)
        }
        
        // Check if all cards can share a value
        let possibleValues = null
        let valid = true
        
        for (const idx of indices) {
          const card = testHand[idx]
          const cardValues = new Set(card.isSplit ? card.splitValues : [card.value])
          
          if (possibleValues === null) {
            possibleValues = cardValues
          } else {
            possibleValues = new Set([...possibleValues].filter(v => cardValues.has(v)))
            if (possibleValues.size === 0) {
              valid = false
              break
            }
          }
        }
        
        if (!valid || !possibleValues || possibleValues.size === 0) continue
        
        const maxValue = Math.max(...possibleValues)
        
        // Check if it beats current combo
        if (!currentCombo || currentCombo.length === 0) {
          // Convert indices back to original hand indices
          const handIndices = indices
            .filter(i => i !== insertPos)
            .map(i => i < insertPos ? i : i - 1)
          
          return {
            insertPosition: insertPos,
            comboIndices: handIndices,
            value: maxValue
          }
        }
        
        const comboSize = currentCombo.length
        const comboValue = currentCombo[0].resolvedValue || 
          (currentCombo[0].isSplit ? Math.max(...currentCombo[0].splitValues) : currentCombo[0].value)
        
        if (indices.length > comboSize || 
            (indices.length === comboSize && maxValue > comboValue)) {
          const handIndices = indices
            .filter(i => i !== insertPos)
            .map(i => i < insertPos ? i : i - 1)
          
          return {
            insertPosition: insertPos,
            comboIndices: handIndices,
            value: maxValue
          }
        }
      }
    }
  }
  
  return null
}
