import { DungeonGenerator } from '../procedural/DungeonGen.js';
import { PuzzleGenerator } from '../procedural/PuzzleGen.js';
import { selectPuzzleType } from '../procedural/puzzles/index.js';
import { GhostEnemyEntity } from '../entities/GhostEnemy.js';
import { PropLibrary } from '../engine/PropLibrary.js';
import { scatterProps } from '../procedural/PropScatter.js';
import { PROP_MODELS, propWeights } from '../assets/manifest.js';
import { quality } from '../engine/QualitySettings.js';
import { clampPlayers, MAX_PLAYERS } from '../../shared/constants.js';
import { yieldToMain } from '../utils/async.js';

/**
 * Ciclo de vida de un nivel: mazmorra, puzle, fantasma y puntos de aparición.
 *
 * La semilla llega desde el servidor, así que todos los agentes de la sala —
 * incluido el que acaba de reconectar — construyen exactamente la misma sala.
 */
export class LevelController {
  constructor(scene, lighting) {
    this.scene = scene;
    this.lighting = lighting;

    this.dungeon = new DungeonGenerator(scene);
    this.puzzle = new PuzzleGenerator(scene);
    this.props = new PropLibrary(scene);
    /** @type {import('../entities/GhostEnemy.js').GhostEnemyEntity[]} */
    this.ghosts = [];

    this.info = null;
    this.level = 1;
    this.seed = 1;
    this.seedOffset = 0;
    this.playersCount = 1;
    this.startedAt = 0;
  }

  get obstacleBoxes() {
    return this.dungeon.obstacleBoxes;
  }

  get navGrid() {
    return this.info ? this.info.navGrid : null;
  }

  /** Segundos transcurridos desde que arrancó el nivel. */
  get elapsedSeconds() {
    return this.startedAt ? Math.round((Date.now() - this.startedAt) / 1000) : 0;
  }

  async build({ level = 1, seed = 1, seedOffset = 0, playersCount = 1, owners = [] }) {
    this.level = level;
    this.seed = seed;
    this.seedOffset = seedOffset;
    this.playersCount = clampPlayers(playersCount);

    await yieldToMain();

    // El arquetipo se elige ANTES de trazar la sala: cada uno necesita un número
    // distinto de nodos, y las celdas hay que reservarlas al generar el trazado.
    const Archetype = selectPuzzleType({
      level,
      seed,
      seedOffset,
      playersCount: this.playersCount
    });
    const nodeCount = Archetype.nodeCount(this.playersCount);

    this.info = this.dungeon.generateLevel(level, seed, seedOffset, nodeCount);
    // El arquetipo consulta el nivel para calibrarse (p. ej. la ventana temporal).
    this.info.level = level;
    this.info.seedOffset = seedOffset;

    await yieldToMain();
    this.lighting.setupCornerLights(this.info.sizeX, this.info.sizeZ, this.info.theme.color);
    
    await yieldToMain();
    this.puzzle.generatePuzzle(this.info, this.playersCount, Archetype);
    
    // Props is now properly awaited so it doesn't merge while playing
    await this.buildProps();

    await yieldToMain();
    this.buildGhosts(owners);
    
    this.startedAt = Date.now();
    return this.info;
  }

  /**
   * Atrezo de la sala.
   *
   * El reparto es **síncrono y sembrado** —así los tres clientes deciden los mismos
   * sitios— pero el montaje es asíncrono y no se espera: si los modelos aún no están,
   * la sala se juega sin atrezo y aparece cuando lleguen. Es la misma regla que
   * `Player.attachModel`, y la que hace que una descarga lenta nunca retrase un nivel.
   *
   * La cantidad sale del preset, así que dos jugadores ven distinto número de piezas.
   * Puede hacerlo porque el atrezo **no colisiona**: ver `PropScatter`.
   */
  async buildProps() {
    const placements = scatterProps(
      this.dungeon.layout,
      quality.get('propDensity'),
      PROP_MODELS.length,
      propWeights()
    );
    await this.props.build(placements);
  }

