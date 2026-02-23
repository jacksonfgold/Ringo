/** Special card effect ids. When drawn, player uses the effect (or discards the card). */
export const SPECIAL_EFFECTS = {
  PEEK_HAND: { name: 'Peek hand', needsTarget: true, desc: "View another player's hand" },
  GIVE_RANDOM: { name: 'Give card', needsTarget: true, desc: 'Give another player a random card from your hand' },
  STEAL_RANDOM: { name: 'Steal', needsTarget: true, desc: 'Take a random card from another player' },
  PEEK_DRAW: { name: 'Peek deck', needsTarget: false, desc: 'Look at the top 3 cards of the draw pile' },
  SKIP_NEXT: { name: 'Skip', needsTarget: false, desc: "Skip the next player's turn" },
  SWAP_HAND: { name: 'Swap hand', needsTarget: true, desc: 'Swap your hand with another player' },
  DISCARD_DRAW: { name: 'Discard & draw', needsTarget: false, desc: 'Discard your hand and draw the same number' }
}

export class Card {
  constructor(id, value, isSplit = false, splitValues = null, isSpecialCard = false, effectId = null) {
    this.id = id
    this.value = value
    this.isSplit = isSplit
    this.splitValues = splitValues || (isSplit ? [value] : null)
    this.isSpecialCard = isSpecialCard ?? false
    this.effectId = effectId ?? null
  }

  resolveValue(chosenValue = null) {
    if (this.isSpecialCard) return this.value
    if (!this.isSplit) {
      return this.value
    }
    if (chosenValue !== null && this.splitValues.includes(chosenValue)) {
      return chosenValue
    }
    return this.splitValues[0]
  }

  canResolveTo(value) {
    if (this.isSpecialCard) return false
    if (!this.isSplit) {
      return this.value === value
    }
    return this.splitValues.includes(value)
  }

  static compareValues(a, b) {
    return a - b
  }

  static beats(value1, value2) {
    return value1 > value2
  }
}

export function createDeck(settings = {}) {
  const deck = []
  let cardId = 0

  // Standard cards (values 1-8), 8 of each
  const standardValues = [1, 2, 3, 4, 5, 6, 7, 8]
  const cardsPerValue = 8

  standardValues.forEach(value => {
    for (let i = 0; i < cardsPerValue; i++) {
      deck.push(new Card(cardId++, value))
    }
  })

  // Split cards: 2 of each 1/2, 3/4, 5/6, 7/8 (8 total)
  const splitPairs = [[1, 2], [3, 4], [5, 6], [7, 8]]
  for (const [low, high] of splitPairs) {
    for (let i = 0; i < 2; i++) {
      deck.push(new Card(cardId++, low, true, [low, high]))
    }
  }

  // Special cards (only in Chaos / special-cards mode)
  if (settings.specialCardsMode) {
    const effectIds = Object.keys(SPECIAL_EFFECTS)
    const copiesPerEffect = 6
    for (const effectId of effectIds) {
      for (let i = 0; i < copiesPerEffect; i++) {
        deck.push(new Card(cardId++, 0, false, null, true, effectId))
      }
    }
  }

  return shuffleDeck(deck)
}

export function shuffleDeck(deck) {
  const shuffled = [...deck]
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]]
  }
  return shuffled
}

export function createCardFromData(data) {
  return new Card(
    data.id,
    data.value,
    data.isSplit,
    data.splitValues,
    data.isSpecialCard,
    data.effectId
  )
}
