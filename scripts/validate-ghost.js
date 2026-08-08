#!/usr/bin/env node
/**
 * Comprueba que el fantasma puede cazar en cualquier sala que el juego genere.
 *
 * Su comportamiento pasó de "línea recta siempre" a una máquina de estados que acecha
 * rodeando muros y solo los atraviesa al verte. Eso trajo dos cosas que ningún test
 * cubría y que **fallan en silencio**: una ruta que no llega, y una máquina que oscila
 * entre dos estados tan deprisa que el fantasma se queda temblando en el sitio en vez de
 * avanzar. Las dos se ven en la pantalla como "está roto" sin ningún error en la consola.
 *
 * Va con los `validate:*` y no con los e2e porque es aritmética de enteros sobre la
 * rejilla: no necesita navegador, no necesita servidor y corre en un segundo.
 *
 * Uso: node scripts/validate-ghost.js
 */
import { generateLayout } from '../src/procedural/LayoutGen.js';
import { UNREACHABLE } from '../src/procedural/NavGrid.js';
import { GhostBrain } from '../src/entities/ghost/GhostBrain.js';
import { GHOST_STATES } from '../shared/events.js';

/** Cuántos trazados se prueban. Cubre de sobra los cinco biomas y los tamaños de sala. */
const LAYOUTS = 240;

let failures = 0;

function fail(message) {
  console.error(`  ✗ ${message}`);
  failures++;
}

console.log('\nFantasma: rutas de acecho y estabilidad de la máquina de estados\n');

// ------------------------------------------------------ el campo de flujo llega

let fieldsChecked = 0;
let worstDistance = 0;

for (let i = 0; i < LAYOUTS; i++) {
  const layout = generateLayout(1 + (i % 40), 7919 * (i + 1), i % 3, 1 + (i % 3));
  const grid = layout.grid;

  const field = grid.computeFlowField(layout.spawnCell.col, layout.spawnCell.row);
  fieldsChecked++;

  // Toda celda que el flood fill del generador declara alcanzable tiene que tener
  // distancia finita en el campo. Si no, hay una zona desde la que el fantasma acecharía
  // eternamente sin poder acercarse: la ruta existe para el jugador y no para él.
  for (let row = 0; row < grid.rows; row++) {
    for (let col = 0; col < grid.cols; col++) {
      if (grid.isBlocked(col, row) || !grid.isReachable(col, row)) continue;
      const distance = field[grid.index(col, row)];
      if (distance === UNREACHABLE) {
        fail(`trazado ${i}: la celda (${col}, ${row}) es alcanzable pero el campo de flujo no llega`);
        row = grid.rows;
        break;
      }
      worstDistance = Math.max(worstDistance, distance);
    }
  }

  // Descender por el campo siempre baja: es lo que hace que seguirlo termine. Se
  // comprueba desde la salida, que es donde aparecen los fantasmas.
  const exit = layout.exitCell;
  if (grid.isReachable(exit.col, exit.row)) {
    let col = exit.col;
    let row = exit.row;
    let steps = 0;
    const limit = grid.cols * grid.rows;

    while (field[grid.index(col, row)] > 0 && steps++ < limit) {
      const here = field[grid.index(col, row)];
      let next = null;
      for (const [c, r] of [[col + 1, row], [col - 1, row], [col, row + 1], [col, row - 1]]) {
        if (!grid.inBounds(c, r)) continue;
        if (field[grid.index(c, r)] < here) next = [c, r];
      }
      if (!next) break;
      [col, row] = next;
    }

    if (field[grid.index(col, row)] !== 0) {
      fail(`trazado ${i}: siguiendo el campo desde la salida no se llega a la presa`);
    }
  }
}

console.log(`  ✓ ${fieldsChecked} campos de flujo alcanzan toda celda alcanzable`);
console.log(`  ✓ descender por el campo termina siempre en la presa`);

// ------------------------------------------------- la línea de visión es simétrica

