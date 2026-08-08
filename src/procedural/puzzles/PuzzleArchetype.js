import * as THREE from 'three';
import { PuzzleElement } from '../../entities/PuzzleElement.js';
import { disposeObject3D, markShared } from '../../engine/disposal.js';
import { PALETTE, neonMaterial, darkBodyMaterial } from '../../engine/materials.js';
import { mergedModel } from '../../engine/mergedModel.js';
import { PUZZLE_MODELS } from '../../assets/manifest.js';
import { clampPlayers } from '../../../shared/constants.js';

/**
 * Piezas idénticas en todos los niveles: se comparten y sobreviven al cambio de sala, como
 * `UNIT_BOX` en `DungeonGen`. Antes cada nodo y cada compuerta construían las suyas, y cada
 * nivel dejaba entre 8 y 24 objetos huérfanos en la GPU.
 */
const BASE_GEO = markShared(new THREE.BoxGeometry(1.6, 0.1, 1.6));
const BASE_MAT = markShared(new THREE.MeshStandardMaterial({
  color: PALETTE.PLATE_BASE,
  roughness: 0.5
}));

/** Plano de altura unidad: la altura real la pone la matriz de cada instancia. */
const FIELD_GEO = markShared(new THREE.PlaneGeometry(2.6, 1));

/** Marco de respaldo, para cuando no hay `.glb`. Es la compuerta de siempre. */
const FRAME_GEO = markShared(new THREE.BoxGeometry(3.2, 4, 0.4));
const FRAME_MAT = markShared(darkBodyMaterial(PALETTE.STRUCTURE_DARK, {
  metalness: 0.9,
  roughness: 1
}));

const EXIT_BEACON_GEO = markShared(new THREE.CylinderGeometry(0.08, 0.4, 8, 16));
const EXIT_BEACON_MAT = markShared(new THREE.MeshBasicMaterial({
  color: PALETTE.DOOR_LOCKED,
  transparent: true,
  opacity: 0.5
}));

