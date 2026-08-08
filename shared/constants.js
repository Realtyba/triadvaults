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

/**
 * Vida completa de un agente.
 *
 * Vivía sólo en `server/rooms/roomState.js`, y el cliente la tenía copiada como un `100`
 * suelto en la llamada de reaparición en solitario. Con sala manda el servidor, así que
 * la copia no se notaba; sin sala, cambiar el máximo en un sitio dejaba la partida en
 * solitario reapareciendo con otra vida que la partida en línea.
 */
export const MAX_HEALTH = 100;

/**
 * Ritmos de envío por la red, en veces por segundo.
 *
 * Son constantes de **protocolo**, no de cliente: el servidor debería poder acotar contra
 * ellas lo que le llega, y hasta ahora sólo las conocía el cliente que las emite. Están
 * aquí para que las dos partes lean el mismo número.
 */
export const MOVE_SEND_HZ = 20;
export const GHOST_SEND_HZ = 15;

export const ROOM_STATUS = {
  LOBBY: 'lobby',
  IN_GAME: 'in_game',
  FULL: 'full'
};

/** Acota un número de agentes al rango jugable. */
export function clampPlayers(count) {
  return Math.max(1, Math.min(Number(count) || 1, MAX_PLAYERS));
}

