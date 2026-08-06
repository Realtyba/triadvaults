/** Cuentas de prueba y utilidades de servidor compartidas por los escenarios e2e. */
import { spawn, execSync } from 'child_process';
import { sleep } from './cdp.js';

/**
 * Las cuentas viven en realtyba-api y las salas en el servidor de Node, así que
 * hay dos URL. Antes bastaba una porque era el mismo proceso.
 */
export const API_URL = (process.env.API_URL || process.env.TRIADVAULTS_API_URL || 'http://localhost:8000').replace(/\/+$/, '');
export const SOCKET_URL = (process.env.SOCKET_URL || 'http://localhost:3001').replace(/\/+$/, '');
// El puerto lo fija `vite.config.js`; apuntar al 5173 por defecto de Vite hacía
// que la comprobación previa fallase con el servidor de desarrollo funcionando.
export const APP_URL = process.env.APP_URL || 'http://localhost:3000';
export const TEST_PASSWORD = 'e2e-triad-pass';

/** Prefijo de las rutas del juego en Laravel. */
const API_PREFIX = '/api/triadvaults';

async function post(path, body) {
  const res = await fetch(API_URL + API_PREFIX + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(body)
  });
  return res.json();
}

/**
 * Crea la cuenta si no existe; si ya existe, simplemente accede.
 *
 * El registro deja la cuenta sin verificar, y sin verificar el juego no deja pasar
 * del modal de PIN. Se completa aquí con el `devCode` que devuelve la API cuando el
 * correo no puede salir (`TRIADVAULTS_DEV_ECHO_PIN`), que es el mismo camino que
 * sigue una persona probando en local.
 */
export async function ensureAgent(username) {
  const login = await post('/login', { identifier: username, password: TEST_PASSWORD });
  if (login.success && login.user.isVerified) return login;

  const account = login.success
    ? login
    : await post('/register', {
        firstName: 'E2E',
        lastName: 'Agent',
        username,
        email: `${username}@e2e.test`,
        password: TEST_PASSWORD
      });

  if (!account.success) throw new Error(`No se pudo preparar "${username}": ${account.error}`);
  if (account.user.isVerified) return account;

  const code = account.devCode || (await resendPin(account.token));
  if (!code) {
    throw new Error(
      `No se pudo verificar "${username}": la API no devolvió el PIN. ` +
        'Arranca realtyba-api con TRIADVAULTS_DEV_ECHO_PIN=true y sin credenciales SMTP.'
    );
  }

  const verified = await post('/verify', { username, code });
  if (!verified.success) throw new Error(`No se pudo verificar "${username}": ${verified.error}`);

  return post('/login', { identifier: username, password: TEST_PASSWORD });
}

/** Pide un PIN nuevo; devuelve el código solo si la API lo hace eco. */
async function resendPin(token) {
  const res = await fetch(`${API_URL}${API_PREFIX}/resend-verification`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      Authorization: `Bearer ${token}`
    }
  });
  return (await res.json()).devCode || null;
}

/** ¿Responde la API de cuentas? Sin ella no hay ni registro ni sesión. */
export async function apiIsUp(url = API_URL) {
  try {
    return (await (await fetch(`${url}${API_PREFIX}/health`)).json()).success === true;
  } catch {
    return false;
  }
}

/** ¿Responde el servidor de salas? Es el que se para y arranca en el escenario de reconexión. */
export async function serverIsUp(url = SOCKET_URL) {
  try {
    return (await (await fetch(`${url}/health`)).json()).success === true;
  } catch {
    return false;
  }
}

export async function appIsUp(url = APP_URL) {
  try {
    return (await fetch(url)).ok;
  } catch {
    return false;
  }
}

export function stopServer() {
  // El patrón entre corchetes evita que pkill se encuentre a sí mismo.
  try { execSync('pkill -f "[n]ode server/index.js"'); } catch { /* ya estaba parado */ }
}

export function startServer() {
  return spawn('node', ['server/index.js'], { stdio: 'ignore', detached: true });
}

export async function waitForServer(up = true, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if ((await serverIsUp()) === up) return true;
    await sleep(300);
  }
  return false;
}
