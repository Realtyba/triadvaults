import * as THREE from 'three';

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
      const baseMat = new THREE.MeshStandardMaterial({ color: 0x222638, roughness: 0.5 });
      const base = new THREE.Mesh(baseGeo, baseMat);
      base.position.y = 0.05;
      base.receiveShadow = true;
      this.mesh.add(base);

      const padGeo = new THREE.BoxGeometry(1.2, 0.12, 1.2);
      this.padMat = new THREE.MeshStandardMaterial({
        color: 0xffa500,
        emissive: 0xffa500,
        emissiveIntensity: 0.3
      });
      this.pad = new THREE.Mesh(padGeo, this.padMat);
      this.pad.position.y = 0.1;
      this.mesh.add(this.pad);
    } 
    else if (this.type === 'door') {
      // Exit Door Barrier
      const frameGeo = new THREE.BoxGeometry(3.2, 4, 0.4);
      const frameMat = new THREE.MeshStandardMaterial({ color: 0x151828, metalness: 0.9 });
      const frame = new THREE.Mesh(frameGeo, frameMat);
      frame.position.y = 2;
      frame.castShadow = true;
      this.mesh.add(frame);

      const forceFieldGeo = new THREE.PlaneGeometry(2.6, 3.6);
      this.doorMat = new THREE.MeshStandardMaterial({
        color: 0xff0055,
        emissive: 0xff0055,
        emissiveIntensity: 0.8,
        transparent: true,
        opacity: 0.7,
        side: THREE.DoubleSide
      });
      this.forceField = new THREE.Mesh(forceFieldGeo, this.doorMat);
      this.forceField.position.y = 2;
      this.mesh.add(this.forceField);
    }
    else if (this.type === 'terminal') {
      // Data Terminal Node
      const poleGeo = new THREE.CylinderGeometry(0.2, 0.3, 1.6, 8);
      const poleMat = new THREE.MeshStandardMaterial({ color: 0x1a1e30, metalness: 0.8 });
      const pole = new THREE.Mesh(poleGeo, poleMat);
      pole.position.y = 0.8;
      this.mesh.add(pole);

      const screenGeo = new THREE.BoxGeometry(0.8, 0.6, 0.2);
      this.screenMat = new THREE.MeshStandardMaterial({
        color: 0x00f3ff,
        emissive: 0x00f3ff,
        emissiveIntensity: 0.6
      });
      const screen = new THREE.Mesh(screenGeo, this.screenMat);
      screen.position.set(0, 1.4, 0);
      screen.rotation.x = -0.3;
      this.mesh.add(screen);
    }
  }

  setActive(state) {
    this.active = state;
    if (this.type === 'plate') {
      if (state) {
        this.pad.position.y = 0.04;
        this.padMat.color.setHex(0x00ff66);
        this.padMat.emissive.setHex(0x00ff66);
        this.padMat.emissiveIntensity = 1.0;
      } else {
        this.pad.position.y = 0.1;
        this.padMat.color.setHex(0xffa500);
        this.padMat.emissive.setHex(0xffa500);
        this.padMat.emissiveIntensity = 0.3;
      }
    } else if (this.type === 'door') {
      if (state) {
        this.doorMat.color.setHex(0x00ff66);
        this.doorMat.emissive.setHex(0x00ff66);
        this.doorMat.opacity = 0.2; // Opened door barrier
      } else {
        this.doorMat.color.setHex(0xff0055);
        this.doorMat.emissive.setHex(0xff0055);
        this.doorMat.opacity = 0.7; // Locked door barrier
      }
    }
  }

  checkCollision(playerPos) {
    const dx = Math.abs(playerPos.x - this.x);
    const dz = Math.abs(playerPos.z - this.z);
    return dx < 1.0 && dz < 1.0;
  }
}
