import { verifyToken } from '../http/middleware/auth.js';

/**
 * Autentica el handshake del socket.
 * Deja `socket.user = { id, username }`; `socket.user.id` es el uid estable
 * que identifica al jugador entre reconexiones.
 */
export function socketAuthMiddleware(socket, next) {
  const token = socket.handshake.auth && socket.handshake.auth.token;
  if (!token) {
    return next(new Error('Autenticación denegada: Token no provisto.'));
  }

  try {
    const decoded = verifyToken(token);
    if (decoded.id === undefined || decoded.id === null) {
      return next(new Error('Autenticación denegada: Token sin identificador de usuario.'));
    }
    socket.user = { id: String(decoded.id), username: decoded.username };
    return next();
  } catch (err) {
    return next(new Error('Autenticación denegada: Token inválido.'));
  }
}
