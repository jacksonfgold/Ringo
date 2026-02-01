import { useState, useEffect } from 'react'

export default function RoomLobby({ socket, gameState, roomPlayers = [], roomHostId = null, roomCode: initialRoomCode, setRoomCode: setRoomCodeProp, setPlayerName: setPlayerNameProp, clearSavedState, setGameState: setGameStateProp, roomClosedError }) {
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

  const [copyFeedback, setCopyFeedback] = useState(false)

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

    socket.on('roomUpdate', (data) => {
      setPlayers(data.players || [])
      if (data.roomCode) {
        setRoomCode(data.roomCode)
      }
      if (data.hostId) {
        setHostId(data.hostId)
        setIsHost(socket.id === data.hostId)
      }
    })

    return () => {
      socket.off('roomUpdate')
    }
  }, [socket])

  useEffect(() => {
    if (roomHostId) {
      setHostId(roomHostId)
      if (socket?.id) {
        setIsHost(socket.id === roomHostId)
      }
    }
  }, [roomHostId, socket?.id])

  // Sync players list from app-level roomPlayers (useSocket)
  useEffect(() => {
    if (roomPlayers && roomPlayers.length > 0) {
      setPlayers(roomPlayers)
    }
  }, [roomPlayers])

  // Fallback: if lobby is shown after game over and roomPlayers is empty,
  // use the players from the last gameState so the list isn't blank.
  useEffect(() => {
    if (players.length === 0 && gameState?.players?.length > 0) {
      setPlayers(gameState.players)
    }
  }, [players.length, gameState?.players])

  const handleCreateRoom = () => {
    if (!playerName.trim()) {
      alert('Please enter your name')
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
        alert(response.error || 'Failed to create room')
      }
    })
  }

  const handleJoinRoom = () => {
    if (!playerName.trim()) {
      alert('Please enter your name')
      return
    }
    if (!joinCode.trim()) {
      alert('Please enter a room code')
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
              alert(joinResponse.error || 'Failed to join room')
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
          alert(response.error || 'Failed to join room')
        }
      })
    }
  }

  const handleStartGame = () => {
    if (!roomCode) return

    socket.emit('startGame', { roomCode }, (response) => {
      if (!response.success) {
        alert(response.error || 'Failed to start game')
        console.error('Start game error:', response)
      } else {
        console.log('Game started successfully')
      }
    })
  }

  const handleLeaveRoom = () => {
    if (roomCode) {
      socket.emit('leaveRoom', { roomCode })
      if (clearSavedState) clearSavedState()
      setRoomCode('')
      setPlayers([])
      setIsHost(false)
      setShowNameInput(true)
      setJoinCode('')
    }
  }

  const effectivePlayers = (roomPlayers && roomPlayers.length > 0)
    ? roomPlayers
    : (players.length > 0 ? players : (gameState?.players || []))

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

  if (roomCode) {
    return (
      <div style={styles.container}>
        <div style={styles.card}>
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
                style={styles.secondaryButton}
              >
                Leave Room
              </button>
            </div>

            <div style={styles.playersSection}>
              <h2 style={styles.sectionTitle}>Players ({(effectivePlayers.length || 0)}/5)</h2>
              <div style={styles.playersList}>
                {effectivePlayers.map((player, index) => {
                  const winsFromRoom = roomPlayers?.find(p => p.id === player.id || p.name === player.name)?.wins
                  const displayWins = winsFromRoom ?? player.wins ?? 0
                  return (
                  <div key={player.id} style={styles.playerItem}>
                    <span style={styles.playerName}>
                      {player.name} {player.id === socket?.id ? '(You)' : ''}
                      {player.id === effectiveHostId && ' 👑'}
                    </span>
                    <span style={styles.playerWins}>{displayWins} wins</span>
                  </div>
                )})}
              </div>
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
                style={styles.playAgainButton}
              >
                Play Again
              </button>
            )}

            {isHostEffective && effectivePlayers.length >= 2 && gameState?.status !== 'GAME_OVER' && (
              <button
                onClick={handleStartGame}
                style={styles.startButton}
              >
                Start Game
              </button>
            )}

            {isHostEffective && effectivePlayers.length < 2 && (
              <div style={styles.waitingText}>
                Waiting for more players (need at least 2)
              </div>
            )}
          </div>
        </div>
      </div>
    )
  }

  return (
    <div style={styles.container}>
      <div style={styles.card}>
        <h1 style={styles.title}>Ringo</h1>
        <p style={styles.subtitle}>Strategy Card Game</p>

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
              style={styles.createButton}
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
              style={styles.joinButton}
              disabled={!joinCode.trim() || !playerName.trim()}
            >
              Join Room
            </button>
          </div>
        </div>
      </div>
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
    marginBottom: '40px',
    fontWeight: '500'
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
    textAlign: 'left'
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
    background: '#f8f9fa',
    borderRadius: '12px',
    border: '1px solid #eee',
    transition: 'transform 0.2s',
    flexWrap: 'wrap',
    gap: '8px',
    ':hover': {
      transform: 'translateY(-2px)'
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
  }
}
