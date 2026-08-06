/**
 * Cliente hacia la API de cuentas (realtyba-api).
 *
 * Desde que las cuentas, el progreso y los logros viven en Laravel, este servidor
 * no toca ninguna base de datos: reporta lo que pasó en la sala y recibe ya
 * resuelto qué se desbloqueó.
 *
 * Se autentica con `X-Internal-Secret`, no con el token del jugador: quien reporta
 * es el servidor, y es él quien sabe lo que ocurrió de verdad en la partida. Un
 * cliente con el token de su cuenta no podría reportar el progreso de los otros dos
 * agentes de la sala.
 */

const API_URL = (process.env.TRIADVAULTS_API_URL || '').replace(/\/+$/, '');
const SECRET = process.env.TRIADVAULTS_INTERNAL_SECRET || '';

/**
 * Tope por petición.
 *
 * Va en el camino caliente del cambio de nivel: los tres agentes están mirando la
 * pantalla de carga esperando el nivel siguiente. Antes que hacerles esperar por una
 * API lenta, se pierde el registro de ese nivel —que es exactamente lo que pasaba
 * cuando `recordLevelCompletion` devolvía null.
 */
const TIMEOUT_MS = 2000;

export function apiIsConfigured() {
  return Boolean(API_URL && SECRET);
}

/**
 * Petición interna. Devuelve null ante cualquier fallo, nunca lanza.
 *
 * Sin reintentos a propósito: reintentar dentro del cambio de nivel multiplicaría la
 * espera del jugador por el mismo fallo, y el progreso de un nivel no vale eso. Lo
 * que sí se recupera es el volcado sin conexión, que el cliente reenvía por su cuenta.
 */
async function request(path, { method = 'GET', body = null } = {}) {
  if (!apiIsConfigured()) return null;

  try {
    const response = await fetch(`${API_URL}/triadvaults/internal${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'X-Internal-Secret': SECRET
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(TIMEOUT_MS)
    });

    if (!response.ok) {
      console.error(`[api] ${method} ${path} respondió ${response.status}`);
      return null;
    }

    return await response.json();
  } catch (err) {
    console.error(`[api] ${method} ${path} falló: ${err.message}`);
    return null;
  }
}

/**
 * Datos del jugador al conectarse. Se llama UNA VEZ en el handshake.
 *
 * @param {string|number} playerId
 * @returns {Promise<{playerId: number, username: string, maxLevel: number, banned: boolean, bannedReason: string|null, isVerified: boolean, tokenVersion: number}|null>}
 */
export async function bootstrapPlayer(playerId) {
  const data = await request(`/players/${encodeURIComponent(playerId)}/bootstrap`);
  return data && data.success ? data.result : null;
}

/**
 * Reporta un nivel completado por TODOS los participantes de la sala a la vez.
 *
 * En lote y no uno por agente: con tres jugadores serían tres viajes HTTP
 * encadenados justo donde se está esperando la pantalla siguiente.
 *
 * @param {{level: number, timeSpent: number, playersCount: number, participants: {playerId: number, damageTaken: number, deaths: number}[]}} report
 * @returns {Promise<{playerId: number, stats: object, unlocked: string[]}[]>}
 */
export async function reportLevelCompletion(report) {
  const data = await request('/progress', { method: 'POST', body: report });
  return data && data.success ? data.results : [];
}
