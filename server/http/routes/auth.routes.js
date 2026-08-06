import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { DatabaseManager } from '../../db/index.js';
import { sendMailTemplate, devPinEchoEnabled } from '../../mailer.js';
import { signUserToken, authenticateHTTP } from '../middleware/auth.js';

export const authRouter = Router();

// Limiters to prevent brute force attacks
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10, // Limit each IP to 10 login requests per `window` (here, per 15 minutes)
  message: { success: false, error: 'Demasiados intentos de inicio de sesión, por favor intenta más tarde.' }
});

const registerLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 10, // Limit each IP to 10 register requests per hour
  message: { success: false, error: 'Demasiadas cuentas creadas desde esta IP, por favor intenta más tarde.' }
});

/** Espera mínima entre reenvíos de PIN, por cuenta. (2 minutos) */
const RESEND_COOLDOWN_MS = 120_000;
const lastResendAt = new Map();

/**
 * Entrega el PIN por correo, y decide si además viaja en la respuesta.
 *
 * Sin correo el código solo se imprimía en la consola del servidor, así que desde
 * el navegador no había forma de completar el registro. Con `AUTH_DEV_ECHO_PIN` se
 * devuelve como `devCode` para poder probar en local; en producción nunca.
 *
 * La decisión se toma **con el resultado real del envío**, no con la presencia de
 * variables SMTP: unas credenciales de relleno pasan por configuradas y el envío
 * falla igual, dejando al jugador esperando un correo que no va a llegar.
 */
async function deliverPin(req, payload, { email, code, username }) {
  const lang = req.headers['accept-language'] || 'es';
  const sent = await sendMailTemplate(email, 'verification', lang, { username, code });
  if (!sent && devPinEchoEnabled()) {
    payload.devCode = code;
  }
  return payload;
}

authRouter.post('/register', registerLimiter, async (req, res) => {
  const { firstName, lastName, username, email, password } = req.body;
  if (!username || !email || !password) {
    return res.status(400).json({ success: false, error: 'Ingresa Usuario, Correo y Contraseña.' });
  }

  // Security: validate password length
  if (password.length < 6) {
    return res.status(400).json({ success: false, error: 'La contraseña debe tener al menos 6 caracteres.' });
  }

  const result = await DatabaseManager.registerUser(firstName, lastName, username, email, password);
  if (!result.success) return res.json(result);

  result.token = signUserToken(result.user);
  if (result.verificationCode) {
    await deliverPin(req, result, {
      email: result.user.email,
      code: result.verificationCode,
      username: result.user.username
    });
    delete result.verificationCode; // el código en claro nunca viaja con este nombre
  }
  res.json(result);
});

authRouter.post('/login', loginLimiter, async (req, res) => {
  const { identifier, password } = req.body;
  if (!identifier || !password) {
    return res.status(400).json({ success: false, error: 'Ingresa tu Usuario o Correo y Contraseña.' });
  }

  const result = await DatabaseManager.loginUser(identifier, password);
  if (result.success) result.token = signUserToken(result.user);
  res.json(result);
});

authRouter.post('/verify', async (req, res) => {
  const { username, code } = req.body;
  if (!username || !code) {
    return res.status(400).json({ success: false, error: 'Faltan datos de verificación.' });
  }
  res.json(await DatabaseManager.verifyEmail(username, code));
});

/**
 * Emite un PIN nuevo. Va autenticada porque el usuario ya tiene token desde el
 * registro: el modal de verificación aparece con la sesión ya iniciada.
 */
authRouter.post('/resend-verification', authenticateHTTP, async (req, res) => {
  const userId = String(req.user.id);

  const elapsed = Date.now() - (lastResendAt.get(userId) || 0);
  if (elapsed < RESEND_COOLDOWN_MS) {
    return res.status(429).json({
      success: false,
      error: 'Espera un momento antes de pedir otro código.',
      retryAfter: Math.ceil((RESEND_COOLDOWN_MS - elapsed) / 1000)
    });
  }

  const result = await DatabaseManager.regenerateVerificationCode(req.user.id);
  if (!result.success) return res.json(result);

  const lang = req.headers['accept-language'] || 'es';
  const sent = await sendMailTemplate(result.email, 'verification', lang, { username: result.username, code: result.code });
  if (!sent && !devPinEchoEnabled()) {
    return res.status(500).json({ success: false, error: 'No se pudo conectar con el servidor de correo. Intenta más tarde.' });
  }

  lastResendAt.set(userId, Date.now());
  res.json({ success: true, cooldown: RESEND_COOLDOWN_MS / 1000 });
});

authRouter.post('/request-reset', async (req, res) => {
  const { email } = req.body;
  if (!email) {
    return res.status(400).json({ success: false, error: 'Ingresa un correo electrónico.' });
  }
  const result = await DatabaseManager.requestPasswordReset(email);
  if (result.success) {
    const lang = req.headers['accept-language'] || 'es';
    const sent = await sendMailTemplate(result.user.email, 'recovery', lang, { username: result.user.username, code: result.resetCode });
    if (!sent && devPinEchoEnabled()) result.devCode = result.resetCode;
    delete result.resetCode; // El código se envía por correo, nunca se devuelve en la API.
    delete result.user;
  }
  res.json(result);
});

authRouter.post('/reset-password', async (req, res) => {
  const { email, resetCode, newPassword } = req.body;
  if (!email || !resetCode || !newPassword) {
    return res.status(400).json({ success: false, error: 'Por favor completa todos los campos.' });
  }
  res.json(await DatabaseManager.resetPassword(email, resetCode, newPassword));
});