const UP = new THREE.Vector3(0, 1, 0);
const matrix = new THREE.Matrix4();
const position = new THREE.Vector3();
const quaternion = new THREE.Quaternion();
const scale = new THREE.Vector3();
const tint = new THREE.Color();

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
    return clampPlayers(playersCount);
  }

  /** ¿Tiene sentido este arquetipo con este número de agentes? */
  static supports() {
    return true;
  }

  constructor(scene) {
    this.scene = scene;
    this.nodes = [];
    this.beacons = [];
    /** @type {import('../../entities/PuzzleElement.js').PuzzleElement[]} */
    this.exitDoors = [];
    /** Marcos, campos de fuerza y balizas de salida, agrupados. Ver `buildExitGates`. */
    this.exitGates = [];
    /** Bases y núcleos de los nodos, agrupados. Ver `buildNodeBases` / `buildNodeCores`. */
    this.nodeBases = null;
    this.nodeCores = null;
    this.playersCount = 1;
    this.solved = false;
    this.elapsed = 0;
    /**
     * `buildExitGates` y `buildNodeCores` son asíncronos y nadie los espera. Si el nivel
     * cambia mientras cargan, lo que llegue tarde iría a parar a la sala siguiente.
     */
    this.cleared = false;
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

  async generate(info, playersCount = 1) {
    this.clear();
    this.cleared = false;
    this.playersCount = clampPlayers(playersCount);
    this.theme = info.theme;

    const p1 = this.buildExits(info.exitPositions || [info.exitPos]);
    this.build(info);
    
    // Ahora las promesas SÍ se esperan: así evitamos que los modelos `.glb`
    // entren en la escena tarde y fuercen una compilación GLSL en pleno juego.
    const p2 = this.buildNodeBases();
    this.buildNodeCores();
    
    await Promise.all([p1, p2]);
    return { requiredCount: this.requiredPlateCount, exitPos: info.exitPos };
  }

  /** @abstract Monta los nodos del arquetipo. */
  build() {
    throw new Error('Cada arquetipo debe implementar build()');
  }

  /**
   * Monta todas las compuertas del nivel.
   *
   * Cualquiera vale para superarlo: son salidas alternativas, no una secuencia. El
   * interés está en que el grupo tenga que decidir a cuál corre cuando el puzle
   * cede, con el fantasma —o los fantasmas— ya encima.
   */
  async buildExits(positions = []) {
    positions.forEach(exitPos => {
      const door = new PuzzleElement('door', exitPos.x, exitPos.z);
      this.scene.add(door.mesh);
      this.exitDoors.push(door);
    });
    await this.buildExitGates(positions);
  }

  /**
   * Marcos, campos de fuerza y balizas de todas las salidas: **tres llamadas de dibujo**,
   * haya una compuerta o tres.
   *
   * Se pueden agrupar porque las compuertas no tienen estado propio: se abren todas a la
   * vez en `openExit`, así que comparten un único material de campo de fuerza y basta con
   * escribirlo una vez. Antes eran tres mallas por salida —marco, campo y baliza—, o sea
   * nueve envíos con tres salidas abiertas.
   *
   * Es asíncrono y nadie lo espera, y no pasa nada: las compuertas están ocultas hasta que
   * el puzle cede, que tarda bastante más de lo que tarda en llegar un `.glb` de 28 kB. Si
   * cediera antes, `showExits` ya habrá puesto `this.solved` y se montan visibles.
   *
   * @param {Array<{x: number, z: number}>} positions
   */
  async buildExitGates(positions = []) {
    if (positions.length === 0) return;

    const gate = await mergedModel(PUZZLE_MODELS.gate);
    if (this.cleared) return;

    // El kit no trae "puerta": trae un tramo de pasillo, que es mejor —se atraviesa— pero
    // sólo si mira hacia donde está el jugador. Visto de canto no se lee como una salida.
    const frameGeo = gate ? gate.geometry : FRAME_GEO;
    const frameMat = gate ? gate.material : FRAME_MAT;

    frameGeo.computeBoundingBox();
    const frameHeight = frameGeo.boundingBox.max.y - frameGeo.boundingBox.min.y;
    // El campo llena el hueco sin desbordarlo por arriba, mida lo que mida el marco.
    const fieldHeight = Math.max(1.5, frameHeight * 0.85);

    this.doorMat = neonMaterial(PALETTE.DOOR_LOCKED, {
      intensity: 0.8,
      roughness: 1,
      opacity: 0.7
    });
    this.doorMat.side = THREE.DoubleSide;
    this.exitDoors.forEach(door => { door.doorMat = this.doorMat; });

    const frames = new THREE.InstancedMesh(frameGeo, frameMat, positions.length);
    frames.castShadow = true;
    frames.receiveShadow = true;
    const fields = new THREE.InstancedMesh(FIELD_GEO, this.doorMat, positions.length);
    const beacons = new THREE.InstancedMesh(EXIT_BEACON_GEO, EXIT_BEACON_MAT, positions.length);

    positions.forEach((exitPos, i) => {
      const yaw = Math.atan2(-exitPos.x, -exitPos.z);
      quaternion.setFromAxisAngle(UP, yaw);

      position.set(exitPos.x, gate ? 0 : frameHeight / 2, exitPos.z);
      frames.setMatrixAt(i, matrix.compose(position, quaternion, scale.setScalar(1)));

      position.set(exitPos.x, fieldHeight / 2, exitPos.z);
      fields.setMatrixAt(i, matrix.compose(position, quaternion, scale.set(1, fieldHeight, 1)));

      position.set(exitPos.x, 4, exitPos.z);
      beacons.setMatrixAt(i, matrix.compose(position, quaternion, scale.setScalar(1)));
    });

    [frames, fields, beacons].forEach(mesh => {
      mesh.instanceMatrix.needsUpdate = true;
      // Sin esto el recorte por frustum usa la esfera de la geometría sin instanciar,
      // centrada en el origen, y las compuertas desaparecen en cuanto la cámara deja de
      // mirar al centro de la sala. Mismo fallo que documenta `DungeonGen.buildWalls`.
      mesh.computeBoundingSphere();
      // El puzle pudo resolverse mientras cargaba el marco.
      mesh.visible = this.solved;
      this.scene.add(mesh);
      this.exitGates.push(mesh);
    });

    if (this.solved) this.exitDoors.forEach(door => door.setActive(true));
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
    // El núcleo que flota encima lleva el mismo color que la baliza. Se guarda aparte de
    // `data` para no pisar lo que cada arquetipo mete ahí.
    element.tint = colorHex;
    element.beacon = this.buildBeacon(cell.x, cell.z, colorHex);
    this.scene.add(element.mesh);
    this.nodes.push(element);
    return element;
  }

  /**
   * Las bases de todos los nodos, en una llamada.
   *
   * Son idénticas y no cambian nunca, así que instanciarlas es gratis: con cinco nodos,
   * cinco envíos que pasan a ser uno.
   */
  buildNodeBases() {
    if (this.nodes.length === 0) return;

    const mesh = new THREE.InstancedMesh(BASE_GEO, BASE_MAT, this.nodes.length);
    mesh.receiveShadow = true;
    this.nodes.forEach((node, i) => {
      position.set(node.x, 0.05, node.z);
      mesh.setMatrixAt(i, matrix.compose(position, quaternion.identity(), scale.setScalar(1)));
    });
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();

    this.scene.add(mesh);
    this.nodeBases = mesh;
  }

  /**
   * El núcleo que flota y gira sobre cada nodo, en una llamada.
   *
   * Es **decoración**: si el `.glb` no está, no aparece y el nodo se sigue leyendo por su
   * placa, que es la que lleva el color y el hundido. Misma regla que el atrezo.
   *
   * El tinte por nodo viaja en `instanceColor`, que multiplica al difuso, así que los cinco
   * núcleos de un `SequenceLock` salen de colores distintos sin costar cinco materiales. El
   * **estado** sigue viviendo en la emisión de la placa, que es lo que recoge el bloom: el
   * núcleo dice de quién es el nodo, no si está pisado.
   */
  async buildNodeCores() {
    const core = await mergedModel(PUZZLE_MODELS.node);
    if (!core || this.cleared || this.nodes.length === 0) return;

    const mesh = new THREE.InstancedMesh(core.geometry, core.material, this.nodes.length);
    this.nodes.forEach((node, i) => {
      mesh.setColorAt(i, tint.setHex(node.tint ?? 0xffffff));
    });
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;

    this.nodeCores = mesh;
    this.updateNodeCores();
    mesh.computeBoundingSphere();
    // Flotan y giran, así que la esfera calculada una vez se les queda corta y parpadearían
    // al llegar arriba. El margen cubre el recorrido completo del vaivén.
    mesh.boundingSphere.radius += 0.6;

    this.scene.add(mesh);
  }

  /**
   * Coloca los núcleos en su punto del vaivén. Se llama cada fotograma desde `update`.
   *
   * Son tres o cinco `compose` por fotograma: no se mide. El desfase por índice evita que
   * suban y bajen todos a la vez, que delataría que es un bucle.
   */
  updateNodeCores() {
    if (!this.nodeCores) return;

    this.nodes.forEach((node, i) => {
      // Pisado sube y gira más deprisa: es el mismo dato que la placa, dicho de otra forma
      // y visible desde el otro extremo de la sala.
      const lift = node.active ? 1.5 : 1.2;
      position.set(
        node.x,
        lift + Math.sin(this.elapsed * 2 + i) * 0.12,
        node.z
      );
      quaternion.setFromAxisAngle(UP, this.elapsed * (node.active ? 3.2 : 1.1) + i);
      this.nodeCores.setMatrixAt(i, matrix.compose(position, quaternion, scale.setScalar(1)));
    });
    this.nodeCores.instanceMatrix.needsUpdate = true;
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
    // Antes del corte por `solved`: los núcleos siguen girando cuando el puzle ya cedió, y
    // pararse en seco al resolverlo parece que el juego se ha colgado.
    this.updateNodeCores();

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

  /**
   * Abre todas las compuertas.
   *
   * Puede llegar antes de que `buildExitGates` haya terminado —el puzle se resuelve en
   * segundos y el marco tarda lo que tarde el `.glb`—. Por eso deja `solved` puesto y el
   * montaje consulta ese estado al terminar: quien llegue el último enciende las luces.
   */
  openExit() {
    this.solved = true;
    this.exitDoors.forEach(door => door.setActive(true));
    this.exitGates.forEach(mesh => { mesh.visible = true; });
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

  /** La primera compuerta. Para todas, `exitPositions`. */
  get exitDoor() {
    return this.exitDoors[0] || null;
  }

  get exitPosition() {
    return this.exitDoor ? this.exitDoor.mesh.position : null;
  }

  get exitPositions() {
    return this.exitDoors.map(door => door.mesh.position);
  }

  /** Vale cualquiera de las salidas abiertas. */
  isAtExit(position) {
    if (!this.solved) return false;
    return this.exitDoors.some(door => door.checkCollision(position));
  }

  // -------------------------------------------------------------- limpieza

  /**
   * Libera todo lo que montó este arquetipo.
   *
   * Antes solo las balizas se disponían: los nodos y la puerta se sacaban de la
   * escena y sus geometrías y materiales se quedaban en la GPU para siempre. Es la
   * razón por la que `renderer.info.memory` subía nivel tras nivel sin bajar nunca.
   */
  clear() {
    // Corta en seco lo que siga cargando: `buildExitGates` y `buildNodeCores` no se
    // esperan, y sin esto lo que llegue tarde se montaría en la sala siguiente.
    this.cleared = true;

    this.nodes.forEach(node => node.dispose(this.scene));
    this.beacons.forEach(beacon => disposeObject3D(beacon, this.scene));
    this.exitDoors.forEach(door => door.dispose(this.scene));
    // Las agrupadas comparten geometría y material salvo el campo de fuerza, que es de este
    // nivel; `disposeObject3D` distingue por `userData.shared` y además suelta el búfer de
    // matrices del `InstancedMesh`, que no cuelga ni de la geometría ni del material.
    this.exitGates.forEach(mesh => disposeObject3D(mesh, this.scene));
    if (this.nodeBases) disposeObject3D(this.nodeBases, this.scene);
    if (this.nodeCores) disposeObject3D(this.nodeCores, this.scene);

    this.nodes = [];
    this.beacons = [];
    this.exitDoors = [];
    this.exitGates = [];
    this.nodeBases = null;
    this.nodeCores = null;
    this.doorMat = null;
    this.solved = false;
    this.elapsed = 0;
  }
}
