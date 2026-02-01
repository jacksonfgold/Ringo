import { useState, useEffect, useMemo } from 'react'
import { DndContext, useDraggable, useDroppable, DragOverlay, useSensor, useSensors, MouseSensor, TouchSensor } from '@dnd-kit/core'
import { CSS } from '@dnd-kit/utilities'

// --- Draggable/Droppable Components ---

const DraggableCard = ({ id, children, disabled, style }) => {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id,
    disabled
  })
  
  const combinedStyle = {
    ...style,
    transform: CSS.Translate.toString(transform),
    opacity: isDragging ? 0.5 : 1,
    touchAction: 'none',
    zIndex: isDragging ? 1000 : 'auto'
  }

  return (
    <div ref={setNodeRef} style={combinedStyle} {...listeners} {...attributes}>
      {children}
    </div>
  )
}

const DroppableZone = ({ id, children, style, activeStyle, onClick }) => {
  const { isOver, setNodeRef } = useDroppable({
    id
  })

  const combinedStyle = {
    ...style,
    ...(isOver ? activeStyle : {})
  }

  return (
    <div ref={setNodeRef} style={combinedStyle} onClick={onClick}>
      {children}
    </div>
  )
}

// Color mapping for card values - darker, more distinct colors
const getCardColor = (value) => {
  const colors = {
    1: '#C0392B', // Dark Red
    2: '#16A085', // Dark Teal
    3: '#2980B9', // Dark Blue
    4: '#E67E22', // Dark Orange
    5: '#27AE60', // Dark Green
    6: '#F39C12', // Dark Gold
    7: '#8E44AD', // Dark Purple
    8: '#34495E'  // Dark Slate
  }
  return colors[value] || '#7F8C8D'
}

