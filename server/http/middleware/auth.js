import jwt from 'jsonwebtoken';

export const JWT_SECRET = process.env.JWT_SECRET || 'super_secret_triad_key_123';
export const JWT_EXPIRES_IN = '7d';

if (!process.env.JWT_SECRET) {
  console.warn('⚠️  JWT_SECRET no está definido; se usa una clave de desarrollo. Defínelo antes de publicar.');
}

export function signUserToken(user) {
  return jwt.sign({ id: user.id, username: user.username }, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
}

export function verifyToken(token) {
  return jwt.verify(token, JWT_SECRET);
}

/** Protege rutas HTTP: deja `req.user = { id, username }`. */
export function authenticateHTTP(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;

  if (!token) {
    return res.status(401).json({ success: false, error: 'No se proporcionó token de acceso.' });
  }

  try {
    req.user = verifyToken(token);
    return next();
  } catch (err) {
    return res.status(401).json({ success: false, error: 'Token inválido o caducado.' });
  }
}
