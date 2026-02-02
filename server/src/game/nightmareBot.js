// Nightmare Mode AI - Belief-MCTS + Hand Sculpting
import { validateCombo, validateBeat, findValidCombos } from './moveValidation.js'
import { createDeck, createCardFromData } from './cardModel.js'
import { findAdjacentGroups, calculateMessiness } from './aiBot.js'

// ============ BELIEF STATE TRACKING ============

// Per-room belief state
const beliefStates = new Map() // roomCode -> Map<playerId, BeliefState>

class BeliefState {
  constructor() {
    // possible_counts[p][v] = plausible count range for value v
    this.possibleCounts = {} // value -> { min: number, max: number }
    // Probability they have adjacency/groups
    this.hasAdjacency = 0.5 // 0-1 probability
    this.hasPairs = 0.3
    this.hasTriples = 0.1
    // can_respond[p][k] = chance they can beat a play of size k
    this.canRespond = {} // size -> probability
    // Track observed behavior
    this.beatCount = 0 // times they've beaten plays
    this.drawCount = 0 // times they've drawn
    this.pileTakeCount = 0 // times they've taken pile
    this.observedPlays = [] // history of plays they've made
  }
}

export function initBeliefState(roomCode, players) {
  if (!beliefStates.has(roomCode)) {
    beliefStates.set(roomCode, new Map())
  }
  
  const beliefs = beliefStates.get(roomCode)
  players.forEach(player => {
    if (!player.isBot && !beliefs.has(player.id)) {
      beliefs.set(player.id, new BeliefState())
      // Initialize with uniform priors
      for (let v = 1; v <= 8; v++) {
        const state = beliefs.get(player.id)
        state.possibleCounts[v] = { min: 0, max: 3 } // reasonable range
        state.canRespond[v] = 0.5 // neutral prior
      }
    }
  })
}

export function updateBeliefState(roomCode, playerId, action, gameState) {
  const beliefs = beliefStates.get(roomCode)
  if (!beliefs || !beliefs.has(playerId)) return
  
  const belief = beliefs.get(playerId)
  const player = gameState.players.find(p => p.id === playerId)
  if (!player) return
  
  if (action.type === 'play') {
    belief.beatCount++
    const playSize = action.comboSize || 1
    const playValue = action.comboValue || 0
    
    // If they beat with a pair/triple, increase adjacency probability
    if (playSize >= 2) {
      belief.hasAdjacency = Math.min(1, belief.hasAdjacency + 0.2)
      if (playSize === 2) belief.hasPairs = Math.min(1, belief.hasPairs + 0.3)
      if (playSize >= 3) belief.hasTriples = Math.min(1, belief.hasTriples + 0.2)
    }
    
    // Update can_respond for similar sizes
    for (let k = 1; k <= 5; k++) {
      if (k <= playSize) {
        belief.canRespond[k] = Math.min(1, (belief.canRespond[k] || 0.5) + 0.1)
      }
    }
    
    belief.observedPlays.push({ size: playSize, value: playValue })
  } else if (action.type === 'draw') {
    belief.drawCount++
    // Repeated draws suggest low adjacency
    if (belief.drawCount > 2) {
      belief.hasAdjacency = Math.max(0, belief.hasAdjacency - 0.1)
    }
  } else if (action.type === 'take_pile') {
    belief.pileTakeCount++
    // Taking pile suggests they're building something
    belief.hasAdjacency = Math.min(1, belief.hasAdjacency + 0.15)
  }
  
  // Update hand size constraints
  const handSize = player.hand?.length || 0
  // Adjust possible counts based on hand size
  const avgCardsPerValue = handSize / 8
  for (let v = 1; v <= 8; v++) {
    const state = belief.possibleCounts[v] || { min: 0, max: 3 }
    state.max = Math.min(state.max, Math.ceil(avgCardsPerValue * 1.5))
  }
}

// ============ HAND OPTIMIZATION ============

