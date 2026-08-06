import * as THREE from 'three';
import { moveWithSlide, turnTowards } from '../physics/collision.js';

export const PLAYER_COLORS = [0x00f3ff, 0xff0077, 0x00ff66]; // agente 1, 2, 3
export const PLAYER_RADIUS = 0.4;
export const PLAYER_SPEED = 8.5;

/** Suavizado de las posiciones remotas: sin esto los otros agentes se ven a saltos. */
const REMOTE_LERP = 12;

export class PlayerEntity {
  constructor({ uid, name, index = 0, isLocal = false }) {
    this.uid = uid;
    this.name = name;
    this.index = index;
    this.isLocal = isLocal;
    this.speed = PLAYER_SPEED;
    this.alive = true;
    this.health = 100;

    this.colorHex = PLAYER_COLORS[index % PLAYER_COLORS.length];
    this.targetPosition = new THREE.Vector3();
    this.targetRotationY = 0;

    this.mesh = new THREE.Group();
    this.buildMesh();
  }

  buildMesh() {
    const body = new THREE.Mesh(
      new THREE.CylinderGeometry(0.4, 0.3, 1.4, 8),
      new THREE.MeshStandardMaterial({ color: 0x111525, roughness: 0.3, metalness: 0.8 })
    );
    body.position.y = 0.7;
    body.castShadow = true;
    body.receiveShadow = true;
    this.mesh.add(body);
    this.bodyMesh = body;

    const head = new THREE.Mesh(
      new THREE.BoxGeometry(0.5, 0.4, 0.5),
      new THREE.MeshStandardMaterial({
        color: this.colorHex,
        emissive: this.colorHex,
        emissiveIntensity: 0.8,
        roughness: 0.2
      })
    );
    head.position.set(0, 1.4, 0.1);
    head.castShadow = true;
    this.mesh.add(head);
    this.headMesh = head;

    const ringGeo = new THREE.RingGeometry(0.5, 0.65, 16);
    ringGeo.rotateX(-Math.PI / 2);
    const ring = new THREE.Mesh(
      ringGeo,
      new THREE.MeshBasicMaterial({ color: this.colorHex, side: THREE.DoubleSide })
    );
    ring.position.y = 0.02;
    this.mesh.add(ring);
    this.ringMesh = ring;

    this.light = new THREE.PointLight(this.colorHex, 1.5, 6);
    this.light.position.set(0, 1.5, 0);
    this.mesh.add(this.light);
  }

  setPosition(x, y, z) {
    this.mesh.position.set(x, y, z);
    this.targetPosition.set(x, y, z);
  }

  getPosition() {
    return this.mesh.position;
  }

  /** Estado de red de un jugador remoto; se interpola en `updateRemote`. */
  setNetworkTransform(position, rotationY) {
    this.targetPosition.set(position.x, position.y, position.z);
    if (typeof rotationY === 'number') this.targetRotationY = rotationY;
  }

  setAlive(alive) {
    this.alive = alive;
    const opacity = alive ? 1 : 0.25;
    [this.bodyMesh, this.headMesh, this.ringMesh].forEach(mesh => {
      if (!mesh) return;
      mesh.material.transparent = !alive;
      mesh.material.opacity = opacity;
    });
    if (this.light) this.light.intensity = alive ? 1.5 : 0.3;
  }

  /**
   * Escudo de reaparición. El parpadeo es lo que comunica que estos segundos no
   * cuentan: sin señal visible, no recibir daño se lee como que el juego falla.
   */
  setShield(durationMs) {
    this.shieldUntil = performance.now() + (durationMs || 0);
  }

  get isShielded() {
    return this.shieldUntil !== undefined && performance.now() < this.shieldUntil;
  }

  updateShieldVisual() {
    if (!this.bodyMesh) return;

    if (!this.isShielded) {
      if (this.shieldWasOn) {
        this.setAlive(this.alive); // restaura opacidad y luz al terminar
        this.shieldWasOn = false;
      }
      return;
    }

    this.shieldWasOn = true;
    const blink = 0.45 + Math.abs(Math.sin(performance.now() * 0.012)) * 0.55;
    [this.bodyMesh, this.headMesh, this.ringMesh].forEach(mesh => {
      if (!mesh) return;
      mesh.material.transparent = true;
      mesh.material.opacity = blink;
    });
    if (this.light) this.light.intensity = 1.5 * blink;
  }

  /** Movimiento del jugador local a partir del input. */
  update(delta, moveVector, obstacleBoxes = []) {
    if (!this.alive || !moveVector || moveVector.lengthSq() === 0) return false;

    const step = moveVector.clone().multiplyScalar(this.speed * delta);
    const moved = moveWithSlide(this.mesh.position, step, obstacleBoxes, PLAYER_RADIUS);

    this.mesh.rotation.y = turnTowards(
      this.mesh.rotation.y,
      Math.atan2(moveVector.x, moveVector.z),
      delta
    );
    return moved;
  }

  /** Interpolación de un jugador remoto hacia su último estado conocido. */
  updateRemote(delta) {
    const factor = Math.min(1, delta * REMOTE_LERP);
    this.mesh.position.lerp(this.targetPosition, factor);
    this.mesh.rotation.y = turnTowards(this.mesh.rotation.y, this.targetRotationY, delta);
  }

  dispose(scene) {
    scene.remove(this.mesh);
    this.mesh.traverse(child => {
      if (child.geometry) child.geometry.dispose();
      if (child.material) child.material.dispose();
    });
  }
}
