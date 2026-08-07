import { DungeonGenerator } from '../procedural/DungeonGen.js';
import { PuzzleGenerator } from '../procedural/PuzzleGen.js';
import { selectPuzzleType } from '../procedural/puzzles/index.js';
import { GhostEnemyEntity } from '../entities/GhostEnemy.js';
import { clampPlayers, MAX_PLAYERS } from '../../shared/constants.js';

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

  build({ level = 1, seed = 1, seedOffset = 0, playersCount = 1, owners = [] }) {
    this.level = level;
    this.seed = seed;
    this.seedOffset = seedOffset;
    this.playersCount = clampPlayers(playersCount);

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

    this.lighting.setupCornerLights(this.info.sizeX, this.info.sizeZ, this.info.theme.color);
    this.puzzle.generatePuzzle(this.info, this.playersCount, Archetype);

    this.buildGhosts(owners);
    this.startedAt = Date.now();
    return this.info;
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
    this.clearGhosts();
    this.info = null;
    this.startedAt = 0;
  }
}