// Calculate hand cost (lower is better)
export function calculateHandCost(hand) {
  if (!hand || hand.length === 0) return 0
  
  const groups = findAdjacentGroups(hand)
  
  // groups_score = sum(size^2) for each contiguous group
  let groupsScore = 0
  for (const group of groups) {
    groupsScore += group.size * group.size
  }
  
  // blockers_penalty = 3 * (#cards between identical values)
  let blockersPenalty = 0
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
      for (let i = 1; i < positions.length; i++) {
        const gap = positions[i] - positions[i - 1] - 1
        if (gap > 0) blockersPenalty += gap * 3
      }
    }
  }
  
  // edge_penalty = high singles stranded at edges
  let edgePenalty = 0
  if (hand.length > 0) {
    const firstCard = hand[0]
    const lastCard = hand[hand.length - 1]
    const firstValue = firstCard.isSplit ? Math.max(...firstCard.splitValues) : firstCard.value
    const lastValue = lastCard.isSplit ? Math.max(...lastCard.splitValues) : lastCard.value
    
    if (firstValue >= 7 && !groups.some(g => g.indices.includes(0))) {
      edgePenalty += 1
    }
    if (lastValue >= 7 && !groups.some(g => g.indices.includes(hand.length - 1))) {
      edgePenalty += 1
    }
  }
  
  // flex_bonus = double cards adjacent to groups they can join
  let flexBonus = 0
  hand.forEach((card, idx) => {
    if (card.isSplit) {
      const leftAdjacent = idx > 0 && groups.some(g => 
        g.indices.includes(idx - 1) && 
        g.indices.some(i => {
          const neighbor = hand[i]
          const neighborValues = neighbor.isSplit ? neighbor.splitValues : [neighbor.value]
          return card.splitValues.some(v => neighborValues.includes(v))
        })
      )
      const rightAdjacent = idx < hand.length - 1 && groups.some(g =>
        g.indices.includes(idx + 1) &&
        g.indices.some(i => {
          const neighbor = hand[i]
          const neighborValues = neighbor.isSplit ? neighbor.splitValues : [neighbor.value]
          return card.splitValues.some(v => neighborValues.includes(v))
        })
      )
      if (leftAdjacent || rightAdjacent) flexBonus += 2
    }
  })
  
  return blockersPenalty - groupsScore - flexBonus + edgePenalty
}

// Find optimal insertion position(s) for cards
export function findOptimalInsertion(hand, cards) {
  if (!cards || cards.length === 0) return []
  if (cards.length === 1) {
    // Try all positions
    let bestPos = hand.length
    let bestCost = Infinity
    
    for (let pos = 0; pos <= hand.length; pos++) {
      const testHand = [...hand]
      testHand.splice(pos, 0, cards[0])
      const cost = calculateHandCost(testHand)
      if (cost < bestCost) {
        bestCost = cost
        bestPos = pos
      }
    }
    return [{ card: cards[0], position: bestPos }]
  }
  
  // For multiple cards, use greedy + local search
  let bestPositions = []
  let bestCost = Infinity
  
  // Greedy: insert each card to minimize cost incrementally
  let currentHand = [...hand]
  const insertions = []
  
  for (const card of cards) {
    let bestPos = currentHand.length
    let bestCardCost = Infinity
    
    for (let pos = 0; pos <= currentHand.length; pos++) {
      const testHand = [...currentHand]
      testHand.splice(pos, 0, card)
      const cost = calculateHandCost(testHand)
      if (cost < bestCardCost) {
        bestCardCost = cost
        bestPos = pos
      }
    }
    
    currentHand.splice(bestPos, 0, card)
    insertions.push({ card, position: bestPos })
  }
  
  // Local search: try swapping positions
  let improved = true
  let iterations = 0
  while (improved && iterations < 5) {
    improved = false
    for (let i = 0; i < insertions.length; i++) {
      for (let j = i + 1; j < insertions.length; j++) {
        // Try swapping positions
        const testHand = [...hand]
        const temp = insertions[i].position
        insertions[i].position = insertions[j].position
        insertions[j].position = temp
        
        // Rebuild hand with new positions
        const sorted = [...insertions].sort((a, b) => a.position - b.position)
        for (const ins of sorted) {
          testHand.splice(ins.position, 0, ins.card)
        }
        
        const cost = calculateHandCost(testHand)
        if (cost < bestCost) {
          bestCost = cost
          bestPositions = [...insertions]
          improved = true
        } else {
          // Revert
          const temp2 = insertions[i].position
          insertions[i].position = insertions[j].position
          insertions[j].position = temp2
        }
      }
    }
    iterations++
  }
  
  return bestPositions.length > 0 ? bestPositions : insertions
}

