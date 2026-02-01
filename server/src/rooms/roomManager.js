import { randomUUID } from 'crypto'

class Room {
  constructor(code, hostId) {
    this.code = code
    this.hostId = hostId
    this.players = []
    this.gameState = null
    this.createdAt = Date.now()
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
    // Check if player with this name already exists (case-insensitive)
    const existingPlayer = room.players.find(
      p => (p.name || '').trim().toLowerCase() === normalizedName
    )
    if (existingPlayer) {
      // Update the player's socket ID
      const oldId = existingPlayer.id
      existingPlayer.id = playerId
      existingPlayer.disconnected = false
      
      // If they were the host, update hostId
      if (room.hostId === oldId) {
        room.hostId = playerId
      }
      return { room, oldId }
    }
    
    // If player doesn't exist, try to add them (might fail if room is full)
    // But first check if there's a player with the same ID (shouldn't happen, but be safe)
    if (room.players.find(p => p.id === playerId)) {
      return { room, oldId: null } // Already in room with this ID
    }
    
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
}

export const roomManager = new RoomManager()
