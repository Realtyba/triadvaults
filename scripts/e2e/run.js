#!/usr/bin/env node
/**
 * Pruebas de extremo a extremo sobre el juego real, en Chrome.
 *
 * Requiere tres cosas levantadas: realtyba-api (las cuentas), el servidor de
 * salas y el cliente. Con `npm run dev` arrancan los dos últimos; la API va
 * aparte, y con TRIADVAULTS_DEV_ECHO_PIN=true para poder verificar sin correo.
 *
 * Uso: node scripts/e2e/run.js [solo|duo|reconnect]
 */
import { launchChrome, connect, findChrome } from './cdp.js';
import { API_URL, APP_URL, SOCKET_URL, apiIsUp, serverIsUp, appIsUp } from './fixtures.js';
import { runSolo } from './scenarios/solo.js';
import { runDuo } from './scenarios/duo.js';
import { runReconnect } from './scenarios/reconnect.js';

const SCENARIOS = { solo: runSolo, duo: runDuo, reconnect: runReconnect };
const PORT = Number(process.env.CDP_PORT || 9330);

const requested = process.argv.slice(2).filter(a => SCENARIOS[a]);
const selected = requested.length > 0 ? requested : Object.keys(SCENARIOS);

if (!findChrome()) {
  console.error('No se encontró Chrome. Define CHROME_PATH o instala los binarios de Playwright.');
  process.exit(1);
}
if (!(await apiIsUp())) {
  console.error(
    `La API de cuentas no responde en ${API_URL}. Arranca realtyba-api ` +
      '(con TRIADVAULTS_DEV_ECHO_PIN=true) y comprueba TRIADVAULTS_API_URL en el .env.'
  );
  process.exit(1);
}
if (!(await serverIsUp())) {
  console.error(`El servidor de salas no responde en ${SOCKET_URL}. Arranca "npm run dev" primero.`);
  process.exit(1);
}
if (!(await appIsUp())) {
  console.error(`El cliente no responde en ${APP_URL}. Arranca "npm run dev" primero.`);
  process.exit(1);
}

const { proc, browserWs } = await launchChrome(PORT);
const conn = await connect(browserWs);

let failures = 0;
for (const name of selected) {
  try {
    failures += await SCENARIOS[name](conn);
  } catch (err) {
    failures++;
    console.error(`  ✗ el escenario "${name}" reventó: ${err.message}`);
  }
}

proc.kill();
console.log(failures === 0 ? '\n✓ Todos los escenarios pasan.' : `\n✗ ${failures} comprobación(es) fallida(s).`);
process.exit(failures === 0 ? 0 : 1);
