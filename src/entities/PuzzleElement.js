import * as THREE from 'three';
import { disposeObject3D, markShared } from '../engine/disposal.js';
import { PALETTE, neonMaterial, darkBodyMaterial } from '../engine/materials.js';
import { paintNode } from '../procedural/puzzles/paint.js';

/**
 * La placa de un nodo. Idéntica en todos, así que la geometría se comparte y sobrevive al
 * cambio de nivel; lo que sí es propio de cada nodo es su **material**, porque ahí vive el
 * estado del puzle. Ver `puzzles/paint.js`.
 */
const PAD_GEO = markShared(new THREE.BoxGeometry(1.2, 0.12, 1.2));

export class PuzzleElement {
  constructor(type, x, z, options = {}) {
    this.type = type; // 'plate', 'door', 'laser', 'terminal'
    this.x = x;
    this.z = z;
    this.options = options;
    this.active = false;

    this.mesh = new THREE.Group();
    this.mesh.position.set(x, 0, z);

    this.initMesh();
  }

  /**
   * ## Qué construye aquí cada tipo, y qué no
   *
   * Un `plate` monta **sólo su placa**. La base sobre la que se apoya es idéntica en todos
   * los nodos y no cambia nunca, así que la dibuja `PuzzleArchetype` para todos a la vez en
   * una sola instancia: con cinco nodos eran cinco envíos que ahora es uno.
   *
   * Un `door` no monta **nada**. Es sólo la lógica —dónde está y quién la pisa, que
   * `checkCollision` resuelve con `this.x`/`this.z` sin mirar la malla—; el marco, el campo
   * de fuerza y la baliza los monta el arquetipo agrupados para todas las salidas, y le
   * pasa a cada puerta el material del campo en `doorMat`.
   *
   * Lo que **no** se agrupa es la placa, y es deliberado: su material *es* el estado del
   * puzle, cuatro ficheros lo escriben por su nombre (`node.padMat`) y uno de ellos lo hace
   * cada fotograma. Agruparla obligaría a reescribir ese contrato para ganar una llamada.
   */
  initMesh() {
    if (this.type === 'plate') {
      this.padMat = neonMaterial(PALETTE.PLATE_IDLE, { intensity: 0.3, roughness: 1 });
      this.pad = new THREE.Mesh(PAD_GEO, this.padMat);
      this.pad.position.y = 0.1;
      this.pad.receiveShadow = true;
      this.mesh.add(this.pad);
    }
    else if (this.type === 'terminal') {
      // Data Terminal Node
      const poleGeo = new THREE.CylinderGeometry(0.2, 0.3, 1.6, 8);
      const poleMat = darkBodyMaterial(PALETTE.POLE_DARK, { metalness: 0.8, roughness: 1 });
      const pole = new THREE.Mesh(poleGeo, poleMat);
      pole.position.y = 0.8;
      this.mesh.add(pole);

      const screenGeo = new THREE.BoxGeometry(0.8, 0.6, 0.2);
      this.screenMat = neonMaterial(PALETTE.CYAN, { intensity: 0.6, roughness: 1 });
      const screen = new THREE.Mesh(screenGeo, this.screenMat);
      screen.position.set(0, 1.4, 0);
      screen.rotation.x = -0.3;
      this.mesh.add(screen);
    }
  }

  setActive(state) {
    this.active = state;

    if (this.type === 'plate') {
      paintNode(this, state, {
        activeColor: PALETTE.PLATE_ACTIVE,
        idleColor: PALETTE.PLATE_IDLE,
        activeIntensity: 1.0,
        idleIntensity: 0.3
      });
    } else if (this.type === 'door') {
      // El material del campo de fuerza lo comparten todas las salidas y lo inyecta
      // `PuzzleArchetype.buildExitGates`: se abren todas a la vez, así que escribirlo una
      // vez por puerta es redundante pero inofensivo. Sin él —una puerta creada suelta,
      // como en las validaciones— no hay nada que pintar.
      if (!this.doorMat) return;

      const color = state ? PALETTE.DOOR_OPEN : PALETTE.DOOR_LOCKED;
      this.doorMat.color.setHex(color);
      this.doorMat.emissive.setHex(color);
      // Abierta se vuelve casi transparente: es la señal de que ya se puede cruzar.
      this.doorMat.opacity = state ? 0.2 : 0.7;
    }
  }

  checkCollision(playerPos) {
    const dx = Math.abs(playerPos.x - this.x);
    const dz = Math.abs(playerPos.z - this.z);
    return dx < 1.0 && dz < 1.0;
  }

  /**
   * Libera geometrías y materiales.
   *
   * No existía, y `PuzzleArchetype.clear()` se limitaba a sacar los nodos y la
   * puerta de la escena. Cada elemento son dos geometrías y dos materiales, así
   * que cada cambio de nivel dejaba entre 8 y 24 objetos huérfanos en la GPU que
   * no se recuperaban ni reiniciando la partida.
   */
  dispose(scene = null) {
    disposeObject3D(this.mesh, scene);
  }
}
