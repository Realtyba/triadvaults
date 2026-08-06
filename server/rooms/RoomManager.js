import {
  MAX_PLAYERS,
  MAX_HEALTH,
  DISCONNECT_GRACE_MS,
  RESPAWN_SHIELD_MS,
  createPlayer,
  createRoomState,
  isJoinable,
  toRoomSummary
} from './roomState.js';

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const CODE_LENGTH = 4;

/**
 * Fuente única de verdad del estado multijugador.
 *
 * Todas las búsquedas son por `uid`. El `socketId` es un dato mutable del jugador,
 * nunca su clave — eso es lo que permite que la reconexión no rompa nada.
 */
export class RoomManager {
  constructor() {
    /** @type {Map<string, object>} code -> room */
    this.rooms = new Map();
    /** @type {Map<string, NodeJS.Timeout>} uid -> timeout de expulsión */
    this.disconnectTimers = new Map();
    /** uids que abandonaron a propósito: no deben ser reenganchados al reconectar */
    this.intentionalLeaves = new Set();
  }

  // ---------------------------------------------------------------- lookup

  getRoom(code) {
    if (!code) return null;
    return this.rooms.get(String(code).toUpperCase().trim()) || null;
  }

  /** Sala en la que figura este uid, si alguna. */
  findRoomByUid(uid) {
    for (const room of this.rooms.values()) {
      if (room.players.some(p => p.uid === uid)) return room;
    }
    return null;
  }

  findPlayer(room, uid) {
    return room ? room.players.find(p => p.uid === uid) || null : null;
  }

  isHost(room, uid) {
    return !!room && room.hostUid === uid;
  }

  generateRoomCode() {
    let code;
    do {
      code = '';
      for (let i = 0; i < CODE_LENGTH; i++) {
        code += CODE_ALPHABET.charAt(Math.floor(Math.random() * CODE_ALPHABET.length));
      }
    } while (this.rooms.has(code));
    return code;
  }

  // ------------------------------------------------------- ciclo de sala

  createRoom({ uid, name, socketId, level = 1 }) {
    // Un usuario solo puede estar en una sala a la vez.
    const existing = this.findRoomByUid(uid);
    if (existing) {
      this.attachSocket(existing, uid, socketId);
      return { room: existing, reconnected: true };
    }

    const host = createPlayer({ uid, name, socketId, index: 0, isHost: true });
    const room = createRoomState({ code: this.generateRoomCode(), host });
    room.currentLevel = level;

    this.intentionalLeaves.delete(uid);
    this.rooms.set(room.code, room);
    return { room, reconnected: false };
  }

  joinRoom({ code, uid, name, socketId }) {
    const room = this.getRoom(code);
    if (!room) return { error: 'El nodo sala especificado no existe.' };

    // ¿Ya es miembro? Entonces esto es una reconexión, no un alta.
    const member = this.findPlayer(room, uid);
    if (member) {
      this.attachSocket(room, uid, socketId);
      return { room, player: member, reconnected: true };
    }

    // Salir de cualquier sala anterior antes de entrar a esta (evita membresías dobles).
    const previous = this.findRoomByUid(uid);
    if (previous) this.removePlayer(previous.code, uid);

    if (!isJoinable(room)) {
      return { error: `La sala está completa (Máximo ${MAX_PLAYERS} agentes).` };
    }

    const player = createPlayer({
      uid,
      name,
      socketId,
      index: this.nextFreeIndex(room),
      isHost: false
    });
    room.players.push(player);
    this.intentionalLeaves.delete(uid);

    return { room, player, reconnected: false };
  }

  /** Índice de color/spawn libre más bajo, para no repetir color al entrar y salir. */
  nextFreeIndex(room) {
    const taken = new Set(room.players.map(p => p.index));
    for (let i = 0; i < MAX_PLAYERS; i++) {
      if (!taken.has(i)) return i;
    }
    return room.players.length;
  }

  /**
   * Reengancha a un usuario que vuelve a conectar.
   * Solo procede si no abandonó a propósito y la sala sigue viva.
   */
  reconnectPlayer({ uid, socketId }) {
    if (this.intentionalLeaves.has(uid)) return null;

    const room = this.findRoomByUid(uid);
    if (!room) return null;

    this.attachSocket(room, uid, socketId);
    return room;
  }

  /** Asocia un socket nuevo a un jugador existente y cancela su expulsión pendiente. */
  attachSocket(room, uid, socketId) {
    const player = this.findPlayer(room, uid);
    if (!player) return null;

    this.cancelRemoval(uid);
    player.socketId = socketId;
    player.connected = true;
    player.disconnectedAt = null;
    return player;
  }

