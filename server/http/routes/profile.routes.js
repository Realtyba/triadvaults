import { Router } from 'express';
import { DatabaseManager } from '../../db/index.js';
import { sendMailTemplate, devPinEchoEnabled } from '../../mailer.js';
import { authenticateHTTP, signUserToken } from '../middleware/auth.js';
import { recordLevelCompletion } from '../../services/progression.js';

export const profileRouter = Router();

/**
 * Tope de niveles por petición.
 *
 * Cada uno es una escritura en la base de datos, así que una cola larguísima —de
 * alguien que jugó un mes sin red, o de alguien que la fabricó a mano— mantendría el
 * proceso ocupado un buen rato. El cliente reenvía lo que quede en la siguiente
 * tanda, y por eso la respuesta dice cuántos se aceptaron.
 */
const MAX_SYNC_RUNS = 100;

/**
 * Vuelca lo jugado sin conexión.
 *
 * Los niveles se vuelven a evaluar aquí con las mismas reglas que en línea. Lo que
 * manda el cliente es lo que hizo, no lo que cree haber ganado: el resumen local
 * vive en `localStorage` y editarlo es trivial, así que la lista de logros que venga
 * de allí se ignora por completo.
 *
 * `applied` dice cuántos se procesaron para que el cliente borre exactamente esos de
 * su cola. Si borrase la cola entera perdería lo jugado mientras la petición viajaba.
 */
profileRouter.post('/sync', authenticateHTTP, async (req, res) => {
  const runs = Array.isArray(req.body.runs) ? req.body.runs.slice(0, MAX_SYNC_RUNS) : [];
  if (runs.length === 0) return res.json({ success: true, applied: 0, unlocked: [], stats: null });

  const identity = { uid: req.user.id, name: req.user.username };
  const unlocked = new Set();
  let stats = null;
  let applied = 0;
  let mark = await DatabaseManager.getOfflineSyncMark(identity);

  // En serie y no en paralelo: `saveProgress` suma sobre la fila del agente, y
  // varias sumas a la vez sobre la misma fila se pisarían entre ellas.
  for (const run of runs) {
    const at = Math.round(Number(run.at) || 0);

    // Ya aplicado en un envío anterior cuyo acuse no llegó al cliente. Cuenta como
    // procesado —para que salga de su cola— pero no se vuelve a sumar.
    if (at > 0 && at <= mark) {
      applied++;
      continue;
    }

    const result = await recordLevelCompletion(identity, {
      ...run,
      // Lo jugado sin conexión es siempre en solitario: aceptar el recuento del
      // cliente regalaría el logro de escuadrón completo a quien lo pusiera a 3.
      playersCount: 1
    });
    if (!result) break; // la cuenta no existe: no tiene sentido seguir intentándolo

    applied++;
    stats = result.stats;
    if (at > mark) mark = at;
    result.unlocked.forEach(key => unlocked.add(key));
  }

  // La marca se guarda al final y una sola vez: si algo falla a mitad, lo que no se
  // llegó a aplicar sigue por debajo de ella y entrará en el siguiente intento.
  await DatabaseManager.setOfflineSyncMark(identity, mark);

  res.json({ success: true, applied, stats, unlocked: [...unlocked] });
});

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
