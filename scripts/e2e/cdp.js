/**
 * Cliente CDP mínimo para pilotar Chrome sin dependencias extra.
 * Node 22 ya trae `WebSocket` global y Playwright deja el binario en caché.
 */
import { spawn, execSync } from 'child_process';
import { mkdtempSync, existsSync, readdirSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

export const sleep = ms => new Promise(r => setTimeout(r, ms));

const PLAYWRIGHT_CACHE = join(process.env.HOME || '', '.cache', 'ms-playwright');

/** Busca un Chrome utilizable: variable de entorno, caché de Playwright o PATH. */
export function findChrome() {
  if (process.env.CHROME_PATH && existsSync(process.env.CHROME_PATH)) return process.env.CHROME_PATH;

  if (existsSync(PLAYWRIGHT_CACHE)) {
    for (const dir of readdirSync(PLAYWRIGHT_CACHE).filter(d => d.startsWith('chromium-'))) {
      const candidate = join(PLAYWRIGHT_CACHE, dir, 'chrome-linux64', 'chrome');
      if (existsSync(candidate)) return candidate;
      const legacy = join(PLAYWRIGHT_CACHE, dir, 'chrome-linux', 'chrome');
      if (existsSync(legacy)) return legacy;
    }
  }

  for (const bin of ['google-chrome', 'chromium', 'chromium-browser']) {
    try {
      return execSync(`which ${bin}`, { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
    } catch { /* siguiente */ }
  }
  return null;
}

const FLAGS = [
  '--headless=new',
  '--no-sandbox',
  '--disable-dev-shm-usage',
  // Sin esto Chrome estrangula timers y rAF de las pestañas en segundo plano,
  // y el bucle del juego no llega a avanzar durante la prueba.
  '--disable-background-timer-throttling',
  '--disable-backgrounding-occluded-windows',
  '--disable-renderer-backgrounding',
  '--window-size=1280,800'
];

export async function launchChrome(port) {
  const binary = findChrome();
  if (!binary) throw new Error('No se encontró Chrome. Define CHROME_PATH o instala Playwright.');

  const proc = spawn(
    binary,
    [...FLAGS, `--remote-debugging-port=${port}`, `--user-data-dir=${mkdtempSync(join(tmpdir(), 'triad-e2e-'))}`, 'about:blank'],
    { stdio: 'ignore' }
  );

  for (let i = 0; i < 60; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/json/version`);
      return { proc, browserWs: (await res.json()).webSocketDebuggerUrl };
    } catch {
      await sleep(250);
    }
  }
  proc.kill();
  throw new Error('Chrome no expuso el puerto de depuración');
}

class Connection {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
    this.listeners = new Set();

    ws.onmessage = e => {
      const msg = JSON.parse(e.data);
      if (msg.id && this.pending.has(msg.id)) {
        this.pending.get(msg.id)(msg);
        this.pending.delete(msg.id);
        return;
      }
      this.listeners.forEach(fn => fn(msg));
    };
  }

  send(method, params = {}, sessionId) {
    const id = ++this.id;
    this.ws.send(JSON.stringify({ id, method, params, sessionId }));
    return new Promise(r => this.pending.set(id, r));
  }

  onEvent(fn) {
    this.listeners.add(fn);
  }
}

export async function connect(browserWs) {
  const ws = new WebSocket(browserWs);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  return new Connection(ws);
}

/**
 * Abre una pestaña en su propio contexto (localStorage aislado, imprescindible
 * para simular dos jugadores distintos en el mismo navegador).
 */
export async function openPage(conn, url) {
  const { browserContextId } = (await conn.send('Target.createBrowserContext')).result;
  const { targetId } = (await conn.send('Target.createTarget', { url: 'about:blank', browserContextId })).result;
  const { sessionId } = (await conn.send('Target.attachToTarget', { targetId, flatten: true })).result;

  const errors = [];
  conn.onEvent(msg => {
    if (msg.sessionId !== sessionId) return;
    if (msg.method === 'Runtime.exceptionThrown') {
      errors.push(msg.params.exceptionDetails.exception?.description || msg.params.exceptionDetails.text);
    }
    if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
      errors.push(msg.params.args.map(a => a.value ?? a.description).join(' '));
    }
  });

  await conn.send('Runtime.enable', {}, sessionId);
  await conn.send('Page.enable', {}, sessionId);
  await conn.send('Page.navigate', { url }, sessionId);
  await sleep(3000);

  /** Evalúa una expresión SÍNCRONA en la página y devuelve su valor. */
  const evaluate = async expr => {
    const msg = await conn.send('Runtime.evaluate', {
      expression: `JSON.stringify((() => { try { return (${expr}); } catch (e) { return { __error: String(e) }; } })())`,
      returnByValue: true
    }, sessionId);

    if (msg.result?.exceptionDetails) {
      throw new Error(msg.result.exceptionDetails.exception?.description || 'error en la página');
    }
    const raw = msg.result?.result?.value;
    const value = raw === undefined ? undefined : JSON.parse(raw);
    if (value && value.__error) throw new Error(value.__error);
    return value;
  };

  return {
    sessionId,
    errors,
    evaluate,
    click: sel => evaluate(`(document.querySelector('${sel}')?.click(), true)`),
    setField: (field, value) => evaluate(
      `(() => { const n = document.querySelector('[data-field="${field}"]');
                n.value = ${JSON.stringify(value)};
                n.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`
    ),
    async login(username, password) {
      await this.setField('username', username);
      await this.setField('password', password);
      await evaluate(`(document.querySelector('[data-action="auth:submit"] button[type=submit]').click(), true)`);
      await sleep(2500);
      // El reenganche automático puede devolver al agente a una sala de otro
      // escenario; cada prueba debe empezar desde el menú.
      await this.leaveAnyRoom();
      return evaluate(`document.querySelector('.profile-card__user')?.textContent || null`);
    },

    /** Sale de la sala actual, esté en lobby o en partida. Idempotente. */
    async leaveAnyRoom() {
      const inRoom = await evaluate(`!!window.gameApp?.socket.currentRoom`);
      if (!inRoom) return false;

      await evaluate(`(() => {
        if (window.gameApp.ui.isPaused === false && window.gameApp.ui.store.get().view === 'hud') {
          window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        }
        return true; })()`);
      await sleep(300);
      await evaluate(`(document.querySelector('[data-action="room:leave"]')?.click(), true)`);
      await sleep(1200);
      return true;
    }
  };
}

/** Contador de aciertos/fallos compartido por los escenarios. */
export function createReporter(title) {
  let failures = 0;
  console.log(`\n▸ ${title}`);
  return {
    ok(message) { console.log('  ✓ ' + message); },
    info(message) { console.log('  ℹ ' + message); },
    fail(message) { failures++; console.error('  ✗ ' + message); },
    check(condition, okMessage, failMessage) {
      if (condition) this.ok(okMessage);
      else this.fail(failMessage);
      return condition;
    },
    get failures() { return failures; }
  };
}
