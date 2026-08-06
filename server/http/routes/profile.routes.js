import { Router } from 'express';
import { DatabaseManager } from '../../db/index.js';
import { sendMailTemplate, devPinEchoEnabled } from '../../mailer.js';
import { authenticateHTTP, signUserToken } from '../middleware/auth.js';

export const profileRouter = Router();

/** Logros del agente autenticado, para pintarlos en su perfil. */
profileRouter.get('/achievements', authenticateHTTP, async (req, res) => {
  const keys = await DatabaseManager.listAchievements({
    uid: req.user.id,
    name: req.user.username
  });
  res.json({ success: true, keys });
});

profileRouter.post('/update', authenticateHTTP, async (req, res) => {
  const { firstName, lastName, newEmail, newUsername } = req.body;
  if (!newEmail) {
    return res.status(400).json({ success: false, error: 'El correo es obligatorio.' });
  }

  const result = await DatabaseManager.updateProfile(
    req.user.id,
    firstName,
    lastName,
    newEmail,
    newUsername
  );
  if (!result.success) return res.json(result);

  if (result.emailChanged && result.newCode) {
    // Si el envío falla, el correo nuevo quedaría sin poder verificarse nunca.
    // Ver `deliverPin` en auth.routes.js.
    const lang = req.headers['accept-language'] || 'es';
    const sent = await sendMailTemplate(newEmail, 'verification', lang, { username: result.username, code: result.newCode });
    if (!sent) {
      console.warn(`[MAILER] No se pudo enviar el correo de verificación a ${newEmail}.`);
    }
  }
  delete result.newCode;

  // Si cambió el usuario, el token viejo lleva el nombre antiguo: se reemite.
  if (result.username !== req.user.username) {
    result.token = signUserToken({ id: req.user.id, username: result.username });
  }

  res.json(result);
});
