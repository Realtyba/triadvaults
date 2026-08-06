import { selectPuzzleType, PressurePlates } from './puzzles/index.js';

/**
 * Anfitrión del puzle del nivel.
 *
 * Antes esta clase *era* el puzle: construía placas y compuerta y evaluaba la
 * única regla que había. Ahora elige el arquetipo que toca —de forma determinista
 * a partir de la semilla del servidor— y delega en él, así que el resto del juego
 * sigue hablando con un solo objeto y no se entera de cuántos tipos existen.
 *
 * La API pública se mantiene para no tocar `LevelController` ni el bucle de juego.
 */
export class PuzzleGenerator {
  constructor(scene) {
    this.scene = scene;
    this.archetype = null;
  }

  /** Clave del arquetipo activo (`plates`, `sequence`, `timed`, `relay`). */
  get kind() {
    return this.archetype ? this.archetype.constructor.key : null;
  }

  get requiredPlateCount() {
    return this.archetype ? this.archetype.requiredPlateCount : 0;
  }

  get plates() {
    return this.archetype ? this.archetype.nodes : [];
  }

  get exitDoor() {
    return this.archetype ? this.archetype.exitDoor : null;
  }

  /** Clave i18n del objetivo, que depende del arquetipo y del número de agentes. */
  get objectiveKey() {
    return this.archetype ? this.archetype.objectiveKey : 'solo_objective';
  }

  /**
   * @param {object} dungeonInfo salida de `DungeonGenerator.generateLevel`
   * @param {number} activePlayersCount
   * @param {typeof PressurePlates} [Type] arquetipo forzado; si se omite se elige
   *   por semilla. Lo usa la validación de niveles para recorrerlos todos.
   */
  generatePuzzle(dungeonInfo, activePlayersCount = 1, Type = null) {
    this.clear();

    const Archetype =
      Type ||
      selectPuzzleType({
        level: dungeonInfo.level,
        seed: dungeonInfo.seed,
        seedOffset: dungeonInfo.seedOffset,
        playersCount: activePlayersCount
      }) ||
      PressurePlates;

    this.archetype = new Archetype(this.scene);
    return this.archetype.generate(dungeonInfo, activePlayersCount);
  }

  update(players = [], delta = 0) {
    if (!this.archetype) {
      return { solved: false, progressPercent: 0, activeCount: 0, newlyPressed: [] };
    }
    return this.archetype.update(players, delta);
  }

  isPlayerOnPlate(position) {
    return this.archetype ? this.archetype.isPlayerOnPlate(position) : false;
  }

  isAtExit(position) {
    return this.archetype ? this.archetype.isAtExit(position) : false;
  }

  platePosition(id) {
    return this.archetype ? this.archetype.platePosition(id) : null;
  }

  get exitPosition() {
    return this.archetype ? this.archetype.exitPosition : null;
  }

  clear() {
    if (this.archetype) this.archetype.clear();
    this.archetype = null;
  }
}
