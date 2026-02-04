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

// Sample a plausible hidden world (opponent hands) using belief model
function sampleHiddenWorld(gameState, botId, roomCode) {
  const beliefs = beliefStates.get(roomCode)
  if (!beliefs) return gameState // No beliefs, return as-is
  
  // Create a copy of game state with sampled hands
  const sampledState = JSON.parse(JSON.stringify(gameState))
  
  // For each opponent, sample a plausible hand
  const bot = gameState.players.find(p => p.id === botId)
  const botHand = bot?.hand || []
  
  // Get all known cards (discard pile, current combo, bot's hand, all player hands)
  const knownCards = []
  if (gameState.discardPile) {
    knownCards.push(...gameState.discardPile.map(c => ({ ...c })))
  }
  if (gameState.currentCombo) {
    knownCards.push(...gameState.currentCombo.map(c => ({ ...c })))
  }
  knownCards.push(...botHand.map(c => ({ ...c })))
  // Also track cards in other players' hands if visible (for bots)
  gameState.players.forEach(p => {
    if (p.id !== botId && p.hand) {
      knownCards.push(...p.hand.map(c => ({ ...c })))
    }
  })
  
  // Create remaining deck
  const fullDeck = createDeck()
  const remainingDeck = fullDeck.filter(card => 
    !knownCards.some(known => known.id === card.id)
  )
  
  // Shuffle and deal to opponents, biased by belief model
  for (let i = remainingDeck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [remainingDeck[i], remainingDeck[j]] = [remainingDeck[j], remainingDeck[i]]
  }
  
  let deckIndex = 0
  sampledState.players.forEach(player => {
    if (player.id !== botId && !player.isBot) {
      const handSize = player.hand?.length || 0
      const belief = beliefs.get(player.id)
      
      // Sample hand biased by belief model
      const sampledHand = []
      const valueCounts = {} // Track how many of each value we've sampled
      
      // First pass: try to match belief model expectations
      if (belief) {
        for (let v = 1; v <= 8; v++) {
          const expectedRange = belief.possibleCounts[v] || { min: 0, max: 3 }
          const targetCount = Math.floor((expectedRange.min + expectedRange.max) / 2)
          valueCounts[v] = 0
          
          // Try to sample cards of this value
          for (let i = 0; i < targetCount && deckIndex < remainingDeck.length && sampledHand.length < handSize; i++) {
            // Find a card with this value
            const cardIndex = remainingDeck.findIndex((c, idx) => 
              idx >= deckIndex && (c.value === v || (c.isSplit && c.splitValues.includes(v)))
            )
            if (cardIndex !== -1) {
              const card = remainingDeck[cardIndex]
              sampledHand.push(card)
              remainingDeck.splice(cardIndex, 1)
              valueCounts[v]++
            }
          }
        }
      }
      
      // Fill remaining slots randomly
      while (sampledHand.length < handSize && deckIndex < remainingDeck.length) {
        sampledHand.push(remainingDeck[deckIndex++])
      }
      
      // Shuffle the sampled hand to randomize order
      for (let i = sampledHand.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [sampledHand[i], sampledHand[j]] = [sampledHand[j], sampledHand[i]]
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
  
  // Convert currentCombo array to format expected by validateBeat
  let currentComboForValidation = null
  if (state.currentCombo && state.currentCombo.length > 0) {
    const firstCard = state.currentCombo[0]
    const comboValue = firstCard.resolvedValue !== undefined && firstCard.resolvedValue !== null
      ? firstCard.resolvedValue
      : (firstCard.isSplit ? Math.max(...firstCard.splitValues) : firstCard.value)
    currentComboForValidation = {
      size: state.currentCombo.length,
      value: comboValue
    }
  }
  const validCombos = findValidCombos(player.hand, currentComboForValidation)
  
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
  
  const numSamples = 32 // Increased for better prediction accuracy
  
  for (let sample = 0; sample < numSamples; sample++) {
    const sampledState = sampleHiddenWorld(state, botId, roomCode)
    
    // Apply the action
    let currentState = JSON.parse(JSON.stringify(sampledState))
    const bot = currentState.players.find(p => p.id === botId)
    
    if (action.type === 'play') {
      // Remove cards from hand (make a copy first to avoid index issues)
      const botHandCopy = [...bot.hand]
      const sortedIndices = [...action.indices].sort((a, b) => b - a)
      const playedCards = []
      
      // Extract cards before removing
      sortedIndices.forEach(idx => {
        if (idx >= 0 && idx < botHandCopy.length) {
          playedCards.push(botHandCopy[idx])
        }
      })
      
      // Remove cards from hand
      sortedIndices.forEach(idx => {
        if (idx >= 0 && idx < bot.hand.length) {
          bot.hand.splice(idx, 1)
        }
      })
      
      // Update current combo
      currentState.currentCombo = playedCards
    } else if (action.type === 'draw') {
      // Simplified: assume draw happens
      // Try to shuffle discard into draw if needed
      if (currentState.drawPile && currentState.drawPile.length > 0) {
        const drawn = currentState.drawPile.pop()
        bot.hand.push(drawn)
      } else if (currentState.discardPile && currentState.discardPile.length > 0) {
        // Shuffle discard into draw for simulation (use proper shuffle)
        const shuffled = [...currentState.discardPile]
        // Fisher-Yates shuffle
        for (let i = shuffled.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]]
        }
        currentState.drawPile = shuffled
        currentState.discardPile = []
        if (currentState.drawPile.length > 0) {
          const drawn = currentState.drawPile.pop()
          bot.hand.push(drawn)
        }
      }
    }
    
    // Simulate forward
    let turns = 0
    let botWon = false
    let someoneElseWon = false
    
    for (let ply = 0; ply < horizon && !botWon && !someoneElseWon; ply++) {
      const currentPlayer = currentState.players[currentState.currentPlayerIndex]
      
      if (currentPlayer.id === botId) {
        // Bot's turn - use strategic play (not just largest combo)
        // Convert currentCombo array to format expected by validateBeat
        let currentComboForValidation = null
        if (currentState.currentCombo && currentState.currentCombo.length > 0) {
          const firstCard = currentState.currentCombo[0]
          const comboValue = firstCard.resolvedValue !== undefined && firstCard.resolvedValue !== null
            ? firstCard.resolvedValue
            : (firstCard.isSplit ? Math.max(...firstCard.splitValues) : firstCard.value)
          currentComboForValidation = {
            size: currentState.currentCombo.length,
            value: comboValue
          }
        }
        const botCombos = findValidCombos(bot.hand, currentComboForValidation)
        if (botCombos.length > 0) {
          // Strategic play: prefer plays that unblock cards and reduce hand cost
          botCombos.sort((a, b) => {
            // Test each play's effect on hand
            const testHandA = bot.hand.filter((_, i) => !a.cardIndices.includes(i))
            const testHandB = bot.hand.filter((_, i) => !b.cardIndices.includes(i))
            const costA = calculateHandCost(testHandA)
            const costB = calculateHandCost(testHandB)
            
            // Prefer lower cost (better hand shape)
            if (costA !== costB) return costA - costB
            
            // If same cost, prefer efficient beats (same size or larger)
            if (currentComboForValidation) {
              const aEfficient = a.combo.size <= currentComboForValidation.size
              const bEfficient = b.combo.size <= currentComboForValidation.size
              if (aEfficient !== bEfficient) return aEfficient ? -1 : 1
            }
            
            // Otherwise prefer larger plays
            if (a.combo.size !== b.combo.size) return b.combo.size - a.combo.size
            return b.combo.value - a.combo.value
          })
          const playIndices = botCombos[0].cardIndices
          const sortedIndices = [...playIndices].sort((a, b) => b - a)
          const playedCards = sortedIndices.map(idx => bot.hand[idx]).filter(c => c)
          sortedIndices.forEach(idx => bot.hand.splice(idx, 1))
          
          // Update current combo
          currentState.currentCombo = playedCards
          turns++
          
          if (bot.hand.length === 0) {
            botWon = true
            break
          }
        } else {
          // Draw
          if (currentState.drawPile && currentState.drawPile.length > 0) {
            const drawn = currentState.drawPile.pop()
            // Optimally insert the drawn card
            const optimal = findOptimalInsertion(bot.hand, [drawn])
            if (optimal.length > 0) {
              bot.hand.splice(optimal[0].position, 0, drawn)
            } else {
              bot.hand.push(drawn)
            }
          } else if (currentState.discardPile && currentState.discardPile.length > 0) {
            // Shuffle discard into draw for simulation (use proper shuffle)
            const shuffled = [...currentState.discardPile]
            // Fisher-Yates shuffle
            for (let i = shuffled.length - 1; i > 0; i--) {
              const j = Math.floor(Math.random() * (i + 1));
              [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]]
            }
            currentState.drawPile = shuffled
            currentState.discardPile = []
            if (currentState.drawPile.length > 0) {
              const drawn = currentState.drawPile.pop()
              const optimal = findOptimalInsertion(bot.hand, [drawn])
              if (optimal.length > 0) {
                bot.hand.splice(optimal[0].position, 0, drawn)
              } else {
                bot.hand.push(drawn)
              }
            }
          }
        }
      } else {
        // Opponent turn - use fast policy
        const oppAction = simulateOpponentAction(currentState, currentPlayer.id)
        if (oppAction && oppAction.action === 'play') {
          const opp = currentState.players.find(p => p.id === currentPlayer.id)
          if (!opp || !opp.hand) {
            currentState.currentPlayerIndex = (currentState.currentPlayerIndex + 1) % currentState.players.length
            continue
          }
          const sortedIndices = [...oppAction.indices].sort((a, b) => b - a)
          // Validate indices before removing
          const validIndices = sortedIndices.filter(idx => idx >= 0 && idx < opp.hand.length)
          const playedCards = validIndices.map(idx => opp.hand[idx]).filter(c => c)
          validIndices.forEach(idx => opp.hand.splice(idx, 1))
          
          // Update current combo
          currentState.currentCombo = playedCards
          
          if (opp.hand.length === 0) {
            someoneElseWon = true
            if (ply <= 2) loseSoonCount++
            break
          }
        } else if (oppAction && oppAction.action === 'draw') {
          // Opponent draws
          if (currentState.drawPile && currentState.drawPile.length > 0) {
            const drawn = currentState.drawPile.pop()
            const opp = currentState.players.find(p => p.id === currentPlayer.id)
            if (opp && opp.hand) {
              opp.hand.push(drawn) // Simple append for opponents
            }
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
    
    // Check if action gives opponent a finisher (they can win next turn)
    if (action.type === 'play' && currentState.currentCombo) {
      const nextPlayerIndex = (currentState.currentPlayerIndex + 1) % currentState.players.length
      const nextPlayer = currentState.players[nextPlayerIndex]
      if (nextPlayer && nextPlayer.hand && nextPlayer.hand.length <= 2) {
        // Check if they can actually beat the combo
        let currentComboForValidation = null
        if (currentState.currentCombo && currentState.currentCombo.length > 0) {
          const firstCard = currentState.currentCombo[0]
          const comboValue = firstCard.resolvedValue !== undefined && firstCard.resolvedValue !== null
            ? firstCard.resolvedValue
            : (firstCard.isSplit ? Math.max(...firstCard.splitValues) : firstCard.value)
          currentComboForValidation = {
            size: currentState.currentCombo.length,
            value: comboValue
          }
        }
        const nextPlayerCombos = findValidCombos(nextPlayer.hand, currentComboForValidation)
        if (nextPlayerCombos.length > 0) {
          giveFinisherCount++
        }
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
  // Convert currentCombo array to format expected by validateBeat
  let currentComboForValidation = null
  if (gameState.currentCombo && gameState.currentCombo.length > 0) {
    const firstCard = gameState.currentCombo[0]
    const comboValue = firstCard.resolvedValue !== undefined && firstCard.resolvedValue !== null
      ? firstCard.resolvedValue
      : (firstCard.isSplit ? Math.max(...firstCard.splitValues) : firstCard.value)
    currentComboForValidation = {
      size: gameState.currentCombo.length,
      value: comboValue
    }
  }
  const validCombos = findValidCombos(hand, currentComboForValidation)
  
  // Generate candidate actions
  const candidates = []
  
  if (!gameState.currentCombo || gameState.currentCombo.length === 0) {
    // Empty table - all playable groups
    if (validCombos.length === 0) {
      return { action: 'draw' }
    }
    
    // Limit to top 15 by heuristic, but prioritize strategic plays
    validCombos.sort((a, b) => {
      // Test each combo's effect on hand
      const testHandA = hand.filter((_, i) => !a.cardIndices.includes(i))
      const testHandB = hand.filter((_, i) => !b.cardIndices.includes(i))
      const costA = calculateHandCost(testHandA)
      const costB = calculateHandCost(testHandB)
      
      // Prefer lower cost (better hand shape)
      if (costA !== costB) return costA - costB
      
      // Otherwise prefer larger plays
      const aScore = a.combo.size * 10 + a.combo.value
      const bScore = b.combo.size * 10 + b.combo.value
      return bScore - aScore
    })
    
    const topCombos = validCombos.slice(0, 15)
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
  
  // If no valid plays, must draw
  const playCandidates = candidates.filter(c => c.type === 'play')
  if (playCandidates.length === 0) {
    return { action: 'draw' }
  }
  
  // Check if opponent is close to winning - if so, ALWAYS play if possible
  const opponents = gameState.players.filter(p => p.id !== botId && p.hand)
  const minOpponentCards = Math.min(...opponents.map(p => p.hand?.length || 99))
  const opponentVeryClose = minOpponentCards <= 2
  const opponentInDanger = minOpponentCards <= 4
  
  // EMERGENCY: If opponent is very close, play immediately with best available play
  if (opponentVeryClose && playCandidates.length > 0) {
    playCandidates.sort((a, b) => {
      if (a.comboSize !== b.comboSize) return a.comboSize - b.comboSize // Prefer efficient
      return a.comboValue - b.comboValue
    })
    return { action: 'play', indices: playCandidates[0].indices }
  }
  
  // Evaluate each candidate with MCTS
  let bestAction = playCandidates[0] // Default to first play option
  let bestUtility = -Infinity
  
  // Add heuristic bonus for playing vs drawing
  for (const candidate of candidates) {
    let simResult
    if (candidate.type === 'draw') {
      // For draws, use a very negative heuristic
      simResult = {
        winProbability: 0.05, // Drawing is much worse
        avgTurnsToWin: 15,
        loseSoonProbability: 0.4,
        giveFinisherProbability: 0.2
      }
    } else {
      simResult = simulateForward(gameState, botId, candidate, roomCode, 6)
    }
    
    // Heuristic bonus: playing is generally better than drawing, but not always
    let playBonus = 0
    if (candidate.type === 'play') {
      playBonus = 20 // Moderate preference to play when possible
      // Bonus for larger plays (sheds more cards)
      playBonus += candidate.comboSize * 6
      // Bonus for beating efficiently
      if (currentComboForValidation && candidate.comboSize <= currentComboForValidation.size) {
        playBonus += 12 // Same size beat is efficient
      }
      // Defensive bonus if opponent is close
      if (opponentInDanger) {
        playBonus += 25 // Extra bonus to prevent opponent from winning
      }
      
      // Check if this play unblocks cards (creates new adjacent groups)
      const testHand = hand.filter((_, i) => !candidate.indices.includes(i))
      const oldGroups = findAdjacentGroups(hand)
      const newGroups = findAdjacentGroups(testHand)
      if (newGroups.length < oldGroups.length) {
        playBonus += 18 // Unblocking bonus - creates fewer groups
      }
      const oldMaxSize = Math.max(...oldGroups.map(g => g.size), 0)
      const newMaxSize = Math.max(...newGroups.map(g => g.size), 0)
      if (newMaxSize > oldMaxSize) {
        playBonus += 15 // Created a larger group by unblocking
      }
      
      // Bonus for reducing hand cost (better hand shape)
      const oldCost = calculateHandCost(hand)
      const newCost = calculateHandCost(testHand)
      if (newCost < oldCost) {
        playBonus += (oldCost - newCost) * 2 // Reward hand improvement
      }
      
      // PILE CLOSING STRATEGY (Nightmare mode): Play large combos to force pile closure
      if (candidate.comboSize >= 4) {
        const numPlayers = gameState.players.length
        let estimatedPassProbability = 1.0
        
        // Estimate probability that all opponents will need to draw
        for (let i = 1; i < numPlayers; i++) {
          const playerIdx = (gameState.currentPlayerIndex + i) % numPlayers
          const player = gameState.players[playerIdx]
          if (player.id === botId) continue
          
          const playerHandSize = player.hand?.length || 0
          // Use belief model if available to better estimate
          const beliefs = beliefStates.get(roomCode)
          const belief = beliefs?.get(player.id)
          
          if (candidate.comboSize >= 5 && playerHandSize < 5) {
            estimatedPassProbability *= 0.75 // Very hard to beat
          } else if (candidate.comboSize >= 4 && playerHandSize < 6) {
            estimatedPassProbability *= 0.65
          } else if (belief && candidate.comboSize >= 4) {
            // Use belief model: check if they likely have combos of this size
            const canRespond = belief.canRespond?.[candidate.comboSize] || 0.3
            estimatedPassProbability *= (1 - canRespond)
          } else {
            estimatedPassProbability *= 0.4
          }
        }
        
        // Check if we have good cards saved for empty board play
        const remainingGroups = findAdjacentGroups(testHand)
        const hasGoodEmptyBoardPlay = remainingGroups.some(g => g.size >= 2) || testHand.length > 0
        const maxRemainingGroup = Math.max(...remainingGroups.map(g => g.size), 0)
        
        if (estimatedPassProbability > 0.3 && hasGoodEmptyBoardPlay) {
          // Bonus scales with combo size, probability, and quality of saved cards
          playBonus += candidate.comboSize * 10 * estimatedPassProbability
          if (maxRemainingGroup >= 3) {
            playBonus += 20 // We have a triple+ saved for empty board
          } else if (maxRemainingGroup >= 2) {
            playBonus += 10 // We have a pair saved
          }
        }
      }
    }
    
    const utility = 
      120 * simResult.winProbability -
      8 * simResult.avgTurnsToWin -
      150 * simResult.loseSoonProbability -
      100 * simResult.giveFinisherProbability +
      playBonus
    
    if (utility > bestUtility) {
      bestUtility = utility
      bestAction = candidate
    }
  }
  
  // If simulation suggests drawing, check if we should still play
  // Only override if play utility is significantly better
  if (bestAction.type === 'draw' && playCandidates.length > 0) {
    // Recalculate to find best play
    let bestPlayUtil = -Infinity
    let bestPlay = playCandidates[0]
    
    for (const play of playCandidates) {
      const sim = simulateForward(gameState, botId, play, roomCode, 6)
      let playBonus = 15 + play.comboSize * 5
      if (currentComboForValidation && play.comboSize <= currentComboForValidation.size) {
        playBonus += 10
      }
      if (opponentInDanger) {
        playBonus += 20
      }
      
      const util = 
        100 * sim.winProbability -
        6 * sim.avgTurnsToWin -
        120 * sim.loseSoonProbability -
        80 * sim.giveFinisherProbability +
        playBonus
      
      if (util > bestPlayUtil) {
        bestPlayUtil = util
        bestPlay = play
      }
    }
    
    // Only play if it's significantly better than drawing (margin of 20 points)
    // This allows strategic draws when the hand needs reshaping
    if (bestPlayUtil > bestUtility + 20) {
      return { action: 'play', indices: bestPlay.indices }
    }
    // Otherwise, trust the simulation and draw
    return { action: 'draw' }
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
  if (!bot || !bot.hand) return { action: 'discard' }
  
  // Calculate hand cost before and after insertion
  const originalCost = calculateHandCost(bot.hand)
  const optimal = findOptimalInsertion(bot.hand, [card])
  
  if (optimal.length > 0) {
    const testHand = [...bot.hand]
    testHand.splice(optimal[0].position, 0, card)
    const newCost = calculateHandCost(testHand)
    
    // Check if card matches anything in hand
    const cardValues = card.isSplit ? card.splitValues : [card.value]
    const hasMatch = bot.hand.some(handCard => {
      const handValues = handCard.isSplit ? handCard.splitValues : [handCard.value]
      return cardValues.some(v => handValues.includes(v))
    })
    
    // Discard if no match AND it increases hand cost (makes hand worse)
    if (!hasMatch && newCost >= originalCost) {
      return { action: 'discard' }
    }
    
    return { action: 'insert', position: optimal[0].position }
  }
  
  // Fallback: check if matches anything
  const cardValues = card.isSplit ? card.splitValues : [card.value]
  const hasMatch = bot.hand.some(handCard => {
    const handValues = handCard.isSplit ? handCard.splitValues : [handCard.value]
    return cardValues.some(v => handValues.includes(v))
  })
  
  if (!hasMatch) {
    return { action: 'discard' }
  }
  
  return { action: 'insert', position: bot.hand.length }
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
