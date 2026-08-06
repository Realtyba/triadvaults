import { EVENTS } from '../../../shared/events.js';

/** Sincronización de alta frecuencia: se reenvía tal cual, sin difundir de vuelta al emisor. */
export function registerSyncHandlers(io, socket, roomManager) {
  const { id: uid } = socket.user;

  socket.on(EVENTS.PLAYER_MOVE, (payload = {}) => {
    const room = roomManager.getRoom(payload.roomCode);
    if (!room) return;

    const player = roomManager.updatePlayerTransform(room, uid, payload.position, payload.rotationY);
    if (!player) return;

    socket.to(room.code).emit(EVENTS.PLAYER_MOVED, {
      uid,
      position: player.position,
      rotationY: player.rotationY
    });
  });

  socket.on(EVENTS.GHOST_STATE, (payload = {}) => {
    const room = roomManager.getRoom(payload.roomCode);
    if (!room || !roomManager.isHost(room, uid)) return;

    socket.to(room.code).emit(EVENTS.GHOST_SYNCED, {
      position: payload.position,
      targetUid: payload.targetUid || null
    });
  });
}
