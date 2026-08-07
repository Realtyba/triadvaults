import { EVENTS } from '../../shared/events.js';
import { toRoomPayload } from '../rooms/roomState.js';

/**
 * Sala de socket.io a la que se suscriben los clientes que están mirando el
 * navegador de salas.
 *
 * Antes la lista se emitía con `io.emit`, es decir a **todos** los sockets del
 * proceso: los tres agentes de cada partida en curso recibían el catálogo entero
 * de salas cada vez que alguien entraba o salía de cualquier otra, aunque
 * estuviesen en el HUD y no hubiera nada que refrescar. Con salas suficientes eso
 * es un envío por socket y una serialización por sala en cada movimiento del
 * sistema.
 */
export const LOBBY_CHANNEL = 'lobby';

/** Emite el estado completo de la sala a sus miembros. */
export function broadcastRoom(io, room) {
  if (!room) return;
  io.to(room.code).emit(EVENTS.ROOM_UPDATED, toRoomPayload(room));
}

/** Refresca el navegador de salas de quien lo esté mirando. */
export function broadcastRoomList(io, roomManager) {
  io.to(LOBBY_CHANNEL).emit(EVENTS.ROOMS_UPDATED, roomManager.listRooms());
}

/** Ambas cosas a la vez: es lo habitual tras cualquier cambio de membresía. */
export function broadcastAll(io, roomManager, room) {
  broadcastRoom(io, room);
  broadcastRoomList(io, roomManager);
}
