import { useState, useEffect } from 'react'
import { useSocket } from './hooks/useSocket'
import RoomLobby from './components/RoomLobby'
import GameBoard from './components/GameBoard'
import { ToastContainer } from './components/Toast'

function App() {
  const { socket, connected, gameState, roomPlayers, roomCode, roomHostId, setRoomCode, setPlayerName, clearSavedState, clearLocalGameState, setGameState, roomClosedError, setRoomClosedError, signalReturnToLobby, isSpectator, setIsSpectator, setRoomSpectators, roomSpectators, roomSettings, turnTimer } = useSocket()
  const [connectionTimeout, setConnectionTimeout] = useState(false)
  const [showGame, setShowGame] = useState(false)
  const [returningToLobby, setReturningToLobby] = useState(false)

  useEffect(() => {
    // When we have an active game (playing or just ended), always show the game and clear
    // "returning to lobby" so that if a new game starts while someone is in the lobby,
    // they get brought into the new game.
    if (gameState?.status === 'PLAYING' || gameState?.status === 'GAME_OVER') {
      setReturningToLobby(false)
      setShowGame(true)
      return
    }
    // Otherwise show lobby (e.g. user clicked Return to Lobby or no game in progress)
    setShowGame(false)
  }, [gameState, returningToLobby])

  const handleGoHome = () => {
    setReturningToLobby(true)
    setShowGame(false)
    if (signalReturnToLobby) signalReturnToLobby()
    setGameState(null)
    if (clearLocalGameState) clearLocalGameState()
    setTimeout(() => setReturningToLobby(false), 600)
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

  // Only show game if showGame is true AND we're not returning to lobby
  if (showGame && !returningToLobby && (gameState?.status === 'PLAYING' || gameState?.status === 'GAME_OVER')) {
    return <GameBoard socket={socket} gameState={gameState} roomCode={roomCode} roomPlayers={roomPlayers} onGoHome={handleGoHome} isSpectator={isSpectator} turnTimer={turnTimer} />
  }

  return (
    <>
      <RoomLobby socket={socket} gameState={gameState} roomCode={roomCode} roomPlayers={roomPlayers} roomHostId={roomHostId} roomSettings={roomSettings} setRoomCode={setRoomCode} setPlayerName={setPlayerName} clearSavedState={clearSavedState} setGameState={setGameState} roomClosedError={roomClosedError} setRoomClosedError={setRoomClosedError} setIsSpectator={setIsSpectator} setRoomSpectators={setRoomSpectators} roomSpectators={roomSpectators} />
      <ToastContainer />
    </>
  )
}

export default App
