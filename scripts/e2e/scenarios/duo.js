/** Dos jugadores: listado en vivo, sincronía, daño por agente y entrada en curso. */
import { openPage, sleep, createReporter } from '../cdp.js';
import { APP_URL, TEST_PASSWORD, ensureAgent } from '../fixtures.js';

export async function runDuo(conn) {
  const r = createReporter('Dúo — dos agentes en la misma sala');
  await ensureAgent('e2ehost');
  await ensureAgent('e2eguest');

  const A = await openPage(conn, APP_URL);
  const B = await openPage(conn, APP_URL);
  const nameA = await A.login('e2ehost', TEST_PASSWORD);
  const nameB = await B.login('e2eguest', TEST_PASSWORD);
  r.check(!!nameA && !!nameB, `dos pestañas independientes: ${nameA} y ${nameB}`, 'no se pudo abrir la sesión doble');

  // A crea la sala; B debe verla aparecer sin recargar.
  await A.click('[data-action="room:create"]');
  await sleep(1500);
  const code = await A.evaluate(`document.querySelector('.room-code')?.textContent.trim()`);
  await sleep(800);

  const listed = await B.evaluate(`(() => {
    const c = [...document.querySelectorAll('.room-card')].find(x => x.dataset.roomCode === '${code}');
    return c ? { badge: c.querySelector('.room-badge').textContent.trim(),
                 players: c.querySelector('.room-card__players').textContent.trim(),
                 joinable: !c.querySelector('[data-action="room:join-public"]').disabled } : null; })()`);
  r.check(!!listed, `B ve la sala ${code} en vivo: ${listed?.badge}, ${listed?.players}`, `B no ve la sala ${code}`);

  await B.click(`[data-action="room:join-public"][data-code="${code}"]`);
  await sleep(1500);
  const roster = await A.evaluate(
    `[...document.querySelectorAll('.player-card:not(.player-card--empty) .player-card__name')].map(n => n.textContent.trim())`
  );
  r.check(roster.length === 2, `lobby compartido: ${roster.join(' + ')}`, `A no ve al segundo agente (${roster.length})`);

  await A.click('[data-action="room:start"]');
  await sleep(2500);

  const snap = page => page.evaluate(`({ seed: window.gameApp.level.seed,
                                         plates: window.gameApp.level.puzzle.plates.length,
                                         players: window.gameApp.players.size,
                                         host: window.gameApp.isHost,
                                         uid: window.gameApp.players.localUid })`);
  const stateA = await snap(A);
  const stateB = await snap(B);

  r.check(stateA.seed === stateB.seed, `ambos generan la misma bóveda (semilla ${stateA.seed})`,
    `semillas distintas: ${stateA.seed} vs ${stateB.seed}`);
  r.check(stateA.plates === 2 && stateB.plates === 2, 'el puzle genera 2 placas para 2 agentes',
    `el puzle no se adaptó: ${stateA.plates}/${stateB.plates}`);
  r.check(stateA.players === 2 && stateB.players === 2, 'cada cliente instancia a los dos agentes',
    `no se ven los dos agentes: ${stateA.players}/${stateB.players}`);
  r.check(stateA.host && !stateB.host, `autoridad: ${stateA.uid} es host, ${stateB.uid} no`,
    'la autoridad de host está mal repartida');

  // El movimiento de B debe replicarse en la pantalla de A.
  const posOfBInA = () => A.evaluate(
    `(() => { const p = window.gameApp.players.get('${stateB.uid}').getPosition();
              return [+p.x.toFixed(2), +p.z.toFixed(2)]; })()`
  );
  const beforeMove = await posOfBInA();
  await B.evaluate(`(window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyD', bubbles: true })), true)`);
  await sleep(900);
  await B.evaluate(`(window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyD', bubbles: true })), true)`);
  await sleep(500);
  const afterMove = await posOfBInA();
  const travelled = Math.hypot(afterMove[0] - beforeMove[0], afterMove[1] - beforeMove[1]);
  r.check(travelled >= 0.5, `A ve replicado el movimiento de B (${travelled.toFixed(2)} u)`,
    `A no ve moverse a B (${travelled.toFixed(2)} u)`);

  // Se mide en delta: el fantasma real también reparte daño durante la prueba.
  const healths = async () => ({
    bHud: await B.evaluate(`+document.querySelector('[data-ref="healthValue"]').textContent`),
    bEnB: await B.evaluate(`window.gameApp.players.local.health`),
    bEnA: await A.evaluate(`window.gameApp.players.get('${stateB.uid}').health`),
    aEnA: await A.evaluate(`window.gameApp.players.local.health`),
    aEnB: await B.evaluate(`window.gameApp.players.get('${stateA.uid}').health`)
  });

  const pre = await healths();
  await A.evaluate(`(window.gameApp.onGhostHit('${stateB.uid}'), true)`);
  await sleep(700);
  const post = await healths();

  r.check(post.bEnB < pre.bEnB && post.bHud === post.bEnB,
    `al golpear a B baja su vida: ${pre.bEnB}% -> ${post.bEnB}%, con su HUD al día`,
    `el invitado no pierde vida: ${pre.bEnB} -> ${post.bEnB} (HUD ${post.bHud})`);
  r.check(post.bEnA === post.bEnB, `A ve a B con la misma vida (${post.bEnA}%)`,
    `A y B no coinciden en la vida de B: ${post.bEnA} vs ${post.bEnB}`);
  r.check(post.aEnA === pre.aEnA, `el golpe a B no toca al host (sigue a ${post.aEnA}%)`,
    `el golpe dirigido a B dañó al host: ${pre.aEnA} -> ${post.aEnA}`);
  r.check(post.aEnB === post.aEnA, 'ambos clientes coinciden en la vida de cada agente',
    `B no ve bien la vida del host: ${post.aEnB} vs ${post.aEnA}`);

  // Antes había un solo fantasma y se le exigía ir alternando de objetivo. Esa
  // prueba comprobaba el síntoma, no lo que importa: con un único cazador alguien
  // tiene por fuerza que quedar sin vigilar en cada instante. Ahora hay uno por
  // agente, así que lo que se verifica es que **nadie queda desatendido**.
  await sleep(2000);
  const hunt = await A.evaluate(`(() => {
    const ghosts = window.gameApp.level.ghosts;
    return { count: ghosts.length,
             owners: ghosts.map(g => g.ownerUid),
             targets: ghosts.map(g => g.targetUid) };
  })()`);

  r.check(hunt.count === 2, `hay un fantasma por agente (${hunt.count})`,
    `se esperaban 2 fantasmas y hay ${hunt.count}`);
  r.check(new Set(hunt.owners).size === hunt.count,
    `cada fantasma tiene su presa asignada: ${hunt.owners.join(', ')}`,
    `dos fantasmas comparten presa: ${hunt.owners.join(', ')}`);
  r.check(new Set(hunt.targets.filter(Boolean)).size === hunt.count,
    `los dos agentes están siendo perseguidos a la vez: ${hunt.targets.join(', ')}`,
    `algún agente queda sin perseguidor: ${hunt.targets.join(', ')}`);

  await B.evaluate(`(window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })), true)`);
  await sleep(400);
  await B.click('[data-action="room:leave"]');
  await sleep(1500);
  const remaining = await A.evaluate(`window.gameApp.players.size`);
  r.check(remaining === 1, 'al abandonar B, A se queda con 1 agente en escena', `A sigue viendo a B (${remaining})`);

  const stillListed = await B.evaluate(`(() => {
    const c = [...document.querySelectorAll('.room-card')].find(x => x.dataset.roomCode === '${code}');
    return c ? { badge: c.querySelector('.room-badge').textContent.trim(),
                 joinable: !c.querySelector('[data-action="room:join-public"]').disabled } : null; })()`);
  r.check(!!stillListed, `la sala en partida sigue listada para B (${stillListed?.badge})`,
    'la sala en partida desapareció del listado');

  await B.click(`[data-action="room:join-public"][data-code="${code}"]`);
  await sleep(2500);
  const rejoined = await B.evaluate(`({ hud: !document.querySelector('.view--hud').classList.contains('hidden'),
                                        running: window.gameApp.running, seed: window.gameApp.level.seed,
                                        players: window.gameApp.players.size })`);
  r.check(rejoined.hud && rejoined.running && rejoined.seed === stateA.seed,
    `B entra a la partida en curso (semilla ${rejoined.seed}, ${rejoined.players} agentes)`,
    'B no pudo entrar a la partida en curso: ' + JSON.stringify(rejoined));

  // Se deja la sala vacía para no contaminar el siguiente escenario.
  await B.leaveAnyRoom();
  await A.leaveAnyRoom();

  return r.failures;
}
