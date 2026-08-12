import {
  MAX_PLAYERS,
  MAX_HEALTH,
  DISCONNECT_GRACE_MS,
  RESPAWN_SHIELD_MS,
  createPlayer,
  createRoomState,
  isJoinable,
  toRoomSummary,
  sanitizeVec3,
  sanitizeAngle,
  newSeed
} from './roomState.js';
import { CODE_LENGTH } from '../../shared/constants.js';

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/**
 * Cuánto se recuerda que alguien abandonó a propósito.
 *
 * El dato solo sirve para no reengancharle en el instante en que su socket vuelve
 * a conectar, que ocurre en segundos. Sin caducidad el registro crecía para
 * siempre: una entrada por cada usuario que hubiese pulsado "Salir" desde que
 * arrancó el proceso, sin nada que las retirase nunca.
 */
const INTENTIONAL_LEAVE_TTL_MS = 60_000;

/** Cada cuánto se barren salas cuyos ocupantes se fueron sin que nadie lo registrase. */
const SWEEP_INTERVAL_MS = 60_000;

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
    /** @type {Map<string, number>} uid -> instante en que abandonó a propósito */
    this.intentionalLeaves = new Map();

    /**
     * Índice uid -> código de sala.
     *
     * `findRoomByUid` era un recorrido por todas las salas y todos sus jugadores, y
     * se llamaba en cada conexión, alta, baja, desconexión y dentro del temporizador
     * de gracia. Con salas suficientes ese barrido pasa a notarse justo en los
     * momentos de más movimiento.
     */
    this.uidToRoom = new Map();

    this.sweepTimer = null;
  }

  // ---------------------------------------------------------------- lookup

  getRoom(code) {
    if (!code) return null;
    return this.rooms.get(String(code).toUpperCase().trim()) || null;
  }

  /** Sala en la que figura este uid, si alguna. */
  findRoomByUid(uid) {
    const code = this.uidToRoom.get(uid);
    if (!code) return null;

    const room = this.rooms.get(code);
    // El índice apuntaba a una sala ya borrada: se limpia en vez de mentir.
    if (!room) {
      this.uidToRoom.delete(uid);
      return null;
    }
    return room;
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
    this.uidToRoom.set(uid, room.code);
    return { room, reconnected: false };
  }

  /**
   * @returns {{room, player, reconnected}|{error: string}|
   *           {error: string, previousRoom: object, previousDeleted: boolean}}
   */
  joinRoom({ code, uid, name, socketId }) {
    const room = this.getRoom(code);
    if (!room) return { error: 'El nodo sala especificado no existe.' };

    // ¿Ya es miembro? Entonces esto es una reconexión, no un alta.
    const member = this.findPlayer(room, uid);
    if (member) {
      this.attachSocket(room, uid, socketId);
      return { room, player: member, reconnected: true };
    }

    // El aforo se comprueba ANTES de sacar a nadie de su sala anterior.
    //
    // Al revés —como estaba— intentar entrar en una sala llena te expulsaba de la
    // tuya: se te daba de baja, tu sala podía quedarse vacía y borrarse, y el
    // camino de error volvía sin difundir nada, así que el resto de clientes
    // seguía viendo una sala que ya no existía.
    if (!isJoinable(room)) {
      return { error: `La sala está completa (Máximo ${MAX_PLAYERS} agentes).` };
    }

    // Ahora sí: salir de la anterior (evita membresías dobles).
    const previous = this.findRoomByUid(uid);
    const left = previous ? this.removePlayer(previous.code, uid) : null;

    const player = createPlayer({
      uid,
      name,
      socketId,
      index: this.nextFreeIndex(room),
      isHost: false
    });
    room.players.push(player);
    this.uidToRoom.set(uid, room.code);
    this.intentionalLeaves.delete(uid);

    return {
      room,
      player,
      reconnected: false,
      // Quien llame debe refrescar también la sala que se acaba de quedar coja.
      previousRoom: left && !left.deleted ? left.room : null
    };
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
    if (this.hasLeftIntentionally(uid)) return null;

    const room = this.findRoomByUid(uid);
    if (!room) return null;

    this.attachSocket(room, uid, socketId);
    return room;
  }

  /** ¿Abandonó a propósito hace poco? Las marcas viejas se descartan al consultarlas. */
  hasLeftIntentionally(uid) {
    const leftAt = this.intentionalLeaves.get(uid);
    if (leftAt === undefined) return false;

    if (Date.now() - leftAt > INTENTIONAL_LEAVE_TTL_MS) {
      this.intentionalLeaves.delete(uid);
      return false;
    }
    return true;
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
    // Solo si el índice sigue apuntando aquí: al cambiar de sala ya se reasignó.
    if (this.uidToRoom.get(uid) === room.code) this.uidToRoom.delete(uid);

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

    this.intentionalLeaves.set(uid, Date.now());
    const code = room.code;
    const result = this.removePlayer(code, uid);
    return result ? { ...result, code } : null;
  }

  /**
   * Cierra una sala desde fuera del ciclo normal de juego (panel admin).
   *
   * No emite nada por socket.io ni desconecta a nadie: este objeto no conoce `io`.
   * Solo limpia el estado en memoria; el caller (la ruta admin) es quien avisa a
   * los clientes y los saca de la room de socket.io.
   *
   * @returns {object|null} la sala tal como estaba justo antes de borrarla, o null
   *   si el código no existe.
   */
  forceCloseRoom(code) {
    const room = this.getRoom(code);
    if (!room) return null;

    room.players.forEach(p => {
      this.cancelRemoval(p.uid);
      this.intentionalLeaves.delete(p.uid);
      if (this.uidToRoom.get(p.uid) === room.code) this.uidToRoom.delete(p.uid);
    });

    this.rooms.delete(room.code);
    return room;
  }

  // ---------------------------------------------------- desconexión suave

  /**
   * Marca al jugador como desconectado de inmediato (para que la sala lo vea)
   * y programa su expulsión al agotarse el periodo de gracia.
   *
   * `socketId` es el socket que se está cayendo. Comprobarlo importa: con dos
   * pestañas de la misma cuenta, la segunda se adueña del `socketId` del jugador y
   * al cerrar la primera se armaba igualmente el temporizador de expulsión, así
   * que quince segundos después el juego echaba a alguien que estaba jugando.
   */
  markDisconnected(uid, onExpired, socketId = null) {
    const room = this.findRoomByUid(uid);
    if (!room) return null;

    const player = this.findPlayer(room, uid);
    if (!player) return null;

    // Se cayó un socket antiguo y el jugador ya tiene otro activo: no pasa nada.
    if (socketId && player.socketId !== socketId) return null;

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
        this.intentionalLeaves.delete(uid);

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

  /** Vida, estado y contadores de logros a cero. Lo comparten empezar y avanzar. */
  resetPlayersForLevel(room) {
    room.players.forEach(p => {
      p.health = MAX_HEALTH;
      p.alive = true;
      p.shieldedUntil = 0;
      p.levelDamageTaken = 0;
      p.levelDeaths = 0;
    });
    return room;
  }

  startGame(room) {
    room.inGame = true;
    room.seedOffset = 0;
    return this.resetPlayersForLevel(room);
  }

  advanceLevel(room) {
    room.currentLevel += 1;
    room.seed = newSeed();
    room.seedOffset = 0;
    return this.resetPlayersForLevel(room);
  }

  regenerateLevel(room) {
    room.seedOffset += 1;
    return room;
  }

  /**
   * Guarda la posición que reporta un cliente, ya saneada.
   *
   * Se copian los tres números en vez de quedarse con el objeto recibido: ver
   * `sanitizeVec3`. Si el dato no es usable se ignora y se conserva el anterior,
   * que es preferible a teletransportar al agente al origen.
   */
  updatePlayerTransform(room, uid, position, rotationY) {
    const player = this.findPlayer(room, uid);
    if (!player) return null;

    const safePosition = sanitizeVec3(position);
    if (safePosition) player.position = safePosition;

    const safeAngle = sanitizeAngle(rotationY);
    if (safeAngle !== null) player.rotationY = safeAngle;

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

  // ------------------------------------------------------------- barrido

  /**
   * Red de seguridad contra salas zombi.
   *
   * El camino normal —temporizador de gracia por jugador— ya borra la sala cuando
   * se va el último. Esto solo cubre el caso en que ese temporizador se pierda
   * (una excepción a mitad del callback, un reinicio a medias): sin nadie que los
   * retire, esos objetos se quedarían ocupando memoria para siempre en un servidor
   * que precisamente no la tiene de sobra.
   *
   * @returns {number} salas retiradas
   */
  sweepStaleRooms(now = Date.now()) {
    const stale = [];

    for (const room of this.rooms.values()) {
      const abandoned = room.players.every(
        p => !p.connected && p.disconnectedAt && now - p.disconnectedAt > DISCONNECT_GRACE_MS * 2
      );
      if (room.players.length === 0 || abandoned) stale.push(room);
    }

    stale.forEach(room => {
      room.players.forEach(p => {
        this.cancelRemoval(p.uid);
        if (this.uidToRoom.get(p.uid) === room.code) this.uidToRoom.delete(p.uid);
      });
      this.rooms.delete(room.code);
      console.log(`[Sala] ${room.code} retirada por abandono`);
    });

    for (const [uid, leftAt] of this.intentionalLeaves) {
      if (now - leftAt > INTENTIONAL_LEAVE_TTL_MS) this.intentionalLeaves.delete(uid);
    }

    return stale.length;
  }

  startSweeper(intervalMs = SWEEP_INTERVAL_MS) {
    if (this.sweepTimer) return this.sweepTimer;
    this.sweepTimer = setInterval(() => this.sweepStaleRooms(), intervalMs);
    // No debe mantener vivo el proceso solo por existir.
    if (typeof this.sweepTimer.unref === 'function') this.sweepTimer.unref();
    return this.sweepTimer;
  }

  stopSweeper() {
    if (!this.sweepTimer) return;
    clearInterval(this.sweepTimer);
    this.sweepTimer = null;
  }
}
