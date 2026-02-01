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
      console.log('[useSocket] Saving gameState to localStorage')
      localStorage.setItem('ringo_gameState', JSON.stringify(gameState))
    }
  }, [gameState])

  useEffect(() => {
    const serverUrl = import.meta.env.VITE_SERVER_URL || 'http://localhost:3001'
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
      console.log('Room update:', data)
      if (data.roomCode) {
        setRoomCode(data.roomCode)
      }
      if (data.players) {
        setRoomPlayers(data.players)
      }
      if (data.hostId) {
        setRoomHostId(data.hostId)
      }
    })

    newSocket.on('gameStateUpdate', (data) => {
      console.log('[useSocket] Game state update received:', data)
      console.log('[useSocket] Current socket ID:', newSocket.id)
      if (data.gameState) {
        console.log('[useSocket] Players in game state:', data.gameState.players?.map(p => ({ id: p.id, name: p.name, hasHand: !!p.hand })))
        console.log('[useSocket] Current player index:', data.gameState.currentPlayerIndex)
        console.log('[useSocket] My player index:', data.gameState.players?.findIndex(p => p.id === newSocket.id))
        console.log('[useSocket] Is my turn?', data.gameState.currentPlayerIndex === data.gameState.players?.findIndex(p => p.id === newSocket.id))
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
        if (response.gameState) {
          console.log('[useSocket] Setting game state from rejoin, players:', response.gameState.players?.map(p => ({ id: p.id, name: p.name })))
          setGameState(response.gameState)
        }
      } else {
        console.warn('[useSocket] Auto-rejoin failed:', response?.error)
        // Don't clear saved state - user might want to try manually
      }
    })
  }, [connected, socket])

  const clearSavedState = () => {
    localStorage.removeItem('ringo_roomCode')
    localStorage.removeItem('ringo_playerName')
    localStorage.removeItem('ringo_gameState')
    setRoomCode(null)
    setPlayerName(null)
    setGameState(null)
  }

  return {
    socket,
    connected,
    gameState,
    roomPlayers,
    roomCode,
    roomHostId,
    playerName,
    setRoomCode,
    setPlayerName,
    setGameState,
    clearSavedState
  }
}
