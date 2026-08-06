/** Cuentas de prueba y utilidades de servidor compartidas por los escenarios e2e. */
import { spawn, execSync } from 'child_process';
import { sleep } from './cdp.js';

export const API_URL = process.env.API_URL || 'http://localhost:3001';
// El puerto lo fija `vite.config.js`; apuntar al 5173 por defecto de Vite hacía
// que la comprobación previa fallase con el servidor de desarrollo funcionando.
export const APP_URL = process.env.APP_URL || 'http://localhost:3000';
export const TEST_PASSWORD = 'e2e-triad-pass';

async function post(path, body) {
  const res = await fetch(API_URL + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  return res.json();
}

/**
 * Crea la cuenta si no existe; si ya existe, simplemente accede.
 *
 * El registro deja la cuenta sin verificar, y sin verificar el juego no deja pasar
 * del modal de PIN. Se completa aquí con el `devCode` que devuelve el servidor
 * cuando el correo no puede salir (`AUTH_DEV_ECHO_PIN`), que es el mismo camino
 * que sigue una persona probando en local.
 */
export async function ensureAgent(username) {
  const login = await post('/api/login', { identifier: username, password: TEST_PASSWORD });
  if (login.success && login.user.isVerified) return login;

  const account = login.success
    ? login
    : await post('/api/register', {
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
      `No se pudo verificar "${username}": el servidor no devolvió el PIN. ` +
        'Arranca con AUTH_DEV_ECHO_PIN=true y sin credenciales SMTP.'
    );
  }

  const verified = await post('/api/verify', { username, code });
  if (!verified.success) throw new Error(`No se pudo verificar "${username}": ${verified.error}`);

  return post('/api/login', { identifier: username, password: TEST_PASSWORD });
}

/** Pide un PIN nuevo; devuelve el código solo si el servidor lo hace eco. */
async function resendPin(token) {
  const res = await fetch(`${API_URL}/api/resend-verification`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }
  });
  return (await res.json()).devCode || null;
}

export async function serverIsUp(url = API_URL) {
  try {
    return (await (await fetch(`${url}/api/health`)).json()).success === true;
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
