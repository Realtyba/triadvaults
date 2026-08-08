import { createRandom, deriveSeed, seedLabel } from './rng.js';
import { NavGrid, CELL_SIZE } from './NavGrid.js';
import { yieldToMain } from '../utils/async.js';
// De `palette.js` y no de `materials.js`: este fichero lo importa `validate-levels.js`
// desde Node pelado, y `materials.js` arrastra Three.js.
import { PALETTE } from '../engine/palette.js';

/**
 * Trazado de la sala como datos puros: sin Three.js, para poder validarlo
 * en Node (`scripts/validate-levels.js`) además de renderizarlo.
 */

/**
 * Biomas. Además de la paleta, cada uno lleva su densidad de niebla: es lo que
 * hace que una sala se sienta abierta y otra opresiva con el mismo trazado.
 * `fogDensity` alta cierra el horizonte; baja deja ver la sala entera.
 */
export const LEVEL_THEMES = [
  { name: 'CÍAN CYBER', color: PALETTE.CYAN, bg: 0x060812, wall: 0x13172b, fogDensity: 0.03 },
  { name: 'MAGENTA SYNTH', color: PALETTE.MAGENTA, bg: 0x12060e, wall: 0x2b1320, fogDensity: 0.042 },
  { name: 'MATRIX ESMERALDA', color: PALETTE.EMERALD, bg: 0x05120a, wall: 0x132b1a, fogDensity: 0.026 },
  { name: 'ÁMBAR IMPERIAL', color: PALETTE.AMBER, bg: 0x120e05, wall: 0x2b2213, fogDensity: 0.048 },
  { name: 'PÚRPURA CÓSMICO', color: PALETTE.PURPLE, bg: 0x0c0512, wall: 0x20132b, fogDensity: 0.038 }
];

/**
 * El bioma de un nivel, sin generar la sala.
 *
 * Existe para que el arranque pueda poner la atmósfera —fondo, niebla y sobre todo el
 * reflejo del entorno— **antes** de crear las mallas. Cuando se ponía después, la sala se
 * dibujaba sus primeros fotogramas con el entorno cián por defecto y todo el metal
 * cambiaba de reflejo de golpe: era una buena parte del "cambia todo raro" al entrar.
 *
 * Es una función pura del número de nivel, igual que la línea que la usa dentro del
 * trazado, así que las dos no pueden divergir.
 */
export function themeForLevel(levelNum) {
  return LEVEL_THEMES[(levelNum - 1) % LEVEL_THEMES.length];
}

export const WALL_HEIGHT = 4.0;
export const WALL_THICKNESS = 0.8;

const MAX_ATTEMPTS = 24;
const MIN_OPEN_RATIO = 0.62; // por debajo de esto la sala se vuelve un laberinto ilegible
const PROTECTED_RADIUS = 2; // celdas alrededor de spawn y salida que nunca se tapian
const MIN_PLATE_SPACING = 4; // celdas entre placas, para que exijan separarse de verdad

/**
 * Sal de la semilla para el sorteo de aparición y salidas.
 *
 * Va aparte —igual que `PUZZLE_SEED_SALT`— para que sacar una tirada más no
 * desplace la secuencia con la que se colocan los muros: así una semilla dada
 * sigue produciendo el mismo trazado que antes de existir este sorteo.
 */
const PLACEMENT_SEED_SALT = 0xd0025;

/** Celdas mínimas entre dos salidas, para que repartirse no sea trivial. */
const MIN_EXIT_SPACING = 5;

/** Separación mínima entre la aparición y cualquier salida. */
const MIN_SPAWN_EXIT_DISTANCE = 6;

/**
 * Cuántas salidas se abren, por nivel.
 *
 * Empieza con una para que el juego se enseñe solo, y a partir de ahí varias: con
 * dos o tres compuertas el grupo tiene que decidir a cuál corre, que es una
 * decisión que antes no existía porque la salida estaba siempre en el mismo sitio.
 */
export function exitCountForLevel(levelNum) {
  if (levelNum >= 15) return 3;
  if (levelNum >= 6) return 2;
  return 1;
}

function roomDimensions(levelNum) {
  const sizeX = Math.min(20 + (levelNum % 4) * 4, 36);
  const sizeZ = Math.min(20 + Math.floor(levelNum / 2) * 2, 36);
  return {
    sizeX,
    sizeZ,
    cols: Math.round(sizeX / CELL_SIZE),
    rows: Math.round(sizeZ / CELL_SIZE)
  };
}

function withinProtected(col, row, zones, radius = PROTECTED_RADIUS) {
  return zones.some(z => Math.abs(col - z.col) <= radius && Math.abs(row - z.row) <= radius);
}

/**
 * Coloca un tramo recto de muro si cabe.
 * Exige que ni el tramo ni su vecindad estén ocupados: así los muros nunca se
 * fusionan en bloques amorfos y siempre queda al menos un pasillo entre ellos.
 */
