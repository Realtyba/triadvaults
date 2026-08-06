import { EVENTS } from '../../../shared/events.js';
import { DatabaseManager } from '../../db/index.js';
import { toRoomPayload } from '../../rooms/roomState.js';
import { broadcastAll, broadcastRoomList } from '../broadcast.js';

export function registerRoomHandlers(io, socket, roomManager) {
  const { id: uid, username } = socket.user;

  const ack = (callback, payload) => {
    if (typeof callback === 'function') callback(payload);
  };

  socket.on(EVENTS.CREATE_ROOM, async (payload, callback) => {
    // El nivel siempre sale de la BD: el cliente no decide en qué nivel empieza.
    const level = await DatabaseManager.getMaxLevel(username);
    const { room, reconnected } = roomManager.createRoom({ uid, name: username, socketId: socket.id, level });

    if (!reconnected) room.currentLevel = level;
    socket.join(room.code);

    console.log(
      reconnected
        ? `[Sala] ${username} devuelto a ${room.code} (nivel ${room.currentLevel})`
        : `[Sala] ${username} creó ${room.code} (nivel ${room.currentLevel})`
    );

    broadcastAll(io, roomManager, room);
    ack(callback, { success: true, room: toRoomPayload(room), uid });
  });

  socket.on(EVENTS.JOIN_ROOM, (payload = {}, callback) => {
    const result = roomManager.joinRoom({
      code: payload.roomCode,
      uid,
      name: username,
      socketId: socket.id
    });

    if (result.error) return ack(callback, { success: false, error: result.error });

    const { room } = result;
    socket.join(room.code);
    console.log(`[Sala] ${username} entró en ${room.code}${room.inGame ? ' (partida en curso)' : ''}`);

    broadcastAll(io, roomManager, room);
    ack(callback, { success: true, room: toRoomPayload(room), uid, inGame: room.inGame });
  });

  socket.on(EVENTS.LEAVE_ROOM, (payload, callback) => {
    const result = roomManager.leaveRoom(uid);
    if (result) {
      socket.leave(result.code);
      if (!result.deleted) broadcastAll(io, roomManager, result.room);
      else broadcastRoomList(io, roomManager);
      console.log(`[Sala] ${username} abandonó ${result.code}`);
    }
    ack(callback, { success: true });
  });

  socket.on(EVENTS.GET_ROOMS, (payload, callback) => {
    ack(callback, roomManager.listRooms());
  });

  socket.on(EVENTS.START_GAME, (payload = {}) => {
    const room = roomManager.getRoom(payload.roomCode);
    if (!room || !roomManager.isHost(room, uid)) return;

    roomManager.startGame(room);
    io.to(room.code).emit(EVENTS.GAME_STARTED, {
      level: room.currentLevel,
      seed: room.seed,
      seedOffset: room.seedOffset,
      players: toRoomPayload(room).players
    });
    broadcastAll(io, roomManager, room);
  });
}
