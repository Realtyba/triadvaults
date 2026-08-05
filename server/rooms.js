export class RoomManager {
  constructor() {
    this.rooms = new Map();
    this.disconnectTimeouts = new Map();
  }

  generateRoomCode() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code = '';
    for (let i = 0; i < 4; i++) {
      code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return code;
  }

  reconnectPlayer(socketId, playerName) {
    for (const [code, room] of this.rooms.entries()) {
      const existingPlayerIndex = room.players.findIndex(p => p.name === playerName);
      if (existingPlayerIndex !== -1) {
        
        // Clear grace period timeout if exists
        if (this.disconnectTimeouts.has(playerName)) {
          clearTimeout(this.disconnectTimeouts.get(playerName));
          this.disconnectTimeouts.delete(playerName);
        }

        room.players[existingPlayerIndex].id = socketId;
        if (room.hostId === room.players[existingPlayerIndex].id || room.players[existingPlayerIndex].isHost) {
           room.hostId = socketId;
        }
        return room;
      }
    }
    return null;
  }

  createRoom(hostSocketId, hostName) {
    // 1. Check if user is already in a room
    for (const [code, room] of this.rooms.entries()) {
      const existingPlayerIndex = room.players.findIndex(p => p.name === hostName);
      if (existingPlayerIndex !== -1) {
        // Update socket ID for the reconnected player
        room.players[existingPlayerIndex].id = hostSocketId;
        // If they were the host but someone else became host when they left, maybe we don't change it back?
        // Let's just update their ID and return the room.
        return { room, reconnected: true };
      }
    }

    // 2. Generate new room
    let roomCode = this.generateRoomCode();
    while (this.rooms.has(roomCode)) {
      roomCode = this.generateRoomCode();
    }

    const room = {
      code: roomCode,
      hostId: hostSocketId,
      currentLevel: 1,
      inGame: false,
      players: [
        {
          id: hostSocketId,
          name: hostName || 'HostAgent',
          index: 0,
          isHost: true,
          position: { x: 0, y: 0, z: 0 },
          rotationY: 0,
          health: 100
        }
      ]
    };

    this.rooms.set(roomCode, room);
    return { room, reconnected: false };
  }

  joinRoom(roomCode, socketId, playerName) {
    const code = roomCode.toUpperCase().trim();
    if (!this.rooms.has(code)) {
      return { error: 'El nodo sala especificado no existe.' };
    }

    const room = this.rooms.get(code);

    // 1. Check if user is already in this room
    const existingPlayerIndex = room.players.findIndex(p => p.name === playerName);
    if (existingPlayerIndex !== -1) {
      room.players[existingPlayerIndex].id = socketId;
      return { room, player: room.players[existingPlayerIndex], reconnected: true };
    }

    if (room.players.length >= 3) {
      return { error: 'La sala está completa (Máximo 3 agentes).' };
    }

    const playerIndex = room.players.length;
    const newPlayer = {
      id: socketId,
      name: playerName || `Agente_0${playerIndex + 1}`,
      index: playerIndex,
      isHost: false,
      position: { x: 0, y: 0, z: 0 },
      rotationY: 0,
      health: 100
    };

    room.players.push(newPlayer);
    return { room, player: newPlayer };
  }

  removePlayer(socketId) {
    let affectedRoom = null;

    for (const [code, room] of this.rooms.entries()) {
      const idx = room.players.findIndex(p => p.id === socketId);
      if (idx !== -1) {
        const playerName = room.players[idx].name;
        room.players.splice(idx, 1);
        affectedRoom = room;

        if (room.players.length === 0) {
          this.rooms.delete(code);
        } else if (room.hostId === socketId) {
          // Reassign host
          room.hostId = room.players[0].id;
          room.players[0].isHost = true;
        }
        break;
      }
    }

    return affectedRoom;
  }

  schedulePlayerRemoval(socketId, playerName, onRemovedCallback) {
    // Clear any existing
    if (this.disconnectTimeouts.has(playerName)) {
      clearTimeout(this.disconnectTimeouts.get(playerName));
    }
    
    const timeoutId = setTimeout(() => {
      this.disconnectTimeouts.delete(playerName);
      
      // Before removing, ensure the current socketId matches the old one.
      // If they reconnected, their socketId in the room would be different!
      let shouldRemove = false;
      for (const [code, room] of this.rooms.entries()) {
        const p = room.players.find(p => p.name === playerName);
        if (p && p.id === socketId) {
          shouldRemove = true;
          break;
        }
      }
      
      if (shouldRemove) {
        const affectedRoom = this.removePlayer(socketId);
        if (onRemovedCallback) onRemovedCallback(affectedRoom);
      }
    }, 15000); // 15 seconds grace period
    
    this.disconnectTimeouts.set(playerName, timeoutId);
  }

  getRoom(roomCode) {
    return this.rooms.get(roomCode.toUpperCase().trim());
  }

  getPublicRooms() {
    const publicRooms = [];
    for (const [code, room] of this.rooms.entries()) {
      if (!room.inGame && room.players.length < 3) {
        publicRooms.push({
          code: room.code,
          hostName: room.players[0].name,
          currentLevel: room.currentLevel,
          playersCount: room.players.length
        });
      }
    }
    return publicRooms;
  }
}
