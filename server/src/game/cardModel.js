export class Card {
  constructor(id, value, isSplit = false, splitValues = null) {
    this.id = id
    this.value = value
    this.isSplit = isSplit
    this.splitValues = splitValues || (isSplit ? [value] : null)
  }

  resolveValue(chosenValue = null) {
    if (!this.isSplit) {
      return this.value
    }
    if (chosenValue !== null && this.splitValues.includes(chosenValue)) {
      return chosenValue
    }
    return this.splitValues[0]
  }

  canResolveTo(value) {
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

export function createDeck() {
  const deck = []
  let cardId = 0

  // Standard cards (values 1-8)
  // 9 cards per value to ensure enough cards for 5 players (8 cards each = 40 needed)
  // Total: 8 values × 9 cards = 72 standard cards
  const standardValues = [1, 2, 3, 4, 5, 6, 7, 8]
  const cardsPerValue = 9

  standardValues.forEach(value => {
    for (let i = 0; i < cardsPerValue; i++) {
      deck.push(new Card(cardId++, value))
    }
  })

  // Split cards (5/6) - 8 split cards total
  deck.push(new Card(cardId++, 5, true, [5, 6]))
  deck.push(new Card(cardId++, 5, true, [5, 6]))
  deck.push(new Card(cardId++, 5, true, [5, 6]))
  deck.push(new Card(cardId++, 5, true, [5, 6]))
  deck.push(new Card(cardId++, 6, true, [5, 6]))
  deck.push(new Card(cardId++, 6, true, [5, 6]))
  deck.push(new Card(cardId++, 6, true, [5, 6]))
  deck.push(new Card(cardId++, 6, true, [5, 6]))

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
  return new Card(data.id, data.value, data.isSplit, data.splitValues)
}