// ============ MCTS SIMULATION ============

// Sample a plausible hidden world (opponent hands)
function sampleHiddenWorld(gameState, botId, roomCode) {
  const beliefs = beliefStates.get(roomCode)
  if (!beliefs) return gameState // No beliefs, return as-is
  
  // Create a copy of game state with sampled hands
  const sampledState = JSON.parse(JSON.stringify(gameState))
  
  // For each opponent, sample a plausible hand
  const bot = gameState.players.find(p => p.id === botId)
  const botHand = bot?.hand || []
  
  // Get all known cards (discard pile, current combo, bot's hand)
  const knownCards = []
  if (gameState.discardPile) {
    knownCards.push(...gameState.discardPile.map(c => ({ ...c })))
  }
  if (gameState.currentCombo) {
    knownCards.push(...gameState.currentCombo.map(c => ({ ...c })))
  }
  knownCards.push(...botHand.map(c => ({ ...c })))
  
  // Create remaining deck
  const fullDeck = createDeck()
  const remainingDeck = fullDeck.filter(card => 
    !knownCards.some(known => known.id === card.id)
  )
  
  // Shuffle and deal to opponents
  for (let i = remainingDeck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [remainingDeck[i], remainingDeck[j]] = [remainingDeck[j], remainingDeck[i]]
  }
  
  let deckIndex = 0
  sampledState.players.forEach(player => {
    if (player.id !== botId && !player.isBot) {
      const handSize = player.hand?.length || 0
      const sampledHand = []
      for (let i = 0; i < handSize && deckIndex < remainingDeck.length; i++) {
        sampledHand.push(remainingDeck[deckIndex++])
      }
      player.hand = sampledHand
    }
  })
  
  return sampledState
}

// Fast policy for opponent simulation (medium-hard level)
function simulateOpponentAction(state, playerId) {
  const player = state.players.find(p => p.id === playerId)
  if (!player || !player.hand) return null
  
  const validCombos = findValidCombos(player.hand, state.currentCombo)
  
  if (!state.currentCombo || state.currentCombo.length === 0) {
    // Empty table - play largest group
    if (validCombos.length === 0) return { action: 'draw' }
    validCombos.sort((a, b) => {
      if (b.combo.size !== a.combo.size) return b.combo.size - a.combo.size
      return b.combo.value - a.combo.value
    })
    return { action: 'play', indices: validCombos[0].cardIndices }
  }
  
  // Table has combo - try to beat
  if (validCombos.length === 0) return { action: 'draw' }
  
  // Prefer smaller beats
  validCombos.sort((a, b) => {
    if (a.combo.size !== b.combo.size) return a.combo.size - b.combo.size
    return a.combo.value - b.combo.value
  })
  
  return { action: 'play', indices: validCombos[0].cardIndices }
}

