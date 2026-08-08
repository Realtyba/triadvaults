/**
 * Pantalla completa, bloqueo de orientación y pantalla siempre encendida.
 *
 * Vive junto a `device.js` y por el mismo motivo: son capacidades del aparato, no del
 * juego, y todas tienen el mismo problema —el soporte es desigual y a menudo la llamada
 * **rechaza** en vez de fallar en silencio—. Envolverlas aquí evita repartir `try/catch`
 * por la interfaz.
 *
 * ## Por qué el aviso de girar el móvil no es opcional
 *
 * `screen.orientation.lock()` no existe en Safari de iOS, y en el resto sólo funciona
 * dentro de pantalla completa. O sea que en un iPhone **no hay forma de forzar el
 * apaisado**, y en Android deja de valer en cuanto el jugador sale de pantalla completa.
 * El bloqueo es la vía rápida cuando está disponible; el aviso de la interfaz es el que
 * siempre tiene que estar. Uno no sustituye al otro.
 */

/** @returns {boolean} si el documento está ahora mismo en pantalla completa */
export function isFullscreen() {
  if (typeof document === 'undefined') return false;
  return Boolean(document.fullscreenElement || document.webkitFullscreenElement);
}

/** @returns {boolean} si el aparato ofrece la API (iPhone la niega en el elemento raíz) */
export function isFullscreenSupported() {
  if (typeof document === 'undefined') return false;
  const root = document.documentElement;
  return Boolean(
    root.requestFullscreen ||
      root.webkitRequestFullscreen ||
      document.body.webkitRequestFullscreen
  );
}

/**
 * Entra en pantalla completa y, si se puede, clava el apaisado.
 *
 * El bloqueo va **después** y encadenado a propósito: fuera de pantalla completa los
 * navegadores lo rechazan siempre, así que pedirlo antes garantiza el fallo.
 *
 * @returns {Promise<boolean>} si se llegó a entrar en pantalla completa
 */
async function enterFullscreen() {
  const root = document.documentElement;
  const request = root.requestFullscreen || root.webkitRequestFullscreen;
  if (!request) return false;

  try {
    // `navigationUI: 'hide'` lo ignoran los que no lo entienden; no hace falta probarlo.
    await request.call(root, { navigationUI: 'hide' });
  } catch {
    return false;
  }

  await lockLandscape();
  return true;
}

/** Sale de pantalla completa. Nunca lanza: se llama desde manejadores de eventos. */
async function exitFullscreen() {
  const exit = document.exitFullscreen || document.webkitExitFullscreen;
  if (!exit || !isFullscreen()) return;
  try {
    unlockOrientation();
    await exit.call(document);
  } catch {
    // Ya se había salido con el gesto del sistema.
  }
}

export async function toggleFullscreen() {
  if (isFullscreen()) {
    await exitFullscreen();
    return false;
  }
  return enterFullscreen();
}

/** @returns {Promise<boolean>} si el apaisado quedó bloqueado de verdad */
export async function lockLandscape() {
  const orientation = typeof screen !== 'undefined' ? screen.orientation : null;
  if (!orientation?.lock) return false;
  try {
    await orientation.lock('landscape');
    return true;
  } catch {
    // iOS no lo implementa y algunos Android lo niegan si el usuario tiene el giro
    // bloqueado en los ajustes del sistema. Para eso está el aviso de la interfaz.
    return false;
  }
}

function unlockOrientation() {
  try {
    screen.orientation?.unlock?.();
  } catch {
    // Igual que arriba: no está en todas partes y no pasa nada si no está.
  }
}

/**
 * Avisa de cada entrada y salida de pantalla completa, incluidas las que hace el
 * jugador con el gesto del sistema o la tecla Escape —que no pasan por este módulo—.
 *
 * @param {(active: boolean) => void} callback
 * @returns {() => void} función para dejar de escuchar
 */
export function watchFullscreen(callback) {
  const notify = () => callback(isFullscreen());
  document.addEventListener('fullscreenchange', notify);
  document.addEventListener('webkitfullscreenchange', notify);
  return () => {
    document.removeEventListener('fullscreenchange', notify);
    document.removeEventListener('webkitfullscreenchange', notify);
  };
}

/**
 * Mantiene la pantalla encendida mientras dura la partida.
 *
 * Sin esto, un nivel largo en el que el jugador está esperando a que sus compañeros
 * pisen una placa se apaga solo, y volver de la pantalla de bloqueo tira el socket.
 *
 * El centinela se pierde al cambiar de pestaña, así que hay que volver a pedirlo al
 * regresar; de eso se encarga quien llame, desde `visibilitychange`.
 */
let wakeLock = null;

export async function requestWakeLock() {
  if (!navigator.wakeLock || wakeLock) return false;
  try {
    wakeLock = await navigator.wakeLock.request('screen');
    wakeLock.addEventListener?.('release', () => {
      wakeLock = null;
    });
    return true;
  } catch {
    // Batería baja o pestaña en segundo plano: se reintenta la próxima vez.
    return false;
  }
}

export function releaseWakeLock() {
  if (!wakeLock) return;
  try {
    wakeLock.release();
  } catch {
    // Ya lo había soltado el sistema.
  }
  wakeLock = null;
}
