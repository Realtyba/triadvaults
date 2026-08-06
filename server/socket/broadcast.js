import { EVENTS } from '../../shared/events.js';
import { toRoomPayload } from '../rooms/roomState.js';

/** Emite el estado completo de la sala a sus miembros. */
export function broadcastRoom(io, room) {
  if (!room) return;
  io.to(room.code).emit(EVENTS.ROOM_UPDATED, toRoomPayload(room));
}

/** Refresca el navegador de salas de todos los conectados. */
export function broadcastRoomList(io, roomManager) {
  io.emit(EVENTS.ROOMS_UPDATED, roomManager.listRooms());
}

/** Ambas cosas a la vez: es lo habitual tras cualquier cambio de membresía. */
export function broadcastAll(io, roomManager, room) {
  broadcastRoom(io, room);
  broadcastRoomList(io, roomManager);
}