export default function GameBoard({ socket, gameState, roomCode, roomPlayers = [], onGoHome }) {
  const [selectedCards, setSelectedCards] = useState([])
  const [splitResolutions, setSplitResolutions] = useState({})
  const [drawnCard, setDrawnCard] = useState(null)
  const [ringoPossible, setRingoPossible] = useState(false)
  const [ringoInfo, setRingoInfo] = useState(null)
  const [showSplitDialog, setShowSplitDialog] = useState(false)
  const [showInsertDialog, setShowInsertDialog] = useState(false)
  const [insertingCard, setInsertingCard] = useState(false)
  const [insertingCapture, setInsertingCapture] = useState(null) // cardId being inserted
  const [ringoMode, setRingoMode] = useState(false)
  const [pendingPlay, setPendingPlay] = useState(null)
  const [activeDragId, setActiveDragId] = useState(null)
  const [invalidSelectionIndex, setInvalidSelectionIndex] = useState(null)

  // Configure sensors for drag vs click distinction
  const mouseSensor = useSensor(MouseSensor, {
    activationConstraint: {
      distance: 5, // 5px movement required before drag starts
    },
  })
  const touchSensor = useSensor(TouchSensor, {
    activationConstraint: {
      delay: 250, // Slight delay for touch to differentiate tap/scroll vs drag
      tolerance: 5,
    },
  })
  const sensors = useSensors(mouseSensor, touchSensor)

  const handleDragStart = (event) => {
    const { id } = event.active
    setActiveDragId(id)

    // Auto-enable insertion zones when dragging
    if (id === 'drawn-card') {
      setInsertingCard(true)
    } else if (String(id).startsWith('capture-')) {
      const cardId = parseInt(String(id).replace('capture-', ''), 10)
      setInsertingCapture(cardId)
    }
  }

  const handleDragEnd = (event) => {
    const { active, over } = event
    setActiveDragId(null)

    // If dropped nowhere
    if (!over) {
      // For capture cards, reset selection so user can pick another card easily
      if (String(active.id).startsWith('capture-')) {
        setInsertingCapture(null)
      }
      return
    }

    // Dragging drawn card to insert
    if (active.id === 'drawn-card' && over.id.startsWith('hand-gap-')) {
      const index = parseInt(over.id.split('-')[2])
      handleInsertCard(index)
      return
    }

    // Dragging capture card to insert
    if (String(active.id).startsWith('capture-') && over.id.startsWith('hand-gap-')) {
      const index = parseInt(over.id.split('-')[2])
      const cardId = parseInt(String(active.id).replace('capture-', ''), 10)
      handleCaptureDecision('insert_one', index, cardId)
      return
    }

    // Dragging drawn card to play area (RINGO only)
    if (active.id === 'drawn-card' && over.id === 'play-area') {
      if (ringoPossible) {
        executeRINGO(selectedCards, ringoInfo?.insertPosition || 0, splitResolutions)
      }
      return
    }
  }

  const getPossibleValuesForSelection = (indices) => {
    if (!currentPlayer || indices.length === 0) return new Set()

    let possible = null
    indices.forEach(idx => {
      const card = currentPlayer.hand[idx]
      const values = card.isSplit ? new Set(card.splitValues) : new Set([card.value])
      if (possible === null) {
        possible = values
      } else {
        possible = new Set([...possible].filter(v => values.has(v)))
      }
    })

    return possible || new Set()
  }

  const triggerInvalidSelection = (index) => {
    setInvalidSelectionIndex(index)
    setTimeout(() => setInvalidSelectionIndex(null), 350)
  }

  const currentPlayer = useMemo(() => {
    return gameState?.players?.find(p => p.hand !== undefined)
  }, [gameState?.players])

  const myPlayerIndex = useMemo(() => {
    if (!gameState?.players || !socket?.id) {
      console.log('[GameBoard] Cannot calculate myPlayerIndex:', { 
        hasPlayers: !!gameState?.players, 
        hasSocketId: !!socket?.id,
        gameStatePlayers: gameState?.players?.length,
        socketId: socket?.id
      })
      return -1
    }
    const index = gameState.players.findIndex(p => p.id === socket.id)
    console.log('[GameBoard] Calculated myPlayerIndex:', index, {
      socketId: socket.id,
      playerIds: gameState.players.map(p => p.id),
      playerNames: gameState.players.map(p => p.name),
      currentPlayerIndex: gameState.currentPlayerIndex,
      willMatch: index === gameState.currentPlayerIndex
    })
    if (index === -1) {
      console.warn('[GameBoard] WARNING: Could not find player with socket.id in game state!', {
        socketId: socket.id,
        allPlayerIds: gameState.players.map(p => p.id),
        allPlayerNames: gameState.players.map(p => p.name)
      })
    }
    return index
  }, [gameState?.players, socket?.id, gameState?.currentPlayerIndex])

  const isMyTurn = useMemo(() => {
    if (!gameState || myPlayerIndex === -1) {
      console.log('[GameBoard] Cannot determine isMyTurn:', { 
        hasGameState: !!gameState, 
        myPlayerIndex 
      })
      return false
    }
    const turn = gameState.currentPlayerIndex === myPlayerIndex
    console.log('[GameBoard] Calculated isMyTurn:', turn, {
      currentPlayerIndex: gameState.currentPlayerIndex,
      myPlayerIndex,
      turnPhase: gameState.turnPhase
    })
    return turn
  }, [gameState?.currentPlayerIndex, myPlayerIndex, gameState?.turnPhase])
  
  // Debug logging
  useEffect(() => {
    if (gameState && socket) {
      console.log('[GameBoard] State update:', {
        socketId: socket.id,
        myPlayerIndex,
        currentPlayerIndex: gameState.currentPlayerIndex,
        isMyTurn,
        turnPhase: gameState.turnPhase,
        players: gameState.players?.map(p => ({ id: p.id, name: p.name, hasHand: !!p.hand }))
      })
    }
  }, [gameState, socket, myPlayerIndex, isMyTurn])

  useEffect(() => {
    if (!socket) return

    const handleCardDrawn = (data) => {
      setDrawnCard(data.card)
      setRingoPossible(data.ringoPossible)
      setRingoInfo(data.ringoInfo)
    }

    const handleGameStateUpdate = (data) => {
      if (data.ringo) {
        // Show RINGO notification
        setTimeout(() => {
          // Notification handled
        }, 1000)
      }
      // Only clear drawn card if it's not our turn or if we're not in a draw phase
      // Don't clear if we're still waiting for our action
      if (data.gameState) {
        const myIdx = data.gameState.players?.findIndex(p => p.id === socket.id) ?? -1
        const isMyTurnNow = data.gameState.currentPlayerIndex === myIdx
        const isDrawPhase = data.gameState.turnPhase === 'PROCESSING_DRAW' || data.gameState.turnPhase === 'RINGO_CHECK'
        
        // Only clear drawn card if it's not our turn or we're past the draw phase
        if (!isMyTurnNow || !isDrawPhase) {
          setDrawnCard(null)
          setRingoPossible(false)
          setRingoInfo(null)
          setRingoMode(false)
        }
        
        // Only clear selected cards if it's not our turn anymore
        if (!isMyTurnNow) {
          setSelectedCards([])
          setSplitResolutions({})
        }
      } else {
        // Fallback: clear everything if no game state
        setDrawnCard(null)
        setRingoPossible(false)
        setRingoInfo(null)
        setRingoMode(false)
        setSelectedCards([])
        setSplitResolutions({})
      }
    }

    socket.on('cardDrawn', handleCardDrawn)
    socket.on('gameStateUpdate', handleGameStateUpdate)

    return () => {
      socket.off('cardDrawn', handleCardDrawn)
      socket.off('gameStateUpdate', handleGameStateUpdate)
    }
  }, [socket])

  const handleCardClick = (index) => {
    if (!isMyTurn) return

    // Special handling for RINGO mode
    if (ringoMode) {
      if (selectedCards.includes(index)) {
        // Deselecting: only if it's an end of the selection
        const sorted = [...selectedCards].sort((a, b) => a - b)
        if (index === sorted[0]) {
          setSelectedCards(sorted.slice(1))
        } else if (index === sorted[sorted.length - 1]) {
          setSelectedCards(sorted.slice(0, -1))
        } else {
          // Deselecting from middle: clear selection
          setSelectedCards([])
        }
      } else {
        // Selecting: must be adjacent to current selection
        if (selectedCards.length === 0) {
          setSelectedCards([index])
        } else {
          const sorted = [...selectedCards].sort((a, b) => a - b)
          if (index === sorted[0] - 1) {
            const possibleValues = getPossibleValuesForSelection(sorted)
            const card = currentPlayer.hand[index]
            const cardValues = card.isSplit ? new Set(card.splitValues) : new Set([card.value])
            const canAdd = [...possibleValues].some(v => cardValues.has(v)) || possibleValues.size === 0
            if (!canAdd) {
              triggerInvalidSelection(index)
              return
            }
            setSelectedCards([index, ...sorted])
          } else if (index === sorted[sorted.length - 1] + 1) {
            const possibleValues = getPossibleValuesForSelection(sorted)
            const card = currentPlayer.hand[index]
            const cardValues = card.isSplit ? new Set(card.splitValues) : new Set([card.value])
            const canAdd = [...possibleValues].some(v => cardValues.has(v)) || possibleValues.size === 0
            if (!canAdd) {
              triggerInvalidSelection(index)
              return
            }
            setSelectedCards([...sorted, index])
          } else {
            // Not adjacent: start new selection
            setSelectedCards([index])
          }
        }
      }
      return
    }

    if (gameState.turnPhase !== 'WAITING_FOR_PLAY_OR_DRAW') {
      return
    }

    if (selectedCards.includes(index)) {
      const sorted = [...selectedCards].sort((a, b) => a - b)
      const clickedIndexInSorted = sorted.indexOf(index)
      
      const distToStart = clickedIndexInSorted
      const distToEnd = (sorted.length - 1) - clickedIndexInSorted
      
      // Smart peeling: remove the clicked card and whatever side is shorter
      // to maintain a single adjacent group.
      // If closer to start, peel from start.
      // If closer to end (or equal), peel from end.
      if (distToStart < distToEnd) {
        setSelectedCards(sorted.slice(clickedIndexInSorted + 1))
      } else {
        setSelectedCards(sorted.slice(0, clickedIndexInSorted))
      }
    } else {
      // Check if card is adjacent to selected cards
      if (selectedCards.length === 0) {
        setSelectedCards([index])
      } else {
        const sorted = [...selectedCards].sort((a, b) => a - b)
        if (index === sorted[0] - 1) {
          const possibleValues = getPossibleValuesForSelection(sorted)
          const card = currentPlayer.hand[index]
          const cardValues = card.isSplit ? new Set(card.splitValues) : new Set([card.value])
          const canAdd = [...possibleValues].some(v => cardValues.has(v)) || possibleValues.size === 0
          if (!canAdd) {
            triggerInvalidSelection(index)
            return
          }
          setSelectedCards([index, ...sorted])
        } else if (index === sorted[sorted.length - 1] + 1) {
          const possibleValues = getPossibleValuesForSelection(sorted)
          const card = currentPlayer.hand[index]
          const cardValues = card.isSplit ? new Set(card.splitValues) : new Set([card.value])
          const canAdd = [...possibleValues].some(v => cardValues.has(v)) || possibleValues.size === 0
          if (!canAdd) {
            triggerInvalidSelection(index)
            return
          }
          setSelectedCards([...sorted, index])
        } else {
          // Not adjacent: start new selection
          setSelectedCards([index])
        }
      }
    }
  }

  const handlePlay = () => {
    if (selectedCards.length === 0) return
    // Server auto-resolves split cards now
    executePlay(selectedCards, splitResolutions)
  }

  // Use gameState.roomCode as primary (set by server on rejoin), fallback to prop
  const effectiveRoomCode = gameState?.roomCode || roomCode || ''

  const executePlay = (cardIndices, resolutions) => {
    console.log('[GameBoard] executePlay with roomCode:', effectiveRoomCode)
    socket.emit('playCards', {
      roomCode: effectiveRoomCode,
      cardIndices,
      splitResolutions: resolutions
    }, (response) => {
      if (!response.success) {
        alert(response.error || 'Invalid play')
        setSelectedCards([])
        setSplitResolutions({})
      }
    })
  }

  const handleDraw = () => {
    console.log('[GameBoard] handleDraw with roomCode:', effectiveRoomCode)
    socket.emit('drawCard', {
      roomCode: effectiveRoomCode
    }, (response) => {
      if (!response.success) {
        alert(response.error || 'Failed to draw card')
      }
    })
  }

  const handleRINGO = () => {
    if (!ringoMode) {
      // Enter RINGO mode: clear current selection and let user pick
      setSelectedCards([])
      setRingoMode(true)
      return
    }

    // Allow RINGO with just the drawn card (0 hand cards selected) or with hand cards
    executeRINGO(selectedCards, ringoInfo?.insertPosition || 0, {})
  }

  const executeRINGO = (comboIndices, insertPosition, resolutions) => {
    socket.emit('ringo', {
      roomCode: effectiveRoomCode,
      comboIndices,
      insertPosition,
      splitResolutions: resolutions
    }, (response) => {
      if (!response.success) {
        alert(response.error || 'Invalid RINGO')
      }
    })
  }

  const handleInsertCard = (position) => {
    socket.emit('insertCard', {
      roomCode: effectiveRoomCode,
      insertPosition: position
    }, (response) => {
      if (!response.success) {
        alert(response.error || 'Failed to insert card')
      } else {
        setInsertingCard(false)
      }
    })
  }

  const handleCaptureDecision = (action, insertPosition, cardId) => {
    socket.emit('captureCombo', {
      roomCode: effectiveRoomCode,
      action,
      insertPosition,
      cardId
    }, (response) => {
      if (!response.success) {
        alert(response.error || 'Failed to capture combo')
      } else {
        setInsertingCapture(null)
      }
    })
  }

  const handleDiscardCard = () => {
    socket.emit('discardCard', {
      roomCode: effectiveRoomCode
    }, (response) => {
      if (!response.success) {
        alert(response.error || 'Failed to discard card')
      }
    })
  }

  const handleSplitResolution = (cardId, value) => {
    setSplitResolutions({ ...splitResolutions, [cardId]: value })
  }

  const confirmSplitResolutions = () => {
    if (pendingPlay.type === 'ringo') {
      executeRINGO(pendingPlay.comboIndices, pendingPlay.insertPosition, splitResolutions)
    } else {
      executePlay(pendingPlay.cardIndices, splitResolutions)
    }
    setShowSplitDialog(false)
    setPendingPlay(null)
  }

  if (gameState?.status === 'GAME_OVER') {
    const winner = gameState.players.find(p => p.id === gameState.winner)
    const isWinner = gameState.winner === socket.id
    return (
      <div style={styles.gameOverContainer}>
        <div style={styles.gameOverCard}>
          <h1 style={styles.gameOverTitle}>{isWinner ? '🎉 You Win! 🎉' : `${winner?.name} Wins!`}</h1>
          <p style={styles.gameOverSubtitle}>
            {isWinner ? 'Congratulations!' : 'Better luck next time!'}
          </p>
          <button
            onClick={onGoHome}
            style={styles.gameOverButton}
          >
            Return to Lobby
          </button>
        </div>
      </div>
    )
  }

  const handleBackgroundClick = (e) => {
    // Basic check: if we clicked on the container directly (or specific wrappers)
    // and not on a button or card, clear selection.
    // We use data attributes to mark interactive elements if needed, 
    // but e.target === e.currentTarget check on specific containers works well.
    if (selectedCards.length > 0) {
       setSelectedCards([])
    }
  }

  return (
    <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
      <div style={styles.container} onClick={(e) => {
        // Only trigger if clicking the background directly
        if (e.target === e.currentTarget) {
          handleBackgroundClick(e)
        }
      }}>
        <button
          onClick={onGoHome}
          style={styles.homeButton}
        >
          ← Home
        </button>
        <div style={styles.gameArea}>
          {/* Players */}
          <div style={styles.otherPlayers}>
            {(gameState?.players?.length ? gameState.players : roomPlayers).map((player, index) => {
              const isActive = gameState?.currentPlayerIndex === index
              const handSize = player.handSize ?? player.hand?.length ?? 0
              const isMe = player.id === socket.id
              return (
                <div
                  key={player.id || `${player.name}-${index}`}
                  style={{
                    ...styles.playerCard,
                    ...(isActive ? styles.activePlayer : {}),
                    ...(isMe ? styles.currentPlayerCard : {})
                  }}
                >
                  <div style={styles.playerName}>
                    {isMe ? `${player.name} (You)` : player.name}
                  </div>
                  <div style={styles.cardCount}>{handSize} cards</div>
                </div>
              )
            })}
          </div>

          {/* Current Combo / Play Area (Hidden when drawnCard active for cleaner look, or just allow stacking) */}
          {!drawnCard && !gameState?.pendingCapture?.cards && (
            <DroppableZone 
              id="play-area" 
              style={styles.currentCombo}
              activeStyle={{
                background: 'rgba(102, 126, 234, 0.1)',
                borderColor: '#667eea',
                borderWidth: '2px',
                borderStyle: 'dashed'
              }}
            >
              {gameState?.currentCombo && (
                <>
                  <div style={styles.comboLabel}>
                    Current Combo ({gameState.currentCombo.length} cards)
                  </div>
                  <div style={styles.comboCards}>
                    {gameState.currentCombo.map((card, idx) => {
                      const cardColor = card.isSplit 
                        ? `linear-gradient(to right, ${getCardColor(card.splitValues[0])} 0%, ${getCardColor(card.splitValues[0])} 50%, ${getCardColor(card.splitValues[1])} 50%, ${getCardColor(card.splitValues[1])} 100%)`
                        : getCardColor(card.value)
                      return (
                        <div key={idx} style={{ ...styles.comboCard, background: cardColor }}>
                          {card.isSplit ? `${card.splitValues[0]}/${card.splitValues[1]}` : card.value}
                        </div>
                      )
                    })}
                  </div>
                </>
              )}
              {!gameState?.currentCombo && (
                <div style={{ padding: '20px', color: '#aaa', fontStyle: 'italic' }}>
                  Drag cards here to play
                </div>
              )}
            </DroppableZone>
          )}

          {/* Current Combo (Small View for Context when Drawn Card active) */}
          {(drawnCard || gameState?.pendingCapture?.cards) && gameState?.currentCombo && (
             <div style={styles.miniCombo}>
               <div style={styles.miniComboLabel}>Current Combo to Beat:</div>
               <div style={styles.miniComboCards}>
                 {gameState.currentCombo.map((card, idx) => {
                    const cardColor = card.isSplit 
                      ? `linear-gradient(to right, ${getCardColor(card.splitValues[0])} 0%, ${getCardColor(card.splitValues[0])} 50%, ${getCardColor(card.splitValues[1])} 50%, ${getCardColor(card.splitValues[1])} 100%)`
                      : getCardColor(card.value)
                    return (
                      <div key={idx} style={{ ...styles.miniComboCard, background: cardColor }}>
                        {card.isSplit ? `${card.splitValues[0]}/${card.splitValues[1]}` : card.value}
                      </div>
                    )
                 })}
               </div>
             </div>
          )}

          {/* Drawn Card (Inline) */}
          {drawnCard && (
            <div style={styles.drawnCardSection}>
              <div style={styles.drawnCardLabel}>Drawn Card</div>
              <DraggableCard 
                id="drawn-card" 
                disabled={!insertingCard && !ringoMode} 
              >
                <div style={{
                  ...styles.drawnCard,
                  background: drawnCard.isSplit 
                    ? `linear-gradient(to right, ${getCardColor(drawnCard.splitValues[0])} 0%, ${getCardColor(drawnCard.splitValues[0])} 50%, ${getCardColor(drawnCard.splitValues[1])} 50%, ${getCardColor(drawnCard.splitValues[1])} 100%)`
                    : getCardColor(drawnCard.value),
                  color: 'white',
                  cursor: (insertingCard || ringoMode) ? 'grab' : 'default'
                }}>
                  {drawnCard.isSplit ? (
                    <div style={styles.splitCardContainer}>
                      <div style={styles.splitCardValue}>{drawnCard.splitValues[0]}</div>
                      <div style={styles.splitDivider}>/</div>
                      <div style={styles.splitCardValue}>{drawnCard.splitValues[1]}</div>
                    </div>
                  ) : (
                    <div style={styles.cardValue}>{drawnCard.value}</div>
                  )}
                </div>
              </DraggableCard>
              
              {/* Action Buttons */}
              <div style={styles.drawnCardActions}>
                {ringoMode ? (
                  // RINGO Mode Actions
                  <>
                    <button 
                      onClick={handleRINGO} 
                      style={styles.confirmRingoButton}
                    >
                      Confirm RINGO {selectedCards.length > 0 ? `(+${selectedCards.length})` : ''}
                    </button>
                    <button 
                      onClick={() => {
                        setRingoMode(false)
                        setSelectedCards([])
                      }}
                      style={styles.cancelRingoButton}
                    >
                      Cancel
                    </button>
                  </>
                ) : (
                  // Standard Actions
                  <>
                    {ringoPossible && (
                      <button 
                        onClick={handleRINGO} 
                        style={styles.ringoButton}
                      >
                        RINGO!
                      </button>
                    )}
                    <button
                      onClick={() => setInsertingCard(!insertingCard)}
                      style={{
                        ...styles.insertButton,
                        background: insertingCard ? '#e74c3c' : '#2ecc71'
                      }}
                    >
                      {insertingCard ? 'Cancel' : 'Add to Hand'}
                    </button>
                    <button onClick={handleDiscardCard} style={styles.discardButton}>
                      Discard
                    </button>
                  </>
                )}
              </div>
              
              {ringoMode && (
                <div style={styles.ringoHint}>
                  Select adjacent cards from your hand to combine with the drawn card, or just confirm to play it alone.
                </div>
              )}
            </div>
          )}

          {/* Capture previous combo decision (Inline) */}
          {gameState?.pendingCapture?.cards && (
            <div style={styles.captureSection}>
              <div style={styles.captureLabel}>You won the previous combo!</div>
              <div style={styles.captureComboPreview}>
                {gameState.pendingCapture.cards.map((card, idx) => {
                  const cardColor = card.isSplit 
                    ? `linear-gradient(to right, ${getCardColor(card.splitValues[0])} 0%, ${getCardColor(card.splitValues[0])} 50%, ${getCardColor(card.splitValues[1])} 50%, ${getCardColor(card.splitValues[1])} 100%)`
                    : getCardColor(card.value)
                  const isBeingInserted = insertingCapture === card.id
                  
                  return (
                    <DraggableCard 
                      key={idx} 
                      id={`capture-${card.id}`}
                      disabled={insertingCapture !== null && !isBeingInserted} 
                    >
                      <div style={styles.captureCardWrapper}>
                        <div style={{ 
                          ...styles.comboCard, 
                          background: cardColor, 
                          opacity: insertingCapture && !isBeingInserted ? 0.5 : 1,
                          cursor: 'grab'
                        }}>
                          {card.isSplit ? `${card.splitValues[0]}/${card.splitValues[1]}` : card.value}
                        </div>
                        <div style={styles.captureCardActions}>
                          {!insertingCapture && (
                            <button 
                              onClick={() => setInsertingCapture(card.id)} 
                              style={styles.captureCardButton}
                            >
                              Add
                            </button>
                          )}
                          {isBeingInserted && (
                            <button 
                              onClick={() => setInsertingCapture(null)} 
                              style={{ ...styles.captureCardButton, background: '#999' }}
                            >
                              Cancel
                            </button>
                          )}
                        </div>
                      </div>
                    </DraggableCard>
                  )
                })}
              </div>
              <div style={styles.captureActions}>
                {!insertingCapture && (
                  <button
                    onClick={() => handleCaptureDecision('discard_all')}
                    style={styles.captureDiscardButton}
                  >
                    Discard All
                  </button>
                )}
              </div>
              {insertingCapture && (
                <div style={styles.captureHint}>Tap a + between cards in your hand to insert this card.</div>
              )}
            </div>
          )}

          {/* Player's Hand */}
          {currentPlayer && (
            <div style={styles.handSection}>
              <div style={styles.handLabel}>
                {ringoMode ? (
                  <span style={styles.ringoHandLabel}>Select cards to combine with drawn card 👇</span>
                ) : (
                  'Your Hand'
                )}
              </div>
              <div style={{
                ...styles.hand,
                ...(ringoMode ? styles.ringoHand : {})
              }} onClick={(e) => {
               if (e.target === e.currentTarget && selectedCards.length > 0) {
                 setSelectedCards([])
               }
            }}>
              {/* Initial Insertion Slot */}
              {(insertingCard || insertingCapture !== null) && (
                  <DroppableZone
                    id="hand-gap-0"
                    style={{
                      ...styles.insertSlot,
                    width: activeDragId && (activeDragId === 'drawn-card' || activeDragId.startsWith('capture-')) ? '40px' : '28px',
                    height: activeDragId && (activeDragId === 'drawn-card' || activeDragId.startsWith('capture-')) ? '90px' : '28px',
                    borderRadius: activeDragId && (activeDragId === 'drawn-card' || activeDragId.startsWith('capture-')) ? '8px' : '50%',
                      transition: 'all 0.2s',
                      opacity: (insertingCard || insertingCapture !== null) ? 1 : (activeDragId ? 0.5 : 0),
                      display: (insertingCard || insertingCapture !== null || activeDragId) ? 'flex' : 'none',
                      background: activeDragId ? 'rgba(0,0,0,0.1)' : 'white'
                    }}
                    activeStyle={{
                      background: 'rgba(46, 204, 113, 0.4)',
                      borderColor: '#2ecc71',
                      transform: 'scale(1.1)',
                      opacity: 1
                    }}
                    onClick={() => {
                      if (insertingCard) {
                        handleInsertCard(0)
                      } else if (insertingCapture !== null) {
                        handleCaptureDecision('insert_one', 0, insertingCapture)
                      }
                    }}
                  >
                    {(insertingCard || insertingCapture !== null) ? '+' : ''}
                  </DroppableZone>
                )}
                
                {currentPlayer.hand.map((card, index) => {
                  const isSelected = selectedCards.includes(index)
                  const isAdjacent = selectedCards.length > 0 && 
                    (selectedCards.includes(index - 1) || selectedCards.includes(index + 1))
                  
                  const cardColor = card.isSplit 
                    ? `linear-gradient(to right, ${getCardColor(card.splitValues[0])} 0%, ${getCardColor(card.splitValues[0])} 50%, ${getCardColor(card.splitValues[1])} 50%, ${getCardColor(card.splitValues[1])} 100%)`
                    : getCardColor(card.value)
                  
                  const CardContent = (
                    <div
                      onClick={() => !insertingCard && insertingCapture === null && handleCardClick(index)}
                      style={{
                        ...styles.card,
                        background: cardColor,
                        color: 'white',
                        cursor: insertingCard || insertingCapture !== null ? 'default' : 'pointer',
                        ...(isSelected ? styles.selectedCard : {}),
                        ...(isAdjacent && !isSelected ? styles.adjacentCard : {}),
                        ...(ringoMode && !isSelected && !isAdjacent ? styles.ringoDimmedCard : {}),
                        ...(invalidSelectionIndex === index ? styles.invalidCard : {})
                      }}
                    >
                      {card.isSplit ? (
                        <div style={styles.splitCardContainer}>
                          <div style={styles.splitCardValue}>{card.splitValues[0]}</div>
                          <div style={styles.splitDivider}>/</div>
                          <div style={styles.splitCardValue}>{card.splitValues[1]}</div>
                        </div>
                      ) : (
                        <div style={styles.cardValue}>{card.value}</div>
                      )}
                    </div>
                  )

                  return (
                    <div key={card.id} style={{ display: 'flex', alignItems: 'center' }}>
                      {CardContent}
                      
                      {/* Insertion Slot after card */}
                      {(insertingCard || insertingCapture !== null) && (
                        <DroppableZone
                          id={`hand-gap-${index + 1}`}
                          style={{
                            ...styles.insertSlot,
                            width: activeDragId && (activeDragId === 'drawn-card' || activeDragId.startsWith('capture-')) ? '40px' : '28px',
                            height: activeDragId && (activeDragId === 'drawn-card' || activeDragId.startsWith('capture-')) ? '90px' : '28px',
                            borderRadius: activeDragId && (activeDragId === 'drawn-card' || activeDragId.startsWith('capture-')) ? '8px' : '50%',
                            transition: 'all 0.2s',
                            opacity: (insertingCard || insertingCapture !== null) ? 1 : (activeDragId ? 0.5 : 0),
                            display: (insertingCard || insertingCapture !== null || activeDragId) ? 'flex' : 'none',
                            background: activeDragId ? 'rgba(0,0,0,0.1)' : 'white'
                          }}
                          activeStyle={{
                            background: 'rgba(46, 204, 113, 0.4)',
                            borderColor: '#2ecc71',
                            transform: 'scale(1.1)',
                            opacity: 1
                          }}
                          onClick={() => {
                            if (insertingCard) {
                              handleInsertCard(index + 1)
                            } else if (insertingCapture !== null) {
                              handleCaptureDecision('insert_one', index + 1, insertingCapture)
                            }
                          }}
                        >
                           {/* Show + only if inserting card/capture, not reordering */}
                           {(insertingCard || insertingCapture !== null) ? '+' : ''}
                        </DroppableZone>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* Drawn Card */}
          {/* Moved Inline */}

          {/* Capture previous combo decision */}
          {/* Moved Inline */}

          {/* Turn Actions */}
          {isMyTurn && 
           gameState && 
           gameState.turnPhase === 'WAITING_FOR_PLAY_OR_DRAW' && 
           !drawnCard && 
           myPlayerIndex !== -1 && (
            <div style={styles.controlBar}>
              {selectedCards.length > 0 ? (
                <button
                  onClick={handlePlay}
                  style={styles.playButton}
                >
                  Play {selectedCards.length} Card{selectedCards.length !== 1 ? 's' : ''}
                </button>
              ) : (
                <button onClick={handleDraw} style={styles.drawButton}>
                  Draw Card
                </button>
              )}
            </div>
          )}
        </div>

        {showSplitDialog && pendingPlay && (
          <div style={styles.dialogOverlay}>
            <div style={styles.dialog}>
              <h3 style={styles.dialogTitle}>Choose Split Card Values</h3>
              {(() => {
                const cards = pendingPlay.type === 'ringo' 
                  ? (() => {
                      const testHand = [...currentPlayer.hand]
                      testHand.splice(pendingPlay.insertPosition, 0, drawnCard)
                      return pendingPlay.comboIndices.map(idx => testHand[idx])
                    })()
                  : pendingPlay.cardIndices.map(idx => currentPlayer.hand[idx])
                
                return cards
                  .filter(card => card.isSplit && !splitResolutions[card.id])
                  .map(card => (
                    <div key={card.id} style={styles.splitOption}>
                      <div style={styles.splitOptionLabel}>
                        Card {card.splitValues[0]}/{card.splitValues[1]}:
                      </div>
                      <div style={styles.splitButtons}>
                        <button
                          onClick={() => handleSplitResolution(card.id, card.splitValues[0])}
                          style={{
                            ...styles.splitButton,
                            ...(splitResolutions[card.id] === card.splitValues[0] ? styles.splitButtonActive : {})
                          }}
                        >
                          {card.splitValues[0]}
                        </button>
                        <button
                          onClick={() => handleSplitResolution(card.id, card.splitValues[1])}
                          style={{
                            ...styles.splitButton,
                            ...(splitResolutions[card.id] === card.splitValues[1] ? styles.splitButtonActive : {})
                          }}
                        >
                          {card.splitValues[1]}
                        </button>
                      </div>
                    </div>
                  ))
              })()}
              <div style={styles.dialogActions}>
                <button onClick={confirmSplitResolutions} style={styles.confirmButton}>
                  Confirm
                </button>
                <button
                  onClick={() => {
                    setShowSplitDialog(false)
                    setPendingPlay(null)
                  }}
                  style={styles.cancelButton}
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        )}
        
        {/* Drag Overlay for smooth visuals */}
        <DragOverlay>
           {activeDragId === 'drawn-card' ? (
             <div style={{
               ...styles.drawnCard,
               background: drawnCard?.isSplit 
                 ? `linear-gradient(to right, ${getCardColor(drawnCard.splitValues[0])} 0%, ${getCardColor(drawnCard.splitValues[0])} 50%, ${getCardColor(drawnCard.splitValues[1])} 50%, ${getCardColor(drawnCard.splitValues[1])} 100%)`
                 : getCardColor(drawnCard?.value),
               color: 'white',
               opacity: 0.9
             }}>
                {drawnCard?.isSplit ? (
                  <div style={styles.splitCardContainer}>
                    <div style={styles.splitCardValue}>{drawnCard.splitValues[0]}</div>
                    <div style={styles.splitDivider}>/</div>
                    <div style={styles.splitCardValue}>{drawnCard.splitValues[1]}</div>
                  </div>
                ) : (
                  <div style={styles.cardValue}>{drawnCard?.value}</div>
                )}
             </div>
           ) : activeDragId?.startsWith('capture-') ? (
             <div style={{
               ...styles.comboCard,
               background: '#2ecc71', // Just a placeholder color or we can find the card
               color: 'white',
               opacity: 0.9
             }}>
               +
             </div>
           ) : null}
        </DragOverlay>
      </div>
    </DndContext>
  )
}

const styles = {
  container: {
    minHeight: '100vh',
    height: '100vh', // Fix height to viewport
    padding: '16px',
    display: 'flex',
    flexDirection: 'column',
    position: 'relative',
    overflowY: 'auto',
    WebkitOverflowScrolling: 'touch' // Smooth scrolling on iOS
  },
  homeButton: {
    position: 'absolute',
    top: '16px',
    left: '16px',
    background: 'rgba(255, 255, 255, 0.2)',
    color: 'white',
    padding: '8px 16px',
    fontSize: '14px',
    fontWeight: '600',
    borderRadius: '20px',
    zIndex: 100,
    backdropFilter: 'blur(10px)',
    border: '1px solid rgba(255, 255, 255, 0.3)',
    boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
    transition: 'all 0.2s',
    ':hover': {
      background: 'rgba(255, 255, 255, 0.3)'
    }
  },
  gameArea: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    gap: '24px',
    maxWidth: '1200px',
    margin: '0 auto',
    width: '100%'
  },
  otherPlayers: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: '12px',
    justifyContent: 'center',
    padding: '12px'
  },
  playerCard: {
    background: 'rgba(255, 255, 255, 0.85)',
    padding: '12px 20px',
    borderRadius: '16px',
    boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
    minWidth: '100px',
    textAlign: 'center',
    backdropFilter: 'blur(5px)',
    border: '1px solid rgba(255,255,255,0.4)',
    transition: 'transform 0.2s'
  },
  currentPlayerCard: {
    background: 'rgba(255, 255, 255, 0.95)',
    border: '2px solid #2ecc71',
    transform: 'scale(1.05)'
  },
  activePlayer: {
    border: '3px solid #667eea',
    boxShadow: '0 0 0 4px rgba(102, 126, 234, 0.2)',
    transform: 'scale(1.05)',
    zIndex: 2
  },
  playerName: {
    fontSize: '14px',
    fontWeight: '700',
    marginBottom: '4px',
    color: '#333'
  },
  cardCount: {
    fontSize: '12px',
    color: '#666',
    fontWeight: '500'
  },
  currentCombo: {
    background: 'rgba(255, 255, 255, 0.6)',
    padding: '24px',
    borderRadius: '24px',
    boxShadow: '0 8px 32px rgba(0,0,0,0.05)',
    textAlign: 'center',
    backdropFilter: 'blur(10px)',
    border: '1px solid rgba(255,255,255,0.3)',
    minHeight: '180px',
    display: 'flex',
    flexDirection: 'column',
    justifyContent: 'center',
    alignItems: 'center',
    margin: '0 16px'
  },
  comboLabel: {
    fontSize: '14px',
    color: '#555',
    marginBottom: '16px',
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: '1px'
  },
  comboCards: {
    display: 'flex',
    gap: '8px',
    justifyContent: 'center',
    flexWrap: 'wrap'
  },
  comboCard: {
    background: '#667eea',
    color: 'white',
    width: '40px',
    height: '60px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: '6px',
    fontSize: '18px',
    fontWeight: '800',
    boxShadow: '0 3px 6px rgba(0,0,0,0.2)',
    border: '1px solid rgba(0,0,0,0.1)'
  },
  miniCombo: {
    padding: '8px',
    textAlign: 'center',
    opacity: 0.8
  },
  miniComboLabel: {
    fontSize: '12px',
    color: '#555',
    marginBottom: '4px',
    fontWeight: '600'
  },
  miniComboCards: {
    display: 'flex',
    gap: '4px',
    justifyContent: 'center'
  },
  miniComboCard: {
    width: '30px',
    height: '45px',
    borderRadius: '4px',
    fontSize: '14px',
    fontWeight: 'bold',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    color: 'white',
    boxShadow: '0 2px 4px rgba(0,0,0,0.1)'
  },
  handSection: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    marginTop: 'auto'
  },
  handLabel: {
    fontSize: '14px',
    fontWeight: '700',
    marginBottom: '12px',
    color: 'white',
    textAlign: 'center',
    textShadow: '0 1px 2px rgba(0,0,0,0.2)',
    letterSpacing: '0.5px',
    textTransform: 'uppercase'
  },
  hand: {
    display: 'flex',
    gap: '8px',
    flexWrap: 'wrap',
    justifyContent: 'center',
    padding: '24px 16px',
    background: 'rgba(255, 255, 255, 0.15)',
    borderRadius: '24px 24px 0 0',
    minHeight: '140px',
    alignItems: 'center',
    transition: 'all 0.3s ease',
    backdropFilter: 'blur(10px)',
    borderTop: '1px solid rgba(255,255,255,0.2)',
    paddingBottom: '100px', // Space for control bar
    marginBottom: '-20px' // Extend below viewport slightly
  },
  ringoHand: {
    background: 'rgba(255, 107, 107, 0.15)',
    border: '2px dashed rgba(255, 107, 107, 0.5)',
    boxShadow: 'inset 0 0 20px rgba(255, 107, 107, 0.1)'
  },
  ringoHandLabel: {
    color: '#FFCDD2',
    fontWeight: '800',
    fontSize: '16px',
    animation: 'pulse 2s infinite',
    textShadow: '0 2px 4px rgba(0,0,0,0.2)'
  },
  ringoDimmedCard: {
    opacity: 0.5,
    transform: 'scale(0.95)',
    filter: 'grayscale(0.5)'
  },
  card: {
    width: '56px',
    height: '84px',
    borderRadius: '8px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: '24px',
    fontWeight: '800',
    cursor: 'pointer',
    boxShadow: '0 3px 8px rgba(0,0,0,0.15)',
    transition: 'all 0.2s cubic-bezier(0.175, 0.885, 0.32, 1.275)',
    touchAction: 'manipulation',
    border: '1px solid rgba(0,0,0,0.1)',
    position: 'relative',
    overflow: 'hidden'
  },
  selectedCard: {
    transform: 'translateY(-16px) scale(1.1)',
    boxShadow: '0 12px 24px rgba(0,0,0,0.25)',
    border: '3px solid #fff',
    zIndex: 10
  },
  invalidCard: {
    border: '3px solid #e74c3c',
    boxShadow: '0 0 0 4px rgba(231, 76, 60, 0.3)',
    animation: 'ringoShake 0.35s'
  },
  adjacentCard: {
    border: '2px dashed rgba(255,255,255,0.8)',
    transform: 'translateY(-4px)'
  },
  cardValue: {
    fontSize: '32px',
    color: 'white',
    textShadow: '0 2px 4px rgba(0,0,0,0.2)'
  },
  splitCardContainer: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    width: '100%',
    height: '100%'
  },
  splitCardValue: {
    fontSize: '24px',
    lineHeight: '1',
    color: 'white',
    fontWeight: '800',
    textShadow: '0 1px 2px rgba(0,0,0,0.2)'
  },
  splitDivider: {
    fontSize: '16px',
    color: 'rgba(255,255,255,0.8)',
    fontWeight: 'bold',
    margin: '0',
    height: '2px',
    width: '70%',
    background: 'rgba(255,255,255,0.5)',
    margin: '4px 0'
  },
  drawnCardSection: {
    background: 'rgba(255, 255, 255, 0.95)',
    padding: '20px',
    borderRadius: '24px',
    textAlign: 'center',
    boxShadow: '0 8px 32px rgba(0,0,0,0.1)',
    backdropFilter: 'blur(20px)',
    border: '1px solid rgba(255,255,255,0.4)',
    margin: '0 auto',
    maxWidth: '360px',
    width: '100%'
  },
  drawnCardLabel: {
    fontSize: '14px',
    color: '#666',
    marginBottom: '20px',
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: '1.5px'
  },
  drawnCard: {
    width: '80px',
    height: '120px',
    borderRadius: '12px',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: '40px',
    fontWeight: '800',
    margin: '0 auto 20px',
    boxShadow: '0 8px 24px rgba(0,0,0,0.2)',
    border: '1px solid rgba(0,0,0,0.1)',
    transition: 'transform 0.2s',
    ':hover': {
      transform: 'scale(1.05)'
    }
  },
  drawnCardActions: {
    display: 'flex',
    flexDirection: 'column',
    gap: '12px',
    justifyContent: 'center'
  },
  controlBar: {
    position: 'fixed',
    bottom: '24px',
    left: '50%',
    transform: 'translateX(-50%)',
    display: 'flex',
    gap: '12px',
    padding: '12px 20px',
    background: 'rgba(255, 255, 255, 0.95)',
    backdropFilter: 'blur(20px)',
    borderRadius: '24px',
    boxShadow: '0 10px 40px rgba(0,0,0,0.15)',
    zIndex: 100,
    minWidth: '280px',
    width: '90%',
    maxWidth: '400px',
    justifyContent: 'center',
    border: '1px solid rgba(255,255,255,0.5)'
  },
  playButton: {
    background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
    color: 'white',
    padding: '16px 32px',
    fontSize: '18px',
    fontWeight: '800',
    borderRadius: '16px',
    border: 'none',
    cursor: 'pointer',
    boxShadow: '0 4px 12px rgba(102, 126, 234, 0.4)',
    transition: 'all 0.2s',
    minWidth: '160px',
    ':active': { transform: 'scale(0.98)' }
  },
  drawButton: {
    background: 'linear-gradient(135deg, #4CAF50 0%, #45a049 100%)',
    color: 'white',
    padding: '16px 32px',
    fontSize: '18px',
    fontWeight: '800',
    borderRadius: '16px',
    border: 'none',
    cursor: 'pointer',
    boxShadow: '0 4px 12px rgba(76, 175, 80, 0.4)',
    transition: 'all 0.2s',
    minWidth: '160px',
    ':active': { transform: 'scale(0.98)' }
  },
  ringoButton: {
    background: 'linear-gradient(135deg, #FF6B6B 0%, #EE5253 100%)',
    color: 'white',
    padding: '16px 24px',
    fontSize: '18px',
    fontWeight: '900',
    borderRadius: '16px',
    border: 'none',
    cursor: 'pointer',
    boxShadow: '0 4px 15px rgba(255, 107, 107, 0.4)',
    animation: 'pulse 1.5s infinite',
    width: '100%'
  },
  confirmRingoButton: {
    background: '#2ecc71',
    color: 'white',
    padding: '16px',
    fontSize: '16px',
    fontWeight: '800',
    borderRadius: '12px',
    border: 'none',
    cursor: 'pointer',
    boxShadow: '0 4px 12px rgba(46, 204, 113, 0.4)',
    flex: 1
  },
  cancelRingoButton: {
    background: '#f1f2f6',
    color: '#666',
    padding: '16px',
    fontSize: '16px',
    fontWeight: '800',
    borderRadius: '12px',
    border: 'none',
    cursor: 'pointer',
    flex: 1
  },
  ringoHint: {
    marginTop: '16px',
    fontSize: '14px',
    color: '#666',
    fontStyle: 'italic',
    lineHeight: '1.5'
  },
  insertButton: {
    color: 'white',
    padding: '16px 24px',
    fontSize: '16px',
    borderRadius: '12px',
    border: 'none',
    fontWeight: '700',
    cursor: 'pointer',
    width: '100%',
    transition: 'all 0.2s'
  },
  insertSlot: {
    width: '28px',
    height: '28px',
    borderRadius: '50%',
    border: '2px solid #2ecc71',
    background: 'white',
    color: '#2ecc71',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: 'pointer',
    fontWeight: '800',
    fontSize: '18px',
    margin: '0 4px',
    flexShrink: 0,
    boxShadow: '0 3px 6px rgba(0,0,0,0.15)',
    zIndex: 20,
    transition: 'all 0.2s'
  },
  discardButton: {
    background: '#f44336',
    color: 'white',
    padding: '16px 24px',
    fontSize: '16px',
    borderRadius: '12px',
    border: 'none',
    fontWeight: '700',
    cursor: 'pointer',
    width: '100%'
  },
  captureSection: {
    background: 'rgba(255,255,255,0.95)',
    borderRadius: '24px',
    padding: '24px',
    textAlign: 'center',
    border: '1px solid rgba(255,255,255,0.3)',
    boxShadow: '0 8px 32px rgba(0,0,0,0.1)',
    backdropFilter: 'blur(20px)',
    width: '100%',
    maxWidth: '400px',
    margin: '0 auto'
  },
  captureLabel: {
    fontSize: '18px',
    fontWeight: '800',
    color: '#2ecc71',
    marginBottom: '24px'
  },
  captureActions: {
    display: 'flex',
    gap: '12px',
    justifyContent: 'center',
    marginTop: '24px'
  },
  captureButton: {
    background: '#2ecc71',
    color: 'white',
    padding: '12px 24px',
    fontSize: '16px',
    borderRadius: '12px',
    border: 'none',
    fontWeight: 'bold',
    cursor: 'pointer',
    flex: 1
  },
  captureDiscardButton: {
    background: '#ff6b6b',
    color: 'white',
    padding: '12px 24px',
    fontSize: '16px',
    borderRadius: '12px',
    border: 'none',
    fontWeight: 'bold',
    cursor: 'pointer',
    flex: 1,
    boxShadow: '0 4px 12px rgba(255, 107, 107, 0.3)'
  },
  captureHint: {
    marginTop: '16px',
    color: '#666',
    fontSize: '14px',
    fontWeight: '500'
  },
  dialogOverlay: {
    position: 'fixed',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    background: 'rgba(0,0,0,0.6)',
    backdropFilter: 'blur(5px)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1000
  },
  dialog: {
    background: 'white',
    padding: '32px',
    borderRadius: '24px',
    maxWidth: '400px',
    width: '90%',
    maxHeight: '80vh',
    overflow: 'auto',
    boxShadow: '0 20px 60px rgba(0,0,0,0.3)'
  },
  dialogTitle: {
    fontSize: '24px',
    fontWeight: '800',
    marginBottom: '24px',
    textAlign: 'center',
    color: '#333'
  },
  splitOption: {
    marginBottom: '24px'
  },
  splitOptionLabel: {
    fontSize: '16px',
    marginBottom: '12px',
    fontWeight: '700',
    color: '#555'
  },
  splitButtons: {
    display: 'flex',
    gap: '16px'
  },
  splitButton: {
    flex: 1,
    padding: '16px',
    fontSize: '20px',
    fontWeight: '700',
    background: '#f1f2f6',
    color: '#333',
    borderRadius: '12px',
    border: '2px solid transparent',
    transition: 'all 0.2s'
  },
  splitButtonActive: {
    background: '#667eea',
    color: 'white',
    boxShadow: '0 4px 12px rgba(102, 126, 234, 0.4)'
  },
  dialogActions: {
    display: 'flex',
    gap: '16px',
    marginTop: '32px'
  },
  confirmButton: {
    flex: 1,
    background: '#2ecc71',
    color: 'white',
    padding: '16px',
    fontSize: '16px',
    fontWeight: '700',
    borderRadius: '12px',
    border: 'none'
  },
  cancelButton: {
    flex: 1,
    background: '#a4b0be',
    color: 'white',
    padding: '16px',
    fontSize: '16px',
    fontWeight: '700',
    borderRadius: '12px',
    border: 'none'
  },
  captureComboPreview: {
    display: 'flex',
    gap: '12px',
    justifyContent: 'center',
    flexWrap: 'wrap',
    marginTop: '8px'
  },
  captureCardWrapper: {
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
    alignItems: 'center'
  },
  captureCardActions: {
    display: 'flex',
    gap: '4px'
  },
  captureCardButton: {
    padding: '6px 12px',
    fontSize: '12px',
    background: '#2ecc71',
    color: 'white',
    border: 'none',
    borderRadius: '6px',
    cursor: 'pointer',
    fontWeight: '700'
  },
  gameOverContainer: {
    minHeight: '100vh',
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
    padding: '20px',
    background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)'
  },
  gameOverCard: {
    background: 'rgba(255, 255, 255, 0.95)',
    borderRadius: '32px',
    padding: '48px',
    textAlign: 'center',
    boxShadow: '0 20px 60px rgba(0,0,0,0.3)',
    maxWidth: '450px',
    width: '100%',
    backdropFilter: 'blur(10px)'
  },
  gameOverTitle: {
    fontSize: '48px',
    fontWeight: '900',
    marginBottom: '16px',
    background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
    WebkitBackgroundClip: 'text',
    WebkitTextFillColor: 'transparent',
    backgroundClip: 'text',
    letterSpacing: '-1px'
  },
  gameOverSubtitle: {
    fontSize: '20px',
    color: '#666',
    marginBottom: '40px',
    fontWeight: '500'
  },
  gameOverButton: {
    background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
    color: 'white',
    padding: '20px 40px',
    fontSize: '20px',
    fontWeight: '800',
    borderRadius: '16px',
    border: 'none',
    cursor: 'pointer',
    boxShadow: '0 8px 24px rgba(102, 126, 234, 0.4)',
    width: '100%',
    transition: 'transform 0.2s',
    ':hover': {
      transform: 'translateY(-2px)'
    }
  }
}
