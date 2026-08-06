import * as THREE from 'three';
import { CameraShake } from './CameraShake.js';

const ZOOM_MIN = 0.6;
const ZOOM_MAX = 1.8;
const ZOOM_STEP = 0.1;

/** Cuánto se adelanta la mirada en la dirección del movimiento, en unidades. */
const LOOK_AHEAD = 2.2;

export class EngineCamera {
  constructor() {
    this.aspect = window.innerWidth / window.innerHeight;
    this.camera = new THREE.PerspectiveCamera(50, this.aspect, 0.1, 1000);

    this.zoomLevel = 1.0;
    this.targetZoom = 1.0;
    this.baseOffset = new THREE.Vector3(0, 24, 18);
    this.offset = this.baseOffset.clone();
    this.target = new THREE.Vector3(0, 0, 0);
    this.smoothFactor = 0.12;

    this.shake = new CameraShake();
    this.lookAhead = new THREE.Vector3();
    this.lastPosition = new THREE.Vector3();
    this.hasLastPosition = false;
    this.scratch = new THREE.Vector3();

    this.camera.position.copy(this.offset);
    this.camera.lookAt(this.target);

    window.addEventListener('wheel', e => this.onScroll(e), { passive: true });
  }

  onScroll(e) {
    // Se mueve el zoom *objetivo*; el real lo persigue en `follow`. Antes el salto
    // era instantáneo en cada muesca de la rueda y se veía a tirones.
    const direction = e.deltaY > 0 ? 1 : -1;
    this.targetZoom = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, this.targetZoom + direction * ZOOM_STEP));
  }

  updateAspect(width, height) {
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  }

  /** Sacudida por daño, apertura de compuerta, etc. `amount` de 0 a 1. */
  addShake(amount) {
    this.shake.add(amount);
  }

  /**
   * Sigue al jugador local.
   *
   * Dos detalles que cambian mucho la sensación: el punto de mira se adelanta en la
   * dirección del movimiento (se ve a dónde vas, no de dónde vienes), y la sacudida
   * se suma después del suavizado, para que no se la coma el `lerp`.
   */
  follow(targetPosition, delta = 0.016) {
    if (!targetPosition) return;

    this.zoomLevel += (this.targetZoom - this.zoomLevel) * 0.15;
    this.offset.copy(this.baseOffset).multiplyScalar(this.zoomLevel);

    // Velocidad estimada a partir del desplazamiento real, sin depender del input:
    // así también se adelanta al empujar contra un muro o al deslizar.
    if (this.hasLastPosition) {
      this.scratch.subVectors(targetPosition, this.lastPosition);
      if (delta > 0) this.scratch.divideScalar(delta);
      this.scratch.y = 0;
      this.lookAhead.lerp(this.scratch.clampLength(0, 10).multiplyScalar(LOOK_AHEAD / 10), 0.08);
    }
    this.lastPosition.copy(targetPosition);
    this.hasLastPosition = true;

    const desired = this.scratch.copy(targetPosition).add(this.lookAhead).add(this.offset);
    this.camera.position.lerp(desired, this.smoothFactor);

    this.target.lerp(this.scratch.copy(targetPosition).add(this.lookAhead), this.smoothFactor);
    this.camera.lookAt(this.target);

    const { offset, roll } = this.shake.update(delta);
    if (this.shake.isActive) {
      this.camera.position.add(offset);
      this.camera.rotateZ(roll);
    }
  }

  /** Al arrancar un nivel la cámara no debe arrastrar la inercia del anterior. */
  reset() {
    this.shake.reset();
    this.lookAhead.set(0, 0, 0);
    this.hasLastPosition = false;
  }
}