// Simulate forward H plies
function simulateForward(state, botId, action, roomCode, horizon = 6) {
  // Simplified simulation using heuristics (full MCTS would be too slow for real-time)
  
  let winCount = 0
  let loseSoonCount = 0
  let giveFinisherCount = 0
  let avgTurnsToWin = 0
  
  const numSamples = 16 // Reduced for performance (can increase if needed)
  
  for (let sample = 0; sample < numSamples; sample++) {
    const sampledState = sampleHiddenWorld(state, botId, roomCode)
    
    // Apply the action
    let currentState = JSON.parse(JSON.stringify(sampledState))
    const bot = currentState.players.find(p => p.id === botId)
    
    if (action.type === 'play') {
      // Remove cards from hand
      const sortedIndices = [...action.indices].sort((a, b) => b - a)
      sortedIndices.forEach(idx => bot.hand.splice(idx, 1))
      
      // Update current combo
      const playedCards = action.indices.map(i => bot.hand[i] || currentState.players.find(p => p.id === botId)?.hand?.[i])
      currentState.currentCombo = playedCards
    } else if (action.type === 'draw') {
      // Simplified: assume draw happens
      if (currentState.drawPile && currentState.drawPile.length > 0) {
        const drawn = currentState.drawPile.pop()
        bot.hand.push(drawn)
      }
    }
    
    // Simulate forward
    let turns = 0
    let botWon = false
    let someoneElseWon = false
    
    for (let ply = 0; ply < horizon && !botWon && !someoneElseWon; ply++) {
      const currentPlayer = currentState.players[currentState.currentPlayerIndex]
      
      if (currentPlayer.id === botId) {
        // Bot's turn - use best response
        const botCombos = findValidCombos(bot.hand, currentState.currentCombo)
        if (botCombos.length > 0) {
          botCombos.sort((a, b) => {
            if (a.combo.size !== b.combo.size) return b.combo.size - a.combo.size
            return b.combo.value - a.combo.value
          })
          const playIndices = botCombos[0].cardIndices
          const sortedIndices = [...playIndices].sort((a, b) => b - a)
          sortedIndices.forEach(idx => bot.hand.splice(idx, 1))
          turns++
          
          if (bot.hand.length === 0) {
            botWon = true
            break
          }
        } else {
          // Draw
          if (currentState.drawPile && currentState.drawPile.length > 0) {
            bot.hand.push(currentState.drawPile.pop())
          }
        }
      } else {
        // Opponent turn - use fast policy
        const oppAction = simulateOpponentAction(currentState, currentPlayer.id)
        if (oppAction && oppAction.action === 'play') {
          const opp = currentState.players.find(p => p.id === currentPlayer.id)
          const sortedIndices = [...oppAction.indices].sort((a, b) => b - a)
          sortedIndices.forEach(idx => opp.hand.splice(idx, 1))
          
          if (opp.hand.length === 0) {
            someoneElseWon = true
            if (ply <= 2) loseSoonCount++
            break
          }
        }
      }
      
      // Advance turn
      currentState.currentPlayerIndex = (currentState.currentPlayerIndex + 1) % currentState.players.length
    }
    
    if (botWon) {
      winCount++
      avgTurnsToWin += turns
    }
    
    // Check if action gives opponent a finisher
    if (action.type === 'play' && currentState.currentCombo) {
      const nextPlayer = currentState.players[(currentState.currentPlayerIndex + 1) % currentState.players.length]
      if (nextPlayer && nextPlayer.hand && nextPlayer.hand.length <= 2) {
        giveFinisherCount++
      }
    }
  }
  
  return {
    winProbability: winCount / numSamples,
    loseSoonProbability: loseSoonCount / numSamples,
    giveFinisherProbability: giveFinisherCount / numSamples,
    avgTurnsToWin: avgTurnsToWin / Math.max(1, winCount)
  }
}

// ============ NIGHTMARE MODE DECISIONS ============

