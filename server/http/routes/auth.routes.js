import { Router } from 'express';
import { DatabaseManager } from '../../db/index.js';
import { sendVerificationPin, devPinEchoEnabled } from '../../mailer.js';
import { signUserToken, authenticateHTTP } from '../middleware/auth.js';

export const authRouter = Router();

/** Espera mínima entre reenvíos de PIN, por cuenta. */
const RESEND_COOLDOWN_MS = 60_000;
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
async function deliverPin(payload, { email, code, username }) {
  const sent = await sendVerificationPin(email, code, username);
  if (!sent && devPinEchoEnabled()) {
    payload.devCode = code;
  }
  return payload;
}

authRouter.post('/register', async (req, res) => {
  const { firstName, lastName, username, email, password } = req.body;
  if (!username || !email || !password) {
    return res.status(400).json({ success: false, error: 'Ingresa Usuario, Correo y Contraseña.' });
  }

  const result = await DatabaseManager.registerUser(firstName, lastName, username, email, password);
  if (!result.success) return res.json(result);

  result.token = signUserToken(result.user);
  if (result.verificationCode) {
    await deliverPin(result, {
      email: result.user.email,
      code: result.verificationCode,
      username: result.user.username
    });
    delete result.verificationCode; // el código en claro nunca viaja con este nombre
  }
  res.json(result);
});

authRouter.post('/login', async (req, res) => {
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

  lastResendAt.set(userId, Date.now());

  const payload = { success: true, cooldown: RESEND_COOLDOWN_MS / 1000 };
  await deliverPin(payload, { email: result.email, code: result.code, username: result.username });
  res.json(payload);
});

authRouter.post('/request-reset', async (req, res) => {
  const { email } = req.body;
  if (!email) {
    return res.status(400).json({ success: false, error: 'Ingresa un correo electrónico.' });
  }
  res.json(await DatabaseManager.requestPasswordReset(email));
});

authRouter.post('/reset-password', async (req, res) => {
  const { email, resetCode, newPassword } = req.body;
  if (!email || !resetCode || !newPassword) {
    return res.status(400).json({ success: false, error: 'Por favor completa todos los campos.' });
  }
  res.json(await DatabaseManager.resetPassword(email, resetCode, newPassword));
});
