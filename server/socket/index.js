import { EVENTS } from '../../shared/events.js';
import { RoomManager } from '../rooms/RoomManager.js';
import { toRoomPayload } from '../rooms/roomState.js';
import { socketAuthMiddleware } from './authMiddleware.js';
import { broadcastAll, broadcastRoom, broadcastRoomList } from './broadcast.js';
import { registerRoomHandlers } from './handlers/room.handlers.js';
import { registerGameHandlers } from './handlers/game.handlers.js';
import { registerSyncHandlers } from './handlers/sync.handlers.js';
import { bootstrapPlayer } from '../services/apiClient.js';

/**
 * Trae de la API lo que hace falta saber del jugador y decide si se le deja entrar.
 *
 * Se hace UNA VEZ al conectar y el resultado queda en `socket.user`. Antes,
 * `getMaxLevel()` se consultaba en cada CREATE_ROOM; ahora eso sería una petición
 * HTTP por sala creada, y el dato no cambia dentro de una sesión salvo por el
 * progreso que este mismo proceso acaba de reportar.
 *
 * Es además el único momento en que se puede rechazar a un baneado: el token se
 * verifica sin red, así que sin esta llamada un baneo no cortaría nada hasta que
 * el token caducase, siete días después.
 *
 * @returns {Promise<string|null>} motivo del rechazo, o null si puede entrar
 */
async function admitPlayer(socket) {
  const account = await bootstrapPlayer(socket.user.id);

  // La API no responde. Se deja jugar: echar a todo el mundo de las salas porque
  // Laravel esté reiniciándose es peor que perder el progreso de unos niveles,
  // que es lo que ya pasaba cuando el guardado fallaba.
  if (!account) {
    socket.user.maxLevel = 1;
    return null;
  }

  if (account.banned) {
    return account.bannedReason
      ? `Cuenta suspendida: ${account.bannedReason}`
      : 'Cuenta suspendida.';
  }

  // El token se emitió antes de un baneo que después se levantó, o antes de otro
  // que sigue vigente. En ambos casos el token ya no vale y hay que volver a
  // iniciar sesión.
  if (account.tokenVersion !== socket.user.tokenVersion) {
    return 'Tu sesión ha caducado. Vuelve a iniciar sesión.';
  }

  socket.user.maxLevel = account.maxLevel;
  socket.user.username = account.username || socket.user.username;
  return null;
}

export function registerSocketLayer(io) {
  const roomManager = new RoomManager();

  // Red de seguridad contra salas que se queden sin nadie sin que ningún
  // temporizador lo registre. En un servidor pequeño, memoria que no se recupera
  // es memoria que acaba tirando el proceso.
  roomManager.startSweeper();

  io.use(socketAuthMiddleware);

  io.use(async (socket, next) => {
    const rejection = await admitPlayer(socket);
    return rejection ? next(new Error(rejection)) : next();
  });

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
      // Se pasa `socket.id` para no armar la expulsión cuando lo que se cae es un
      // socket viejo de la misma cuenta (dos pestañas): en ese caso el jugador
      // sigue conectado por otro y no hay nada que hacer.
      const affected = roomManager.markDisconnected(
        uid,
        expired => {
          if (expired && !expired.deleted) broadcastRoom(io, expired.room);
          broadcastRoomList(io, roomManager);
        },
        socket.id
      );

      // La sala ve el hueco de inmediato, sin esperar al periodo de gracia.
      if (affected) broadcastAll(io, roomManager, affected);
      console.log(`[Socket] Desconectado ${username} (${reason})`);
    });
  });

  return roomManager;
}