export function nightmareModeDecision(gameState, botId, roomCode) {
  const bot = gameState.players.find(p => p.id === botId)
  if (!bot || !bot.hand) return null
  
  // Initialize belief state if needed
  initBeliefState(roomCode, gameState.players)
  
  const hand = bot.hand
  const currentCombo = gameState.currentCombo
  const validCombos = findValidCombos(hand, currentCombo)
  
  // Generate candidate actions
  const candidates = []
  
  if (!currentCombo || currentCombo.length === 0) {
    // Empty table - all playable groups
    if (validCombos.length === 0) {
      return { action: 'draw' }
    }
    
    // Limit to top 12 by heuristic
    validCombos.sort((a, b) => {
      const aScore = a.combo.size * 10 + a.combo.value
      const bScore = b.combo.size * 10 + b.combo.value
      return bScore - aScore
    })
    
    const topCombos = validCombos.slice(0, 12)
    topCombos.forEach(combo => {
      candidates.push({
        type: 'play',
        indices: combo.cardIndices,
        comboSize: combo.combo.size,
        comboValue: combo.combo.value
      })
    })
  } else {
    // Table has combo - all legal beats + draw
    validCombos.forEach(combo => {
      candidates.push({
        type: 'play',
        indices: combo.cardIndices,
        comboSize: combo.combo.size,
        comboValue: combo.combo.value
      })
    })
    candidates.push({ type: 'draw' })
  }
  
  // Evaluate each candidate with MCTS
  let bestAction = candidates[0] || { action: 'draw' }
  let bestUtility = -Infinity
  
  for (const candidate of candidates) {
    const simResult = simulateForward(gameState, botId, candidate, roomCode, 6)
    
    const utility = 
      100 * simResult.winProbability -
      6 * simResult.avgTurnsToWin -
      120 * simResult.loseSoonProbability -
      80 * simResult.giveFinisherProbability
    
    if (utility > bestUtility) {
      bestUtility = utility
      bestAction = candidate
    }
  }
  
  if (bestAction.type === 'play') {
    return { action: 'play', indices: bestAction.indices }
  }
  return { action: 'draw' }
}

export function nightmareModeCapture(gameState, botId, capturedCards, roomCode) {
  const bot = gameState.players.find(p => p.id === botId)
  if (!bot || !bot.hand) return { action: 'discard_all' }
  
  // Always take doubles
  if (capturedCards.some(c => c.isSplit)) {
    return { action: 'insert_all' }
  }
  
  // Check if taking creates a triple soon
  for (const card of capturedCards) {
    const cardValues = card.isSplit ? card.splitValues : [card.value]
    for (const value of cardValues) {
      const count = bot.hand.filter(c => {
        const values = c.isSplit ? c.splitValues : [c.value]
        return values.includes(value)
      }).length
      if (count >= 2) {
        // Would create a triple
        return { action: 'insert_all' }
      }
    }
  }
  
  // Use simulation to decide
  const takeSim = simulateForward(
    { ...gameState, pendingCapture: { cards: capturedCards } },
    botId,
    { type: 'take_pile' },
    roomCode,
    4
  )
  
  const discardSim = simulateForward(
    gameState,
    botId,
    { type: 'discard_pile' },
    roomCode,
    4
  )
  
  if (takeSim.winProbability > discardSim.winProbability + 0.1) {
    return { action: 'insert_all' }
  }
  
  return { action: 'discard_all' }
}

export function nightmareModeInsert(gameState, botId, card, roomCode) {
  const bot = gameState.players.find(p => p.id === botId)
  if (!bot) return { position: 0 }
  
  const optimal = findOptimalInsertion(bot.hand, [card])
  if (optimal.length > 0) {
    return { position: optimal[0].position }
  }
  
  // Fallback
  return { position: bot.hand.length }
}

export function nightmareModeRingo(gameState, botId, drawnCard, ringoPossible, ringoInfo, roomCode) {
  if (!ringoPossible) return { action: 'insert' }
  
  // Always take RINGO if it increases tempo or sheds ≥2 cards
  const comboSize = (ringoInfo?.comboIndices?.length || 0) + 1
  
  if (comboSize >= 2) {
    return { action: 'ringo' }
  }
  
  // Check if opponent is close to winning
  const opponentInDanger = gameState.players.some(p =>
    p.id !== botId && p.hand && p.hand.length <= 2
  )
  
  if (opponentInDanger) {
    return { action: 'ringo' }
  }
  
  // Use simulation
  const ringoSim = simulateForward(
    gameState,
    botId,
    { type: 'ringo', comboSize: 1 },
    roomCode,
    4
  )
  
  const insertSim = simulateForward(
    gameState,
    botId,
    { type: 'insert' },
    roomCode,
    4
  )
  
  if (ringoSim.winProbability > insertSim.winProbability) {
    return { action: 'ringo' }
  }
  
  return { action: 'insert' }
}
