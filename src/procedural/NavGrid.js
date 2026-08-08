/**
 * Rejilla de ocupación de la sala, sin dependencia de Three.js.
 *
 * Sirve para tres cosas que antes no existían:
 *  - garantizar que la salida y las placas son alcanzables (flood fill),
 *  - elegir puntos de aparición libres en vez del `(0, 0, 8)` fijo,
 *  - dar al generador una noción real de "celda ocupada" para no solapar muros.
 */
export const CELL_SIZE = 2;

/**
 * Marca de "aquí no se llega" en un campo de flujo.
 *
 * Es el máximo de un `Uint16Array`, así que la comparación "más cerca que" ya descarta
 * sola las celdas inalcanzables sin necesidad de un caso aparte.
 */
export const UNREACHABLE = 0xffff;

/**
 * Margen para decidir que un rayo pasa por un vértice de la rejilla, en fracción del
 * segmento. Ver `hasLineOfSight`.
 */
const CROSSING_EPSILON = 1e-9;

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

  // -------------------------------------------------------- caza del fantasma

  /**
   * ¿Se ven dos puntos del mundo sin muro por medio?
   *
   * Es lo que decide si el fantasma te ha visto, y por tanto si acecha rodeando la sala
   * o entra a por ti. Con esto, **romper la línea de visión funciona**: un muro deja de
   * ser decoración y pasa a ser algo que se puede usar.
   *
   * ## Tiene que ser simétrico, y por eso no es un Bresenham
   *
   * Ver es recíproco: si el fantasma te ve desde su esquina, tú lo ves desde la tuya. Un
   * Bresenham no cumple eso —su regla de desempate depende de por dónde se empieza, así
   * que A→B y B→A recorren celdas distintas cuando la línea pasa cerca de un canto—, y
   * el resultado sería un fantasma que a veces te ve a través de una pared por la que tú
   * no lo ves. Es un fallo que en la pantalla se lee como "el bicho hace trampas".
   *
   * Lo que se usa es el recorrido de vóxeles de Amanatides–Woo: avanza por el eje cuyo
   * siguiente corte con la rejilla esté **más cerca a lo largo del rayo**. Ese criterio
   * es geométrico, no depende del sentido, y por tanto es simétrico por construcción.
   *
   * Nada de `Raycaster`: en el repositorio no hay ninguno, esto es aritmética sobre la
   * rejilla que ya existe, y estrenar uno traería la escena de Three.js a un módulo que a
   * propósito no la conoce —y que por eso se valida sin navegador—.
   */
  hasLineOfSight(ax, az, bx, bz) {
    // A coordenadas continuas de rejilla: la celda (c, r) ocupa [c, c+1) × [r, r+1).
    const x0 = ax / this.cellSize + this.cols / 2;
    const y0 = az / this.cellSize + this.rows / 2;
    const x1 = bx / this.cellSize + this.cols / 2;
    const y1 = bz / this.cellSize + this.rows / 2;

    let col = Math.floor(x0);
    let row = Math.floor(y0);
    const endCol = Math.floor(x1);
    const endRow = Math.floor(y1);
    if (this.isBlocked(col, row)) return false;

    const dx = x1 - x0;
    const dy = y1 - y0;
    const stepCol = Math.sign(dx);
    const stepRow = Math.sign(dy);

    // Cuánto avanza el parámetro del rayo al cruzar una celda entera en cada eje, y
    // cuánto falta para el primer cruce. Sin movimiento en un eje, nunca se cruza.
    const deltaX = dx !== 0 ? 1 / Math.abs(dx) : Infinity;
    const deltaY = dy !== 0 ? 1 / Math.abs(dy) : Infinity;
    let nextX = dx !== 0 ? (dx > 0 ? col + 1 - x0 : x0 - col) / Math.abs(dx) : Infinity;
    let nextY = dy !== 0 ? (dy > 0 ? row + 1 - y0 : y0 - row) / Math.abs(dy) : Infinity;

    // Tope de seguridad: no puede visitar más celdas que tiene la rejilla.
    let guard = this.cols + this.rows + 2;

    while (guard-- > 0) {
      if (col === endCol && row === endRow) return true;

      // El empate se compara con tolerancia y no con `===`.
      //
      // Los dos parámetros se van acumulando (`+= delta`), así que al llegar a un vértice
      // de la rejilla el mismo cruce sale como 0,4999999999999999 en un sentido y como
      // 0,5 en el otro. Con una comparación exacta, un sentido cruzaba en diagonal y el
      // otro daba dos pasos rectos por celdas distintas: justo la asimetría que este
      // recorrido venía a evitar. Ambos parámetros recorren de 0 a 1 sobre el segmento,
      // así que la tolerancia es directamente comparable.
      if (Math.abs(nextX - nextY) > CROSSING_EPSILON) {
        if (nextX < nextY) {
          col += stepCol;
          nextX += deltaX;
        } else {
          row += stepRow;
          nextY += deltaY;
        }
      } else {
        // El rayo pasa justo por un vértice de la rejilla. Se cruza en diagonal, y solo
        // se considera tapado si **las dos** celdas del canto lo están: por una rendija
        // diagonal entre dos muros se ve, y tratarla como pared cerraría huecos que a
        // ojo están abiertos.
        if (this.isBlocked(col + stepCol, row) && this.isBlocked(col, row + stepRow)) return false;
        col += stepCol;
        row += stepRow;
        nextX += deltaX;
        nextY += deltaY;
      }

      if (this.isBlocked(col, row)) return false;
    }

    return false;
  }

  /**
   * Campo de distancias hasta una celda, en saltos, por anchura.
   *
   * Es el sustituto del pathfinding para el estado de acecho, y es un **campo de flujo**
   * y no un A\* por dos motivos. El primero es el tamaño: la rejilla más grande del juego
   * son 18×18 = 324 celdas, así que recorrerla entera cuesta menos que montar la cola de
   * prioridad que pediría A\*. El segundo es que un campo **sirve a la vez a todos los
   * fantasmas que persigan a la misma presa**: se calcula una vez por objetivo y no una
   * por perseguidor.
   *
   * Quien lo use solo tiene que mirar sus cuatro vecinas y quedarse con la de menor
   * distancia. Ver `GhostBrain`.
   *
   * @returns {Uint16Array} distancia por celda; `UNREACHABLE` donde no se llega
   */
  computeFlowField(targetCol, targetRow) {
    const field = new Uint16Array(this.cols * this.rows).fill(UNREACHABLE);
    if (!this.inBounds(targetCol, targetRow) || this.isBlocked(targetCol, targetRow)) return field;

    field[this.index(targetCol, targetRow)] = 0;
    // Cola con índice de lectura en vez de `shift()`: sacar por delante de un array de
    // JavaScript es lineal, y con 324 celdas eso convierte un recorrido en cuadrático.
    const queue = [targetCol, targetRow];

    for (let head = 0; head < queue.length; head += 2) {
      const col = queue[head];
      const row = queue[head + 1];
      const distance = field[this.index(col, row)] + 1;

      for (const [c, r] of [[col + 1, row], [col - 1, row], [col, row + 1], [col, row - 1]]) {
        if (!this.inBounds(c, r) || this.isBlocked(c, r)) continue;
        const idx = this.index(c, r);
        if (field[idx] !== UNREACHABLE) continue;
        field[idx] = distance;
        queue.push(c, r);
      }
    }

    return field;
  }

  /**
   * Todas las celdas de la rejilla, ocupadas o no.
   *
   * Lo usa el sorteo de aparición y salidas, que corre **antes** de levantar los
   * muros: en ese momento no hay nada bloqueado ni alcanzabilidad calculada
   * todavía, así que `listReachableCells` devolvería una lista vacía.
   */
  listAllCells() {
    const cells = [];
    for (let row = 0; row < this.rows; row++) {
      for (let col = 0; col < this.cols; col++) {
        cells.push({ col, row });
      }
    }
    return cells;
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
