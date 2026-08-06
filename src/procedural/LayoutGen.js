import { createRandom, deriveSeed, seedLabel } from './rng.js';
import { NavGrid, CELL_SIZE } from './NavGrid.js';

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
  { name: 'CÍAN CYBER', color: 0x00f3ff, bg: 0x060812, wall: 0x13172b, fogDensity: 0.03 },
  { name: 'MAGENTA SYNTH', color: 0xff0077, bg: 0x12060e, wall: 0x2b1320, fogDensity: 0.042 },
  { name: 'MATRIX ESMERALDA', color: 0x00ff66, bg: 0x05120a, wall: 0x132b1a, fogDensity: 0.026 },
  { name: 'ÁMBAR IMPERIAL', color: 0xffaa00, bg: 0x120e05, wall: 0x2b2213, fogDensity: 0.048 },
  { name: 'PÚRPURA CÓSMICO', color: 0x9d00ff, bg: 0x0c0512, wall: 0x20132b, fogDensity: 0.038 }
];

export const WALL_HEIGHT = 4.0;
export const WALL_THICKNESS = 0.8;

const MAX_ATTEMPTS = 24;
const MIN_OPEN_RATIO = 0.62; // por debajo de esto la sala se vuelve un laberinto ilegible
const PROTECTED_RADIUS = 2; // celdas alrededor de spawn y salida que nunca se tapian
const MIN_PLATE_SPACING = 4; // celdas entre placas, para que exijan separarse de verdad

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

/** Placas repartidas entre celdas alcanzables, separadas entre sí y de spawn/salida. */
function pickPlateCells(grid, rng, count, zones) {
  const candidates = rng
    .shuffle(grid.listReachableCells())
    .filter(cell => !withinProtected(cell.col, cell.row, zones, 3));

  const chosen = [];
  for (const cell of candidates) {
    if (chosen.length >= count) break;
    const farEnough = chosen.every(
      p => Math.abs(p.col - cell.col) + Math.abs(p.row - cell.row) >= MIN_PLATE_SPACING
    );
    if (farEnough) chosen.push(cell);
  }

  // Sala pequeña: se relaja la separación antes que devolver menos placas de las pedidas.
  for (const cell of candidates) {
    if (chosen.length >= count) break;
    if (!chosen.some(p => p.col === cell.col && p.row === cell.row)) chosen.push(cell);
  }

  return chosen.slice(0, count);
}

function buildAttempt(levelNum, seed, plateCount) {
  const { sizeX, sizeZ, cols, rows } = roomDimensions(levelNum);
  const grid = new NavGrid(cols, rows);
  const rng = createRandom(seed);

  const spawnCell = { col: Math.floor(cols / 2), row: rows - 2 };
  const exitCell = { col: Math.floor(cols / 2), row: 1 };
  const zones = [spawnCell, exitCell];

  const targetWalls = Math.min(4 + Math.floor(levelNum * 0.9), Math.floor(cols * rows * 0.09));
  const walls = [];
  let guard = targetWalls * 12;

  while (walls.length < targetWalls && guard-- > 0) {
    const wall = tryPlaceWall(grid, rng, zones);
    if (wall) walls.push(wall);
  }

  grid.computeReachable(spawnCell.col, spawnCell.row);

  const openRatio = grid.countFree() / (cols * rows);
  const exitReachable = grid.isReachable(exitCell.col, exitCell.row);
  const plateCells = pickPlateCells(grid, rng, plateCount, zones);

  const valid = exitReachable && openRatio >= MIN_OPEN_RATIO && plateCells.length === plateCount;

  const spawnWorld = grid.toWorld(spawnCell.col, spawnCell.row);
  const exitWorld = grid.toWorld(exitCell.col, exitCell.row);

  return {
    valid,
    reason: !exitReachable
      ? 'salida inalcanzable'
      : openRatio < MIN_OPEN_RATIO
        ? 'sala demasiado tapiada'
        : plateCells.length !== plateCount
          ? 'no caben todas las placas'
          : null,
    seed,
    seedLabel: seedLabel(seed),
    theme: LEVEL_THEMES[(levelNum - 1) % LEVEL_THEMES.length],
    sizeX,
    sizeZ,
    cols,
    rows,
    grid,
    walls,
    openRatio,
    spawnCell,
    exitCell,
    spawn: { x: spawnWorld.x, y: 0, z: spawnWorld.z },
    exit: { x: exitWorld.x, y: 0, z: exitWorld.z },
    plateCells,
    plates: plateCells.map(cell => {
      const world = grid.toWorld(cell.col, cell.row);
      return { x: world.x, z: world.z, col: cell.col, row: cell.row };
    })
  };
}

/**
 * Genera un trazado jugable. Reintenta con semillas derivadas hasta que la salida
 * y las placas son alcanzables; devuelve el mejor intento si se agotan los reintentos.
 */
export function generateLayout(levelNum = 1, baseSeed = 1, seedOffset = 0, plateCount = 1) {
  let best = null;

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const seed = deriveSeed(baseSeed, levelNum, seedOffset + attempt);
    const layout = buildAttempt(levelNum, seed, plateCount);
    layout.attempts = attempt + 1;

    if (layout.valid) return layout;
    if (!best || layout.openRatio > best.openRatio) best = layout;
  }

  // Último recurso: sala sin muros interiores, siempre jugable.
  const fallback = buildAttempt(levelNum, deriveSeed(baseSeed, levelNum, seedOffset), plateCount);
  fallback.walls = [];
  fallback.grid = new NavGrid(fallback.cols, fallback.rows);
  fallback.grid.computeReachable(fallback.spawnCell.col, fallback.spawnCell.row);
  fallback.plateCells = pickPlateCells(fallback.grid, createRandom(fallback.seed), plateCount, [
    fallback.spawnCell,
    fallback.exitCell
  ]);
  fallback.plates = fallback.plateCells.map(cell => {
    const world = fallback.grid.toWorld(cell.col, cell.row);
    return { x: world.x, z: world.z, col: cell.col, row: cell.row };
  });
  fallback.valid = true;
  fallback.reason = 'fallback sin muros interiores';
  fallback.attempts = MAX_ATTEMPTS;
  return fallback;
}
