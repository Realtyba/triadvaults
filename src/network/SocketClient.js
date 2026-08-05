import { io } from 'socket.io-client';

export class SocketClient {
  constructor() {
    this.baseUrl = import.meta.env.VITE_API_URL || 
      (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
        ? 'http://localhost:3001'
        : window.location.origin);

    this.socket = io(this.baseUrl, {
      autoConnect: true,
      transports: ['websocket', 'polling']
    });

    this.currentRoom = null;
    this.localPlayer = null;
    this.authenticatedUser = null;
  }

  async register(username, email, password) {
    try {
      const res = await fetch(`${this.baseUrl}/api/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, email, password })
      });
      const data = await res.json();
      if (data.success) {
        this.authenticatedUser = data.user;
      }
      return data;
    } catch (e) {
      return { success: false, error: 'Error de conexión con el servidor.' };
    }
  }

  async login(identifier, password) {
    try {
      const res = await fetch(`${this.baseUrl}/api/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identifier, password })
      });
      const data = await res.json();
      if (data.success) {
        this.authenticatedUser = data.user;
      }
      return data;
    } catch (e) {
      return { success: false, error: 'Error de conexión con el servidor.' };
    }
  }

  async requestReset(email) {
    try {
      const res = await fetch(`${this.baseUrl}/api/request-reset`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email })
      });
      return await res.json();
    } catch (e) {
      return { success: false, error: 'Error al solicitar el PIN de recuperación.' };
    }
  }

  async resetPassword(email, resetCode, newPassword) {
    try {
      const res = await fetch(`${this.baseUrl}/api/reset-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, resetCode, newPassword })
      });
      return await res.json();
    } catch (e) {
      return { success: false, error: 'Error al restablecer la contraseña.' };
    }
  }

  createRoom(playerName, level = 1, callback) {
    this.socket.emit('create_room', { playerName, level }, (response) => {
      if (response.success) {
        this.currentRoom = response.room;
        this.localPlayer = response.room.players[0];
      }
      callback(response);
    });
  }

  joinRoom(roomCode, playerName, callback) {
    this.socket.emit('join_room', { roomCode, playerName }, (response) => {
      if (response.success) {
        this.currentRoom = response.room;
        this.localPlayer = response.player;
      }
      callback(response);
    });
  }

  startGame() {
    if (this.currentRoom) {
      this.socket.emit('start_game', { roomCode: this.currentRoom.code });
    }
  }

  leaveRoom() {
    this.socket.emit('leave_room');
    this.currentRoom = null;
    this.localPlayer = null;
  }

  getPublicRooms(callback) {
    this.socket.emit('get_public_rooms', callback);
  }

  onPublicRoomsUpdated(callback) {
    this.socket.on('public_rooms_updated', callback);
  }

  sendMove(position, rotationY, health = 100) {
    if (this.currentRoom) {
      this.socket.emit('player_move', {
        roomCode: this.currentRoom.code,
        position,
        rotationY,
        health
      });
    }
  }

  sendGhostMove(position) {
    if (this.currentRoom && this.localPlayer && this.localPlayer.isHost) {
      this.socket.emit('ghost_move', {
        roomCode: this.currentRoom.code,
        position
      });
    }
  }

  sendDamage(playerId, health) {
    if (this.currentRoom) {
      this.socket.emit('player_damaged', {
        roomCode: this.currentRoom.code,
        playerId,
        health
      });
    }
  }

  notifyLevelComplete() {
    if (this.currentRoom && this.localPlayer && this.localPlayer.isHost) {
      const username = this.authenticatedUser ? this.authenticatedUser.username : this.localPlayer.name;
      this.socket.emit('level_complete', {
        roomCode: this.currentRoom.code,
        username
      });
    }
  }

  onRoomUpdated(callback) {
    this.socket.on('room_updated', (room) => {
      this.currentRoom = room;
      callback(room);
    });
  }

  onGameStarted(callback) {
    this.socket.on('game_started', callback);
  }

  onPlayerMoved(callback) {
    this.socket.on('player_moved', callback);
  }

  onGhostMoved(callback) {
    this.socket.on('ghost_moved', callback);
  }

  onUpdateHealth(callback) {
    this.socket.on('update_player_health', callback);
  }

  onNextLevel(callback) {
    this.socket.on('load_next_level', callback);
  }

  onUserProgressUpdated(callback) {
    this.socket.on('user_progress_updated', (data) => {
      if (this.authenticatedUser) {
        this.authenticatedUser.maxLevelReached = data.maxLevelReached;
        this.authenticatedUser.totalPuzzlesSolved = data.totalPuzzlesSolved;
      }
      if (callback) callback(data);
    });
  }
}
