import { DungeonGenerator } from '../procedural/DungeonGen.js';
import { PuzzleGenerator } from '../procedural/PuzzleGen.js';
import { selectPuzzleType } from '../procedural/puzzles/index.js';
import { GhostEnemyEntity } from '../entities/GhostEnemy.js';

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
    this.ghost = null;

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

  build({ level = 1, seed = 1, seedOffset = 0, playersCount = 1 }) {
    this.level = level;
    this.seed = seed;
    this.seedOffset = seedOffset;
    this.playersCount = Math.max(1, Math.min(playersCount, 3));

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

    this.buildGhost();
    this.startedAt = Date.now();
    return this.info;
  }

  buildGhost() {
    if (this.ghost) this.ghost.destroy();
    this.ghost = new GhostEnemyEntity(this.scene);
    this.ghost.setSpeedForLevel(this.level);

    // El fantasma aparece junto a la salida, en el extremo opuesto al spawn.
    const start = this.spawnFor(0, this.info.exitPos);
    this.ghost.spawnAt(start.x, start.z);
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

  clear() {
    this.dungeon.clear();
    this.puzzle.clear();
    if (this.ghost) {
      this.ghost.destroy();
      this.ghost = null;
    }
    this.info = null;
    this.startedAt = 0;
  }
}