  /**
   * Reparte a cada fantasma la ruta hacia su presa.
   *
   * El campo se calcula **por presa y no por perseguidor**: dos fantasmas que van a por
   * el mismo agente comparten exactamente la misma ruta, así que calcularlo dos veces
   * sería tirar el trabajo. Y se recalcula solo cuando la presa cambia de celda, no cada
   * fotograma: dentro de una celda de dos unidades la ruta no cambia.
   *
   * Coste real: un recorrido por anchura de 324 celdas como mucho, unas pocas veces por
   * segundo. Por eso es un campo de flujo y no un A\* por fantasma. Ver
   * `NavGrid.computeFlowField`.
   *
   * @param {Array<{uid: string, position: THREE.Vector3}>} players
   */
  updateFlowFields(players) {
    const grid = this.navGrid;
    if (!grid) return;

    const cache = this.flowFields || (this.flowFields = new Map());
    const wanted = new Set();

    for (const ghost of this.ghosts) {
      if (!ghost.targetUid) continue;
      const prey = players.find(p => p.uid === ghost.targetUid);
      if (!prey) continue;

      const uid = String(prey.uid);
      wanted.add(uid);

      const cell = grid.toCell(prey.position.x, prey.position.z);
      const entry = cache.get(uid);
      if (!entry || entry.col !== cell.col || entry.row !== cell.row) {
        // Se reutiliza el búfer anterior si existe: evita crear un Uint16Array en cada
        // cambio de celda. `computeFlowField` lo llena desde cero con UNREACHABLE.
        const reuse = entry ? entry.field : undefined;
        cache.set(uid, { col: cell.col, row: cell.row, field: grid.computeFlowField(cell.col, cell.row, reuse) });
      }
      ghost.flowField = cache.get(uid).field;
    }

    // Un agente que muere o se va deja su campo detrás; sin esto la caché crecería con
    // cada cambio de sala.
    for (const uid of cache.keys()) {
      if (!wanted.has(uid)) cache.delete(uid);
    }
  }

  /** El primer fantasma. Para todos, `ghosts`. */
  get ghost() {
    return this.ghosts[0] || null;
  }

  /** Diagonal de la sala: es la escala real contra la que puntúa la IA. */
  get roomRange() {
    if (!this.info) return 45;
    return Math.hypot(this.info.sizeX, this.info.sizeZ);
  }

  /**
   * Un perseguidor por agente.
   *
   * Con uno solo, y por mucho que se afinase la puntuación, alguien tenía que
   * quedar sin vigilar: la decisión de a quién ignorar es inherente a tener un
   * único cazador. Asignando uno a cada agente esa decisión desaparece, y de paso
   * el daño por jugador no cambia respecto a antes, porque cada uno sigue teniendo
   * exactamente un fantasma encima.
   *
   * @param {Array<{uid: string}>} owners agentes a los que asignar cazador
   */
  buildGhosts(owners = []) {
    this.clearGhosts();

    const count = Math.max(1, Math.min(owners.length || this.playersCount, MAX_PLAYERS));

    for (let i = 0; i < count; i++) {
      const owner = owners[i] || null;
      const ghost = new GhostEnemyEntity(this.scene, {
        index: i,
        ownerUid: owner ? owner.uid : null
      });
      ghost.setSpeedForLevel(this.level);
      // La rejilla es lo que le deja ver y rodear muros mientras acecha; sin ella cae
      // al comportamiento de siempre. Ver `GhostBrain`.
      ghost.setLevel({ navGrid: this.navGrid, obstacleBoxes: this.obstacleBoxes });

      // Aparecen repartidos junto a las salidas, en el extremo opuesto al spawn.
      // El `variant` los separa: con el 0 fijo que había antes, todos habrían caído
      // en la misma celda —y encima justo sobre la puerta.
      const anchor = this.exitPositions[i % Math.max(1, this.exitPositions.length)] || this.info.exitPos;
      const start = this.spawnFor(i * 7, anchor);
      ghost.spawnAt(start.x, start.z);

      this.ghosts.push(ghost);
    }
  }

  /** Reasigna los cazadores sin rehacer el nivel (alguien entra o sale en partida). */
  syncGhostOwners(owners = []) {
    if (owners.length === 0) return;
    if (owners.length !== this.ghosts.length) {
      this.buildGhosts(owners);
      return;
    }
    this.ghosts.forEach((ghost, i) => { ghost.ownerUid = owners[i].uid; });
  }

  clearGhosts() {
    this.ghosts.forEach(ghost => ghost.destroy());
    this.ghosts = [];
  }

  /**
   * Punto de aparición libre. `variant` desplaza la celda elegida para que dos
   * agentes no se solapen y para que reaparecer no devuelva siempre al mismo sitio.
   */
  spawnFor(variant = 0, origin = null) {
    const base = origin || (this.info ? this.info.spawnPos : { x: 0, z: 0 });
    if (!this.navGrid) return { x: base.x, z: base.z };
    return this.navGrid.findFreeCellNear(base, variant);
  }

  updatePuzzle(players, delta = 0) {
    return this.puzzle.update(players, delta);
  }

  isPlayerOnPlate(position) {
    return this.puzzle.isPlayerOnPlate(position);
  }

  isAtExit(position) {
    return this.puzzle.isAtExit(position);
  }

  /** Posiciones de todas las compuertas del nivel. */
  get exitPositions() {
    return this.info && this.info.exitPositions ? this.info.exitPositions : [];
  }

  clear() {
    this.dungeon.clear();
    this.puzzle.clear();
    // Suelta las mallas del atrezo pero conserva la geometría fusionada y el material,
    // que están marcados como compartidos y los hereda la sala siguiente.
    this.props.clear();
    this.clearGhosts();
    if (this.flowFields) this.flowFields.clear();
    this.info = null;
    this.startedAt = 0;
  }
}