function tryPlaceWall(grid, rng, zones) {
  const horizontal = rng.bool();
  const length = rng.int(2, 4);
  const col = rng.int(1, grid.cols - 2);
  const row = rng.int(1, grid.rows - 2);

  const cells = [];
  for (let i = 0; i < length; i++) {
    const c = horizontal ? col + i : col;
    const r = horizontal ? row : row + i;
    if (!grid.inBounds(c, r)) return null;
    if (withinProtected(c, r, zones)) return null;
    if (grid.hasBlockedNeighbour(c, r)) return null;
    cells.push({ col: c, row: r });
  }

  cells.forEach(cell => grid.block(cell.col, cell.row));

  const first = grid.toWorld(cells[0].col, cells[0].row);
  const last = grid.toWorld(cells[cells.length - 1].col, cells[cells.length - 1].row);

  return {
    cells,
    horizontal,
    x: (first.x + last.x) / 2,
    z: (first.z + last.z) / 2,
    width: horizontal ? length * CELL_SIZE : WALL_THICKNESS * 1.75,
    depth: horizontal ? WALL_THICKNESS * 1.75 : length * CELL_SIZE
  };
}

function manhattan(a, b) {
  return Math.abs(a.col - b.col) + Math.abs(a.row - b.row);
}

/**
 * Elige `count` celdas de una lista, separadas entre sí al menos `minSpacing`.
 *
 * Si no caben tan separadas, relaja la condición antes que devolver menos de las
 * pedidas: quedarse corto rompe el nivel —faltarían placas o salidas—, mientras
 * que dos nodos algo más juntos de la cuenta solo lo hace un poco más fácil.
 *
 * Era la lógica de colocación de placas; se generalizó porque es exactamente la
 * que hace falta para repartir las salidas.
 */
function pickSpacedCells(candidates, count, minSpacing) {
  const chosen = [];

  for (const cell of candidates) {
    if (chosen.length >= count) break;
    if (chosen.every(p => manhattan(p, cell) >= minSpacing)) chosen.push(cell);
  }

  for (const cell of candidates) {
    if (chosen.length >= count) break;
    if (!chosen.some(p => p.col === cell.col && p.row === cell.row)) chosen.push(cell);
  }

  return chosen.slice(0, count);
}

/** Placas repartidas entre celdas alcanzables, separadas entre sí y de spawn/salidas. */
function pickPlateCells(grid, rng, count, zones) {
  const candidates = rng
    .shuffle(grid.listReachableCells())
    .filter(cell => !withinProtected(cell.col, cell.row, zones, 3));

  return pickSpacedCells(candidates, count, MIN_PLATE_SPACING);
}

/**
 * Sortea dónde aparecen los agentes y dónde están las salidas.
 *
 * Antes ninguna de las dos cosas era aleatoria: la salida se fijaba en
 * `{ col: floor(cols/2), row: 1 }` y la aparición en su reflejo. Como `cols`
 * siempre es par, `toWorld` devolvía **x = 1.0 exacto en todos los niveles y con
 * todas las semillas**, y el radio protegido garantizaba además un claro idéntico
 * a su alrededor. La semilla existía, pero solo alimentaba muros y placas.
 *
 * El sorteo se hace sobre la rejilla **vacía**, antes de levantar ningún muro: las
 * celdas elegidas entran en las zonas protegidas, que no se tapian nunca, y la
 * validación posterior comprueba que siguen siendo alcanzables.
 */
function pickPlacement(grid, rng, exitCount) {
  // Sin el borde: una salida pegada al muro perimetral queda medio tapada.
  const candidates = rng
    .shuffle(grid.listAllCells())
    .filter(cell => cell.col > 0 && cell.col < grid.cols - 1 && cell.row > 0 && cell.row < grid.rows - 1);

  if (candidates.length === 0) {
    const fallback = { col: Math.floor(grid.cols / 2), row: Math.floor(grid.rows / 2) };
    return { spawnCell: fallback, exitCells: [fallback] };
  }

  const spawnCell = candidates[0];

  // Las salidas se buscan lejos de la aparición: si no, el nivel se cruza de una
  // zancada y el puzle deja de importar.
  const farFromSpawn = candidates.filter(c => manhattan(c, spawnCell) >= MIN_SPAWN_EXIT_DISTANCE);
  const pool = farFromSpawn.length >= exitCount ? farFromSpawn : candidates.slice(1);

  const exitCells = pickSpacedCells(pool, exitCount, MIN_EXIT_SPACING);
  return { spawnCell, exitCells: exitCells.length > 0 ? exitCells : [candidates[candidates.length - 1]] };
}

/** Celda -> punto del mundo con sus coordenadas de rejilla adjuntas. */
function toPlacement(grid, cell) {
  const world = grid.toWorld(cell.col, cell.row);
  return { x: world.x, z: world.z, col: cell.col, row: cell.row };
}

