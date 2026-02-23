import { updateGameState, getPlayerById, shuffleDiscardIntoDraw } from './gameState.js'
import { SPECIAL_EFFECTS } from './cardModel.js'

/**
 * Apply a special card effect. Does NOT remove the drawn card or advance turn
 * (caller does that after). Returns { success, state, payloadForActor }.
 * payloadForActor is sent only to the player who used the card (e.g. peek hand / peek deck).
 */
export function applySpecialEffect(state, playerId, effectId, targetPlayerId = null) {
  const effect = SPECIAL_EFFECTS[effectId]
  if (!effect) {
    return { success: false, error: 'Unknown effect', state }
  }

  const actor = getPlayerById(state, playerId)
  if (!actor) {
    return { success: false, error: 'Player not found', state }
  }

  if (effect.needsTarget && !targetPlayerId) {
    return { success: false, error: 'This effect requires a target player', state }
  }

  const target = targetPlayerId ? getPlayerById(state, targetPlayerId) : null
  if (effect.needsTarget && !target) {
    return { success: false, error: 'Target player not found', state }
  }

  if (effect.needsTarget && target.id === playerId) {
    return { success: false, error: 'You cannot target yourself', state }
  }

  let newState = state
  let payloadForActor = null

  switch (effectId) {
    case 'PEEK_HAND': {
      payloadForActor = { type: 'PEEK_HAND', targetName: target.name, hand: [...target.hand] }
      break
    }

    case 'GIVE_RANDOM': {
      if (actor.hand.length === 0) {
        return { success: false, error: 'You have no cards to give', state }
      }
      const idx = Math.floor(Math.random() * actor.hand.length)
      const card = actor.hand[idx]
      const newActorHand = actor.hand.filter((_, i) => i !== idx)
      const newTargetHand = [...target.hand, card]
      newState = updateGameState(state, {
        players: state.players.map(p =>
          p.id === playerId ? { ...p, hand: newActorHand }
          : p.id === targetPlayerId ? { ...p, hand: newTargetHand }
          : p
        )
      })
      payloadForActor = { type: 'GIVE_RANDOM', givenCard: card, targetName: target.name }
      break
    }

    case 'STEAL_RANDOM': {
      if (target.hand.length === 0) {
        return { success: false, error: 'Target has no cards to steal', state }
      }
      const idx = Math.floor(Math.random() * target.hand.length)
      const card = target.hand[idx]
      const newTargetHand = target.hand.filter((_, i) => i !== idx)
      const newActorHand = [...actor.hand, card]
      newState = updateGameState(state, {
        players: state.players.map(p =>
          p.id === playerId ? { ...p, hand: newActorHand }
          : p.id === targetPlayerId ? { ...p, hand: newTargetHand }
          : p
        )
      })
      payloadForActor = { type: 'STEAL_RANDOM', stolenCard: card, targetName: target.name }
      break
    }

    case 'DRAW_TWO': {
      newState = shuffleDiscardIntoDraw(newState)
      if (newState.drawPile.length < 2) {
        return { success: false, error: 'Not enough cards to draw', state }
      }
      const pile = [...newState.drawPile]
      const drawn = [pile.pop(), pile.pop()]
      const newHand = [...actor.hand, ...drawn]
      newState = updateGameState(newState, {
        drawPile: pile,
        players: state.players.map(p =>
          p.id === playerId ? { ...p, hand: newHand } : p
        )
      })
      payloadForActor = { type: 'DRAW_TWO', drawnCards: drawn }
      break
    }

    case 'PEEK_DRAW': {
      newState = shuffleDiscardIntoDraw(newState)
      const top = newState.drawPile.slice(-3).reverse()
      payloadForActor = { type: 'PEEK_DRAW', cards: top }
      break
    }

    case 'SKIP_NEXT': {
      const nextIndex = (state.currentPlayerIndex + 1) % state.players.length
      const nextPlayer = state.players[nextIndex]
      newState = updateGameState(state, { skippedPlayerId: nextPlayer.id })
      payloadForActor = { type: 'SKIP_NEXT', skippedName: nextPlayer.name }
      break
    }

    case 'SWAP_HAND': {
      const actorHand = [...actor.hand]
      const targetHand = [...target.hand]
      newState = updateGameState(state, {
        players: state.players.map(p =>
          p.id === playerId ? { ...p, hand: targetHand }
          : p.id === targetPlayerId ? { ...p, hand: actorHand }
          : p
        )
      })
      payloadForActor = { type: 'SWAP_HAND', targetName: target.name }
      break
    }

    case 'DISCARD_DRAW': {
      const count = actor.hand.length
      const newDiscardPile = [...state.discardPile, ...actor.hand]
      newState = updateGameState(state, {
        discardPile: newDiscardPile,
        players: state.players.map(p =>
          p.id === playerId ? { ...p, hand: [] } : p
        )
      })
      newState = shuffleDiscardIntoDraw(newState)
      const pile = [...newState.drawPile]
      const drawCount = Math.min(count, pile.length)
      const drawn = pile.splice(-drawCount)
      const newHand = [...drawn]
      newState = updateGameState(newState, {
        drawPile: pile,
        players: newState.players.map(p =>
          p.id === playerId ? { ...p, hand: newHand } : p
        )
      })
      payloadForActor = { type: 'DISCARD_DRAW', drawnCards: newHand }
      break
    }

    default:
      return { success: false, error: 'Effect not implemented', state }
  }

  return { success: true, state: newState, payloadForActor }
}
