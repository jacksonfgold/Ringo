import { useState, useEffect } from 'react'
import { useSocket } from './hooks/useSocket'
import RoomLobby from './components/RoomLobby'
import GameBoard from './components/GameBoard'

function App() {
  const { socket, connected, gameState, roomPlayers, roomCode, roomHostId, setRoomCode, setPlayerName, clearSavedState, setGameState, roomClosedError, setRoomClosedError } = useSocket()
  const [connectionTimeout, setConnectionTimeout] = useState(false)
  const [showGame, setShowGame] = useState(false)

  useEffect(() => {
    // Show game while playing or if game just ended
    if (gameState?.status === 'PLAYING' || gameState?.status === 'GAME_OVER') {
      setShowGame(true)
    } else {
      // Hide game when status is not PLAYING or GAME_OVER
      // But don't clear room data - user should stay in lobby
      setShowGame(false)
    }
  }, [gameState])

  const handleGoHome = () => {
    setShowGame(false)
    // Clear gameState when returning to lobby so the winning screen doesn't persist
    setGameState(null)
  }

  useEffect(() => {
    const timer = setTimeout(() => {
      if (!connected) {
        setConnectionTimeout(true)
      }
    }, 5000)

    return () => clearTimeout(timer)
  }, [connected])

  if (!connected) {
    return (
      <div style={{ 
        display: 'flex', 
        flexDirection: 'column',
        justifyContent: 'center', 
        alignItems: 'center', 
        minHeight: '100vh',
        color: 'white',
        fontSize: '18px',
        gap: '16px'
      }}>
        <div>Connecting to server...</div>
        {connectionTimeout && (
          <div style={{ fontSize: '14px', color: '#ffcccc', textAlign: 'center', maxWidth: '400px', padding: '0 20px' }}>
            Connection taking longer than expected. Make sure the server is running on port 3001.
            <br />
            <button 
              onClick={() => window.location.reload()} 
              style={{ 
                marginTop: '12px', 
                padding: '8px 16px', 
                background: 'white', 
                color: '#667eea', 
                border: 'none', 
                borderRadius: '4px',
                cursor: 'pointer',
                fontWeight: '600'
              }}
            >
              Retry
            </button>
          </div>
        )}
      </div>
    )
  }

  if (showGame && (gameState?.status === 'PLAYING' || gameState?.status === 'GAME_OVER')) {
    return <GameBoard socket={socket} gameState={gameState} roomCode={roomCode} roomPlayers={roomPlayers} onGoHome={handleGoHome} />
  }

  return <RoomLobby socket={socket} gameState={gameState} roomCode={roomCode} roomPlayers={roomPlayers} roomHostId={roomHostId} setRoomCode={setRoomCode} setPlayerName={setPlayerName} clearSavedState={clearSavedState} setGameState={setGameState} roomClosedError={roomClosedError} setRoomClosedError={setRoomClosedError} />
}

export default App
