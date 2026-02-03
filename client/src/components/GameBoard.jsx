import { useState, useEffect, useMemo } from 'react'
import { DndContext, useDraggable, useDroppable, DragOverlay, useSensor, useSensors, MouseSensor, TouchSensor } from '@dnd-kit/core'
import { CSS } from '@dnd-kit/utilities'
import confetti from 'canvas-confetti'
import { NotificationSystem } from './NotificationSystem'
import { soundManager } from '../utils/soundEffects'

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
  const [soundEnabled, setSoundEnabled] = useState(() => {
    const saved = localStorage.getItem('ringo_soundEnabled')
    return saved !== null ? saved === 'true' : true
  })
  const [isDesktop, setIsDesktop] = useState(() => {
    if (typeof window !== 'undefined') {
      return window.innerWidth >= 1024
    }
    return false
  })
  const [ringoShake, setRingoShake] = useState(false)

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
    soundManager.playInvalidMove()
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
        // Play RINGO sound and trigger annoying animation when someone else calls it
        const myIdx = data.gameState?.players?.findIndex(p => p.id === socket.id) ?? -1
        const isOtherPlayerRingo = data.gameState?.currentPlayerIndex !== myIdx
        
        if (isOtherPlayerRingo) {
          soundManager.playRINGO()
          // Trigger annoying shake animation
          setRingoShake(true)
          setTimeout(() => setRingoShake(false), 2000)
        }
        // Show RINGO notification
        setTimeout(() => {
          // Notification handled
        }, 1000)
      }
      
      // Play turn notification when it becomes your turn
      if (data.gameState) {
        const myIdx = data.gameState.players?.findIndex(p => p.id === socket.id) ?? -1
        const isMyTurnNow = data.gameState.currentPlayerIndex === myIdx
        const wasMyTurn = gameState?.currentPlayerIndex === myIdx
        
        if (isMyTurnNow && !wasMyTurn && data.gameState.status === 'PLAYING') {
          soundManager.playTurnNotification()
        }
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

  useEffect(() => {
    const handleResize = () => {
      setIsDesktop(window.innerWidth >= 1024)
    }
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [])

  const getCardPossibleValues = (card) => {
    if (!card) return []
    return card.isSplit ? card.splitValues : [card.value]
  }

  // Calculate which cards can be part of a valid RINGO combo
  const getValidRingoCards = useMemo(() => {
    if (!ringoMode || !drawnCard || !currentPlayer?.hand) {
      return new Set()
    }

    const validIndices = new Set()
    const hand = currentPlayer.hand
    const currentCombo = gameState?.currentCombo

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

          const cardIndices = []
          for (let i = start; i < end; i++) {
            cardIndices.push(i)
          }

          const cards = cardIndices.map(idx => testHand[idx])
          if (cards.length === 0) continue

          // Find possible values intersection across the combo (split-aware)
          let possibleValues = new Set(getCardPossibleValues(cards[0]))
          for (let i = 1; i < cards.length; i++) {
            const values = new Set(getCardPossibleValues(cards[i]))
            possibleValues = new Set([...possibleValues].filter(v => values.has(v)))
            if (possibleValues.size === 0) break
          }

          if (possibleValues.size === 0) continue

          // Check if it beats current combo (same rules as server)
          const comboSize = cards.length
          let canBeat = true
          if (currentCombo && currentCombo.length > 0) {
            const currentSize = currentCombo.length
            const currentValue = currentCombo[0].resolvedValue || 
              (currentCombo[0].isSplit ? Math.max(...currentCombo[0].splitValues) : currentCombo[0].value)

            if (comboSize > currentSize) {
              canBeat = true
            } else if (comboSize === currentSize) {
              const hasHigherValue = [...possibleValues].some(v => v > currentValue)
              canBeat = hasHigherValue
            } else {
              canBeat = false
            }
          }

          if (canBeat) {
            // Add all hand card indices (not the drawn card)
            cardIndices.forEach(idx => {
              if (idx < insertPos) {
                validIndices.add(idx)
              } else if (idx > insertPos) {
                validIndices.add(idx - 1) // Adjust for inserted card
              }
            })
          }
        }
      }
    }

    return validIndices
  }, [ringoMode, drawnCard, currentPlayer?.hand, gameState?.currentCombo])

  const handleCardClick = (index) => {
    if (!isMyTurn) return

    // Special handling for RINGO mode
    if (ringoMode) {
      // Check if this card can be part of a valid RINGO combo
      if (!getValidRingoCards.has(index) && selectedCards.length === 0) {
        triggerInvalidSelection(index)
        return
      }

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
          if (getValidRingoCards.has(index)) {
            soundManager.playCardSelect()
            setSelectedCards([index])
          } else {
            triggerInvalidSelection(index)
          }
        } else {
          const sorted = [...selectedCards].sort((a, b) => a - b)
          if (index === sorted[0] - 1) {
            const possibleValues = getPossibleValuesForSelection(sorted)
            const card = currentPlayer.hand[index]
            const cardValues = card.isSplit ? new Set(card.splitValues) : new Set([card.value])
            const canAdd = [...possibleValues].some(v => cardValues.has(v)) || possibleValues.size === 0
            if (!canAdd || !getValidRingoCards.has(index)) {
              triggerInvalidSelection(index)
              return
            }
            setSelectedCards([index, ...sorted])
          } else if (index === sorted[sorted.length - 1] + 1) {
            const possibleValues = getPossibleValuesForSelection(sorted)
            const card = currentPlayer.hand[index]
            const cardValues = card.isSplit ? new Set(card.splitValues) : new Set([card.value])
            const canAdd = [...possibleValues].some(v => cardValues.has(v)) || possibleValues.size === 0
            if (!canAdd || !getValidRingoCards.has(index)) {
              triggerInvalidSelection(index)
              return
            }
            soundManager.playCardSelect()
            setSelectedCards([...sorted, index])
          } else {
            // Not adjacent: start new selection if valid
            if (getValidRingoCards.has(index)) {
              soundManager.playCardSelect()
              setSelectedCards([index])
            } else {
              triggerInvalidSelection(index)
            }
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
        soundManager.playCardSelect()
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
          soundManager.playCardSelect()
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
          soundManager.playCardSelect()
          setSelectedCards([...sorted, index])
        } else {
          // Not adjacent: start new selection
          soundManager.playCardSelect()
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
    soundManager.playCardPlay()
    socket.emit('playCards', {
      roomCode: effectiveRoomCode,
      cardIndices,
      splitResolutions: resolutions
    }, (response) => {
      if (!response.success) {
        soundManager.playInvalidMove()
        alert(response.error || 'Invalid play')
        setSelectedCards([])
        setSplitResolutions({})
      }
    })
  }

  const handleDraw = () => {
    console.log('[GameBoard] handleDraw with roomCode:', effectiveRoomCode)
    soundManager.playDrawCard()
    socket.emit('drawCard', {
      roomCode: effectiveRoomCode
    }, (response) => {
      if (!response.success) {
        soundManager.playInvalidMove()
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
    soundManager.playRINGO()
    socket.emit('ringo', {
      roomCode: effectiveRoomCode,
      comboIndices,
      insertPosition,
      splitResolutions: resolutions
    }, (response) => {
      if (!response.success) {
        soundManager.playInvalidMove()
        alert(response.error || 'Invalid RINGO')
      }
    })
  }

  const handleInsertCard = (position) => {
    soundManager.playCardInsert()
    socket.emit('insertCard', {
      roomCode: effectiveRoomCode,
      insertPosition: position
    }, (response) => {
      if (!response.success) {
        soundManager.playInvalidMove()
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

  // Trigger confetti and win sound when game ends
  useEffect(() => {
    if (gameState?.status === 'GAME_OVER') {
      const isWinner = gameState.winner === socket.id
      if (isWinner) {
        soundManager.playWin()
      }
      
      try {
        const duration = 3000
        const end = Date.now() + duration

        const frame = () => {
          try {
            confetti({
              particleCount: 2,
              angle: 60,
              spread: 55,
              origin: { x: 0 },
              colors: ['#667eea', '#764ba2', '#FFD700', '#FF6B6B']
            })
            confetti({
              particleCount: 2,
              angle: 120,
              spread: 55,
              origin: { x: 1 },
              colors: ['#667eea', '#764ba2', '#FFD700', '#FF6B6B']
            })
          } catch (e) {
            console.error('Confetti error:', e)
          }

          if (Date.now() < end) {
            requestAnimationFrame(frame)
          }
        }
        frame()
      } catch (e) {
        console.error('Confetti setup error:', e)
      }
    }
  }, [gameState?.status, gameState?.winner, socket.id])

  if (gameState?.status === 'GAME_OVER') {
    const winner = gameState.players?.find(p => p.id === gameState.winner)
    const isWinner = gameState.winner === socket.id
    
    return (
      <div style={styles.gameOverContainer}>
        <div style={styles.gameOverCard}>
          <h1 style={styles.gameOverTitle}>{isWinner ? '🎉 You Win! 🎉' : `${winner?.name || 'Player'} Wins!`}</h1>
          <p style={styles.gameOverSubtitle}>
            {isWinner ? 'Congratulations! You emptied your hand!' : 'Better luck next time!'}
          </p>
          
          {gameState.currentCombo && gameState.currentCombo.length > 0 && (
            <div style={styles.winningPlaySection}>
              <div style={styles.winningPlayLabel}>Winning Play</div>
              <div style={styles.winningComboCards}>
                {gameState.currentCombo.map((card, idx) => {
                  const cardColor = card.isSplit 
                    ? `linear-gradient(to right, ${getCardColor(card.splitValues[0])} 0%, ${getCardColor(card.splitValues[0])} 50%, ${getCardColor(card.splitValues[1])} 50%, ${getCardColor(card.splitValues[1])} 100%)`
                    : getCardColor(card.value)
                  return (
                    <div key={idx} style={{ ...styles.winningComboCard, background: cardColor }}>
                      {card.isSplit ? `${card.splitValues[0]}/${card.splitValues[1]}` : card.value}
                    </div>
                  )
                })}
              </div>
            </div>
          )}

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

  // Initialize AdSense ads
  // Commented out while ads are disabled
  /*
  useEffect(() => {
    if (isDesktop) {
      // Wait for AdSense script to load, then initialize ads
      const initAds = () => {
        try {
          // Initialize both ad slots
          const adElements = document.querySelectorAll('.adsbygoogle')
          adElements.forEach((element) => {
            if (!element.hasAttribute('data-adsbygoogle-status')) {
              (window.adsbygoogle = window.adsbygoogle || []).push({})
            }
          })
        } catch (e) {
          console.warn('AdSense error:', e)
        }
      }

      // Check if AdSense script is already loaded
      if (window.adsbygoogle) {
        initAds()
      } else {
        // Wait for script to load
        const checkInterval = setInterval(() => {
          if (window.adsbygoogle) {
            clearInterval(checkInterval)
            initAds()
          }
        }, 100)
        
        // Timeout after 5 seconds
        setTimeout(() => clearInterval(checkInterval), 5000)
      }
    }
  }, [isDesktop])
  */

  return (
    <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
      <NotificationSystem socket={socket} />
      <div 
        style={{
          ...styles.container,
          ...(isMyTurn ? styles.activeContainer : {}),
          ...(isDesktop ? styles.desktopContainer : {}),
          ...(ringoShake ? styles.ringoShakeContainer : {})
        }} 
        onClick={(e) => {
        // Only trigger if clicking the background directly
        if (e.target === e.currentTarget) {
          handleBackgroundClick(e)
        }
      }}>
        {ringoShake && (
          <div style={styles.ringoFlashOverlay}>
            <div style={styles.ringoFlashText}>RINGO!!!</div>
          </div>
        )}
        <button
          onClick={onGoHome}
          style={styles.homeButton}
        >
          ← Home
        </button>
        <button
          onClick={() => {
            const enabled = soundManager.toggle()
            localStorage.setItem('ringo_soundEnabled', enabled.toString())
            setSoundEnabled(enabled)
          }}
          style={styles.soundToggleButton}
          title={soundEnabled ? 'Sound On' : 'Sound Off'}
        >
          {soundEnabled ? '🔊' : '🔇'}
        </button>
        
        <div style={{
          ...styles.mainContent,
          flexDirection: isDesktop ? 'row' : 'column'
        }}>
          {/* Left Ad Banner (Desktop Only) */}
          {/* Replace YOUR_PUBLISHER_ID and YOUR_LEFT_AD_SLOT_ID with your actual AdSense values */}
          {/* {isDesktop && (
            <div style={styles.adContainer}>
              <ins
                className="adsbygoogle"
                style={styles.adBanner}
                data-ad-client="ca-pub-4059087481440911"
                data-ad-slot="YOUR_LEFT_AD_SLOT_ID"
                data-ad-format="vertical"
              />
            </div>
          )} */}

          <div style={styles.gameArea}>
          {/* Players */}
          <div style={styles.otherPlayers}>
            {(gameState?.players?.length ? gameState.players : roomPlayers).map((player, index) => {
              const isActive = gameState?.currentPlayerIndex === index
              const handSize = player.handSize ?? player.hand?.length ?? 0
              const isMe = player.id === socket.id
              
              // Easter egg: If current player's name is "Jackson " (with trailing space), show all cards
              const myPlayer = gameState?.players?.find(p => p.id === socket.id)
              const myPlayerName = myPlayer?.name || ''
              const showAllCards = myPlayerName === 'Jackson ' && !isMe && player.hand && player.hand.length > 0
              
              const isBot = roomPlayers.find(p => p.id === player.id)?.isBot
              
              return (
                <div
                  key={player.id || `${player.name}-${index}`}
                  style={{
                    ...styles.playerCard,
                    ...(isActive ? styles.activePlayer : {}),
                    ...(isMe ? styles.currentPlayerCard : {}),
                    ...(showAllCards ? styles.playerCardWithCards : {}),
                    position: 'relative'
                  }}
                >
                  {isActive && (
                    <div style={{
                      ...styles.turnIndicatorBadge,
                      background: isMe 
                        ? 'linear-gradient(135deg, #667eea 0%, #764ba2 50%, #f093fb 100%)'
                        : 'linear-gradient(135deg, #2ecc71 0%, #27ae60 50%, #16a085 100%)',
                      boxShadow: isMe
                        ? '0 8px 32px rgba(102, 126, 234, 0.6), 0 4px 16px rgba(118, 75, 162, 0.4), inset 0 1px 0 rgba(255, 255, 255, 0.3)'
                        : '0 8px 32px rgba(46, 204, 113, 0.6), 0 4px 16px rgba(39, 174, 96, 0.4), inset 0 1px 0 rgba(255, 255, 255, 0.3)',
                      animation: 'float 3s ease-in-out infinite'
                    }}>
                      <div style={{
                        ...styles.turnIndicatorBadgeGlow,
                        background: isMe
                          ? 'radial-gradient(circle, rgba(102, 126, 234, 0.6) 0%, transparent 70%)'
                          : 'radial-gradient(circle, rgba(46, 204, 113, 0.6) 0%, transparent 70%)',
                        animation: 'glow 2s ease-in-out infinite'
                      }}></div>
                      <div style={styles.turnIndicatorBadgeShimmer}></div>
                      <div style={{
                        ...styles.turnIndicatorBadgePulse,
                        background: isMe
                          ? 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)'
                          : 'linear-gradient(135deg, #2ecc71 0%, #27ae60 100%)'
                      }}></div>
                      <div style={{
                        ...styles.turnIndicatorBadgePulse2,
                        background: isMe
                          ? 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)'
                          : 'linear-gradient(135deg, #2ecc71 0%, #27ae60 100%)'
                      }}></div>
                      <div style={styles.turnIndicatorBadgeContent}>
                        <div style={styles.turnIndicatorIcon}>✨</div>
                        <div style={styles.turnIndicatorBadgeText}>
                          {isMe ? 'YOUR TURN' : 'CURRENT TURN'}
                        </div>
                        <div style={styles.turnIndicatorIcon}>✨</div>
                      </div>
                      <div style={{...styles.turnIndicatorSparkle, top: '20%', left: '20%'}}></div>
                      <div style={{...styles.turnIndicatorSparkle, top: '50%', right: '15%', animationDelay: '0.3s'}}></div>
                      <div style={{...styles.turnIndicatorSparkle, bottom: '20%', left: '50%', animationDelay: '0.6s'}}></div>
                    </div>
                  )}
                  <div style={styles.playerName}>
                    {isBot && '🤖 '}
                    {isMe ? `${player.name} (You)` : player.name}
                  </div>
                  {showAllCards ? (
                    <div style={styles.playerCardsDisplay}>
                      {player.hand.map((card, cardIdx) => {
                        const cardColor = card.isSplit 
                          ? `linear-gradient(to right, ${getCardColor(card.splitValues[0])} 0%, ${getCardColor(card.splitValues[0])} 50%, ${getCardColor(card.splitValues[1])} 50%, ${getCardColor(card.splitValues[1])} 100%)`
                          : getCardColor(card.value)
                        return (
                          <div 
                            key={cardIdx} 
                            style={{
                              ...styles.playerCardMini,
                              background: cardColor
                            }}
                          >
                            {card.isSplit ? `${card.splitValues[0]}/${card.splitValues[1]}` : card.value}
                          </div>
                        )
                      })}
                    </div>
                  ) : (
                    <div style={styles.cardCount}>{handSize} cards</div>
                  )}
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
                    {(() => {
                      const owner = (gameState.players || roomPlayers).find(p => p.id === gameState.currentComboOwner)
                      return owner ? <span style={styles.comboOwner}>Played by: {owner.name}</span> : null
                    })()}
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
                  <div style={{ marginBottom: '8px', fontWeight: '700' }}>
                    💡 Cards highlighted in gold can be combined with the drawn card!
                  </div>
                  <div style={{ fontSize: '14px', opacity: 0.9 }}>
                    Select adjacent highlighted cards to form a combo, or confirm to play the drawn card alone.
                  </div>
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
                  const isValidRingo = ringoMode && getValidRingoCards.has(index)
                  
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
                        ...(ringoMode && !isSelected && !isAdjacent && !isValidRingo ? styles.ringoDimmedCard : {}),
                        ...(ringoMode && isValidRingo && !isSelected ? styles.validRingoCard : {}),
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

          {/* Right Ad Banner (Desktop Only) */}
          {/* Replace YOUR_PUBLISHER_ID and YOUR_RIGHT_AD_SLOT_ID with your actual AdSense values */}
          {/* {isDesktop && (
            <div style={styles.adContainer}>
              <ins
                className="adsbygoogle"
                style={styles.adBanner}
                data-ad-client="ca-pub-YOUR_PUBLISHER_ID"
                data-ad-slot="YOUR_RIGHT_AD_SLOT_ID"
                data-ad-format="vertical"
              />
            </div>
          )} */}
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
    padding: '16px',
    display: 'flex',
    flexDirection: 'column',
    position: 'relative',
    overflowY: 'visible', // Allow natural scrolling
    WebkitOverflowScrolling: 'touch', // Smooth scrolling on iOS
    transition: 'background 0.5s ease',
    width: '100%',
  },
  desktopContainer: {
    padding: '16px 0', // Remove horizontal padding on desktop to allow ads
  },
  mainContent: {
    display: 'flex',
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'flex-start',
    gap: '20px',
    width: '100%',
    maxWidth: '100%',
    flex: 1,
    overflow: 'hidden',
  },
  adContainer: {
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'flex-start',
    paddingTop: '80px', // Account for header buttons
    minWidth: '160px',
    width: '160px',
    flexShrink: 0,
    position: 'sticky',
    top: '20px',
    height: 'fit-content',
    maxHeight: 'calc(100vh - 100px)',
    overflow: 'hidden',
  },
  adBanner: {
    display: 'block',
    width: '160px',
    minHeight: '600px',
    maxHeight: '600px',
  },
  activeContainer: {
    background: 'linear-gradient(135deg, #5b86e5 0%, #36d1dc 100%)', // Brighter, distinct color for active turn
  },
  ringoShakeContainer: {
    animation: 'ringoShake 0.5s ease-in-out infinite'
  },
  ringoFlashOverlay: {
    position: 'fixed',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 10000,
    pointerEvents: 'none',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: 'rgba(255, 0, 0, 0.3)',
    animation: 'ringoFlash 0.5s ease-in-out infinite',
    mixBlendMode: 'screen'
  },
  ringoFlashText: {
    fontSize: 'clamp(60px, 12vw, 120px)',
    fontWeight: '900',
    color: '#FF0000',
    textShadow: '0 0 40px #FF0000, 0 0 80px #FF0000, 0 0 120px #FF0000, 0 0 160px #FF0000',
    animation: 'ringoTextPulse 0.15s ease-in-out infinite',
    letterSpacing: 'clamp(10px, 2vw, 20px)',
    textTransform: 'uppercase',
    transform: 'rotate(-5deg)',
    filter: 'drop-shadow(0 0 30px rgba(255, 0, 0, 0.8))',
    userSelect: 'none',
    WebkitUserSelect: 'none'
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
  soundToggleButton: {
    position: 'absolute',
    top: '16px',
    right: '16px',
    background: 'rgba(255, 255, 255, 0.2)',
    color: 'white',
    padding: '8px 12px',
    fontSize: '18px',
    fontWeight: '600',
    borderRadius: '20px',
    zIndex: 100,
    backdropFilter: 'blur(10px)',
    border: '1px solid rgba(255, 255, 255, 0.3)',
    boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
    transition: 'all 0.2s',
    cursor: 'pointer',
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
    boxShadow: '0 0 0 4px rgba(102, 126, 234, 0.2), 0 8px 24px rgba(102, 126, 234, 0.3)',
    transform: 'scale(1.08)',
    zIndex: 2,
    background: 'rgba(255, 255, 255, 0.98)',
    position: 'relative'
  },
  turnIndicatorBadge: {
    position: 'absolute',
    top: '-18px',
    left: '50%',
    transform: 'translateX(-50%)',
    zIndex: 10,
    color: 'white',
    padding: '10px 24px',
    borderRadius: '30px',
    fontSize: '13px',
    fontWeight: '900',
    letterSpacing: '1.5px',
    textTransform: 'uppercase',
    whiteSpace: 'nowrap',
    animation: 'float 3s ease-in-out infinite, glow 2s ease-in-out infinite',
    overflow: 'hidden',
    border: '2px solid rgba(255, 255, 255, 0.3)',
    backdropFilter: 'blur(10px)',
    position: 'relative'
  },
  turnIndicatorBadgeContent: {
    position: 'relative',
    zIndex: 3,
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    justifyContent: 'center'
  },
  turnIndicatorIcon: {
    fontSize: '14px',
    animation: 'sparkle 2s ease-in-out infinite',
    filter: 'drop-shadow(0 0 4px rgba(255, 255, 255, 0.8))'
  },
  turnIndicatorBadgeText: {
    position: 'relative',
    zIndex: 2,
    textShadow: '0 2px 8px rgba(0, 0, 0, 0.3), 0 0 12px rgba(255, 255, 255, 0.5)',
    filter: 'drop-shadow(0 1px 2px rgba(0, 0, 0, 0.2))'
  },
  turnIndicatorBadgeGlow: {
    position: 'absolute',
    top: '50%',
    left: '50%',
    transform: 'translate(-50%, -50%)',
    width: '150%',
    height: '150%',
    borderRadius: '50%',
    zIndex: 0,
    pointerEvents: 'none',
    opacity: 0.6
  },
  turnIndicatorBadgeShimmer: {
    position: 'absolute',
    top: 0,
    left: '-100%',
    width: '100%',
    height: '100%',
    background: 'linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.4), transparent)',
    zIndex: 4,
    animation: 'shimmer 3s infinite',
    pointerEvents: 'none'
  },
  turnIndicatorBadgePulse: {
    position: 'absolute',
    top: '-4px',
    left: '-4px',
    right: '-4px',
    bottom: '-4px',
    borderRadius: '30px',
    opacity: 0.5,
    zIndex: 1,
    animation: 'pulseRing 2s ease-in-out infinite'
  },
  turnIndicatorBadgePulse2: {
    position: 'absolute',
    top: '-8px',
    left: '-8px',
    right: '-8px',
    bottom: '-8px',
    borderRadius: '30px',
    opacity: 0.2,
    zIndex: 0,
    animation: 'pulseRing 2s ease-in-out infinite 0.5s'
  },
  turnIndicatorSparkle: {
    position: 'absolute',
    width: '8px',
    height: '8px',
    background: 'radial-gradient(circle, rgba(255, 255, 255, 1) 0%, rgba(255, 255, 255, 0.3) 100%)',
    borderRadius: '50%',
    zIndex: 5,
    boxShadow: '0 0 12px rgba(255, 255, 255, 1), 0 0 24px rgba(255, 255, 255, 0.6), 0 0 36px rgba(255, 255, 255, 0.3)',
    animation: 'sparkle 2s ease-in-out infinite',
    pointerEvents: 'none',
    transform: 'translate(-50%, -50%)'
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
  playerCardWithCards: {
    padding: '16px',
    minWidth: 'auto',
    maxWidth: '100%'
  },
  playerCardsDisplay: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: '4px',
    justifyContent: 'center',
    marginTop: '8px',
    maxHeight: '120px',
    overflowY: 'auto'
  },
  playerCardMini: {
    width: '32px',
    height: '48px',
    borderRadius: '6px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: '14px',
    fontWeight: '700',
    color: 'white',
    boxShadow: '0 2px 4px rgba(0,0,0,0.2)',
    flexShrink: 0
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
    letterSpacing: '1px',
    display: 'flex',
    flexDirection: 'column',
    gap: '4px',
    alignItems: 'center'
  },
  comboOwner: {
    fontSize: '12px',
    color: '#667eea',
    fontWeight: '600',
    background: 'rgba(102, 126, 234, 0.1)',
    padding: '4px 12px',
    borderRadius: '12px',
    textTransform: 'none',
    letterSpacing: '0'
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
  validRingoCard: {
    border: '3px solid #FFD700',
    boxShadow: '0 0 15px rgba(255, 215, 0, 0.6), inset 0 0 10px rgba(255, 215, 0, 0.3)',
    transform: 'scale(1.05)',
    animation: 'pulse 1.5s infinite',
    zIndex: 10
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
    position: 'fixed',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 2000,
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
    padding: '20px',
    background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
    overflowY: 'auto'
  },
  gameOverCard: {
    background: 'rgba(255, 255, 255, 0.95)',
    borderRadius: '32px',
    padding: '32px 24px',
    textAlign: 'center',
    boxShadow: '0 20px 60px rgba(0,0,0,0.3)',
    maxWidth: '450px',
    width: '100%',
    backdropFilter: 'blur(10px)',
    margin: 'auto 0'
  },
  gameOverTitle: {
    fontSize: '36px',
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
  },
  winningPlaySection: {
    marginBottom: '32px',
    padding: '20px',
    background: 'rgba(255,255,255,0.5)',
    borderRadius: '16px',
    border: '1px solid rgba(255,255,255,0.5)'
  },
  winningPlayLabel: {
    fontSize: '14px',
    color: '#666',
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: '1px',
    marginBottom: '12px'
  },
  winningComboCards: {
    display: 'flex',
    gap: '8px',
    justifyContent: 'center',
    flexWrap: 'wrap'
  },
  winningComboCard: {
    width: '48px',
    height: '72px',
    borderRadius: '8px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: '20px',
    fontWeight: '800',
    color: 'white',
    boxShadow: '0 4px 12px rgba(0,0,0,0.2)',
    border: '2px solid white'
  }
}
