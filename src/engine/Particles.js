import * as THREE from 'three';
import { createParticleTexture } from './textures.js';
import { quality } from './QualitySettings.js';

/**
 * Partículas de la escena, en dos sistemas:
 *
 * - **Ambiente**: motas suspendidas en el volumen de la sala. Dan sensación de aire
 *   y de escala; sin ellas el espacio entre muros se lee como vacío muerto.
 * - **Impactos**: ráfagas al golpear, pisar una placa o abrirse la compuerta.
 *
 * Los dos son un único `Points` cada uno, con la geometría reservada de antemano.
 * Crear objetos por evento provocaba tirones justo en el momento de más acción,
 * que es exactamente cuando no se pueden permitir.
 */

const AMBIENT_DRIFT = 0.35;

export class ParticleField {
  constructor(scene) {
    this.scene = scene;
    this.ambient = null;
    this.impacts = null;
    this.impactCursor = 0;
    this.elapsed = 0;
    this.burstColor = new THREE.Color();

    this.buildImpactPool();

    // Era el único consumidor del preset que no escuchaba sus cambios: el pool se
    // dimensionaba una vez en el constructor, así que cambiar de calidad a mitad de
    // sesión no alteraba las partículas hasta la siguiente sala.
    this.unsubscribeQuality = quality.subscribe(() => this.applyQuality());
  }

  applyQuality() {
    if (this.impacts) {
      this.scene.remove(this.impacts);
      this.impacts.geometry.dispose();
      this.impacts.material.dispose();
      this.impacts = null;
    }
    this.impactCursor = 0;
    this.buildImpactPool();

    // El campo de ambiente se rehace con las medidas de la sala actual, si la hay.
    if (this.ambient) {
      const { sizeX, sizeZ } = this.ambient.userData;
      const colorHex = this.ambient.material.color.getHex();
      this.setupAmbient(sizeX, sizeZ, colorHex);
    }
  }

  // ------------------------------------------------------------- ambiente

  /** Rehace el campo de motas con las dimensiones y el color del nivel. */
  setupAmbient(sizeX, sizeZ, colorHex) {
    this.clearAmbient();

    const count = quality.get('ambientParticles');
    if (count <= 0) return;

    const positions = new Float32Array(count * 3);
    const speeds = new Float32Array(count);

    for (let i = 0; i < count; i++) {
      positions[i * 3] = (Math.random() - 0.5) * sizeX;
      positions[i * 3 + 1] = Math.random() * 6 + 0.4;
      positions[i * 3 + 2] = (Math.random() - 0.5) * sizeZ;
      speeds[i] = 0.4 + Math.random() * 0.8;
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));

    const points = new THREE.Points(
      geometry,
      new THREE.PointsMaterial({
        size: 0.16,
        map: createParticleTexture(),
        color: colorHex,
        transparent: true,
        opacity: 0.5,
        depthWrite: false, // sin esto las motas se recortan entre sí de forma visible
        blending: THREE.AdditiveBlending,
        sizeAttenuation: true
      })
    );
    points.frustumCulled = false;

