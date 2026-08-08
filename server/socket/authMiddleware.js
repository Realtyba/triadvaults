import jwt from 'jsonwebtoken';

/**
 * Autentica el handshake del socket.
 *
 * El token lo emite Laravel al iniciar sesión; aquí solo se verifica, con el mismo
 * secreto compartido. Se verifica SIN RED a propósito: `SocketClient.js` reintenta
 * la conexión hasta 12 veces, y consultar a Laravel en cada intento haría que una
 * caída suya echase de la partida a gente que está jugando entre ellos.
 *
 * El precio es que revocar no es inmediato, y por eso el token lleva `tv`
 * (token_version): `socket/index.js` lo contrasta con la cuenta al conectar.
 *
 * Deja `socket.user = { id, username, tokenVersion }`; `id` es el uid estable que
 * identifica al jugador entre reconexiones.
 */

const SECRET = process.env.TRIADVAULTS_JWT_SECRET;
const ISSUER = 'realtyba-api';
const AUDIENCE = 'triadvaults';

// Sin secreto se aborta el arranque en lugar de avisar y seguir con una clave de
// desarrollo conocida, que es lo que hacía antes: cualquiera que leyese el
// repositorio podría firmarse un token válido y entrar como quien quisiera.
if (!SECRET) {
  console.error(
    '✖ TRIADVAULTS_JWT_SECRET no está definido. Debe valer lo mismo que en el .env de realtyba-api.'
  );
  process.exit(1);
}

function verifyToken(token) {
  // `algorithms` explícito: sin él, un token con `alg: none` se aceptaría.
  return jwt.verify(token, SECRET, {
    algorithms: ['HS256'],
    issuer: ISSUER,
    audience: AUDIENCE
  });
}

export function socketAuthMiddleware(socket, next) {
  const token = socket.handshake.auth && socket.handshake.auth.token;
  if (!token) {
    return next(new Error('Autenticación denegada: Token no provisto.'));
  }

  try {
    const decoded = verifyToken(token);

    // Laravel firma `sub` como texto, que es lo que manda la especificación de JWT.
    if (decoded.sub === undefined || decoded.sub === null) {
      return next(new Error('Autenticación denegada: Token sin identificador de usuario.'));
    }

    socket.user = {
      id: String(decoded.sub),
      username: decoded.username,
      tokenVersion: Number(decoded.tv) || 1
    };
    return next();
  } catch {
    return next(new Error('Autenticación denegada: Token inválido.'));
  }
}
