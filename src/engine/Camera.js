import * as THREE from 'three';
import { CameraShake } from './CameraShake.js';

const ZOOM_MIN = 0.6;
const ZOOM_MAX = 1.8;
const ZOOM_STEP = 0.1;

/** Cuánto se adelanta la mirada en la dirección del movimiento, en unidades. */
const LOOK_AHEAD = 2.2;

const BASE_FOV = 50;

/**
 * Topes de la compensación para ventanas estrechas.
 *
 * `fov` es el **vertical** en Three.js, así que al estrechar la ventana el campo
 * horizontal se desploma —de unos 79° a 24° en un móvil— y de la sala solo queda
 * una franja. Recuperarlo solo con el ángulo pediría más de 120°, que deforma la
 * imagen hasta marear, así que se reparte entre abrir el ángulo y **alejar la
 * cámara**, cada uno con su tope.
 */
const MAX_FOV = 70;
const MAX_DISTANCE_SCALE = 2.2;

/** Margen alrededor de la sala, para que los muros no queden pegados al borde. */
const ROOM_MARGIN = 1.18;

/** Distancia del ojo al objetivo con el desplazamiento base, `|(0, 24, 18)|`. */
const BASE_DISTANCE = Math.hypot(24, 18);

export class EngineCamera {
  constructor() {
    this.aspect = window.innerWidth / window.innerHeight;
    // `far` a 200: la sala más grande mide 36 unidades y la niebla cierra el
    // horizonte mucho antes. Con 1000 solo se perdía precisión del búfer de
    // profundidad, que en las GPU móviles suele ser de 16 bits.
    this.camera = new THREE.PerspectiveCamera(BASE_FOV, this.aspect, 0.1, 200);

    this.zoomLevel = 1.0;
    this.targetZoom = 1.0;
    /** Alejamiento extra para que la sala quepa; se multiplica sobre el zoom. */
    this.aspectScale = 1;
    /** Ancho de la sala en curso. Lo fija `setRoomExtent` al construir el nivel. */
    this.roomExtent = null;
    this.baseOffset = new THREE.Vector3(0, 24, 18);
    this.offset = this.baseOffset.clone();
    this.target = new THREE.Vector3(0, 0, 0);
    this.smoothFactor = 0.12;

    this.shake = new CameraShake();
    this.lookAhead = new THREE.Vector3();
    this.lastPosition = new THREE.Vector3();
    this.hasLastPosition = false;
    this.scratch = new THREE.Vector3();

    this.applyAspect(this.aspect);
    this.camera.position.copy(this.offset);
    this.camera.lookAt(this.target);

    window.addEventListener('wheel', e => this.onScroll(e), { passive: true });
  }

  onScroll(e) {
    this.zoomBy(e.deltaY > 0 ? ZOOM_STEP : -ZOOM_STEP);
  }

  /**
   * Mueve el zoom *objetivo*; el real lo persigue en `follow`. Antes el salto era
   * instantáneo en cada muesca de la rueda y se veía a tirones.
   *
   * Lo comparten la rueda del ratón y el pellizco de dos dedos, que es la razón de
   * que esté aquí y no dentro de `onScroll`.
   */
  zoomBy(amount) {
    this.targetZoom = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, this.targetZoom + amount));
  }

  updateAspect(width, height) {
    this.applyAspect(width / height);
  }

  /**
   * Ancho de sala que hay que dejar ver, en unidades de mundo.
   *
   * Lo llama el controlador de nivel al construir la bóveda. Sin este dato la única
   * referencia posible era la sala **más grande** del juego (36 unidades), y encuadrar
   * siempre para ese peor caso dejaba la sala del nivel 1 —que mide 20— como un
   * recuadro pequeño en mitad de una pantalla vacía. Con la medida real, la
   * compensación solo se aleja lo que ese nivel necesita.
   */
  setRoomExtent(extent) {
    this.roomExtent = extent > 0 ? extent : null;
    this.applyAspect(this.aspect);
  }

  /**
   * Encuadre para la ventana actual.
   *
   * Se calcula el campo **horizontal** que hace falta para que la sala quepa a lo
   * ancho y se cubre con dos mandos en este orden: primero abriendo el ángulo, y lo
   * que quede, alejando la cámara. Si con el ángulo original ya cabe —cualquier
   * monitor, y un móvil en apaisado—, no se toca nada: `fov` se queda en 50 y la
   * distancia en 1, que es exactamente el encuadre de siempre.
   *
   * El orden importa: alejar la cámara empequeñece al agente, así que se usa como
   * último recurso; abrir el ángulo cuesta algo de deformación pero conserva el
   * tamaño de lo que hay en el centro.
   */
  applyAspect(aspect) {
    this.aspect = aspect;
    this.camera.aspect = aspect;

    const needed = this.roomExtent ? (this.roomExtent * ROOM_MARGIN) / 2 / BASE_DISTANCE : 0;
    const reachedAtBase = Math.tan(THREE.MathUtils.degToRad(BASE_FOV) / 2) * aspect;

    if (!needed || reachedAtBase >= needed) {
      this.camera.fov = BASE_FOV;
      this.aspectScale = 1;
      this.camera.updateProjectionMatrix();
      return;
    }

    // Ángulo vertical que daría ese campo horizontal en esta proporción.
    const wantedHalf = Math.atan(needed / aspect);
    const fov = Math.min(MAX_FOV, THREE.MathUtils.radToDeg(wantedHalf) * 2);
    this.camera.fov = fov;

    const reached = Math.tan(THREE.MathUtils.degToRad(fov) / 2) * aspect;
    this.aspectScale = Math.min(MAX_DISTANCE_SCALE, Math.max(1, needed / reached));

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
    // El alejamiento por proporción va aparte del zoom del jugador: así el pellizco
    // sigue teniendo el mismo recorrido en vertical que en apaisado.
    this.offset.copy(this.baseOffset).multiplyScalar(this.zoomLevel * this.aspectScale);

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
