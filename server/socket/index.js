import { EVENTS } from '../../shared/events.js';
import { RoomManager } from '../rooms/RoomManager.js';
import { toRoomPayload } from '../rooms/roomState.js';
import { socketAuthMiddleware } from './authMiddleware.js';
import { broadcastAll, broadcastRoom, broadcastRoomList } from './broadcast.js';
import { registerRoomHandlers } from './handlers/room.handlers.js';
import { registerGameHandlers } from './handlers/game.handlers.js';
import { registerSyncHandlers } from './handlers/sync.handlers.js';

export function registerSocketLayer(io) {
  const roomManager = new RoomManager();

  io.use(socketAuthMiddleware);

  io.on('connection', socket => {
    const { id: uid, username } = socket.user;
    console.log(`[Socket] Conectado ${username} (${socket.id})`);

    // Reenganche automático: si el usuario seguía en una sala (recarga o caída de red),
    // vuelve a ella con su estado intacto en vez de empezar de cero.
    const room = roomManager.reconnectPlayer({ uid, socketId: socket.id });
    if (room) {
      socket.join(room.code);
      socket.emit(EVENTS.RECONNECTED_TO_ROOM, { room: toRoomPayload(room), uid });
      broadcastRoom(io, room);
      console.log(`[Reconexión] ${username} regresó a ${room.code}`);
    }

    registerRoomHandlers(io, socket, roomManager);
    registerGameHandlers(io, socket, roomManager);
    registerSyncHandlers(io, socket, roomManager);

    socket.on('disconnect', reason => {
      const affected = roomManager.markDisconnected(uid, expired => {
        if (expired && !expired.deleted) broadcastRoom(io, expired.room);
        broadcastRoomList(io, roomManager);
      });

      // La sala ve el hueco de inmediato, sin esperar al periodo de gracia.
      if (affected) broadcastAll(io, roomManager, affected);
      console.log(`[Socket] Desconectado ${username} (${reason})`);
    });
  });

  return roomManager;
}
