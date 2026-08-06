import * as THREE from 'three';
import { PuzzleElement } from '../../entities/PuzzleElement.js';

/**
 * Base común de los arquetipos de puzle.
 *
 * Antes solo existía un puzle —pisar todas las placas a la vez— y su lógica vivía
 * mezclada con la construcción de la compuerta dentro de `PuzzleGen`. Al separar
 * el contrato, añadir un tipo nuevo no obliga a tocar el generador ni el bucle de
 * juego: basta con implementar `build` y `evaluate`.
 *
 * Contrato que espera el resto del juego:
 *   - `generate(info, playersCount)` monta la escena.
 *   - `update(players, delta)` devuelve `{ solved, progressPercent, newlyPressed }`.
 *   - `isPlayerOnPlate(pos)` lo consulta la IA del fantasma para priorizar objetivos.
 *   - `objectiveKey` es la clave i18n del texto del HUD.
 *
 * Las subclases **no** deciden dónde va nada: las celdas llegan ya validadas por
 * `LayoutGen` (libres y alcanzables desde la aparición).
 */
export class PuzzleArchetype {
  /** Nodos que el trazado debe reservar. Lo consulta `LevelController` antes de generar. */
  static nodeCount(playersCount) {
    return Math.max(1, Math.min(playersCount, 3));
  }

  /** ¿Tiene sentido este arquetipo con este número de agentes? */
  static supports() {
    return true;
  }

  constructor(scene) {
    this.scene = scene;
    this.nodes = [];
    this.beacons = [];
    this.exitDoor = null;
    this.exitBeacon = null;
    this.playersCount = 1;
    this.solved = false;
    this.elapsed = 0;
  }

  /** Clave i18n del objetivo. La sobrescribe cada arquetipo. */
  get objectiveKey() {
    return 'solo_objective';
  }

  /** Cuántos nodos hay que activar; lo muestra el HUD. */
  get requiredPlateCount() {
    return this.nodes.length;
  }

  // ------------------------------------------------------------- montaje

  generate(info, playersCount = 1) {
    this.clear();
    this.playersCount = Math.max(1, Math.min(playersCount, 3));
    this.theme = info.theme;

    this.buildExit(info.exitPos);
    this.build(info);
    return { requiredCount: this.requiredPlateCount, exitPos: info.exitPos };
  }

  /** @abstract Monta los nodos del arquetipo. */
  build() {
    throw new Error('Cada arquetipo debe implementar build()');
  }

  buildExit(exitPos) {
    this.exitDoor = new PuzzleElement('door', exitPos.x, exitPos.z);
    this.exitDoor.mesh.visible = false;
    this.scene.add(this.exitDoor.mesh);

    const beacon = this.buildBeacon(exitPos.x, exitPos.z, 0xff0055, { height: 8, radius: 0.4 });
    beacon.visible = false;
    this.exitBeacon = beacon;
  }

  /**
   * Pilar de luz sobre un punto, para verlo desde el otro extremo de la sala.
   * @returns {THREE.Mesh}
   */
  buildBeacon(x, z, colorHex, { height = 6, radius = 0.5 } = {}) {
    const beacon = new THREE.Mesh(
      new THREE.CylinderGeometry(0.08, radius, height, 16),
      new THREE.MeshBasicMaterial({ color: colorHex, transparent: true, opacity: 0.5 })
    );
    beacon.position.set(x, height / 2, z);
    this.scene.add(beacon);
    this.beacons.push(beacon);
    return beacon;
  }

  /** Crea un nodo pisable y su baliza. `data` queda disponible en `node.data`. */
  addNode(cell, index, colorHex, data = {}) {
    const element = new PuzzleElement('plate', cell.x, cell.z, { id: index });
    element.data = data;
    element.beacon = this.buildBeacon(cell.x, cell.z, colorHex);
    this.scene.add(element.mesh);
    this.nodes.push(element);
    return element;
  }

  // -------------------------------------------------------------- lógica

  /** ¿Hay algún agente vivo sobre este nodo? */
  isNodePressed(node, players) {
    return players.some(p => p.alive !== false && node.checkCollision(p.position));
  }

  /**
   * @param {Array<{uid?: string, position: THREE.Vector3, alive?: boolean}>} players
   * @param {number} delta segundos desde el fotograma anterior
   */
  update(players = [], delta = 0) {
    this.elapsed += delta;

    if (this.solved) {
      return { solved: true, progressPercent: 100, activeCount: this.requiredPlateCount, newlyPressed: [] };
    }

    const result = this.evaluate(players, delta);
    if (result.solved) this.openExit();
    return result;
  }

  /** @abstract Decide el estado del puzle en este fotograma. */
  evaluate() {
    throw new Error('Cada arquetipo debe implementar evaluate()');
  }

  openExit() {
    this.solved = true;
    if (this.exitDoor) {
      this.exitDoor.mesh.visible = true;
      this.exitDoor.setActive(true);
    }
    if (this.exitBeacon) this.exitBeacon.visible = true;
  }

  // ------------------------------------------------------------ consultas

  /** Lo usa la IA del fantasma: pisar un nodo es lo que conviene interrumpir. */
  isPlayerOnPlate(position) {
    return this.nodes.some(node => node.checkCollision(position));
  }

  /** @returns {THREE.Vector3|null} */
  platePosition(id) {
    const node = this.nodes.find(n => n.options.id === id);
    return node ? node.mesh.position : null;
  }

  get exitPosition() {
    return this.exitDoor ? this.exitDoor.mesh.position : null;
  }

  isAtExit(position) {
    return !!this.exitDoor && this.solved && this.exitDoor.checkCollision(position);
  }

  // -------------------------------------------------------------- limpieza

  clear() {
    this.nodes.forEach(node => this.scene.remove(node.mesh));
    this.beacons.forEach(beacon => {
      this.scene.remove(beacon);
      if (beacon.geometry) beacon.geometry.dispose();
      if (beacon.material) beacon.material.dispose();
    });
    if (this.exitDoor) this.scene.remove(this.exitDoor.mesh);

    this.nodes = [];
    this.beacons = [];
    this.exitDoor = null;
    this.exitBeacon = null;
    this.solved = false;
    this.elapsed = 0;
  }
}
