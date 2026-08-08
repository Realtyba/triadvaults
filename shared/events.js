/**
 * Nombres de eventos de socket compartidos por servidor y cliente.
 * Importar desde aquí evita que un typo en una cadena rompa el multijugador en silencio.
 */
export const EVENTS = {
  // sala
  CREATE_ROOM: 'create_room',
  JOIN_ROOM: 'join_room',
  LEAVE_ROOM: 'leave_room',
  GET_ROOMS: 'get_rooms',
  ROOMS_UPDATED: 'rooms_updated',
  ROOM_UPDATED: 'room_updated',
  RECONNECTED_TO_ROOM: 'reconnected_to_room',

  // partida
  START_GAME: 'start_game',
  GAME_STARTED: 'game_started',
  LEVEL_COMPLETE: 'level_complete',
  LOAD_NEXT_LEVEL: 'load_next_level',
  REGENERATE_LEVEL: 'regenerate_level',
  LEVEL_REGENERATED: 'level_regenerated',
  USER_PROGRESS_UPDATED: 'user_progress_updated',
  ACHIEVEMENT_UNLOCKED: 'achievement_unlocked',

  // sincronización en partida
  PLAYER_MOVE: 'player_move',
  PLAYER_MOVED: 'player_moved',
  GHOST_STATE: 'ghost_state',
  GHOST_SYNCED: 'ghost_synced',
  GHOST_HIT: 'ghost_hit',
  PLAYER_HEALTH_CHANGED: 'player_health_changed',
  PLAYER_DIED: 'player_died',
  REQUEST_RESPAWN: 'request_respawn',
  PLAYER_RESPAWNED: 'player_respawned'
};

/** Daño por impacto del fantasma. El servidor no acepta valores mayores. */
export const GHOST_DAMAGE = 20;

/**
 * En qué anda el fantasma. Lo decide el host y viaja dentro de `GHOST_STATE`.
 *
 * Vive aquí por la misma regla que los nombres de evento: es un contrato entre el
 * cliente, el servidor —que lo sanea— y el otro cliente que lo pinta. Si los números
 * estuvieran escritos en cada sitio, el día que se añada un estado en medio quedarían
 * desincronizados **en silencio**, y el síntoma sería un fantasma que en una pantalla
 * embiste y en otra pasea.
 *
 * Números y no cadenas porque esto se manda quince veces por segundo por fantasma.
 *
 * Lo que hace cada uno está en `src/entities/ghost/GhostBrain.js`.
 */
export const GHOST_STATES = Object.freeze({
  /** Rodea los muros, despacio, sin haberte visto. */
  STALK: 0,
  /** Te ha visto: línea recta, atravesando la geometría. */
  HUNT: 1,
  /** Embestida con la dirección congelada. */
  CHARGE: 2
});
