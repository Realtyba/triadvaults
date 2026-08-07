/**
 * Contexto común de los manejadores de socket.
 *
 * Había cuatro comprobaciones de autoridad escritas a mano y **divergentes**: la
 * de `game` verificaba sala, pertenencia y host; la de `room.START_GAME` se
 * saltaba la pertenencia; las dos de `sync` también. Es decir, la versión más laxa
 * protegía justo los eventos de más frecuencia.
 *
 * Y el acuse de recibo solo existía en `room`: `game` y `sync` declaraban el
 * callback en su firma y no lo llamaban nunca, así que cualquier fallo ahí volvía
 * al cliente como silencio y era indistinguible de un paquete perdido.
 */
export function createHandlerContext(socket, roomManager) {
  const { id: uid, username } = socket.user;

  /** Responde al cliente si pidió acuse. */
  const ack = (callback, payload) => {
    if (typeof callback === 'function') callback(payload);
  };

  const fail = (callback, error) => ack(callback, { success: false, error });

  /**
   * Sala del emisor, comprobando que pertenece a ella y, si se exige, que es host.
   * @returns {object|null} la sala, o null si no procede atender el evento
   */
  const authorize = (roomCode, { hostOnly = false } = {}) => {
    const room = roomManager.getRoom(roomCode);
    if (!room) return null;
    if (!roomManager.findPlayer(room, uid)) return null;
    if (hostOnly && !roomManager.isHost(room, uid)) return null;
    return room;
  };

  return { uid, username, ack, fail, authorize };
}
