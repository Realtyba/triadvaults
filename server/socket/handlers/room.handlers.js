import { EVENTS } from '../../../shared/events.js';
import { toRoomPayload } from '../../rooms/roomState.js';
import { broadcastAll, broadcastRoom, broadcastRoomList, LOBBY_CHANNEL } from '../broadcast.js';
import { createHandlerContext } from './context.js';

export function registerRoomHandlers(io, socket, roomManager) {
  const { uid, username, ack, fail } = createHandlerContext(socket, roomManager);

  socket.on(EVENTS.CREATE_ROOM, (payload, callback) => {
    // El nivel sale de la cuenta, no del cliente: nadie decide en qué nivel empieza.
    // Se leyó de la API al conectar (ver admitPlayer en socket/index.js) y se
    // mantiene al día con lo que este mismo proceso reporta al completar niveles.
    const level = socket.user.maxLevel || 1;
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

    if (result.error) return fail(callback, result.error);

    const { room, previousRoom } = result;
    socket.join(room.code);

    // La sala que se acaba de dejar tiene ahora un hueco: sus miembros deben verlo.
    if (previousRoom) {
      socket.leave(previousRoom.code);
      broadcastRoom(io, previousRoom);
    }

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

  // Pedir la lista es la señal de que este cliente está mirando el navegador de
  // salas: a partir de aquí se le mandan las actualizaciones, y no antes.
  socket.on(EVENTS.GET_ROOMS, (payload, callback) => {
    socket.join(LOBBY_CHANNEL);
    ack(callback, roomManager.listRooms());
  });

  socket.on(EVENTS.START_GAME, (payload = {}, callback) => {
    const room = roomManager.getRoom(payload.roomCode);
    if (!room) return fail(callback, 'El nodo sala especificado no existe.');
    if (!roomManager.findPlayer(room, uid)) return fail(callback, 'No perteneces a esta sala.');
    if (!roomManager.isHost(room, uid)) return fail(callback, 'Solo el anfitrión puede iniciar.');

    roomManager.startGame(room);

    // En partida no hay navegador de salas que refrescar. Salir del canal evita
    // que los agentes reciban el catálogo entero cada vez que alguien, en
    // cualquier otra sala, entra o sale.
    io.in(room.code).socketsLeave(LOBBY_CHANNEL);

    const payloadForRoom = toRoomPayload(room);
    io.to(room.code).emit(EVENTS.GAME_STARTED, {
      level: room.currentLevel,
      seed: room.seed,
      seedOffset: room.seedOffset,
      players: payloadForRoom.players
    });
    broadcastAll(io, roomManager, room);
    ack(callback, { success: true });
  });
}
