import { MAX_PLAYERS, ROOM_STATUS, MAX_HEALTH } from '../../shared/constants.js';

/**
 * Forma canónica del estado de sala y de jugador.
 *
 * Regla clave: la identidad de un jugador es su `uid` (el id de usuario del JWT),
 * NUNCA el `socketId`, que cambia en cada reconexión.
 */

// Se reexportan para no romper a quien ya las importaba de aquí, pero la
// definición vive en `shared/` porque el cliente necesita las mismas: el lobby
// pinta MAX_PLAYERS huecos y el navegador valida la longitud del código.
// `MAX_HEALTH` se une a la lista por el mismo motivo: el cliente la necesita para la
// reaparición en solitario, donde no hay servidor que la dicte.
export { MAX_PLAYERS, ROOM_STATUS, MAX_HEALTH };

export const DISCONNECT_GRACE_MS = 15000;

/**
 * Cota de coordenadas admisible.
 *
 * La sala más grande mide 36×36 y el plano de vacío que la rodea llega a ±72, así
 * que cualquier cosa fuera de este margen es basura o un intento de inyectar
 * carga. No pretende ser una comprobación de física: para eso haría falta simular
 * el movimiento en el servidor, que es justo lo que este diseño evita.
 */
const MAX_COORD = 500;

/**
 * Margen de invulnerabilidad tras reaparecer.
 *
 * El fantasma persigue sin pausa, así que reaparecer podía devolverte al juego
 * justo debajo de él y encadenar muertes sin que llegases a moverte. Dos segundos
 * bastan para orientarse y salir de su alcance.
 */
export const RESPAWN_SHIELD_MS = 2000;

/**
 * Copia defensiva de una posición que llega del cliente.
 *
 * Antes se guardaba **la referencia del objeto recibido**, sin mirar su contenido.
 * Eso significaba que un cliente podía mandar `{x, y, z, relleno: <10 MB>}` y el
 * servidor lo retenía en memoria, lo reenviaba a 20 Hz a toda la sala y lo volvía
 * a serializar en cada `ROOM_UPDATED`. Copiar tres números corta las tres cosas de
 * golpe: el tamaño deja de depender del cliente.
 *
 * @returns {{x: number, y: number, z: number}|null} null si el dato no es usable
 */
export function sanitizeVec3(value) {
  if (!value || typeof value !== 'object') return null;

  const x = Number(value.x);
  const y = Number(value.y);
  const z = Number(value.z);

  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return null;
  if (Math.abs(x) > MAX_COORD || Math.abs(y) > MAX_COORD || Math.abs(z) > MAX_COORD) return null;

  return { x, y, z };
}

/** Ángulo de giro admisible. Igual que arriba: se copia el número, no el objeto. */
export function sanitizeAngle(value) {
  const angle = Number(value);
  return Number.isFinite(angle) ? angle : null;
}

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

/**
 * Semilla de sala.
 *
 * Es el único punto del sistema donde se admite azar real: a partir de aquí todo
 * —trazado, puzle, salidas— se deriva de forma determinista, porque el servidor
 * envía la semilla y cada cliente reconstruye la sala por su cuenta.
 */
export function newSeed() {
  return Math.floor(Math.random() * 1_000_000);
}

export function createRoomState({ code, host }) {
  return {
    code,
    hostUid: host.uid,
    currentLevel: 1,
    seed: newSeed(),
    seedOffset: 0,
    inGame: false,
    createdAt: Date.now(),

    // Guarda de reentrada al superar un nivel. Se declara aquí, y no se añade
    // sobre la marcha en el handler, porque una propiedad que aparece a mitad de
    // vida del objeto no se ve al leer la forma del estado y es indistinguible de
    // una errata.
    completingLevel: false,

    players: [host]
  };
}

function roomStatus(room) {
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
