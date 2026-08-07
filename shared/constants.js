/**
 * Constantes compartidas entre el servidor y el cliente.
 *
 * Estaban bifurcadas: `MAX_PLAYERS` en el servidor y `MAX_SLOTS` en el lobby,
 * `CODE_LENGTH` en el gestor de salas y un `4` literal en el validador del cliente
 * y otro en el `maxlength` del input, `ROOM_STATUS` redeclarado como cadenas
 * sueltas en tres vistas. Ninguna copia estaba mal hoy, pero cambiar el máximo de
 * agentes exigía acertar en seis ficheros a la vez sin que nada avisara del fallo.
 */

export const MAX_PLAYERS = 3;
export const CODE_LENGTH = 4;

export const ROOM_STATUS = {
  LOBBY: 'lobby',
  IN_GAME: 'in_game',
  FULL: 'full'
};

/** Acota un número de agentes al rango jugable. */
export function clampPlayers(count) {
  return Math.max(1, Math.min(Number(count) || 1, MAX_PLAYERS));
}

/** ¿Tiene un código de sala la forma esperada? */
export function isValidRoomCode(code) {
  return typeof code === 'string' && code.trim().length === CODE_LENGTH;
}