  removePlayer(code, uid) {
    const room = this.getRoom(code);
    if (!room) return null;

    const idx = room.players.findIndex(p => p.uid === uid);
    if (idx === -1) return null;

    room.players.splice(idx, 1);
    this.cancelRemoval(uid);

    if (room.players.length === 0) {
      this.rooms.delete(room.code);
      return { room, deleted: true };
    }

    if (room.hostUid === uid) this.reassignHost(room);
    return { room, deleted: false };
  }

  /** El host anterior siempre pierde el flag: si no, acaban dos jugadores con isHost. */
  reassignHost(room) {
    const next = room.players.find(p => p.connected) || room.players[0];
    room.players.forEach(p => { p.isHost = p.uid === next.uid; });
    room.hostUid = next.uid;
    return next;
  }

  leaveRoom(uid) {
    const room = this.findRoomByUid(uid);
    if (!room) return null;

    this.intentionalLeaves.add(uid);
    const code = room.code;
    const result = this.removePlayer(code, uid);
    return result ? { ...result, code } : null;
  }

  // ---------------------------------------------------- desconexión suave

  /**
   * Marca al jugador como desconectado de inmediato (para que la sala lo vea)
   * y programa su expulsión al agotarse el periodo de gracia.
   */
  markDisconnected(uid, onExpired) {
    const room = this.findRoomByUid(uid);
    if (!room) return null;

    const player = this.findPlayer(room, uid);
    if (!player) return null;

    player.connected = false;
    player.disconnectedAt = Date.now();

    // Si el host se cae, la autoridad pasa ya a otro para que el fantasma siga vivo.
    if (room.hostUid === uid && room.players.some(p => p.connected)) {
      this.reassignHost(room);
    }

    this.cancelRemoval(uid);
    this.disconnectTimers.set(
      uid,
      setTimeout(() => {
        this.disconnectTimers.delete(uid);

        // Puede haber vuelto (y reconectado) o haber salido ya por otra vía.
        const current = this.findRoomByUid(uid);
        const stale = this.findPlayer(current, uid);
        if (!stale || stale.connected) return;

        const code = current.code;
        const result = this.removePlayer(code, uid);
        if (result && onExpired) onExpired({ ...result, code });
      }, DISCONNECT_GRACE_MS)
    );

    return room;
  }

  cancelRemoval(uid) {
    const timer = this.disconnectTimers.get(uid);
    if (timer) {
      clearTimeout(timer);
      this.disconnectTimers.delete(uid);
    }
  }

  // ------------------------------------------------------ estado de juego

  startGame(room) {
    room.inGame = true;
    room.seedOffset = 0;
    room.players.forEach(p => {
      p.health = MAX_HEALTH;
      p.alive = true;
      p.shieldedUntil = 0;
      p.levelDamageTaken = 0;
      p.levelDeaths = 0;
    });
    return room;
  }

  advanceLevel(room) {
    room.currentLevel += 1;
    room.seed = Math.floor(Math.random() * 1_000_000);
    room.seedOffset = 0;
    room.players.forEach(p => {
      p.health = MAX_HEALTH;
      p.alive = true;
      p.shieldedUntil = 0;
      p.levelDamageTaken = 0;
      p.levelDeaths = 0;
    });
    return room;
  }

  regenerateLevel(room) {
    room.seedOffset += 1;
    return room;
  }

  updatePlayerTransform(room, uid, position, rotationY) {
    const player = this.findPlayer(room, uid);
    if (!player) return null;
    if (position) player.position = position;
    if (typeof rotationY === 'number') player.rotationY = rotationY;
    return player;
  }

  /**
   * Aplica daño de forma autoritativa.
   * @returns el jugador, o null si el golpe no es válido (muerto o protegido).
   */
  applyDamage(room, targetUid, amount) {
    const player = this.findPlayer(room, targetUid);
    if (!player || !player.alive) return null;
    if (Date.now() < player.shieldedUntil) return null;

    const damage = Math.max(0, Math.min(MAX_HEALTH, Number(amount) || 0));
    player.health = Math.max(0, player.health - damage);
    player.alive = player.health > 0;

    // Lo consultan los logros al superar el nivel: "sin recibir un golpe" y
    // "tras caer varias veces" no se pueden deducir del estado final.
    player.levelDamageTaken += damage;
    if (!player.alive) player.levelDeaths += 1;

    return player;
  }

  respawnPlayer(room, uid) {
    const player = this.findPlayer(room, uid);
    if (!player) return null;
    player.health = MAX_HEALTH;
    player.alive = true;
    player.shieldedUntil = Date.now() + RESPAWN_SHIELD_MS;
    return player;
  }

  listRooms() {
    return Array.from(this.rooms.values()).map(toRoomSummary);
  }
}
