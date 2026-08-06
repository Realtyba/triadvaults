/**
 * Reconexión, en sus dos formas:
 *   A) se cae el transporte pero el servidor sigue vivo -> se vuelve a la misma bóveda,
 *   B) el servidor se reinicia y pierde las salas -> aviso y regreso limpio al menú.
 */
import { openPage, sleep, createReporter } from '../cdp.js';
import { APP_URL, TEST_PASSWORD, ensureAgent, startServer, stopServer, waitForServer } from '../fixtures.js';

export async function runReconnect(conn) {
  const r = createReporter('Reconexión — corte de red y reinicio del servidor');
  await ensureAgent('e2ehost');

  const page = await openPage(conn, APP_URL);
  const { evaluate: ev, click } = page;

  await page.login('e2ehost', TEST_PASSWORD);
  await click('[data-action="room:create"]');
  await sleep(1500);
  await click('[data-action="room:start"]');
  await sleep(2500);

  const before = await ev(`({ code: window.gameApp.socket.roomCode, seed: window.gameApp.level.seed,
                              level: window.gameApp.level.level, running: window.gameApp.running })`);
  r.check(before.running, `partida en curso: sala ${before.code}, nivel ${before.level}, semilla ${before.seed}`,
    'la partida no arrancó');

  // --- A) corte del transporte con el servidor vivo.
  // Se observa desde la propia página: socket.io reconecta en menos de un segundo
  // y un muestreo desde fuera llegaría tarde.
  await ev(`(() => {
    window.__watch = { seen: false, title: null, room: null, status: null, simulated: false, moved: null };
    const p0 = window.gameApp.players.local.getPosition().clone();
    window.__watch.timer = setInterval(() => {
      if (document.querySelector('.reconnect-overlay').classList.contains('hidden')) return;
      const w = window.__watch;
      w.seen = true;
      w.title = document.querySelector('.reconnect-card h2')?.textContent.trim();
      w.room = document.querySelector('.reconnect-card__room strong')?.textContent.trim();
      w.status = document.querySelector('.reconnect-card__status')?.textContent.trim();
      w.simulated = w.simulated || window.gameApp.canSimulate();
      w.moved = +p0.distanceTo(window.gameApp.players.local.getPosition()).toFixed(2);
    }, 50);
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyW', bubbles: true }));
    window.gameApp.socket.socket.io.engine.close();
    return true; })()`);
  await sleep(2500);

  const down = await ev(`(() => {
    clearInterval(window.__watch.timer);
    window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyW', bubbles: true }));
    return { ...window.__watch, timer: undefined }; })()`);

  r.check(down.seen, `ventana de reconexión visible: "${down.title}" — sala ${down.room}`,
    'no aparece la ventana de reconexión');
  r.check(!!down.status, `estado mostrado: "${down.status}"`, 'la ventana no informa del intento');
  r.check(!down.simulated, 'la simulación se detiene mientras no hay enlace', 'el juego sigue simulando sin conexión');
  r.check(down.moved !== null && down.moved <= 0.1,
    'el personaje queda congelado durante el corte (no se desincroniza)',
    `el personaje se movió sin conexión (${down.moved} u)`);

  await sleep(5000);

  const after = await ev(`({ overlayHidden: document.querySelector('.reconnect-overlay').classList.contains('hidden'),
                             connected: window.gameApp.socket.isConnected,
                             hud: !document.querySelector('.view--hud').classList.contains('hidden'),
                             code: window.gameApp.socket.roomCode, seed: window.gameApp.level.seed,
                             level: window.gameApp.level.level, running: window.gameApp.running,
                             isHost: window.gameApp.isHost })`);

  r.check(after.connected && after.overlayHidden, 'reconectado: la ventana desaparece sola', 'no se restableció la conexión');
  r.check(after.code === before.code, `vuelve a la misma sala ${after.code}`, `volvió a otra sala: ${after.code}`);
  r.check(after.seed === before.seed && after.level === before.level,
    `misma bóveda tras reconectar (nivel ${after.level}, semilla ${after.seed})`,
    `la bóveda cambió: ${before.seed} -> ${after.seed}`);
  r.check(after.running && after.hud, 'la partida se reanuda en el HUD', 'la partida no se reanudó');
  r.check(after.isHost, 'recupera la autoridad de host', 'perdió la autoridad de host');

  // El fantasma pudo matar al agente mientras tanto; se le revive antes de medir.
  if (await ev(`window.gameApp.players.local.health <= 0`)) {
    await click('[data-action="game:respawn"]');
    await sleep(1200);
  }

  await ev(`(() => { window.__p0 = window.gameApp.players.local.getPosition().clone();
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyW', bubbles: true })); return true; })()`);
  await sleep(800);
  const moves = await ev(`(() => {
    window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyW', bubbles: true }));
    return +window.__p0.distanceTo(window.gameApp.players.local.getPosition()).toFixed(2); })()`);
  r.check(moves >= 0.5, `el personaje vuelve a responder (${moves} u)`, `el personaje no responde tras reconectar (${moves} u)`);

  await ev(`(() => { window.__g0 = window.gameApp.level.ghost.mesh.position.clone(); return true; })()`);
  await sleep(1500);
  const ghost = await ev(`(() => ({ dist: +window.__g0.distanceTo(window.gameApp.level.ghost.mesh.position).toFixed(2),
                                    target: window.gameApp.level.ghost.targetUid }))()`);
  r.check(ghost.dist >= 0.5, `el fantasma vuelve a perseguir (${ghost.dist} u, objetivo ${ghost.target})`,
    `el fantasma sigue congelado (${ghost.dist} u)`);

  // --- B) el servidor se reinicia: la sala ya no existe en memoria.
  stopServer();
  await waitForServer(false);
  startServer();
  await waitForServer(true);
  await sleep(7000);

  const lost = await ev(`({ main: !document.querySelector('.view--main').classList.contains('hidden'),
                            message: document.querySelector('.modal__message')?.textContent,
                            running: window.gameApp.running,
                            room: window.gameApp.socket.currentRoom,
                            overlayHidden: document.querySelector('.reconnect-overlay').classList.contains('hidden') })`);

  r.check(lost.room === null, 'la sala fantasma se descarta al no llegar el reenganche',
    'el cliente se queda en una sala que ya no existe');
  r.check(lost.main && !lost.running, 'vuelve al menú y detiene la simulación', 'no volvió al menú');
  r.check(!!lost.message, `aviso al jugador: "${lost.message}"`, 'no se avisa de que la sala se perdió');
  r.check(lost.overlayHidden, 'la ventana de reconexión se cierra', 'la ventana de reconexión se queda colgada');

  return r.failures;
}
