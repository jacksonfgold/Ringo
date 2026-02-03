import { randomUUID } from 'crypto'

class Room {
  constructor(code, hostId) {
    this.code = code
    this.hostId = hostId
    this.players = []
    this.gameState = null
    this.settings = {
      handSize: null,
      turnTimer: 0,
      autoStart: false,
      allowRINGO: true,
      spectatorMode: false
    }
    this.createdAt = Date.now()
    this.lastActivity = Date.now() // Track last activity for cleanup
  }
  
  updateActivity() {
    this.lastActivity = Date.now()
  }
  
  isInactive(timeoutMs) {
    return Date.now() - this.lastActivity > timeoutMs
  }

  addPlayer(playerId, playerName) {
    if (this.players.length >= 5) {
      throw new Error('Room is full (max 5 players)')
    }
    if (this.players.find(p => p.id === playerId)) {
      throw new Error('Player already in room')
    }
    this.players.push({ id: playerId, name: playerName || `Player ${this.players.length + 1}`, disconnected: false, wins: 0 })
    return this.players
  }

  removePlayer(playerId) {
    this.players = this.players.filter(p => p.id !== playerId)
    if (this.hostId === playerId && this.players.length > 0) {
      this.hostId = this.players[0].id
    }
    return this.players
  }

  getPlayer(playerId) {
    return this.players.find(p => p.id === playerId)
  }

  isEmpty() {
    return this.players.length === 0
  }
}

class RoomManager {
  constructor() {
    this.rooms = new Map()
  }

  generateRoomCode() {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
    let code
    do {
      code = ''
      for (let i = 0; i < 6; i++) {
        code += chars[Math.floor(Math.random() * chars.length)]
      }
    } while (this.rooms.has(code))
    return code
  }

  createRoom(hostId, hostName) {
    const code = this.generateRoomCode()
    const room = new Room(code, hostId)
    room.addPlayer(hostId, hostName)
    this.rooms.set(code, room)
    return room
  }

  getRoom(code) {
    return this.rooms.get(code)
  }

  joinRoom(code, playerId, playerName) {
    const room = this.rooms.get(code)
    if (!room) {
      throw new Error('Room not found')
    }
    room.addPlayer(playerId, playerName)
    return room
  }

  rejoinRoom(code, playerId, playerName) {
    const room = this.rooms.get(code)
    if (!room) {
      throw new Error('Room not found')
    }

    const normalizedName = (playerName || '').trim().toLowerCase()
    const trimmedName = (playerName || '').trim()
    
    // First check if there's a player with the same socket ID (reconnecting)
    const existingById = room.players.find(p => p.id === playerId)
    if (existingById) {
      // Update name if it changed
      if (existingById.name !== trimmedName) {
        existingById.name = trimmedName
      }
      existingById.disconnected = false
      return { room, oldId: null }
    }
    
    // Check if player with this name already exists (case-insensitive)
    const existingPlayer = room.players.find(
      p => (p.name || '').trim().toLowerCase() === normalizedName
    )
    if (existingPlayer) {
      // Update the player's socket ID and name
      const oldId = existingPlayer.id
      existingPlayer.id = playerId
      existingPlayer.name = trimmedName // Update name in case it changed
      existingPlayer.disconnected = false
      
      // If they were the host, update hostId
      if (room.hostId === oldId) {
        room.hostId = playerId
      }
      return { room, oldId }
    }
    
    // If player doesn't exist, try to add them (might fail if room is full)
    room.addPlayer(playerId, playerName)
    return { room, oldId: null }
  }

  leaveRoom(code, playerId) {
    const room = this.rooms.get(code)
    if (!room) {
      return null
    }
    room.removePlayer(playerId)
    if (room.isEmpty()) {
      this.rooms.delete(code)
      return null
    }
    return room
  }

  cleanupEmptyRooms() {
    for (const [code, room] of this.rooms.entries()) {
      if (room.isEmpty()) {
        this.rooms.delete(code)
      }
    }
  }
  
  cleanupInactiveRooms(inactivityTimeoutMs = 30 * 60 * 1000) { // Default: 30 minutes
    const now = Date.now()
    const roomsToClose = []
    
    for (const [code, room] of this.rooms.entries()) {
      // Close room if:
      // 1. Empty (no players)
      // 2. Inactive for too long (no activity in timeout period)
      // 3. All players are disconnected for more than 5 minutes
      const allDisconnected = room.players.length > 0 && 
        room.players.every(p => p.disconnected) &&
        (now - room.lastActivity > 5 * 60 * 1000) // 5 minutes with all disconnected
      
      if (room.isEmpty() || room.isInactive(inactivityTimeoutMs) || allDisconnected) {
        roomsToClose.push({ code, room })
      }
    }
    
    return roomsToClose
  }
  
  closeRoom(code) {
    const room = this.rooms.get(code)
    if (room) {
      this.rooms.delete(code)
      return room
    }
    return null
  }
}

export const roomManager = new RoomManager()
