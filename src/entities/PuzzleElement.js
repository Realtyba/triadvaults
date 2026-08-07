import * as THREE from 'three';
import { disposeObject3D } from '../engine/disposal.js';
import { PALETTE, neonMaterial, darkBodyMaterial } from '../engine/materials.js';
import { paintNode } from '../procedural/puzzles/paint.js';

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

  initMesh() {
    if (this.type === 'plate') {
      // Pressure Plate
      const baseGeo = new THREE.BoxGeometry(1.6, 0.1, 1.6);
      const baseMat = new THREE.MeshStandardMaterial({ color: PALETTE.PLATE_BASE, roughness: 0.5 });
      const base = new THREE.Mesh(baseGeo, baseMat);
      base.position.y = 0.05;
      base.receiveShadow = true;
      this.mesh.add(base);

      const padGeo = new THREE.BoxGeometry(1.2, 0.12, 1.2);
      this.padMat = neonMaterial(PALETTE.PLATE_IDLE, { intensity: 0.3, roughness: 1 });
      this.pad = new THREE.Mesh(padGeo, this.padMat);
      this.pad.position.y = 0.1;
      this.mesh.add(this.pad);
    } 
    else if (this.type === 'door') {
      // Exit Door Barrier
      const frameGeo = new THREE.BoxGeometry(3.2, 4, 0.4);
      const frameMat = darkBodyMaterial(PALETTE.STRUCTURE_DARK, { metalness: 0.9, roughness: 1 });
      const frame = new THREE.Mesh(frameGeo, frameMat);
      frame.position.y = 2;
      frame.castShadow = true;
      this.mesh.add(frame);

      const forceFieldGeo = new THREE.PlaneGeometry(2.6, 3.6);
      this.doorMat = neonMaterial(PALETTE.DOOR_LOCKED, {
        intensity: 0.8,
        roughness: 1,
        opacity: 0.7
      });
      this.doorMat.side = THREE.DoubleSide;
      this.forceField = new THREE.Mesh(forceFieldGeo, this.doorMat);
      this.forceField.position.y = 2;
      this.mesh.add(this.forceField);
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
