import { useState, useEffect, useRef } from 'react'
import { io } from 'socket.io-client'

export function useSocket() {
  const [socket, setSocket] = useState(null)
  const [connected, setConnected] = useState(false)
  const [gameState, setGameState] = useState(null)
  const [roomPlayers, setRoomPlayers] = useState([])
  const [roomCode, setRoomCode] = useState(null)
  const [playerName, setPlayerName] = useState(null)
  const [roomHostId, setRoomHostId] = useState(null)
  const [roomClosedError, setRoomClosedError] = useState(null)
  const socketRef = useRef(null)
  const hasAttemptedRejoin = useRef(false)
  const hasLoadedFromStorage = useRef(false)

  // Load saved state from localStorage ONCE on mount
  useEffect(() => {
    const savedRoomCode = localStorage.getItem('ringo_roomCode')
    const savedPlayerName = localStorage.getItem('ringo_playerName')
    const savedGameState = localStorage.getItem('ringo_gameState')
    
    console.log('[useSocket] Loading from localStorage:', { savedRoomCode, savedPlayerName, hasSavedGameState: !!savedGameState })
    
    if (savedRoomCode) {
      setRoomCode(savedRoomCode)
    }
    if (savedPlayerName) {
      setPlayerName(savedPlayerName)
    }
    if (savedGameState) {
      try {
        setGameState(JSON.parse(savedGameState))
      } catch (e) {
        console.error('Error parsing saved game state:', e)
      }
    }
    
    // Mark as loaded AFTER setting state
    hasLoadedFromStorage.current = true
  }, [])

  // Save state to localStorage whenever it changes (but only after initial load)
  useEffect(() => {
    if (!hasLoadedFromStorage.current) return // Don't save during initial load
    
    if (roomCode) {
      console.log('[useSocket] Saving roomCode to localStorage:', roomCode)
      localStorage.setItem('ringo_roomCode', roomCode)
    }
    // Don't remove on null - only remove via clearSavedState
  }, [roomCode])

  useEffect(() => {
    if (!hasLoadedFromStorage.current) return
    
    if (playerName) {
      console.log('[useSocket] Saving playerName to localStorage:', playerName)
      localStorage.setItem('ringo_playerName', playerName)
    }
  }, [playerName])

  useEffect(() => {
    if (!hasLoadedFromStorage.current) return
    
    if (gameState) {
      // Only save game state if it's actually in progress (not a stale state)
      // Don't save GAME_OVER states as they'll be replaced by new games
      if (gameState.status === 'PLAYING') {
        console.log('[useSocket] Saving gameState to localStorage')
        localStorage.setItem('ringo_gameState', JSON.stringify(gameState))
      } else if (gameState.status === 'GAME_OVER') {
        // Don't clear localStorage on GAME_OVER - keep it so lobby can show winner
        // Only clear when a new game starts (handled by gameStateReset)
        console.log('[useSocket] Game over - keeping gameState for lobby display')
      }
    } else {
      // Only clear localStorage if we're actually leaving the room
      // Don't clear just because gameState is temporarily null
      if (!roomCode) {
        localStorage.removeItem('ringo_gameState')
      }
    }
  }, [gameState, roomCode])

  useEffect(() => {
    const serverUrl = import.meta.env.VITE_SERVER_URL || 'http://localhost:3001'
    console.log('Environment check:', {
      VITE_SERVER_URL: import.meta.env.VITE_SERVER_URL,
      allEnv: import.meta.env,
      serverUrl
    })
    console.log('Attempting to connect to:', serverUrl)
    
    const newSocket = io(serverUrl, {
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionAttempts: 5
    })

    socketRef.current = newSocket
    setSocket(newSocket)

    newSocket.on('connect', () => {
      console.log('Connected to server')
      setConnected(true)
      // Allow auto-rejoin on refresh if we have saved state
    })

    newSocket.on('connect_error', (error) => {
      console.error('Connection error:', error)
      console.error('Make sure the server is running on', serverUrl)
    })

    newSocket.on('disconnect', (reason) => {
      console.log('Disconnected from server:', reason)
      setConnected(false)
      hasAttemptedRejoin.current = false
      // Don't reset gameState on disconnect - allow reconnection
    })

    newSocket.on('reconnect', (attemptNumber) => {
      console.log('Reconnected to server after', attemptNumber, 'attempts')
      setConnected(true)
    })

    newSocket.on('reconnect_error', (error) => {
      console.error('Reconnection error:', error)
    })

    newSocket.on('roomUpdate', (data) => {
      console.log('[useSocket] Room update received:', data)
      if (data.roomCode) {
        setRoomCode(data.roomCode)
      }
      // Always update players, even if empty array (to clear stale data)
      if (data.players !== undefined) {
        setRoomPlayers(data.players)
        console.log('[useSocket] Updated roomPlayers:', data.players.map(p => ({ id: p.id, name: p.name, isBot: p.isBot })))
      }
      if (data.hostId !== undefined) {
        setRoomHostId(data.hostId)
      }
    })

    newSocket.on('roomClosed', (data) => {
      console.log('[useSocket] Room closed event received:', data)
      // Clear all room-related state
      clearSavedState()
      setRoomClosedError(data.reason || 'Room has been closed')
      // Clear game state
      setGameState(null)
    })

    newSocket.on('gameStateReset', () => {
      console.log('[useSocket] Game state reset signal received - clearing old state')
      // Clear game state and localStorage before new game starts
      setGameState(null)
      localStorage.removeItem('ringo_gameState')
    })

    newSocket.on('gameStateUpdate', (data) => {
      console.log('[useSocket] Game state update received:', data)
      console.log('[useSocket] Current socket ID:', newSocket.id)
      if (data.gameState) {
        console.log('[useSocket] Players in game state:', data.gameState.players?.map(p => ({ id: p.id, name: p.name, hasHand: !!p.hand })))
        console.log('[useSocket] Current player index:', data.gameState.currentPlayerIndex)
        console.log('[useSocket] My player index:', data.gameState.players?.findIndex(p => p.id === newSocket.id))
        console.log('[useSocket] Is my turn?', data.gameState.currentPlayerIndex === data.gameState.players?.findIndex(p => p.id === newSocket.id))
        
        // If this is a new game (status is PLAYING and isNewGame flag is set), ensure clean state
        if (data.isNewGame && data.gameState.status === 'PLAYING') {
          console.log('[useSocket] New game detected - ensuring clean state')
          // Clear any stale localStorage state
          localStorage.removeItem('ringo_gameState')
        }
        
        setGameState(data.gameState)
        if (data.gameState.hostId) {
          setRoomHostId(data.gameState.hostId)
        }
      }
    })

    newSocket.on('cardDrawn', (data) => {
      console.log('Card drawn:', data)
      // This will be handled by the GameBoard component
    })

    return () => {
      newSocket.close()
    }
  }, [])

  useEffect(() => {
    console.log('[useSocket] Auto-rejoin check:', { connected, hasSocket: !!socket, hasAttempted: hasAttemptedRejoin.current })
    
    if (!connected || !socket || hasAttemptedRejoin.current) {
      console.log('[useSocket] Skipping auto-rejoin:', { connected, hasSocket: !!socket, hasAttempted: hasAttemptedRejoin.current })
      return
    }

    const savedRoomCode = localStorage.getItem('ringo_roomCode')
    const savedPlayerName = localStorage.getItem('ringo_playerName')
    const savedGameState = localStorage.getItem('ringo_gameState')

    console.log('[useSocket] Saved state check:', { savedRoomCode, savedPlayerName, hasSavedGameState: !!savedGameState })

    if (!savedRoomCode || !savedPlayerName || !savedGameState) {
      console.log('[useSocket] Missing saved state, skipping auto-rejoin')
      return
    }

    let parsedState = null
    try {
      parsedState = JSON.parse(savedGameState)
    } catch (e) {
      console.warn('[useSocket] Failed to parse saved game state:', e)
      return
    }

    console.log('[useSocket] Parsed game state status:', parsedState?.status)

    if (!parsedState || (parsedState.status !== 'PLAYING' && parsedState.status !== 'GAME_OVER')) {
      console.log('[useSocket] Game not in progress, skipping auto-rejoin')
      return
    }

    hasAttemptedRejoin.current = true
    console.log('[useSocket] Auto-rejoin attempt:', savedRoomCode, savedPlayerName, 'socket.id:', socket.id)

    socket.emit('rejoinRoom', { roomCode: savedRoomCode, playerName: savedPlayerName }, (response) => {
      console.log('[useSocket] Auto-rejoin response:', response)
      if (response?.success) {
        setRoomCode(savedRoomCode)
        setPlayerName(savedPlayerName)
        setRoomClosedError(null)
        if (response.gameState) {
          console.log('[useSocket] Setting game state from rejoin, players:', response.gameState.players?.map(p => ({ id: p.id, name: p.name })))
          setGameState(response.gameState)
        }
      } else {
        console.warn('[useSocket] Auto-rejoin failed:', response?.error)
        // If room not found, clear state and show error
        if (response?.error === 'Room not found' || response?.error?.includes('not found')) {
          clearSavedState()
          setRoomClosedError('Room has been closed')
        }
      }
    })
  }, [connected, socket])

  const clearSavedState = () => {
    // Clear all localStorage items
    localStorage.removeItem('ringo_roomCode')
    localStorage.removeItem('ringo_playerName')
    localStorage.removeItem('ringo_gameState')
    
    // Clear all state
    setRoomCode(null)
    setPlayerName(null)
    setGameState(null)
    setRoomClosedError(null)
    setRoomPlayers([])
    setRoomHostId(null)
    
    console.log('[useSocket] Cleared all saved state and game data')
  }

  return {
    socket,
    connected,
    gameState,
    roomPlayers,
    roomCode,
    roomHostId,
    playerName,
    roomClosedError,
    setRoomCode,
    setPlayerName,
    setGameState,
    clearSavedState
  }
}