let sightChecked = 0;
for (let i = 0; i < 40; i++) {
  const layout = generateLayout(1 + (i % 20), 104729 * (i + 1), 0, 1);
  const grid = layout.grid;
  const cells = [];

  for (let row = 0; row < grid.rows; row += 2) {
    for (let col = 0; col < grid.cols; col += 2) {
      if (!grid.isBlocked(col, row)) cells.push(grid.toWorld(col, row));
    }
  }

  for (let a = 0; a < cells.length; a += 3) {
    for (let b = a + 1; b < cells.length; b += 5) {
      const ab = grid.hasLineOfSight(cells[a].x, cells[a].z, cells[b].x, cells[b].z);
      const ba = grid.hasLineOfSight(cells[b].x, cells[b].z, cells[a].x, cells[a].z);
      sightChecked++;
      if (ab !== ba) {
        fail(
          `trazado ${i}: la visión no es simétrica entre (${cells[a].x}, ${cells[a].z}) ` +
            `y (${cells[b].x}, ${cells[b].z})`
        );
        a = cells.length;
        break;
      }
    }
  }
}

console.log(`  ✓ ${sightChecked} pares comprobados: ver es recíproco`);

// ------------------------------------------------------ la máquina no se atasca

/**
 * Simula un minuto de persecución y cuenta los cambios de estado.
 *
 * Lo que se busca no es una secuencia concreta —depende de dónde esté el jugador— sino
 * que **no haya vibración**: una máquina que entra y sale de cazar cada pocos fotogramas
 * deja al fantasma acelerando y frenando en el sitio.
 */
function simulate({ visible, distance }) {
  const brain = new GhostBrain();
  const transitions = [];
  let previous = brain.state;

  for (let t = 0; t < 60; t += 1 / 60) {
    const d = typeof distance === 'function' ? distance(t) : distance;
    brain.update(1 / 60, d, typeof visible === 'function' ? visible(t) : visible, { x: 1, z: 0 });
    if (brain.state !== previous) {
      transitions.push({ t, from: previous, to: brain.state });
      previous = brain.state;
    }
  }
  return transitions;
}

// Escondido y lejos: se le acaba la paciencia y entra igual, pero una sola vez.
const hidden = simulate({ visible: false, distance: 25 });
if (hidden.length === 0) {
  fail('escondido para siempre: el fantasma nunca deja de acechar y esconderse gana la partida');
}

// Justo en el límite de la vista, entrando y saliendo: es el caso que haría vibrar una
// máquina sin histéresis, y el motivo de que perder de vista tarde en contar.
const flickering = simulate({
  visible: t => Math.sin(t * 6) > 0,
  distance: 11.5
});
const rapid = flickering.filter((tr, i) => i > 0 && tr.t - flickering[i - 1].t < 0.4);
if (rapid.length > 0) {
  fail(`la máquina vibra: ${rapid.length} cambios de estado a menos de 0,4 s uno de otro`);
} else {
  console.log(`  ✓ en el límite de la vista no vibra (${flickering.length} cambios en 60 s)`);
}

// A bocajarro y a la vista: tiene que embestir, y la embestida tiene que terminar.
const pointBlank = simulate({ visible: true, distance: 3 });
const charges = pointBlank.filter(tr => tr.to === GHOST_STATES.CHARGE);
if (charges.length === 0) {
  fail('a bocajarro y a la vista, el fantasma no llega a embestir nunca');
} else if (!pointBlank.some(tr => tr.from === GHOST_STATES.CHARGE)) {
  fail('la embestida no termina: el fantasma se queda cargando para siempre');
} else {
  console.log(`  ✓ embiste y se recupera (${charges.length} embestidas en 60 s)`);
}

console.log(`\nTrazados comprobados : ${fieldsChecked}`);
console.log(`Ruta más larga       : ${worstDistance} celdas`);
console.log(
  failures === 0
    ? '\n✅ El fantasma sabe llegar y no se atasca.\n'
    : `\n❌ ${failures} comprobación(es) fallida(s).\n`
);
process.exit(failures === 0 ? 0 : 1);
