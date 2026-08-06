/**
 * Cara del cliente del puente con Steam.
 *
 * El puente de verdad está en el proceso principal de Electron (`electron/steam.js`);
 * aquí solo se traduce clave nuestra → nombre de Steam y se llama por IPC.
 *
 * **La autoridad no cambia.** Quien decide que un logro está conseguido sigue siendo
 * el servidor, o `OfflineStore` cuando no hay red. Steam es un espejo: si falla, el
 * jugador conserva su logro en el perfil del juego y solo le falta el reflejo.
 *
 * En el navegador `window.triad` no existe y todo esto se queda en nada.
 */

const api = () => (typeof window !== 'undefined' && window.triad ? window.triad.steam : null);

/** ¿Estamos en la build de escritorio con Steam detrás? */
export async function steamIsAvailable() {
  const steam = api();
  if (!steam) return false;

  try {
    return await steam.isAvailable();
  } catch {
    return false;
  }
}

/**
 * Refleja en Steam los logros indicados.
 *
 * @param {string[]} keys        claves recién desbloqueadas
 * @param {object[]} catalog     catálogo vigente, con `steamApiName`
 * @returns {Promise<number>} cuántos se enviaron
 */
export async function mirrorToSteam(keys = [], catalog = []) {
  const steam = api();
  if (!steam || keys.length === 0) return 0;

  const nameFor = new Map(catalog.map(d => [d.key, d.steamApiName]));
  let sent = 0;

  for (const key of keys) {
    const apiName = nameFor.get(key);
    // Un logro sin equivalente en Steam no es un error: existe solo en el juego.
    if (!apiName) continue;

    try {
      if (await steam.unlock(apiName)) sent++;
    } catch (err) {
      console.error(`[steam] "${key}" no se pudo reflejar:`, err.message);
    }
  }

  return sent;
}

/**
 * Pone al día a Steam con todo lo que el agente ya tenía.
 *
 * Hace falta porque los logros se conceden en nuestro servidor y Steam no se entera
 * de nada: quien jugó en otra máquina, en el navegador, o antes de instalar por
 * Steam, tendría el logro en su perfil del juego y no en el de Steam para siempre.
 *
 * Se pregunta antes de escribir para no reenviar en cada arranque lo que Steam ya
 * sabe, que es la mayoría de las veces.
 *
 * @returns {Promise<number>} cuántos hubo que enviar
 */
export async function reconcileWithSteam(ownedKeys = [], catalog = []) {
  const steam = api();
  if (!steam || ownedKeys.length === 0) return 0;
  if (!(await steamIsAvailable())) return 0;

  const pending = [];
  const nameFor = new Map(catalog.map(d => [d.key, d.steamApiName]));

  for (const key of ownedKeys) {
    const apiName = nameFor.get(key);
    if (!apiName) continue;

    try {
      if (!(await steam.isUnlocked(apiName))) pending.push(key);
    } catch {
      // Si no se puede consultar, no se fuerza: se deja para el siguiente arranque.
    }
  }

  const sent = await mirrorToSteam(pending, catalog);
  if (sent > 0) console.log(`[steam] ${sent} logro(s) puestos al día`);
  return sent;
}