function buildAttempt(levelNum, seed, plateCount, exitCount = 1) {
  const { sizeX, sizeZ, cols, rows } = roomDimensions(levelNum);
  const grid = new NavGrid(cols, rows);
  const rng = createRandom(seed);

  // Sorteo con su propia semilla derivada; ver PLACEMENT_SEED_SALT.
  const placementRng = createRandom((seed ^ PLACEMENT_SEED_SALT) >>> 0);
  const { spawnCell, exitCells } = pickPlacement(grid, placementRng, exitCount);
  const zones = [spawnCell, ...exitCells];

  const targetWalls = Math.min(4 + Math.floor(levelNum * 0.9), Math.floor(cols * rows * 0.09));
  const walls = [];
  let guard = targetWalls * 12;

  while (walls.length < targetWalls && guard-- > 0) {
    const wall = tryPlaceWall(grid, rng, zones);
    if (wall) walls.push(wall);
  }

  grid.computeReachable(spawnCell.col, spawnCell.row);

  const openRatio = grid.countFree() / (cols * rows);
  // Basta con que una salida sea alcanzable para poder terminar, pero se exigen
  // todas: una compuerta visible a la que no se puede llegar se lee como un fallo.
  const exitsReachable = exitCells.every(cell => grid.isReachable(cell.col, cell.row));
  const plateCells = pickPlateCells(grid, rng, plateCount, zones);

  const valid = exitsReachable && openRatio >= MIN_OPEN_RATIO && plateCells.length === plateCount;

  const spawnWorld = grid.toWorld(spawnCell.col, spawnCell.row);
  const exits = exitCells.map(cell => toPlacement(grid, cell));

  return {
    valid,
    reason: !exitsReachable
      ? 'salida inalcanzable'
      : openRatio < MIN_OPEN_RATIO
        ? 'sala demasiado tapiada'
        : plateCells.length !== plateCount
          ? 'no caben todas las placas'
          : null,
    seed,
    seedLabel: seedLabel(seed),
    theme: themeForLevel(levelNum),
    sizeX,
    sizeZ,
    cols,
    rows,
    grid,
    walls,
    openRatio,
    spawnCell,
    exitCells,
    exits,

    // Alias de la primera salida. Se mantienen porque los scripts de validación y
    // el resto del pipeline hablaban en singular; el código nuevo usa las listas.
    exitCell: exitCells[0],
    exit: { x: exits[0].x, y: 0, z: exits[0].z },

    spawn: { x: spawnWorld.x, y: 0, z: spawnWorld.z },
    plateCells,
    plates: plateCells.map(cell => toPlacement(grid, cell))
  };
}

/**
 * Genera un trazado jugable. Reintenta con semillas derivadas hasta que la salida
 * y las placas son alcanzables; devuelve el mejor intento si se agotan los reintentos.
 */
export async function generateLayout(levelNum = 1, baseSeed = 1, seedOffset = 0, plateCount = 1) {
  const exitCount = exitCountForLevel(levelNum);
  let best = null;

  // Cada reintento deriva una semilla nueva, así que también vuelve a sortear
  // aparición y salidas: una tirada mala —salidas en un rincón que los muros
  // acaban aislando— se corrige sola en el intento siguiente.
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    // Se cede cada cuatro intentos, no en cada uno. Un intento cuesta menos de un
    // milisegundo, así que ceder antes de cada uno no evitaba ningún bloqueo: lo que
    // hacía era **esperar un fotograma** hasta 24 veces, o sea hasta 400 ms de loader
    // con la CPU parada. Cediendo cada cuatro, el hilo sigue libre y el caso peor baja
    // a seis fotogramas.
    if (attempt > 0 && attempt % 4 === 0) await yieldToMain();

    const seed = deriveSeed(baseSeed, levelNum, seedOffset + attempt);
    const layout = buildAttempt(levelNum, seed, plateCount, exitCount);
    layout.attempts = attempt + 1;

    if (layout.valid) return layout;
    if (!best || layout.openRatio > best.openRatio) best = layout;
  }

  // Último recurso: sala sin muros interiores, siempre jugable.
  const fallback = buildAttempt(
    levelNum,
    deriveSeed(baseSeed, levelNum, seedOffset),
    plateCount,
    exitCount
  );
  fallback.walls = [];
  fallback.grid = new NavGrid(fallback.cols, fallback.rows);
  fallback.grid.computeReachable(fallback.spawnCell.col, fallback.spawnCell.row);
  fallback.plateCells = pickPlateCells(fallback.grid, createRandom(fallback.seed), plateCount, [
    fallback.spawnCell,
    ...fallback.exitCells
  ]);
  fallback.plates = fallback.plateCells.map(cell => toPlacement(fallback.grid, cell));
  fallback.valid = true;
  fallback.reason = 'fallback sin muros interiores';
  fallback.attempts = MAX_ATTEMPTS;
  return fallback;
}