    points.userData = { speeds, sizeX, sizeZ };
    this.scene.add(points);
    this.ambient = points;
  }

  updateAmbient(delta) {
    if (!this.ambient) return;

    const positions = this.ambient.geometry.attributes.position;
    const { speeds } = this.ambient.userData;

    // Se indexa el array directamente en vez de pasar por getX/setX/getY/setY.
    // Con 420 motas eso eran unas 1.700 llamadas a función por fotograma solo para
    // leer y escribir posiciones contiguas de un Float32Array.
    const array = positions.array;

    for (let i = 0; i < speeds.length; i++) {
      const base = i * 3;
      const y = array[base + 1] + speeds[i] * delta * AMBIENT_DRIFT;
      // Deriva lateral distinta por partícula, o todas subirían en columnas rectas.
      array[base] += Math.sin(this.elapsed * 0.4 + i) * delta * 0.08;
      array[base + 1] = y > 6.5 ? 0.2 : y;
    }
    positions.needsUpdate = true;
  }

  clearAmbient() {
    if (!this.ambient) return;
    this.scene.remove(this.ambient);
    this.ambient.geometry.dispose();
    this.ambient.material.dispose();
    this.ambient = null;
  }

  // ------------------------------------------------------------- impactos

  /**
   * Reserva el pool completo una sola vez. Las partículas muertas se aparcan bajo
   * el suelo con vida 0 en vez de eliminarse, para no tocar el tamaño del buffer.
   */
  buildImpactPool() {
    const perBurst = quality.get('impactParticles');
    this.burstSize = Math.max(1, perBurst);
    const capacity = this.burstSize * 8; // ocho ráfagas simultáneas es de sobra

    this.impactPositions = new Float32Array(capacity * 3);
    this.impactVelocities = new Float32Array(capacity * 3);
    this.impactLife = new Float32Array(capacity);
    this.impactColors = new Float32Array(capacity * 3);

    for (let i = 0; i < capacity; i++) {
      this.impactPositions[i * 3 + 1] = -100; // fuera de cámara mientras no vive
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(this.impactPositions, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(this.impactColors, 3));

    this.impacts = new THREE.Points(
      geometry,
      new THREE.PointsMaterial({
        size: 0.28,
        map: createParticleTexture(),
        vertexColors: true,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        sizeAttenuation: true
      })
    );
    this.impacts.frustumCulled = false;
    this.scene.add(this.impacts);
  }

  /**
   * Ráfaga en un punto. `spread` controla la apertura del cono; `up` cuánto sube.
   * @param {THREE.Vector3|{x:number,y:number,z:number}} position
   */
  burst(position, colorHex = 0xffffff, { spread = 3.2, up = 2.6, count = null } = {}) {
    if (!this.impacts) return;

    const color = this.burstColor.setHex(colorHex);
    const total = count || this.burstSize;
    const capacity = this.impactLife.length;

    for (let n = 0; n < total; n++) {
      const i = this.impactCursor;
      this.impactCursor = (this.impactCursor + 1) % capacity;

      this.impactPositions[i * 3] = position.x;
      this.impactPositions[i * 3 + 1] = (position.y || 0) + 0.6;
      this.impactPositions[i * 3 + 2] = position.z;

      const angle = Math.random() * Math.PI * 2;
      const speed = spread * (0.4 + Math.random() * 0.6);
      this.impactVelocities[i * 3] = Math.cos(angle) * speed;
      this.impactVelocities[i * 3 + 1] = up * (0.3 + Math.random() * 0.7);
      this.impactVelocities[i * 3 + 2] = Math.sin(angle) * speed;

      this.impactColors[i * 3] = color.r;
      this.impactColors[i * 3 + 1] = color.g;
      this.impactColors[i * 3 + 2] = color.b;

      this.impactLife[i] = 0.6 + Math.random() * 0.4;
    }

    this.impacts.geometry.attributes.color.needsUpdate = true;
  }

  updateImpacts(delta) {
    if (!this.impacts) return;

    const positions = this.impacts.geometry.attributes.position;
    let anyAlive = false;

    for (let i = 0; i < this.impactLife.length; i++) {
      if (this.impactLife[i] <= 0) continue;
      anyAlive = true;

      this.impactLife[i] -= delta;

      if (this.impactLife[i] <= 0) {
        this.impactPositions[i * 3 + 1] = -100;
        continue;
      }

      this.impactVelocities[i * 3 + 1] -= 9.8 * delta; // gravedad: caen, no flotan
      this.impactPositions[i * 3] += this.impactVelocities[i * 3] * delta;
      this.impactPositions[i * 3 + 1] += this.impactVelocities[i * 3 + 1] * delta;
      this.impactPositions[i * 3 + 2] += this.impactVelocities[i * 3 + 2] * delta;
    }

    // Subir el buffer entero cuesta; si no vive nada, no hay nada que subir.
    if (anyAlive) positions.needsUpdate = true;
  }

  // ---------------------------------------------------------------- ciclo

  update(delta) {
    this.elapsed += delta;
    this.updateAmbient(delta);
    this.updateImpacts(delta);
  }

  destroy() {
    if (this.unsubscribeQuality) this.unsubscribeQuality();
    this.clearAmbient();
    if (this.impacts) {
      this.scene.remove(this.impacts);
      this.impacts.geometry.dispose();
      this.impacts.material.dispose();
      this.impacts = null;
    }
  }
}
