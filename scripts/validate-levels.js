#!/usr/bin/env node
/**
 * Comprueba sin cabeza gráfica que los trazados generados son jugables.
 *
 * Verifica lo que antes no comprobaba nadie y producía las salas "sin sentido":
 *   - que no haya muros solapados o pegados entre sí,
 *   - que la salida sea alcanzable desde el punto de aparición,
 *   - que todos los nodos del puzle caigan en celdas libres y alcanzables,
 *   - que la sala no acabe tapiada.
 *
 * Con varios arquetipos de puzle hay dos cosas más que comprobar, y son las que
 * romperían una partida sin dar ningún error:
 *   - que la sala reserve **tantos nodos como pide el arquetipo** (una secuencia
 *     necesita más placas que agentes, y sin ellas es irresoluble),
 *   - que la elección de arquetipo sea **determinista**: si dos clientes de la
 *     misma sala eligieran distinto, uno vería placas y el otro una secuencia.
 *
 * Uso: node scripts/validate-levels.js [niveles] [semillas]
 */
import { generateLayout } from '../src/procedural/LayoutGen.js';
import { selectPuzzleType, PUZZLE_TYPES } from '../src/procedural/puzzles/index.js';

const LEVELS = parseInt(process.argv[2] || '50', 10);
const SEEDS = parseInt(process.argv[3] || '8', 10);
const MIN_OPEN_RATIO = 0.6;

function checkLayout(layout, level, seed, plateCount) {
  const problems = [];
  const grid = layout.grid;

  // 1. La salida tiene que ser alcanzable desde el spawn.
  if (!grid.isReachable(layout.exitCell.col, layout.exitCell.row)) {
    problems.push('la salida no es alcanzable desde el punto de aparición');
  }

  // 2. Ningún muro puede pisar ni tocar a otro.
  const occupied = new Map();
  for (const wall of layout.walls) {
    for (const cell of wall.cells) {
      const key = `${cell.col},${cell.row}`;
      if (occupied.has(key)) problems.push(`muros solapados en la celda ${key}`);
      occupied.set(key, true);
    }
  }

  // 3. Las placas deben caer en celdas libres y alcanzables.
  layout.plateCells.forEach((cell, index) => {
    if (grid.isBlocked(cell.col, cell.row)) problems.push(`la placa ${index} está dentro de un muro`);
    else if (!grid.isReachable(cell.col, cell.row)) problems.push(`la placa ${index} es inalcanzable`);
  });

  if (layout.plateCells.length !== plateCount) {
    problems.push(`se pidieron ${plateCount} placas y se colocaron ${layout.plateCells.length}`);
  }

  // 4. Spawn y salida siempre libres.
  if (grid.isBlocked(layout.spawnCell.col, layout.spawnCell.row)) {
    problems.push('el punto de aparición está tapiado');
  }
  if (grid.isBlocked(layout.exitCell.col, layout.exitCell.row)) {
    problems.push('la salida está tapiada');
  }

  // 5. Espacio jugable suficiente.
  const openRatio = grid.countFree() / (grid.cols * grid.rows);
  if (openRatio < MIN_OPEN_RATIO) {
    problems.push(`sala demasiado tapiada (${(openRatio * 100).toFixed(0)}% libre)`);
  }

  return { problems, openRatio };
}

let checked = 0;
let failures = 0;
let totalOpen = 0;
let maxAttempts = 0;
const usage = new Map(PUZZLE_TYPES.map(type => [type.key, 0]));

for (let level = 1; level <= LEVELS; level++) {
  for (let seed = 1; seed <= SEEDS; seed++) {
    for (let playersCount = 1; playersCount <= 3; playersCount++) {
      const baseSeed = seed * 7919;
      const params = { level, seed: baseSeed, seedOffset: 0, playersCount };

      const Archetype = selectPuzzleType(params);

      // Determinismo: la misma entrada debe dar el mismo arquetipo siempre.
      // Es el fallo que dejaría una sala injugable sin ningún síntoma.
      if (selectPuzzleType(params) !== Archetype) {
        failures++;
        console.error(`✗ nivel ${level} · semilla ${seed} · ${playersCount}p — elección no determinista`);
        continue;
      }

      if (!Archetype.supports(playersCount)) {
        failures++;
        console.error(
          `✗ nivel ${level} · semilla ${seed} · ${playersCount}p — se eligió "${Archetype.key}", que no admite ${playersCount} agente(s)`
        );
        continue;
      }

      const nodeCount = Archetype.nodeCount(playersCount);
      const layout = generateLayout(level, baseSeed, 0, nodeCount);
      const { problems, openRatio } = checkLayout(layout, level, seed, nodeCount);

      checked++;
      totalOpen += openRatio;
      maxAttempts = Math.max(maxAttempts, layout.attempts || 1);
      usage.set(Archetype.key, usage.get(Archetype.key) + 1);

      if (problems.length > 0) {
        failures++;
        console.error(
          `✗ nivel ${level} · semilla ${seed} · ${playersCount}p · "${Archetype.key}" (${nodeCount} nodos)`
        );
        problems.forEach(p => console.error(`    - ${p}`));
      }
    }
  }
}

// Un arquetipo que nunca sale es un arquetipo que nadie ha probado: o la
// selección está sesgada, o su condición de `supports` no se cumple jamás.
const unused = [...usage.entries()].filter(([, count]) => count === 0).map(([key]) => key);
if (unused.length > 0) {
  failures++;
  console.error(`✗ arquetipos que nunca se seleccionaron: ${unused.join(', ')}`);
}

console.log('');
console.log(`Trazados comprobados : ${checked}`);
console.log(`Espacio libre medio  : ${((totalOpen / checked) * 100).toFixed(1)}%`);
console.log(`Reintentos máximos   : ${maxAttempts}`);
console.log('Reparto de arquetipos:');
for (const [key, count] of usage) {
  console.log(`  ${key.padEnd(9)} ${String(count).padStart(5)}  (${((count / checked) * 100).toFixed(1)}%)`);
}
console.log(failures === 0 ? '✓ Todos los niveles son jugables.' : `✗ ${failures} trazados con problemas.`);

process.exit(failures === 0 ? 0 : 1);
