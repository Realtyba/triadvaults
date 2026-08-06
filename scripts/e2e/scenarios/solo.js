/** Un jugador: arranque, sala, partida, daño, muerte, reaparición y salida. */
import { openPage, sleep, createReporter } from '../cdp.js';
import { APP_URL, TEST_PASSWORD, ensureAgent } from '../fixtures.js';

export async function runSolo(conn) {
  const r = createReporter('Solo — ciclo completo de una partida');
  await ensureAgent('e2ehost');

  const page = await openPage(conn, APP_URL);
  const { evaluate: ev, click } = page;

  r.check(page.errors.length === 0, 'la aplicación arranca sin excepciones',
    'excepciones al cargar: ' + page.errors.join(' | '));

  const webgl = await ev(`!!document.querySelector('#canvas-container canvas')`);
  if (webgl) r.ok('canvas WebGL activo');
  else r.info('sin WebGL en este entorno: se valida que la UI sobreviva igualmente');

  const skeleton = await ev(`(() => {
    const l = document.getElementById('ui-layer');
    return { regions: l.children.length, menu: !!l.querySelector('.menu-shell'),
             auth: !!l.querySelector('.auth-panel'), hud: !!l.querySelector('.hud-bar') };
  })()`);
  r.check(skeleton.menu && skeleton.auth, `UI montada (${skeleton.regions} regiones)`, 'la UI no se montó');
  r.check(skeleton.hud, 'HUD premontado: no se reconstruye en cada frame', 'el HUD no está premontado');

  const user = await page.login('e2ehost', TEST_PASSWORD);
  r.check(!!user, `sesión iniciada como ${user}`, 'no se completó el acceso');

  const menu = await ev(`(() => {
    const l = document.getElementById('ui-layer');
    return { filters: [...l.querySelectorAll('.filter-btn')].map(b => b.textContent.trim()),
             rank: !!l.querySelector('.panel--rank') };
  })()`);
  r.check(menu.filters.length === 3, `navegador de salas: ${menu.filters.join(' | ')}`, 'faltan los filtros de sala');
  r.check(menu.rank, 'ranking presente', 'falta el ranking');

  await click('[data-action="room:create"]');
  await sleep(1500);
  const lobby = await ev(`(() => ({
    visible: !document.querySelector('.view--lobby').classList.contains('hidden'),
    code: document.querySelector('.room-code')?.textContent.trim(),
    slots: document.querySelectorAll('.player-card').length }))()`);
  r.check(lobby.visible && !!lobby.code, `lobby ${lobby.code} con ${lobby.slots} huecos`, 'no se entró al lobby');

  await click('[data-action="room:start"]');
  await sleep(2500);
  const hud = await ev(`(() => {
    const v = n => document.querySelector('[data-ref="' + n + '"]')?.textContent;
    const g = window.gameApp;
    return { visible: !document.querySelector('.view--hud').classList.contains('hidden'),
             level: v('level'), seed: v('seed'), code: v('code'), health: v('healthValue'),
             objective: (document.querySelector('[data-ref="objective"]')?.textContent || '').slice(0, 40),
             players: g.players.size, boxes: g.level.obstacleBoxes.length,
             plates: g.level.puzzle.plates.length, ghost: !!g.level.ghost, running: g.running };
  })()`);
  r.check(hud.visible && hud.running, `partida: ${hud.level} · semilla ${hud.seed} · sala ${hud.code}`, 'la partida no arrancó');
  r.check(hud.ghost && hud.plates >= 1, `escena: ${hud.players} agente, ${hud.plates} placa(s), ${hud.boxes} colisiones`, 'faltan entidades');
  r.check(!!hud.objective, `objetivo: "${hud.objective}…"`, 'el objetivo está vacío');

  const spawn = await ev(`(() => {
    const g = window.gameApp, p = g.players.local.getPosition();
    return { x: +p.x.toFixed(2), z: +p.z.toFixed(2),
             inWall: g.level.obstacleBoxes.some(b => p.x + 0.4 > b.min.x && p.x - 0.4 < b.max.x &&
                                                     p.z + 0.4 > b.min.z && p.z - 0.4 < b.max.z) };
  })()`);
  r.check(!spawn.inWall, `aparición libre en (${spawn.x}, ${spawn.z})`, `aparición dentro de un muro (${spawn.x}, ${spawn.z})`);

  // El HUD no debe reconstruirse mientras corre el bucle: es la regresión que se vigila.
  await ev(`(() => {
    window.__probe = { frames: 0, mutations: 0, node: document.querySelector('[data-ref="healthFill"]') };
    const loop = () => { window.__probe.frames++; requestAnimationFrame(loop); };
    requestAnimationFrame(loop);
    window.__obs = new MutationObserver(l => { window.__probe.mutations += l.length; });
    window.__obs.observe(document.querySelector('.view--hud'), { childList: true, subtree: true });
    return true; })()`);
  await sleep(1500);
  const loop = await ev(`(() => { window.__obs.disconnect();
    return { frames: window.__probe.frames, mutations: window.__probe.mutations,
             sameNode: window.__probe.node === document.querySelector('[data-ref="healthFill"]') }; })()`);
  r.check(loop.frames > 30, `bucle a ~${Math.round(loop.frames / 1.5)} fps`, `el bucle apenas avanza (${loop.frames} frames)`);
  r.check(loop.sameNode && loop.mutations <= 5,
    `HUD estable: mismo nodo tras ${loop.frames} frames, ${loop.mutations} mutaciones`,
    `el HUD se reconstruye (mismoNodo=${loop.sameNode}, ${loop.mutations} mutaciones)`);

  await ev(`(() => { window.__p0 = window.gameApp.players.local.getPosition().clone();
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyW', bubbles: true })); return true; })()`);
  await sleep(700);
  const moved = await ev(`(() => {
    window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyW', bubbles: true }));
    return +window.__p0.distanceTo(window.gameApp.players.local.getPosition()).toFixed(2); })()`);
  r.check(moved >= 0.5, `el personaje se mueve con WASD (${moved} u en 0.7 s)`, `el personaje no responde (${moved} u)`);

  await ev(`(() => { window.__g0 = window.gameApp.level.ghost.mesh.position.clone(); return true; })()`);
  await sleep(1500);
  const ghost = await ev(`(() => {
    const g = window.gameApp.level.ghost, p = g.mesh.position;
    return { dist: +window.__g0.distanceTo(p).toFixed(2), target: g.targetUid,
             inWall: window.gameApp.level.obstacleBoxes.some(b => p.x + 0.5 > b.min.x && p.x - 0.5 < b.max.x &&
                                                                  p.z + 0.5 > b.min.z && p.z - 0.5 < b.max.z) };
  })()`);
  r.check(ghost.dist >= 0.5, `el fantasma persigue a "${ghost.target}" (${ghost.dist} u)`, `el fantasma no se mueve (${ghost.dist} u)`);
  r.check(!ghost.inWall, 'el fantasma respeta la geometría', 'el fantasma está dentro de un muro');

  const before = await ev(`window.gameApp.players.local.health`);
  await ev(`(window.gameApp.onGhostHit(window.gameApp.players.localUid), true)`);
  await sleep(800);
  const after = await ev(`({ hud: +document.querySelector('[data-ref="healthValue"]').textContent,
                             entity: window.gameApp.players.local.health })`);
  r.check(after.entity < before && after.hud === after.entity,
    `el daño lo aplica el servidor: ${before}% -> ${after.entity}% y el HUD lo refleja`,
    `el daño no se aplicó: ${before} -> ${JSON.stringify(after)}`);

  await ev(`(() => { for (let i = 0; i < 5; i++) window.gameApp.onGhostHit(window.gameApp.players.localUid); return true; })()`);
  await sleep(1000);
  const dead = await ev(`({ modal: document.querySelector('.modal__title')?.textContent,
                            alive: window.gameApp.players.local.alive,
                            pos: [+window.gameApp.players.local.getPosition().x.toFixed(2),
                                  +window.gameApp.players.local.getPosition().z.toFixed(2)] })`);
  r.check(!dead.alive, `muerte registrada (modal "${dead.modal}")`, 'la muerte no se registró');

  await click('[data-action="game:respawn"]');
  await sleep(1000);
  const revived = await ev(`(() => {
    const g = window.gameApp, p = g.players.local.getPosition();
    return { health: g.players.local.health, alive: g.players.local.alive,
             pos: [+p.x.toFixed(2), +p.z.toFixed(2)],
             inWall: g.level.obstacleBoxes.some(b => p.x + 0.4 > b.min.x && p.x - 0.4 < b.max.x &&
                                                     p.z + 0.4 > b.min.z && p.z - 0.4 < b.max.z) };
  })()`);
  r.check(revived.alive && revived.health === 100, `reaparición con vida ${revived.health}%`, 'la reaparición no restauró al agente');
  r.check(!revived.inWall, `reaparición fuera de los muros en (${revived.pos})`, 'reapareció dentro de un muro');
  r.check(String(revived.pos) !== String(dead.pos), 'la reaparición cambia de posición', 'reaparece en el punto exacto de la muerte');

  await ev(`(window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })), true)`);
  await sleep(500);
  const paused = await ev(`({ paused: window.gameApp.ui.isPaused, modal: document.querySelector('.modal__title')?.textContent })`);
  r.check(paused.paused, `Escape pausa la partida ("${paused.modal}")`, 'Escape no pausa');

  await click('[data-action="room:leave"]');
  await sleep(1500);
  const back = await ev(`({ main: !document.querySelector('.view--main').classList.contains('hidden'),
                            running: window.gameApp.running, ghost: !!window.gameApp.level.ghost })`);
  r.check(back.main && !back.running && !back.ghost, 'abandonar limpia la escena y vuelve al menú', 'no volvió limpio al menú');

  const noise = page.errors.filter(e => !/WebGL|favicon|fonts\.googleapis|ERR_/i.test(e));
  r.check(noise.length === 0, 'sin errores de consola relevantes', 'errores de consola: ' + noise.join(' | '));

  return r.failures;
}
