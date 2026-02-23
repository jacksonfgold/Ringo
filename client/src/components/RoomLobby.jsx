import { useState, useEffect } from 'react'
import { DndContext, closestCenter, KeyboardSensor, PointerSensor, useSensor, useSensors } from '@dnd-kit/core'
import { arrayMove, SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { showToast } from './Toast'

export default function RoomLobby({ socket, gameState, roomPlayers = [], roomHostId = null, roomCode: initialRoomCode, roomSettings: roomSettingsProp = null, setRoomCode: setRoomCodeProp, setPlayerName: setPlayerNameProp, clearSavedState, setGameState: setGameStateProp, roomClosedError, setRoomClosedError, setIsSpectator, setRoomSpectators, roomSpectators = [] }) {
  const [roomCode, setRoomCode] = useState(initialRoomCode || '')
  const [joinCode, setJoinCode] = useState('')
  const [players, setPlayers] = useState([])
  const [isHost, setIsHost] = useState(false)
  const [hostId, setHostId] = useState(null)
  const [playerName, setPlayerNameState] = useState(() => {
    // Try to load saved player name
    const saved = localStorage.getItem('ringo_playerName')
    return saved || ''
  })
  const [showNameInput, setShowNameInput] = useState(true)
  const [showRules, setShowRules] = useState(false)
  const [showBotMenu, setShowBotMenu] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [editingBotId, setEditingBotId] = useState(null)
  const [editingBotName, setEditingBotName] = useState('')
  const [kickedMessage, setKickedMessage] = useState(null)
  const [gameSettings, setGameSettings] = useState({
    handSize: null,
    turnTimer: 0,
    specialCardsMode: false
  })

  const GAME_PRESETS = {
    classic: {
      name: 'Classic',
      desc: 'Default balance',
      handSize: null,
      turnTimer: 0,
      specialCardsMode: false
    },
    speed: {
      name: 'Speed Ringo',
      desc: '30s per turn',
      handSize: null,
      turnTimer: 30,
      specialCardsMode: false
    },
    ultra: {
      name: 'Ultra Ringo',
      desc: 'Max cards, big hands',
      handSize: 'max',
      turnTimer: 0,
      specialCardsMode: false
    },
    blitz: {
      name: 'Blitz',
      desc: '15s timer, 6 cards',
      handSize: 6,
      turnTimer: 15,
      specialCardsMode: false
    },
    chaos: {
      name: 'Chaos',
      desc: 'Special cards in the deck',
      handSize: null,
      turnTimer: 0,
      specialCardsMode: true
    },
    tournament: {
      name: 'Tournament',
      desc: '60s timer',
      handSize: null,
      turnTimer: 60,
      specialCardsMode: false
    }
  }

  const [copyFeedback, setCopyFeedback] = useState(false)
  const [hoveredPreset, setHoveredPreset] = useState(null)
  const [isMobile, setIsMobile] = useState(() => typeof window !== 'undefined' && window.innerWidth < 768)

  const activePresetKey = (() => {
    const s = gameSettings
    for (const [key, preset] of Object.entries(GAME_PRESETS)) {
      if (
        (preset.handSize === s.handSize || (preset.handSize == null && s.handSize == null)) &&
        (preset.turnTimer === (s.turnTimer || 0)) &&
        (preset.specialCardsMode === !!s.specialCardsMode)
      ) return key
    }
    return null
  })()
  
  useEffect(() => {
    const handleResize = () => setIsMobile(window.innerWidth < 768)
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [])
  
  // Drag and drop sensors
  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  )

  const handleCopyCode = async () => {
    if (!roomCode) return
    try {
      await navigator.clipboard.writeText(roomCode)
      setCopyFeedback(true)
      setTimeout(() => setCopyFeedback(false), 2000)
    } catch (err) {
      console.error('Failed to copy:', err)
    }
  }

  // Sync playerName with parent component
  useEffect(() => {
    if (setPlayerNameProp && playerName) {
      setPlayerNameProp(playerName)
    }
  }, [playerName, setPlayerNameProp])

  const setPlayerName = (name) => {
    setPlayerNameState(name)
    if (setPlayerNameProp) {
      setPlayerNameProp(name)
    }
  }

  useEffect(() => {
    if (!socket) return

    const onRoomUpdate = (data) => {
      console.log('[RoomLobby] roomUpdate received:', data)
      if (data.players && Array.isArray(data.players)) {
        setPlayers(data.players)
        console.log('[RoomLobby] Updated players list:', data.players.map(p => ({ id: p.id, name: p.name, isBot: p.isBot })))
      }
      if (data.roomCode) {
        setRoomCode(data.roomCode)
      }
      if (data.hostId !== undefined) {
        setHostId(data.hostId)
        setIsHost(socket.id === data.hostId)
      }
      if (data.settings && typeof data.settings === 'object') {
        setGameSettings(prev => ({ handSize: null, turnTimer: 0, specialCardsMode: false, ...data.settings }))
      }
    }

    const onRoomSettingsUpdate = (data) => {
      console.log('[RoomLobby] roomSettingsUpdate received:', data)
      if (data.settings) {
        setGameSettings(data.settings)
      }
    }

    const onRoomClosed = (data) => {
      console.log('[RoomLobby] Room closed event received:', data)
      setRoomCode('')
      setPlayers([])
      setIsHost(false)
      setHostId(null)
      if (clearSavedState) clearSavedState()
      if (setRoomClosedError) setRoomClosedError(data.reason || 'Room has been closed')
    }

    const onKickedFromRoom = (data) => {
      setKickedMessage(data.message || "You've been kicked from the room. Bye! 👢")
      if (setRoomCodeProp) setRoomCodeProp('')
      setRoomCode('')
      setPlayers([])
      setIsHost(false)
      setHostId(null)
      if (clearSavedState) clearSavedState()
    }

    socket.on('roomUpdate', onRoomUpdate)
    socket.on('roomSettingsUpdate', onRoomSettingsUpdate)
    socket.on('roomClosed', onRoomClosed)
    socket.on('kickedFromRoom', onKickedFromRoom)

    return () => {
      socket.off('roomUpdate', onRoomUpdate)
      socket.off('roomSettingsUpdate', onRoomSettingsUpdate)
      socket.off('roomClosed', onRoomClosed)
      socket.off('kickedFromRoom', onKickedFromRoom)
    }
  }, [socket, clearSavedState, setRoomClosedError])

  useEffect(() => {
    if (roomHostId) {
      setHostId(roomHostId)
      if (socket?.id) {
        setIsHost(socket.id === roomHostId)
      }
    }
  }, [roomHostId, socket?.id])

  // Persist game settings between rounds: sync from server (roomSettings) into lobby form state
  useEffect(() => {
    if (roomCode && roomSettingsProp && typeof roomSettingsProp === 'object' && Object.keys(roomSettingsProp).length > 0) {
      setGameSettings(prev => ({ handSize: null, turnTimer: 0, specialCardsMode: false, ...prev, ...roomSettingsProp }))
    }
  }, [roomCode, roomSettingsProp])

  // Sync players list from app-level roomPlayers (useSocket) - this is the source of truth
  useEffect(() => {
    // Always update from roomPlayers, even if empty (to clear stale data)
    if (roomPlayers) {
      setPlayers(roomPlayers)
    }
  }, [roomPlayers])

  // Request room data when lobby becomes visible and we have a roomCode but no players
  useEffect(() => {
    if (socket && roomCode && (!roomPlayers || roomPlayers.length === 0) && players.length === 0) {
      console.log('[RoomLobby] Requesting room data - roomCode exists but no players')
      // Request room update by emitting a rejoinRoom (which will trigger roomUpdate)
      socket.emit('rejoinRoom', { roomCode, playerName: playerName || 'Player' }, (response) => {
        if (response?.success) {
          console.log('[RoomLobby] Rejoin successful, roomUpdate should be received')
        }
      })
    }
  }, [socket, roomCode, roomPlayers, players.length, playerName])

  // Fallback: if lobby is shown after game over and roomPlayers is empty,
  // use the players from the last gameState so the list isn't blank.
  // But only if we haven't received a roomUpdate yet
  useEffect(() => {
    // Only use gameState players if we don't have roomPlayers AND haven't set players from roomUpdate
    if ((!roomPlayers || roomPlayers.length === 0) && gameState?.players?.length > 0 && players.length === 0) {
      // Only use this as a one-time fallback, don't keep updating from gameState
      setPlayers(gameState.players)
    }
  }, [roomPlayers, gameState?.players])

  const handleCreateRoom = () => {
    if (!playerName.trim()) {
      showToast('Please enter your name', 'error')
      return
    }

    socket.emit('createRoom', { playerName: playerName.trim() }, (response) => {
      if (response.success) {
        setRoomCode(response.roomCode)
        if (setRoomCodeProp) setRoomCodeProp(response.roomCode)
        if (setPlayerNameProp) setPlayerNameProp(playerName.trim())
        setPlayers(response.players || [])
        setHostId(response.hostId)
        setIsHost(socket.id === response.hostId)
        setShowNameInput(false)
      } else {
        showToast(response.error || 'Failed to create room', 'error')
      }
    })
  }

  const handleJoinAsSpectator = () => {
    if (!playerName.trim()) {
      showToast('Please enter your name', 'error')
      return
    }
    if (!joinCode.trim()) {
      showToast('Please enter a room code', 'error')
      return
    }
    const code = joinCode.trim().toUpperCase()
    socket.emit('joinAsSpectator', { roomCode: code, playerName: playerName.trim() }, (response) => {
      if (response?.success) {
        setRoomCode(code)
        if (setRoomCodeProp) setRoomCodeProp(code)
        setPlayerName(playerName.trim())
        if (setPlayerNameProp) setPlayerNameProp(playerName.trim())
        if (response.players) setPlayers(response.players)
        if (setIsSpectator) setIsSpectator(true)
        if (setRoomSpectators && response.spectators) setRoomSpectators(response.spectators)
        if (setGameStateProp && response.gameState) setGameStateProp(response.gameState)
        setShowNameInput(false)
        showToast('Joined as spectator', 'success')
      } else {
        showToast(response?.error || 'Failed to join as spectator', 'error')
      }
    })
  }

  const handleJoinRoom = () => {
    if (!playerName.trim()) {
      showToast('Please enter your name', 'error')
      return
    }
    if (!joinCode.trim()) {
      showToast('Please enter a room code', 'error')
      return
    }

    const code = joinCode.trim().toUpperCase()
    const savedRoomCode = localStorage.getItem('ringo_roomCode')
    
    // If joining a room where we have a saved game, try rejoin first
    if (savedRoomCode === code) {
      console.log('[RoomLobby] Attempting to rejoin room:', code, 'with player name:', playerName.trim())
      console.log('[RoomLobby] Current socket ID:', socket.id)
      socket.emit('rejoinRoom', { 
        roomCode: code,
        playerName: playerName.trim()
      }, (response) => {
        console.log('[RoomLobby] Rejoin response:', response)
        if (response.success) {
          setRoomCode(code)
          if (setRoomCodeProp) setRoomCodeProp(code)
          if (setPlayerNameProp) setPlayerNameProp(playerName.trim())
          setPlayers(response.players || [])
          setHostId(response.hostId)
          setIsHost(socket.id === response.hostId)
          setShowNameInput(false)
          if (response.gameState && setGameStateProp) {
            console.log('[RoomLobby] Setting game state from rejoin:', {
              currentPlayerIndex: response.gameState.currentPlayerIndex,
              turnPhase: response.gameState.turnPhase,
              players: response.gameState.players?.map(p => ({ id: p.id, name: p.name })),
              socketId: socket.id
            })
            setGameStateProp(response.gameState)
          }
        } else {
          // If rejoin fails, check if room not found
          if (response?.error === 'Room not found' || response?.error?.includes('not found')) {
            if (clearSavedState) clearSavedState()
            return
          }
          // Otherwise try regular join
          socket.emit('joinRoom', { 
            roomCode: code,
            playerName: playerName.trim()
          }, (joinResponse) => {
            if (joinResponse.success) {
              setRoomCode(code)
              if (setRoomCodeProp) setRoomCodeProp(code)
              if (setPlayerNameProp) setPlayerNameProp(playerName.trim())
              setPlayers(joinResponse.players || [])
              setHostId(joinResponse.hostId)
              setIsHost(socket.id === joinResponse.hostId)
              setShowNameInput(false)
              if (joinResponse.gameState && setGameStateProp) {
                setGameStateProp(joinResponse.gameState)
              }
            } else {
              if (joinResponse?.error === 'Room not found' || joinResponse?.error?.includes('not found')) {
                if (clearSavedState) clearSavedState()
              }
              showToast(joinResponse.error || 'Failed to join room', 'error')
            }
          })
        }
      })
    } else {
      // Regular join for new rooms
      socket.emit('joinRoom', { 
        roomCode: code,
        playerName: playerName.trim()
      }, (response) => {
        if (response.success) {
          setRoomCode(code)
          if (setRoomCodeProp) setRoomCodeProp(code)
          if (setPlayerNameProp) setPlayerNameProp(playerName.trim())
          setPlayers(response.players || [])
          setHostId(response.hostId)
          setIsHost(socket.id === response.hostId)
          setShowNameInput(false)
          if (response.gameState && setGameStateProp) {
            setGameStateProp(response.gameState)
          }
        } else {
          if (response?.error === 'Room not found' || response?.error?.includes('not found')) {
            if (clearSavedState) clearSavedState()
          }
          showToast(response.error || 'Failed to join room', 'error')
        }
      })
    }
  }

  const handleStartGame = () => {
    if (!roomCode) return
    if (loadingActions.has('startGame')) return

    setLoadingActions(prev => new Set(prev).add('startGame'))
    socket.emit('startGame', { roomCode, settings: gameSettings }, (response) => {
      setLoadingActions(prev => {
        const next = new Set(prev)
        next.delete('startGame')
        return next
      })
      if (!response.success) {
        showToast(response.error || 'Failed to start game', 'error')
        console.error('Start game error:', response)
      } else {
        showToast('Game starting...', 'success')
        console.log('Game started successfully')
      }
    })
  }
  
  const handleDragEnd = (event) => {
    const { active, over } = event
    
    if (!over || active.id === over.id) return
    if (!isHostEffective || gameState?.status === 'PLAYING') return
    
    const oldIndex = uniquePlayers.findIndex(p => p.id === active.id)
    const newIndex = uniquePlayers.findIndex(p => p.id === over.id)
    
    if (oldIndex === -1 || newIndex === -1) return
    
    const newOrder = arrayMove(uniquePlayers, oldIndex, newIndex)
    
    // Emit reorder event to server
    socket.emit('reorderPlayers', { 
      roomCode, 
      playerOrder: newOrder.map(p => p.id) 
    }, (response) => {
      if (!response.success) {
        console.error('Failed to reorder players:', response.error)
      }
    })
  }
  
  const handleUpdateSettings = (newSettings) => {
    const updated = { ...gameSettings, ...newSettings }
    setGameSettings(updated)
    if (isHostEffective) {
      socket.emit('updateRoomSettings', { roomCode, settings: updated }, (response) => {
        if (!response.success) console.error('Failed to update settings:', response.error)
      })
    }
  }

  const applyPreset = (presetKey) => {
    const preset = GAME_PRESETS[presetKey]
    if (!preset) return
    const numPlayers = Math.max(1, uniquePlayers.length)
    const maxHand = Math.floor(72 / numPlayers)
    let handSize = preset.handSize
    if (handSize === 'max') handSize = maxHand
    const updated = {
      handSize,
      turnTimer: preset.turnTimer,
      specialCardsMode: preset.specialCardsMode
    }
    setGameSettings(updated)
    if (isHostEffective) {
      socket.emit('updateRoomSettings', { roomCode, settings: updated }, (response) => {
        if (!response.success) console.error('Failed to update settings:', response.error)
      })
    }
  }
  
  // Sortable player item component
  const SortablePlayerItem = ({ player, index }) => {
    const {
      attributes,
      listeners,
      setNodeRef,
      transform,
      transition,
      isDragging
    } = useSortable({ id: player.id })
    
    const style = {
      transform: CSS.Transform.toString(transform),
      transition,
      opacity: isDragging ? 0.5 : 1,
      cursor: isHostEffective && gameState?.status !== 'PLAYING' ? 'grab' : 'default'
    }
    
    const winsFromRoom = roomPlayers?.find(p => p.id === player.id || p.name === player.name)?.wins
    const displayWins = winsFromRoom ?? player.wins ?? 0
    const isBot = player.isBot
    const isEditing = editingBotId === player.id
    
    return (
      <div 
        ref={setNodeRef} 
        style={{
          ...styles.playerItem,
          ...(isBot ? styles.botPlayerItem : {}),
          ...style
        }}
        {...attributes}
      >
        {isHostEffective && gameState?.status !== 'PLAYING' && (
          <div style={styles.dragHandle} {...listeners}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="9" cy="12" r="1"/>
              <circle cx="9" cy="5" r="1"/>
              <circle cx="9" cy="19" r="1"/>
              <circle cx="15" cy="12" r="1"/>
              <circle cx="15" cy="5" r="1"/>
              <circle cx="15" cy="19" r="1"/>
            </svg>
          </div>
        )}
        {isEditing ? (
          <div style={styles.botNameEditContainer}>
            <span>🤖 </span>
            <input
              type="text"
              value={editingBotName}
              onChange={(e) => setEditingBotName(e.target.value)}
              onKeyDown={handleBotNameKeyDown}
              onBlur={handleSaveBotName}
              style={styles.botNameInput}
              autoFocus
              maxLength={20}
            />
          </div>
        ) : (
          <span 
            style={{
              ...styles.playerName,
              ...(isBot && isHostEffective && gameState?.status !== 'PLAYING' ? styles.editableBotName : {})
            }}
            onClick={() => {
              if (isBot && isHostEffective && gameState?.status !== 'PLAYING') {
                handleStartEditBot(player)
              }
            }}
            title={isBot && isHostEffective && gameState?.status !== 'PLAYING' ? 'Click to rename' : ''}
          >
            {isBot && '🤖 '}
            {player.name} {player.id === socket?.id ? '(You)' : ''}
            {player.id === effectiveHostId && ' 👑'}
            {isBot && isHostEffective && gameState?.status !== 'PLAYING' && (
              <span style={styles.editIcon}>✏️</span>
            )}
          </span>
        )}
        <div style={styles.playerRightSection}>
          <span style={styles.playerWins}>{displayWins} wins</span>
          {isBot && isHostEffective && gameState?.status !== 'PLAYING' && (
            <button 
              onClick={() => handleRemoveBot(player.id)}
              style={styles.removeBotButton}
              title="Remove bot"
            >
              ✕
            </button>
          )}
          {!isBot && isHostEffective && gameState?.status !== 'PLAYING' && player.id !== socket?.id && (
            <button
              onClick={() => handleKickPlayer(player.id)}
              style={styles.kickPlayerButton}
              title="Kick player"
            >
              👢 Kick
            </button>
          )}
        </div>
      </div>
    )
  }

  const [loadingActions, setLoadingActions] = useState(new Set())

  const handleAddBot = (difficulty) => {
    setLoadingActions(prev => new Set(prev).add('addBot'))
    socket.emit('addBot', { roomCode, difficulty }, (response) => {
      setLoadingActions(prev => {
        const next = new Set(prev)
        next.delete('addBot')
        return next
      })
      if (!response.success) {
        showToast(response.error || 'Failed to add bot', 'error')
      } else {
        showToast('Bot added successfully', 'success')
      }
      setShowBotMenu(false)
    })
  }

  const handleRemoveBot = (botId) => {
    setLoadingActions(prev => new Set(prev).add(`removeBot-${botId}`))
    socket.emit('removeBot', { roomCode, botId }, (response) => {
      setLoadingActions(prev => {
        const next = new Set(prev)
        next.delete(`removeBot-${botId}`)
        return next
      })
      if (!response.success) {
        showToast(response.error || 'Failed to remove bot', 'error')
      } else {
        showToast('Bot removed', 'success')
      }
    })
  }

  const handleKickPlayer = (playerIdToKick) => {
    socket.emit('kickPlayer', { roomCode, playerIdToKick }, (response) => {
      if (response?.error) {
        showToast(response.error, 'error')
      } else {
        showToast('Player kicked', 'success')
      }
    })
  }

  const handleStartEditBot = (bot) => {
    setEditingBotId(bot.id)
    setEditingBotName(bot.name)
  }

  const handleSaveBotName = () => {
    if (!editingBotId || !editingBotName.trim()) {
      setEditingBotId(null)
      return
    }
    
    socket.emit('renameBot', { 
      roomCode, 
      botId: editingBotId, 
      newName: editingBotName.trim() 
    }, (response) => {
      if (!response.success) {
        showToast(response.error || 'Failed to rename bot', 'error')
      } else {
        showToast('Bot renamed', 'success')
      }
      setEditingBotId(null)
      setEditingBotName('')
    })
  }

  const handleBotNameKeyDown = (e) => {
    if (e.key === 'Enter') {
      handleSaveBotName()
    } else if (e.key === 'Escape') {
      setEditingBotId(null)
      setEditingBotName('')
    }
  }

  const handleLeaveRoom = () => {
    if (roomCode) {
      socket.emit('leaveRoom', { roomCode })
    }
    // Always clear all state, even if no roomCode
    if (clearSavedState) clearSavedState()
    if (setGameStateProp) setGameStateProp(null)
    setRoomCode('')
    setPlayers([])
    setIsHost(false)
    setShowNameInput(true)
    setJoinCode('')
  }

  // Prioritize roomPlayers (from useSocket/roomUpdate) as the source of truth
  // Only fall back to local players state or gameState if roomPlayers is not available
  const effectivePlayers = (roomPlayers && roomPlayers.length > 0)
    ? roomPlayers
    : (players.length > 0 ? players : (gameState?.players || []))
  
  // Remove duplicates based on ID, keeping the most recent data
  const uniquePlayers = effectivePlayers.reduce((acc, player) => {
    const existing = acc.find(p => p.id === player.id)
    if (!existing) {
      acc.push(player)
    } else {
      // Update existing player with latest data (prefer roomPlayers data)
      const index = acc.indexOf(existing)
      acc[index] = player
    }
    return acc
  }, [])

  const effectiveHostId = roomHostId || hostId || (roomPlayers && roomPlayers.length > 0
    ? roomPlayers[0]?.id
    : gameState?.players?.[0]?.id)

  const isHostEffective = socket?.id && effectiveHostId ? socket.id === effectiveHostId : isHost

  // If room closed error, clear room and show home with error
  useEffect(() => {
    if (roomClosedError && roomCode) {
      if (clearSavedState) clearSavedState()
      setRoomCode('')
      setPlayers([])
      setIsHost(false)
      setShowNameInput(true)
    }
  }, [roomClosedError, roomCode, clearSavedState])

  if (kickedMessage) {
    return (
      <div
        style={{
          position: 'fixed',
          inset: 0,
          zIndex: 9999,
          background: 'linear-gradient(135deg, #1a1a2e 0%, #16213e 50%, #0f3460 100%)',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 24
        }}
        role="alert"
      >
        <div style={{ fontSize: 72, marginBottom: 16 }}>👢😤</div>
        <h2 style={{
          color: '#ff6b6b',
          fontSize: 28,
          fontWeight: 900,
          textAlign: 'center',
          textTransform: 'uppercase',
          textShadow: '0 0 20px rgba(255, 107, 107, 0.8)',
          margin: '0 0 12px'
        }}>
          YOU'VE BEEN KICKED!!!
        </h2>
        <p style={{
          color: 'rgba(255,255,255,0.9)',
          fontSize: 18,
          textAlign: 'center',
          maxWidth: 360,
          margin: '0 0 24px',
          lineHeight: 1.4
        }}>
          {kickedMessage}
        </p>
        <button
          onClick={() => setKickedMessage(null)}
          style={{
            background: 'linear-gradient(135deg, #ff6b6b 0%, #ee5a5a 100%)',
            color: 'white',
            border: 'none',
            borderRadius: 12,
            padding: '14px 28px',
            fontSize: 18,
            fontWeight: 700,
            cursor: 'pointer',
            boxShadow: '0 4px 20px rgba(255, 107, 107, 0.5)'
          }}
        >
          OK, I get it 😢
        </button>
      </div>
    )
  }

  if (roomCode) {
    return (
      <div style={{
        ...styles.container,
        ...(isMobile ? { padding: 'max(16px, env(safe-area-inset-top)) max(16px, env(safe-area-inset-right)) max(16px, env(safe-area-inset-bottom)) max(16px, env(safe-area-inset-left))', alignItems: 'flex-start' } : {})
      }}>
        <div style={{
          ...styles.card,
          ...(isMobile ? { padding: '24px 16px', margin: 'max(16px, env(safe-area-inset-top)) 0 max(16px, env(safe-area-inset-bottom))', maxHeight: 'calc(100vh - 32px)', overflowY: 'auto', WebkitOverflowScrolling: 'touch' } : {})
        }}>
          <h1 style={styles.title}>Ringo</h1>
          <div style={styles.roomInfo}>
            <div style={styles.headerSection}>
              <div style={styles.roomCodeContainer}>
                <label style={styles.label}>ROOM CODE</label>
                <div style={styles.codeDisplay} onClick={handleCopyCode}>
                  {roomCode}
                  <button style={styles.copyButton} title="Copy Code">
                    {copyFeedback ? (
                      <span style={styles.copyFeedback}>✓</span>
                    ) : (
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                        <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
                      </svg>
                    )}
                  </button>
                </div>
                {copyFeedback && <div style={styles.toast}>Copied to clipboard!</div>}
              </div>
              <button 
                onClick={handleLeaveRoom}
                style={{ ...styles.secondaryButton, ...(isMobile ? { minHeight: 44, padding: '12px 20px' } : {}) }}
              >
                Leave Room
              </button>
            </div>

            <div style={styles.playersSection}>
              <div style={styles.sectionHeader}>
                <h2 style={styles.sectionTitle}>Players ({(uniquePlayers.length || 0)}/5)</h2>
                {isHostEffective && gameState?.status !== 'PLAYING' && uniquePlayers.length > 1 && (
                  <span style={styles.dragHint}>Drag to reorder</span>
                )}
              </div>
              <DndContext 
                sensors={sensors}
                collisionDetection={closestCenter}
                onDragEnd={handleDragEnd}
              >
                <SortableContext 
                  items={uniquePlayers.map(p => p.id)}
                  strategy={verticalListSortingStrategy}
                >
                  <div style={styles.playersList}>
                    {uniquePlayers.map((player, index) => (
                      <SortablePlayerItem key={player.id} player={player} index={index} />
                    ))}
                  </div>
                </SortableContext>
              </DndContext>
              
              {roomSpectators && roomSpectators.length > 0 && (
                <div style={styles.spectatorsSection}>
                  <div style={styles.spectatorsLabel}>Spectators ({roomSpectators.length})</div>
                  <div style={styles.spectatorsList}>
                    {roomSpectators.map(s => (
                      <span key={s.id} style={styles.spectatorChip}>{s.name}</span>
                    ))}
                  </div>
                </div>
              )}

              {/* Add Bot Button */}
              {isHostEffective && uniquePlayers.length < 5 && gameState?.status !== 'PLAYING' && (
                <div style={styles.addBotSection}>
                  <button 
                    onClick={() => setShowBotMenu(!showBotMenu)}
                    style={{ ...styles.addBotButton, ...(isMobile ? { minHeight: 44, padding: '14px 20px' } : {}) }}
                  >
                    🤖 Add Bot
                  </button>
                  
                  {showBotMenu && (
                    <div style={styles.botMenu}>
                      <button 
                        onClick={() => handleAddBot('EASY')}
                        style={styles.botDifficultyButton}
                        onMouseOver={(e) => e.currentTarget.style.background = 'rgba(102, 126, 234, 0.1)'}
                        onMouseOut={(e) => e.currentTarget.style.background = 'none'}
                      >
                        <span style={styles.botDifficultyIcon}>🟢</span>
                        <span style={{ fontWeight: '600' }}>Rookie Bot</span>
                        <span style={styles.botDifficultyDesc}>Plays simple moves</span>
                      </button>
                      <button 
                        onClick={() => handleAddBot('MEDIUM')}
                        style={styles.botDifficultyButton}
                        onMouseOver={(e) => e.currentTarget.style.background = 'rgba(102, 126, 234, 0.1)'}
                        onMouseOut={(e) => e.currentTarget.style.background = 'none'}
                      >
                        <span style={styles.botDifficultyIcon}>🟡</span>
                        <span style={{ fontWeight: '600' }}>Pro Bot</span>
                        <span style={styles.botDifficultyDesc}>Strategic play</span>
                      </button>
                      <button 
                        onClick={() => handleAddBot('HARD')}
                        style={styles.botDifficultyButton}
                        onMouseOver={(e) => e.currentTarget.style.background = 'rgba(102, 126, 234, 0.1)'}
                        onMouseOut={(e) => e.currentTarget.style.background = 'none'}
                      >
                        <span style={styles.botDifficultyIcon}>🔴</span>
                        <span style={{ fontWeight: '600' }}>Master Bot</span>
                        <span style={styles.botDifficultyDesc}>Expert tactics</span>
                      </button>
                      <button 
                        onClick={() => handleAddBot('NIGHTMARE')}
                        style={styles.botDifficultyButton}
                        onMouseOver={(e) => e.currentTarget.style.background = 'rgba(102, 126, 234, 0.1)'}
                        onMouseOut={(e) => e.currentTarget.style.background = 'none'}
                      >
                        <span style={styles.botDifficultyIcon}>💀</span>
                        <span style={{ fontWeight: '600' }}>Nightmare Bot</span>
                        <span style={styles.botDifficultyDesc}>MCTS + Belief Model</span>
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>

            {gameState?.status === 'GAME_OVER' && (
              <div style={styles.gameOverBanner}>
                <div style={styles.gameOverText}>
                  {(() => {
                    const winner = players.find(p => p.id === gameState?.winner)
                    return winner ? `${winner.name} won the last game!` : 'Game over!'
                  })()}
                </div>
              </div>
            )}

            {(isHostEffective || !effectiveHostId) && gameState?.status === 'GAME_OVER' && (
              <button
                onClick={handleStartGame}
                style={{ ...styles.playAgainButton, ...(isMobile ? { minHeight: 48, padding: '16px 24px' } : {}) }}
              >
                Play Again
              </button>
            )}

            {isHostEffective && uniquePlayers.length >= 2 && gameState?.status !== 'GAME_OVER' && (
              <button
                onClick={handleStartGame}
                style={{ ...styles.startButton, ...(isMobile ? { minHeight: 48, padding: '16px 24px' } : {}) }}
              >
                Start Game
              </button>
            )}

            {isHostEffective && uniquePlayers.length < 2 && (
              <div style={styles.waitingText}>
                Waiting for more players (need at least 2)
              </div>
            )}

            {/* Settings Button */}
            {isHostEffective && gameState?.status !== 'PLAYING' && (
              <button
                onClick={() => setShowSettings(!showSettings)}
                style={{ ...styles.settingsButton, ...(isMobile ? { minHeight: 44, padding: '12px 20px' } : {}) }}
              >
                {showSettings ? '✕ Close' : '⚙️ Game Settings'}
              </button>
            )}

            {/* Settings Panel */}
            {showSettings && isHostEffective && (
              <div style={styles.settingsPanel}>
                <div style={styles.settingsHeader}>
                  <h3 style={styles.settingsTitle}>Game Settings</h3>
                  <p style={styles.settingsSubtitle}>Choose a preset or adjust details below</p>
                </div>

                <div style={styles.presetsSection}>
                  <div style={styles.presetsLabel}>Preset</div>
                  <div style={{ ...styles.presetsGrid, ...(isMobile ? { gridTemplateColumns: 'repeat(2, 1fr)' } : {}) }}>
                    {Object.entries(GAME_PRESETS).map(([key, preset]) => {
                      const isSelected = activePresetKey === key
                      const isHover = hoveredPreset === key
                      return (
                        <button
                          key={key}
                          type="button"
                          onClick={() => applyPreset(key)}
                          onMouseEnter={() => setHoveredPreset(key)}
                          onMouseLeave={() => setHoveredPreset(null)}
                          style={{
                            ...styles.presetCard,
                            ...(isSelected ? styles.presetCardSelected : {}),
                            ...(isHover && !isSelected ? styles.presetCardHover : {})
                          }}
                        >
                          <span style={{
                            ...styles.presetName,
                            ...(isSelected || isHover ? { color: '#fff' } : {})
                          }}>{preset.name}</span>
                          <span style={{
                            ...styles.presetDesc,
                            ...(isSelected || isHover ? { color: 'rgba(255,255,255,0.92)' } : {})
                          }}>{preset.desc}</span>
                          {isSelected && <span style={styles.presetCheck}>Selected</span>}
                        </button>
                      )
                    })}
                  </div>
                </div>

                <div style={styles.settingsDivider} />

                <div style={styles.settingsSection}>
                  <div style={styles.sectionLabel}>Hand size & timer</div>
                  <div style={styles.settingsRowGroup}>
                    <div style={styles.settingRow}>
                      <label style={styles.settingLabel}>Starting hand size</label>
                      {(() => {
                        const numPlayers = Math.max(1, uniquePlayers.length)
                        const maxHand = Math.floor(72 / numPlayers)
                        const raw = gameSettings.handSize
                        const value = raw == null || raw === '' ? '' : String(raw)
                        return (
                          <div style={styles.inputWrap}>
                            <input
                              type="number"
                              min={1}
                              max={maxHand}
                              value={value}
                              onChange={(e) => {
                                const v = e.target.value
                                if (v === '') { handleUpdateSettings({ handSize: null }); return }
                                const n = parseInt(v, 10)
                                if (!Number.isNaN(n)) handleUpdateSettings({ handSize: Math.min(maxHand, Math.max(1, n)) })
                              }}
                              style={styles.settingInput}
                              placeholder={`Auto (max ${maxHand})`}
                            />
                            <span style={styles.settingHint}>Up to {maxHand} for {numPlayers} player{numPlayers !== 1 ? 's' : ''}</span>
                          </div>
                        )
                      })()}
                    </div>
                    <div style={styles.settingRow}>
                      <label style={styles.settingLabel}>Turn timer</label>
                      <div style={styles.timerRow}>
                        <input
                          type="range"
                          min={0}
                          max={120}
                          step={5}
                          value={Math.min(120, gameSettings.turnTimer || 0)}
                          onChange={(e) => handleUpdateSettings({ turnTimer: parseInt(e.target.value, 10) || 0 })}
                          style={styles.timerSlider}
                        />
                        <span style={styles.timerValue}>{gameSettings.turnTimer || 0}s</span>
                      </div>
                      <span style={styles.settingHint}>0 is no limit</span>
                    </div>
                  </div>
                </div>

                <div style={styles.settingsDivider} />

                <div style={styles.settingsSection}>
                  <div style={styles.sectionLabel}>Deck mode</div>
                  <div style={styles.modeSwitchWrap}>
                    <button
                      type="button"
                      onClick={() => handleUpdateSettings({ specialCardsMode: false })}
                      style={{
                        ...styles.modeSwitchOption,
                        ...(!gameSettings.specialCardsMode ? styles.modeSwitchOptionActive : {})
                      }}
                    >
                      <span style={{ ...styles.modeSwitchName, ...(!gameSettings.specialCardsMode ? { color: '#fff' } : {}) }}>Classic</span>
                      <span style={{ ...styles.modeSwitchDesc, ...(!gameSettings.specialCardsMode ? { color: 'rgba(255,255,255,0.9)' } : {}) }}>Standard deck only</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => handleUpdateSettings({ specialCardsMode: true })}
                      style={{
                        ...styles.modeSwitchOption,
                        ...(gameSettings.specialCardsMode ? styles.modeSwitchOptionActive : {})
                      }}
                    >
                      <span style={{ ...styles.modeSwitchName, ...(gameSettings.specialCardsMode ? { color: '#fff' } : {}) }}>Chaos</span>
                      <span style={{ ...styles.modeSwitchDesc, ...(gameSettings.specialCardsMode ? { color: 'rgba(255,255,255,0.9)' } : {}) }}>Special cards with effects</span>
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    )
  }

  return (
    <div style={{
      ...styles.container,
      ...(isMobile ? { padding: 'max(16px, env(safe-area-inset-top)) max(16px, env(safe-area-inset-right)) max(16px, env(safe-area-inset-bottom)) max(16px, env(safe-area-inset-left))' } : {})
    }}>
      <div style={{
        ...styles.card,
        ...(isMobile ? { padding: '24px 16px', maxHeight: 'calc(100vh - 32px)', overflowY: 'auto', WebkitOverflowScrolling: 'touch' } : {})
      }}>
        <h1 style={{ ...styles.title, ...(isMobile ? { fontSize: 36 } : {}) }}>Ringo</h1>
        <p style={{ ...styles.subtitle, ...(isMobile ? { fontSize: 16 } : {}) }}>Strategy Card Game</p>

        <button 
          onClick={() => setShowRules(true)}
          style={styles.rulesButton}
        >
          How to Play
        </button>

        {roomClosedError && (
          <div style={styles.errorBanner}>
            <div style={styles.errorText}>{roomClosedError}</div>
            <button 
              onClick={() => {
                if (clearSavedState) clearSavedState()
                setRoomCode('')
                setPlayers([])
                setIsHost(false)
                setShowNameInput(true)
              }}
              style={styles.errorButton}
            >
              OK
            </button>
          </div>
        )}

        {showNameInput && (
          <div style={styles.nameInputSection}>
            <input
              type="text"
              placeholder="Enter your name"
              value={playerName}
              onChange={(e) => setPlayerName(e.target.value)}
              onKeyPress={(e) => e.key === 'Enter' && handleCreateRoom()}
              style={styles.input}
              maxLength={20}
            />
          </div>
        )}

        <div style={styles.actions}>
          <div style={styles.createSection}>
            <button
              onClick={handleCreateRoom}
              style={{ ...styles.createButton, ...(isMobile ? { minHeight: 48, padding: '16px' } : {}) }}
              disabled={!playerName.trim()}
            >
              Create Room
            </button>
          </div>

          <div style={styles.divider}>
            <span style={styles.dividerText}>OR</span>
          </div>

          <div style={styles.joinSection}>
            <input
              type="text"
              placeholder="Enter room code"
              value={joinCode}
              onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
              onKeyPress={(e) => e.key === 'Enter' && handleJoinRoom()}
              style={styles.input}
              maxLength={6}
            />
            <button
              onClick={handleJoinRoom}
              style={{ ...styles.joinButton, ...(isMobile ? { minHeight: 48, padding: '16px' } : {}) }}
              disabled={!joinCode.trim() || !playerName.trim()}
            >
              Join as Player
            </button>
            <button
              onClick={handleJoinAsSpectator}
              style={{ ...styles.joinButton, ...styles.spectatorJoinButton, ...(isMobile ? { minHeight: 48, padding: '16px' } : {}) }}
              disabled={!joinCode.trim() || !playerName.trim()}
            >
              Join as Spectator
            </button>
          </div>
        </div>
      </div>

      {showRules && (
        <div style={{
          ...styles.modalOverlay,
          ...(isMobile ? { padding: 'env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left)', alignItems: 'flex-end' } : {})
        }} onClick={(e) => {
          if (e.target === e.currentTarget) setShowRules(false)
        }}>
          <div style={{
            ...styles.modalContent,
            ...(isMobile ? { maxHeight: '90vh', overflowY: 'auto', WebkitOverflowScrolling: 'touch', margin: '0 16px 16px', width: 'calc(100% - 32px)' } : {})
          }}>
            <div style={styles.modalHeader}>
              <h2 style={{ ...styles.modalTitle, ...(isMobile ? { fontSize: 22 } : {}) }}>How to Play Ringo</h2>
              <button 
                onClick={() => setShowRules(false)}
                style={{ ...styles.closeButton, ...(isMobile ? { minWidth: 44, minHeight: 44 } : {}) }}
              >
                ✕
              </button>
            </div>
            <div style={styles.modalBody}>
              <div style={styles.ruleSection}>
                <h3 style={styles.ruleTitle}>Objective</h3>
                <p style={styles.ruleText}>Be the first player to empty your hand!</p>
              </div>

              <div style={styles.ruleSection}>
                <h3 style={styles.ruleTitle}>On Your Turn</h3>
                <p style={styles.ruleText}>Choose one action:</p>
                <ul style={styles.ruleList}>
                  <li>
                    <strong>Play:</strong> Play adjacent cards of the same value from your hand. You must beat the current combo on the table by playing the same or greater number of cards with a higher value (e.g., two 1s beats one 8).
                  </li>
                  <li>
                    <strong>Draw:</strong> Draw 1 card from the pile.
                  </li>
                </ul>
              </div>

              <div style={styles.ruleSection}>
                <h3 style={styles.ruleTitle}>Drawing & RINGO!</h3>
                <p style={styles.ruleText}>When you draw a card:</p>
                <ul style={styles.ruleList}>
                  <li>
                    If you can combine the drawn card with cards in your hand to beat the current table combo, you can call <strong>RINGO!</strong> and play immediately.
                  </li>
                  <li>
                    Otherwise, you must add the card to your hand (insert it anywhere) or discard it.
                  </li>
                </ul>
              </div>

              <div style={styles.ruleSection}>
                <h3 style={styles.ruleTitle}>Special Rules</h3>
                <ul style={styles.ruleList}>
                  <li>
                    <strong>Split Cards:</strong> Cards like 1/2, 3/4, 5/6, 7/8 can count as either value.
                  </li>
                  <li>
                    <strong>Closing a Pile:</strong> If play returns to you and no one has beaten your combo, the pile is discarded and you start a new one freely.
                  </li>
                  <li>
                    <strong>Winning a Combo:</strong> When you beat a combo, you can choose to pick up the beaten cards (add to hand) or discard them.
                  </li>
                </ul>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

const styles = {
  container: {
    minHeight: '100vh',
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
    padding: '20px',
    overflowY: 'auto'
  },
  card: {
    background: 'rgba(255, 255, 255, 0.95)',
    borderRadius: '24px',
    padding: '32px 24px',
    boxShadow: '0 20px 60px rgba(0,0,0,0.15)',
    width: '100%',
    maxWidth: '500px',
    textAlign: 'center',
    backdropFilter: 'blur(10px)',
    border: '1px solid rgba(255,255,255,0.2)',
    margin: 'auto 0'
  },
  title: {
    fontSize: '48px',
    fontWeight: '800',
    marginBottom: '8px',
    background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
    WebkitBackgroundClip: 'text',
    WebkitTextFillColor: 'transparent',
    backgroundClip: 'text',
    letterSpacing: '-2px'
  },
  subtitle: {
    fontSize: '20px',
    color: '#666',
    marginBottom: '20px',
    fontWeight: '500'
  },
  rulesButton: {
    background: 'transparent',
    border: '2px solid #667eea',
    color: '#667eea',
    padding: '8px 16px',
    borderRadius: '20px',
    fontSize: '14px',
    fontWeight: '700',
    cursor: 'pointer',
    marginBottom: '32px',
    transition: 'all 0.2s',
    ':hover': {
      background: 'rgba(102, 126, 234, 0.1)'
    }
  },
  nameInputSection: {
    marginBottom: '24px'
  },
  input: {
    width: '100%',
    padding: '16px',
    fontSize: '18px',
    border: '2px solid #e0e0e0',
    borderRadius: '12px',
    marginBottom: '16px',
    transition: 'border-color 0.2s',
    background: '#f8f9fa'
  },
  actions: {
    display: 'flex',
    flexDirection: 'column',
    gap: '20px'
  },
  createButton: {
    width: '100%',
    background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
    color: 'white',
    padding: '18px',
    fontSize: '18px',
    fontWeight: '700',
    borderRadius: '12px',
    boxShadow: '0 4px 12px rgba(118, 75, 162, 0.3)'
  },
  divider: {
    position: 'relative',
    textAlign: 'center',
    margin: '10px 0'
  },
  dividerText: {
    background: 'rgba(255,255,255,0.95)',
    padding: '0 16px',
    color: '#999',
    fontSize: '14px',
    fontWeight: '600'
  },
  joinSection: {
    width: '100%',
    display: 'flex',
    flexDirection: 'column',
    gap: '12px'
  },
  joinButton: {
    width: '100%',
    background: '#4CAF50',
    color: 'white',
    padding: '18px',
    fontSize: '18px',
    fontWeight: '700',
    borderRadius: '12px',
    boxShadow: '0 4px 12px rgba(76, 175, 80, 0.3)'
  },
  spectatorJoinButton: {
    background: 'transparent',
    color: '#667eea',
    border: '2px solid #667eea',
    boxShadow: 'none'
  },
  spectatorsSection: {
    marginTop: '12px',
    padding: '12px',
    background: 'rgba(102, 126, 234, 0.08)',
    borderRadius: '12px',
    border: '1px solid rgba(102, 126, 234, 0.2)'
  },
  spectatorsLabel: {
    fontSize: '12px',
    color: '#666',
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: '0.5px',
    marginBottom: '8px'
  },
  spectatorsList: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: '8px'
  },
  spectatorChip: {
    background: 'rgba(255,255,255,0.9)',
    padding: '4px 10px',
    borderRadius: '16px',
    fontSize: '13px',
    color: '#555',
    border: '1px solid rgba(0,0,0,0.08)'
  },
  headerSection: {
    marginBottom: '32px',
    textAlign: 'center'
  },
  roomCodeContainer: {
    position: 'relative',
    marginBottom: '24px',
    background: '#f8f9fa',
    borderRadius: '16px',
    padding: '24px',
    border: '2px dashed #e0e0e0'
  },
  label: {
    display: 'block',
    fontSize: '12px',
    color: '#666',
    marginBottom: '8px',
    fontWeight: '700',
    letterSpacing: '1px',
    textTransform: 'uppercase'
  },
  codeDisplay: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '12px',
    fontSize: '32px',
    fontWeight: '800',
    color: '#333',
    fontFamily: 'monospace',
    cursor: 'pointer'
  },
  copyButton: {
    background: 'none',
    border: 'none',
    padding: '8px',
    cursor: 'pointer',
    color: '#666',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: '8px',
    transition: 'all 0.2s',
    minWidth: 44,
    minHeight: 44,
    ':hover': {
      background: '#eee'
    }
  },
  copyFeedback: {
    color: '#4CAF50',
    fontSize: '20px',
    fontWeight: 'bold'
  },
  toast: {
    position: 'absolute',
    bottom: '8px',
    left: '50%',
    transform: 'translateX(-50%)',
    fontSize: '12px',
    color: '#4CAF50',
    fontWeight: '600',
    background: '#fff',
    padding: '4px 12px',
    borderRadius: '12px',
    boxShadow: '0 2px 8px rgba(0,0,0,0.1)'
  },
  secondaryButton: {
    background: 'transparent',
    color: '#f44336',
    padding: '8px 16px',
    fontSize: '14px',
    border: '1px solid rgba(244, 67, 54, 0.3)',
    borderRadius: '8px',
    marginTop: '8px'
  },
  playersSection: {
    marginBottom: '32px',
    textAlign: 'left',
    padding: '20px',
    background: 'rgba(248, 249, 250, 0.6)',
    borderRadius: '16px',
    border: '1px solid rgba(0,0,0,0.05)',
    boxShadow: '0 2px 8px rgba(0,0,0,0.05)'
  },
  sectionTitle: {
    fontSize: '18px',
    marginBottom: '16px',
    color: '#666',
    fontWeight: '600',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center'
  },
  playersList: {
    display: 'flex',
    flexDirection: 'column',
    gap: '10px'
  },
  playerItem: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '16px',
    background: '#ffffff',
    borderRadius: '12px',
    border: '1px solid rgba(0,0,0,0.08)',
    transition: 'all 0.2s ease',
    flexWrap: 'wrap',
    gap: '8px',
    boxShadow: '0 2px 4px rgba(0,0,0,0.04)',
    marginBottom: '8px',
    ':hover': {
      transform: 'translateY(-2px)',
      boxShadow: '0 4px 12px rgba(0,0,0,0.08)',
      borderColor: 'rgba(102, 126, 234, 0.3)'
    }
  },
  playerName: {
    fontSize: '16px',
    color: '#333',
    fontWeight: '600',
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    flex: '1 1 auto',
    minWidth: '0',
    wordBreak: 'break-word'
  },
  playerWins: {
    fontSize: '14px',
    color: '#667eea',
    fontWeight: '700',
    background: 'rgba(102, 126, 234, 0.1)',
    padding: '4px 12px',
    borderRadius: '20px',
    whiteSpace: 'nowrap',
    flexShrink: 0
  },
  playerRightSection: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px'
  },
  botPlayerItem: {
    background: 'rgba(102, 126, 234, 0.05)',
    borderLeft: '3px solid #667eea'
  },
  removeBotButton: {
    background: 'rgba(255, 107, 107, 0.1)',
    color: '#FF6B6B',
    border: 'none',
    borderRadius: '50%',
    width: '24px',
    height: '24px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: 'pointer',
    fontSize: '12px',
    fontWeight: '700',
    transition: 'all 0.2s'
  },
  kickPlayerButton: {
    background: 'linear-gradient(135deg, #ff6b6b 0%, #ee5a5a 100%)',
    color: 'white',
    border: 'none',
    borderRadius: 8,
    padding: '6px 10px',
    fontSize: 12,
    fontWeight: 700,
    cursor: 'pointer',
    marginLeft: 8,
    boxShadow: '0 2px 8px rgba(255, 107, 107, 0.4)'
  },
  editableBotName: {
    cursor: 'pointer',
    borderRadius: '4px',
    padding: '2px 4px',
    transition: 'all 0.2s'
  },
  editIcon: {
    marginLeft: '6px',
    fontSize: '12px',
    opacity: 0.6
  },
  botNameEditContainer: {
    display: 'flex',
    alignItems: 'center',
    gap: '4px',
    flex: 1
  },
  botNameInput: {
    background: 'rgba(102, 126, 234, 0.1)',
    border: '2px solid #667eea',
    borderRadius: '8px',
    padding: '6px 10px',
    fontSize: '16px',
    fontWeight: '600',
    color: '#333',
    outline: 'none',
    width: '150px'
  },
  addBotSection: {
    marginTop: '16px',
    position: 'relative'
  },
  addBotButton: {
    background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
    color: 'white',
    border: 'none',
    padding: '12px 24px',
    borderRadius: '12px',
    fontSize: '16px',
    fontWeight: '700',
    cursor: 'pointer',
    width: '100%',
    transition: 'all 0.2s',
    boxShadow: '0 4px 12px rgba(102, 126, 234, 0.3)'
  },
  botMenu: {
    position: 'absolute',
    top: '100%',
    left: 0,
    right: 0,
    marginTop: '8px',
    background: 'white',
    borderRadius: '16px',
    boxShadow: '0 8px 32px rgba(0,0,0,0.15)',
    padding: '8px',
    zIndex: 100,
    animation: 'slideUp 0.2s ease-out'
  },
  botDifficultyButton: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'flex-start',
    gap: '2px',
    width: '100%',
    padding: '12px 16px',
    background: 'none',
    border: 'none',
    borderRadius: '12px',
    cursor: 'pointer',
    transition: 'all 0.2s',
    textAlign: 'left',
    ':hover': {
      background: 'rgba(102, 126, 234, 0.1)'
    }
  },
  botDifficultyIcon: {
    fontSize: '16px'
  },
  botDifficultyDesc: {
    fontSize: '12px',
    color: '#888',
    fontWeight: '400'
  },
  startButton: {
    width: '100%',
    background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
    color: 'white',
    padding: '20px',
    fontSize: '20px',
    fontWeight: '700',
    borderRadius: '16px',
    boxShadow: '0 8px 20px rgba(118, 75, 162, 0.4)',
    marginTop: '24px',
    transition: 'transform 0.2s'
  },
  playAgainButton: {
    width: '100%',
    background: '#4CAF50',
    color: 'white',
    padding: '20px',
    fontSize: '20px',
    fontWeight: '700',
    borderRadius: '16px',
    boxShadow: '0 8px 20px rgba(76, 175, 80, 0.4)',
    marginTop: '24px'
  },
  gameOverBanner: {
    background: 'linear-gradient(135deg, #FF9966 0%, #FF5E62 100%)',
    borderRadius: '12px',
    padding: '16px',
    textAlign: 'center',
    color: 'white',
    marginBottom: '24px',
    boxShadow: '0 4px 12px rgba(255, 94, 98, 0.3)'
  },
  gameOverText: {
    fontSize: '18px',
    fontWeight: '700'
  },
  errorBanner: {
    background: 'linear-gradient(135deg, #FF6B6B 0%, #EE5A6F 100%)',
    borderRadius: '12px',
    padding: '20px',
    textAlign: 'center',
    color: 'white',
    marginBottom: '24px',
    boxShadow: '0 4px 12px rgba(238, 90, 111, 0.3)',
    display: 'flex',
    flexDirection: 'column',
    gap: '16px',
    alignItems: 'center'
  },
  errorText: {
    fontSize: '18px',
    fontWeight: '700'
  },
  errorButton: {
    background: 'rgba(255, 255, 255, 0.2)',
    color: 'white',
    border: '2px solid rgba(255, 255, 255, 0.5)',
    padding: '10px 24px',
    borderRadius: '8px',
    fontSize: '16px',
    fontWeight: '600',
    cursor: 'pointer',
    transition: 'all 0.2s'
  },
  waitingText: {
    textAlign: 'center',
    color: '#999',
    fontSize: '15px',
    marginTop: '24px',
    fontStyle: 'italic',
    background: '#f8f9fa',
    padding: '12px',
    borderRadius: '8px'
  },
  reconnectSection: {
    marginBottom: '24px',
    padding: '16px',
    background: '#E8F5E9',
    borderRadius: '8px',
    textAlign: 'center',
    border: '1px solid #C8E6C9'
  },
  reconnectMessage: {
    fontSize: '14px',
    color: '#2E7D32',
    marginBottom: '12px',
    fontWeight: '600'
  },
  reconnectButton: {
    background: '#4CAF50',
    color: 'white',
    padding: '12px 24px',
    fontSize: '16px',
    fontWeight: '600',
    width: '100%',
    borderRadius: '8px'
  },
  modalOverlay: {
    position: 'fixed',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    background: 'rgba(0, 0, 0, 0.6)',
    backdropFilter: 'blur(8px)',
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 1000,
    padding: '20px',
    animation: 'fadeIn 0.3s ease-out'
  },
  modalContent: {
    background: 'rgba(255, 255, 255, 0.95)',
    borderRadius: '32px',
    padding: '40px',
    maxWidth: '600px',
    width: '100%',
    maxHeight: '85vh',
    overflowY: 'auto',
    boxShadow: '0 20px 60px rgba(0,0,0,0.3), 0 0 0 1px rgba(255,255,255,0.5) inset',
    border: '1px solid rgba(255,255,255,0.2)',
    animation: 'slideUp 0.4s cubic-bezier(0.16, 1, 0.3, 1)'
  },
  modalHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '32px',
    borderBottom: '2px solid rgba(102, 126, 234, 0.1)',
    paddingBottom: '20px'
  },
  modalTitle: {
    fontSize: '32px',
    fontWeight: '900',
    background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
    WebkitBackgroundClip: 'text',
    WebkitTextFillColor: 'transparent',
    margin: 0,
    letterSpacing: '-1px'
  },
  closeButton: {
    background: 'rgba(0,0,0,0.05)',
    border: 'none',
    fontSize: '20px',
    color: '#666',
    cursor: 'pointer',
    width: '40px',
    height: '40px',
    borderRadius: '50%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    transition: 'all 0.2s',
    ':hover': {
      background: 'rgba(0,0,0,0.1)',
      transform: 'rotate(90deg)'
    }
  },
  modalBody: {
    textAlign: 'left'
  },
  ruleSection: {
    marginBottom: '32px',
    background: 'rgba(248, 249, 250, 0.5)',
    padding: '20px',
    borderRadius: '16px',
    border: '1px solid rgba(0,0,0,0.03)'
  },
  ruleTitle: {
    fontSize: '20px',
    fontWeight: '800',
    color: '#444',
    marginBottom: '12px',
    display: 'flex',
    alignItems: 'center',
    gap: '8px'
  },
  ruleText: {
    fontSize: '16px',
    color: '#555',
    lineHeight: '1.6',
    margin: 0
  },
  ruleList: {
    margin: '12px 0 0 20px',
    padding: 0,
    display: 'flex',
    flexDirection: 'column',
    gap: '12px'
  },
  sectionHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '12px'
  },
  dragHint: {
    fontSize: '12px',
    color: '#999',
    fontStyle: 'italic'
  },
  dragHandle: {
    cursor: 'grab',
    padding: '8px',
    color: '#999',
    display: 'flex',
    alignItems: 'center',
    marginRight: '8px',
    touchAction: 'none'
  },
  settingsButton: {
    width: '100%',
    background: 'rgba(102, 126, 234, 0.1)',
    border: '2px solid #667eea',
    color: '#667eea',
    padding: '12px 20px',
    borderRadius: '12px',
    fontSize: '16px',
    fontWeight: '600',
    cursor: 'pointer',
    marginTop: '16px',
    transition: 'all 0.2s'
  },
  settingsPanel: {
    marginTop: 24,
    padding: 28,
    background: 'linear-gradient(165deg, #ffffff 0%, #f8fafc 50%, #f1f5f9 100%)',
    borderRadius: 24,
    border: '1px solid rgba(226, 232, 240, 0.9)',
    boxShadow: '0 8px 32px rgba(30, 41, 59, 0.08), 0 2px 8px rgba(0,0,0,0.04)'
  },
  settingsHeader: {
    marginBottom: 28,
    textAlign: 'center'
  },
  settingsTitle: {
    fontSize: 24,
    fontWeight: 800,
    color: '#1e293b',
    margin: 0,
    letterSpacing: '-0.03em'
  },
  settingsSubtitle: {
    fontSize: 14,
    color: '#64748b',
    marginTop: 6,
    marginBottom: 0,
    fontWeight: 500
  },
  presetsSection: {
    marginBottom: 24
  },
  presetsLabel: {
    fontSize: 11,
    fontWeight: 700,
    color: '#64748b',
    textTransform: 'uppercase',
    letterSpacing: '0.1em',
    marginBottom: 12
  },
  presetsGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(3, 1fr)',
    gap: 12
  },
  presetCard: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '16px 12px',
    background: 'linear-gradient(180deg, #ffffff 0%, #f8fafc 100%)',
    border: '2px solid #e2e8f0',
    borderRadius: 16,
    cursor: 'pointer',
    transition: 'all 0.22s cubic-bezier(0.4, 0, 0.2, 1)',
    textAlign: 'center',
    minHeight: 80,
    position: 'relative'
  },
  presetName: {
    fontSize: 14,
    fontWeight: 700,
    color: '#334155',
    display: 'block',
    letterSpacing: '-0.01em'
  },
  presetDesc: {
    fontSize: 11,
    color: '#64748b',
    marginTop: 4,
    display: 'block',
    lineHeight: 1.3
  },
  presetCheck: {
    position: 'absolute',
    top: 8,
    right: 8,
    fontSize: 9,
    fontWeight: 700,
    textTransform: 'uppercase',
    letterSpacing: '0.06em',
    color: 'rgba(255,255,255,0.95)',
    background: 'rgba(255,255,255,0.25)',
    padding: '2px 6px',
    borderRadius: 6
  },
  presetCardSelected: {
    background: 'linear-gradient(145deg, #4f46e5 0%, #6366f1 50%, #7c3aed 100%)',
    borderColor: '#4f46e5',
    boxShadow: '0 6px 20px rgba(79, 70, 229, 0.4), inset 0 1px 0 rgba(255,255,255,0.2)'
  },
  presetCardHover: {
    background: 'linear-gradient(145deg, #6366f1 0%, #8b5cf6 100%)',
    borderColor: '#6366f1',
    transform: 'translateY(-3px) scale(1.02)',
    boxShadow: '0 12px 28px rgba(99, 102, 241, 0.35)'
  },
  settingsDivider: {
    height: 1,
    background: 'linear-gradient(90deg, transparent 0%, #e2e8f0 20%, #e2e8f0 80%, transparent 100%)',
    margin: '20px 0'
  },
  settingsSection: {
    marginBottom: 20
  },
  sectionLabel: {
    fontSize: 11,
    fontWeight: 700,
    color: '#64748b',
    textTransform: 'uppercase',
    letterSpacing: '0.1em',
    marginBottom: 14
  },
  settingsRowGroup: {
    display: 'flex',
    flexDirection: 'column',
    gap: 20
  },
  settingRow: {
    marginBottom: 0
  },
  settingLabel: {
    display: 'block',
    fontSize: 14,
    fontWeight: 600,
    color: '#334155',
    marginBottom: 8
  },
  inputWrap: {
    display: 'flex',
    flexDirection: 'column',
    gap: 6
  },
  settingInput: {
    padding: '14px 16px',
    fontSize: 15,
    border: '2px solid #e2e8f0',
    borderRadius: 14,
    background: '#fff',
    transition: 'border-color 0.2s, box-shadow 0.2s',
    outline: 'none'
  },
  settingHint: {
    fontSize: 12,
    color: '#94a3b8'
  },
  timerRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 16
  },
  timerSlider: {
    flex: 1,
    height: 8,
    borderRadius: 4,
    accentColor: '#4f46e5',
    cursor: 'pointer'
  },
  timerValue: {
    fontSize: 15,
    fontWeight: 700,
    color: '#334155',
    minWidth: 40,
    textAlign: 'right'
  },
  modeSwitchWrap: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gap: 12
  },
  modeSwitchOption: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '18px 16px',
    background: 'linear-gradient(180deg, #f8fafc 0%, #f1f5f9 100%)',
    border: '2px solid #e2e8f0',
    borderRadius: 16,
    cursor: 'pointer',
    transition: 'all 0.22s cubic-bezier(0.4, 0, 0.2, 1)',
    textAlign: 'center'
  },
  modeSwitchOptionActive: {
    background: 'linear-gradient(145deg, #4f46e5 0%, #6366f1 100%)',
    borderColor: '#4f46e5',
    boxShadow: '0 6px 20px rgba(79, 70, 229, 0.35), inset 0 1px 0 rgba(255,255,255,0.2)'
  },
  modeSwitchName: {
    fontSize: 15,
    fontWeight: 700,
    color: '#334155',
    display: 'block'
  },
  modeSwitchDesc: {
    fontSize: 12,
    color: '#64748b',
    marginTop: 4,
    display: 'block'
  },
  togglesWrap: {
    display: 'flex',
    flexDirection: 'column',
    gap: 12
  },
  toggleRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    fontSize: 15,
    fontWeight: 500,
    color: '#4a5568',
    cursor: 'pointer'
  },
  toggleCheckbox: {
    width: 20,
    height: 20,
    cursor: 'pointer',
    accentColor: '#667eea'
  },
  settingItem: {
    marginBottom: 20
  },
  settingSelect: {
    width: '100%',
    padding: '10px 12px',
    fontSize: 14,
    border: '2px solid #e0e0e0',
    borderRadius: 8,
    background: 'white',
    cursor: 'pointer'
  },
  settingToggle: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    fontSize: 14,
    color: '#555',
    cursor: 'pointer',
    textAlign: 'left'
  }
}
