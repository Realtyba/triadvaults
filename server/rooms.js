export class RoomManager {
  constructor() {
    this.rooms = new Map();
  }

  generateRoomCode() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code = '';
    for (let i = 0; i < 4; i++) {
      code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return code;
  }

  createRoom(hostSocketId, hostName) {
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
    return room;
  }

  joinRoom(roomCode, socketId, playerName) {
    const code = roomCode.toUpperCase().trim();
    if (!this.rooms.has(code)) {
      return { error: 'El nodo sala especificado no existe.' };
    }

    const room = this.rooms.get(code);

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
