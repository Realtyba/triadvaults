import { io } from 'socket.io-client';
import { EVENTS } from '../../shared/events.js';
import { socketBaseUrl } from './endpoints.js';
import { session } from './session.js';

/**
 * Transporte en tiempo real.
 *
 * La identidad del jugador es `uid` (id de usuario), no `socket.id`: el socket
 * cambia en cada reconexión, y ese era el motivo de que tras reconectar el
 * personaje dejase de responder y el fantasma se quedase congelado.
 */
export class SocketClient {
  constructor(baseUrl = socketBaseUrl()) {
    this.baseUrl = baseUrl;
    this.currentRoom = null;
    this.uid = null;
    this.listeners = new Map();

    // Build empaquetada sin servidor configurado: se construye el socket igual —hay
    // mucho código que llama a `emit` sin preguntar— pero no se conecta nunca, en
    // lugar de dejarlo reintentando contra "file://" para siempre.
    this.isEnabled = baseUrl !== null;

    this.socket = io(baseUrl || undefined, {
      autoConnect: this.isEnabled && session.isValid(),
      transports: ['websocket', 'polling'],
      auth: { token: session.getToken() },
      reconnection: true,
      reconnectionAttempts: 12,
      reconnectionDelay: 800,
      reconnectionDelayMax: 5000
    });

    this.syncUidFromSession();
    this.registerCoreEvents();
  }

  syncUidFromSession() {
    const user = session.getUser();
    this.uid = user ? String(user.id) : null;
  }

  connectWithToken(token) {
    if (!this.isEnabled) return;
    this.syncUidFromSession();
    this.socket.auth = { token };
    if (this.socket.connected) this.socket.disconnect();
    this.socket.connect();
  }

  disconnect() {
    this.currentRoom = null;
    this.socket.disconnect();
  }

  // ------------------------------------------------------------ eventos

  /** Registro con deduplicación: llamar dos veces no duplica el handler. */
  on(event, handler) {
    if (this.listeners.has(event)) {
      this.socket.off(event, this.listeners.get(event));
    }
    this.listeners.set(event, handler);
    this.socket.on(event, handler);
  }

  emit(event, payload, callback) {
    this.socket.emit(event, payload, callback);
  }

  registerCoreEvents() {
    // El servidor es la fuente de verdad de la sala: se cachea cada actualización.
    this.socket.on(EVENTS.ROOM_UPDATED, room => {
      this.currentRoom = room;
    });
    this.socket.on(EVENTS.RECONNECTED_TO_ROOM, ({ room, uid }) => {
      this.currentRoom = room;
      if (uid) this.uid = String(uid);
    });
  }

  // ------------------------------------------------------------- estado

  get isConnected() {
    return this.socket.connected;
  }

  get roomCode() {
    return this.currentRoom ? this.currentRoom.code : null;
  }

  /** Jugador local dentro de la sala actual, resuelto por uid en cada consulta. */
  get localPlayer() {
    if (!this.currentRoom || !this.uid) return null;
    return this.currentRoom.players.find(p => String(p.uid) === String(this.uid)) || null;
  }

  /** Autoridad de simulación: sin sala, el jugador en solitario también la tiene. */
  get isHost() {
    if (!this.currentRoom) return true;
    return String(this.currentRoom.hostUid) === String(this.uid);
  }

  // -------------------------------------------------------------- salas

  /** Guarda la sala y el uid que devuelve el servidor si la operación salió bien. */
  adoptRoom(response) {
    if (response && response.success) {
      this.currentRoom = response.room;
      this.uid = String(response.uid);
    }
    return response;
  }

  createRoom(callback) {
    this.emit(EVENTS.CREATE_ROOM, {}, response => callback(this.adoptRoom(response)));
  }

  joinRoom(roomCode, callback) {
    this.emit(EVENTS.JOIN_ROOM, { roomCode }, response => callback(this.adoptRoom(response)));
  }

  leaveRoom() {
    this.emit(EVENTS.LEAVE_ROOM, {});
    this.currentRoom = null;
  }

  fetchRooms(callback) {
    this.emit(EVENTS.GET_ROOMS, {}, rooms => callback(rooms || []));
  }

  startGame() {
    if (this.roomCode) this.emit(EVENTS.START_GAME, { roomCode: this.roomCode });
  }

  // ------------------------------------------------------------ partida

  sendMove(position, rotationY) {
    if (!this.roomCode || !this.isConnected) return;
    this.emit(EVENTS.PLAYER_MOVE, { roomCode: this.roomCode, position, rotationY });
  }

  /**
   * Estado de todos los fantasmas en un solo paquete.
   *
   * Un evento por fantasma habría triplicado los envíos a 15 Hz sin ganar nada: el
   * host los simula todos en el mismo fotograma, así que viajan juntos.
   */
  sendGhostStates(ghosts = []) {
    if (!this.roomCode || !this.isHost || !this.isConnected || ghosts.length === 0) return;

    this.emit(EVENTS.GHOST_STATE, {
      roomCode: this.roomCode,
      ghosts: ghosts.map(ghost => ({
        id: ghost.index,
        position: {
          x: ghost.mesh.position.x,
          y: ghost.mesh.position.y,
          z: ghost.mesh.position.z
        },
        targetUid: ghost.targetUid || null,
        // Lo único que no se deduce de la posición: si lo que se ve venir es un paseo o
        // una carga. La animación, el borde encendido y la disolución dependen de esto,
        // y tienen que coincidir en las tres pantallas. Ver `GHOST_STATES`.
        state: ghost.brain.state
      }))
    });
  }

  sendGhostHit(targetUid, amount) {
    if (!this.roomCode || !this.isHost) return;
    this.emit(EVENTS.GHOST_HIT, { roomCode: this.roomCode, targetUid, amount });
  }

  requestRespawn() {
    if (!this.roomCode) return;
    this.emit(EVENTS.REQUEST_RESPAWN, { roomCode: this.roomCode });
  }

  /**
   * Lo señala quien cruza la salida, sea o no el host; el servidor lo procesa una vez.
   *
   * `level` es lo que permite descartar los duplicados: llegan hasta tres avisos
   * del mismo nivel —uno por agente— y el servidor solo atiende el que coincide
   * con el nivel que la sala está jugando en ese momento.
   */
  notifyLevelComplete(timeSpent = 0, level = null) {
    if (!this.roomCode) return;
    this.emit(EVENTS.LEVEL_COMPLETE, { roomCode: this.roomCode, timeSpent, level });
  }

  requestRegenerate() {
    if (!this.roomCode || !this.isHost) return;
    this.emit(EVENTS.REGENERATE_LEVEL, { roomCode: this.roomCode });
  }
}
