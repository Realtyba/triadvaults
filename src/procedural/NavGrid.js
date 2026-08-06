/**
 * Rejilla de ocupación de la sala, sin dependencia de Three.js.
 *
 * Sirve para tres cosas que antes no existían:
 *  - garantizar que la salida y las placas son alcanzables (flood fill),
 *  - elegir puntos de aparición libres en vez del `(0, 0, 8)` fijo,
 *  - dar al generador una noción real de "celda ocupada" para no solapar muros.
 */
export const CELL_SIZE = 2;

export class NavGrid {
  constructor(cols, rows, cellSize = CELL_SIZE) {
    this.cols = cols;
    this.rows = rows;
    this.cellSize = cellSize;
    this.blocked = new Uint8Array(cols * rows);
    this.reachable = null;
  }

  index(col, row) {
    return row * this.cols + col;
  }

  inBounds(col, row) {
    return col >= 0 && col < this.cols && row >= 0 && row < this.rows;
  }

  isBlocked(col, row) {
    if (!this.inBounds(col, row)) return true;
    return this.blocked[this.index(col, row)] === 1;
  }

  block(col, row) {
    if (this.inBounds(col, row)) this.blocked[this.index(col, row)] = 1;
  }

  /** ¿Hay algún muro en la celda o en su vecindad inmediata? Evita pasillos de ancho cero. */
  hasBlockedNeighbour(col, row, radius = 1) {
    for (let r = row - radius; r <= row + radius; r++) {
      for (let c = col - radius; c <= col + radius; c++) {
        if (this.inBounds(c, r) && this.isBlocked(c, r)) return true;
      }
    }
    return false;
  }

  // ------------------------------------------------------ mundo <-> celda

  toWorld(col, row) {
    return {
      x: (col - this.cols / 2 + 0.5) * this.cellSize,
      z: (row - this.rows / 2 + 0.5) * this.cellSize
    };
  }

  toCell(x, z) {
    return {
      col: Math.floor(x / this.cellSize + this.cols / 2),
      row: Math.floor(z / this.cellSize + this.rows / 2)
    };
  }

  // ---------------------------------------------------------- conectividad

  /** Marca todas las celdas alcanzables desde un origen (4-conectividad). */
  computeReachable(startCol, startRow) {
    const reachable = new Uint8Array(this.cols * this.rows);
    if (this.isBlocked(startCol, startRow)) {
      this.reachable = reachable;
      return reachable;
    }

    const queue = [[startCol, startRow]];
    reachable[this.index(startCol, startRow)] = 1;

    while (queue.length > 0) {
      const [col, row] = queue.pop();
      const neighbours = [
        [col + 1, row],
        [col - 1, row],
        [col, row + 1],
        [col, row - 1]
      ];

      for (const [c, r] of neighbours) {
        if (!this.inBounds(c, r) || this.isBlocked(c, r)) continue;
        const idx = this.index(c, r);
        if (reachable[idx]) continue;
        reachable[idx] = 1;
        queue.push([c, r]);
      }
    }

    this.reachable = reachable;
    return reachable;
  }

  isReachable(col, row) {
    if (!this.reachable || !this.inBounds(col, row)) return false;
    return this.reachable[this.index(col, row)] === 1;
  }

  /** Todas las celdas libres y alcanzables, como pares {col, row}. */
  listReachableCells() {
    const cells = [];
    for (let row = 0; row < this.rows; row++) {
      for (let col = 0; col < this.cols; col++) {
        if (!this.isBlocked(col, row) && this.isReachable(col, row)) cells.push({ col, row });
      }
    }
    return cells;
  }

  countFree() {
    let free = 0;
    for (let i = 0; i < this.blocked.length; i++) {
      if (this.blocked[i] === 0) free++;
    }
    return free;
  }

  /** Número mínimo de candidatas a reunir antes de elegir, para que haya variedad real. */
  static SPAWN_CANDIDATES = 10;

  /**
   * Celda libre cercana a una posición del mundo.
   *
   * Reúne varias candidatas en anillos crecientes y elige según `variant`, en vez de
   * quedarse con la primera libre: si no, todos los agentes —y todas las reapariciones—
   * caían exactamente en la misma celda.
   */
  findFreeCellNear(worldPos, variant = 0, maxRadius = 12) {
    const origin = this.toCell(worldPos.x, worldPos.z);
    const candidates = [];

    for (let radius = 0; radius <= maxRadius; radius++) {
      const ring = this.collectRing(origin.col, origin.row, radius).filter(
        ({ col, row }) => !this.isBlocked(col, row) && (!this.reachable || this.isReachable(col, row))
      );
      candidates.push(...ring);
      if (candidates.length >= NavGrid.SPAWN_CANDIDATES) break;
    }

    // Sin hueco cerca: cualquier celda alcanzable antes que dejar al jugador en un muro.
    if (candidates.length === 0) candidates.push(...this.listReachableCells());
    if (candidates.length === 0) {
      return { x: worldPos.x, z: worldPos.z, col: origin.col, row: origin.row };
    }

    const chosen = candidates[Math.abs(Math.trunc(variant)) % candidates.length];
    return { ...this.toWorld(chosen.col, chosen.row), col: chosen.col, row: chosen.row };
  }

  collectRing(centerCol, centerRow, radius) {
    if (radius === 0) {
      return this.inBounds(centerCol, centerRow) ? [{ col: centerCol, row: centerRow }] : [];
    }

    const cells = [];
    for (let d = -radius; d <= radius; d++) {
      const candidates = [
        { col: centerCol + d, row: centerRow - radius },
        { col: centerCol + d, row: centerRow + radius },
        { col: centerCol - radius, row: centerRow + d },
        { col: centerCol + radius, row: centerRow + d }
      ];
      for (const cell of candidates) {
        if (this.inBounds(cell.col, cell.row)) cells.push(cell);
      }
    }
    return cells;
  }
}
