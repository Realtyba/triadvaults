/**
 * Forma canónica del estado de sala y de jugador.
 *
 * Regla clave: la identidad de un jugador es su `uid` (el id de usuario del JWT),
 * NUNCA el `socketId`, que cambia en cada reconexión.
 */

export const MAX_PLAYERS = 3;
export const MAX_HEALTH = 100;
export const DISCONNECT_GRACE_MS = 15000;

/**
 * Margen de invulnerabilidad tras reaparecer.
 *
 * El fantasma persigue sin pausa, así que reaparecer podía devolverte al juego
 * justo debajo de él y encadenar muertes sin que llegases a moverte. Dos segundos
 * bastan para orientarse y salir de su alcance.
 */
export const RESPAWN_SHIELD_MS = 2000;

export const ROOM_STATUS = {
  LOBBY: 'lobby',
  IN_GAME: 'in_game',
  FULL: 'full'
};

export function createPlayer({ uid, name, socketId, index, isHost = false }) {
  return {
    uid,
    name,
    socketId,
    index,
    isHost,
    connected: true,
    disconnectedAt: null,
    health: MAX_HEALTH,
    alive: true,
    respawnCount: 0,
    shieldedUntil: 0, // marca temporal hasta la que el jugador no recibe daño

    // Contadores del nivel en curso; los consumen los logros al superarlo y se
    // reinician en cada nivel nuevo. No son estadísticas acumuladas: eso vive en
    // la base de datos.
    levelDamageTaken: 0,
    levelDeaths: 0,
    position: { x: 0, y: 0, z: 0 },
    rotationY: 0
  };
}

export function createRoomState({ code, host }) {
  return {
    code,
    hostUid: host.uid,
    currentLevel: 1,
    seed: Math.floor(Math.random() * 1_000_000),
    seedOffset: 0,
    inGame: false,
    createdAt: Date.now(),
    players: [host]
  };
}

export function roomStatus(room) {
  if (room.inGame) return ROOM_STATUS.IN_GAME;
  if (room.players.length >= MAX_PLAYERS) return ROOM_STATUS.FULL;
  return ROOM_STATUS.LOBBY;
}

export function isJoinable(room) {
  return room.players.length < MAX_PLAYERS;
}

/** Resumen para el navegador de salas (no expone posiciones ni socketIds). */
export function toRoomSummary(room) {
  const host = room.players.find(p => p.uid === room.hostUid) || room.players[0];
  return {
    code: room.code,
    hostName: host ? host.name : '???',
    currentLevel: room.currentLevel,
    playersCount: room.players.length,
    maxPlayers: MAX_PLAYERS,
    status: roomStatus(room),
    joinable: isJoinable(room),
    createdAt: room.createdAt
  };
}

/** Vista de sala que se envía a los miembros. Sin `socketId` para no filtrar el transporte. */
export function toRoomPayload(room) {
  return {
    code: room.code,
    hostUid: room.hostUid,
    currentLevel: room.currentLevel,
    seed: room.seed,
    seedOffset: room.seedOffset,
    inGame: room.inGame,
    players: room.players.map(p => ({
      uid: p.uid,
      name: p.name,
      index: p.index,
      isHost: p.isHost,
      connected: p.connected,
      health: p.health,
      alive: p.alive,
      position: p.position,
      rotationY: p.rotationY
    }))
  };
}
