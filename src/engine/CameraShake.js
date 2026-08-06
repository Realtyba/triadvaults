import * as THREE from 'three';

/**
 * Sacudida de cámara con decaimiento.
 *
 * El desplazamiento es ruido continuo, no aleatorio por fotograma: un `Math.random()`
 * en cada frame produce vibración de alta frecuencia que se percibe como parpadeo
 * y marea. Aquí se muestrean tres ondas con frecuencias primas entre sí, lo que da
 * un temblor que se lee como un golpe físico.
 *
 * La intensidad decae al cuadrado (`trauma²`) porque la percepción del temblor no
 * es lineal: así un golpe fuerte se distingue claramente de uno leve.
 */
export class CameraShake {
  constructor({ maxOffset = 0.9, maxRoll = 0.05, decay = 1.6 } = {}) {
    this.trauma = 0;
    this.elapsed = 0;
    this.maxOffset = maxOffset;
    this.maxRoll = maxRoll;
    this.decay = decay;
    this.offset = new THREE.Vector3();
  }

  /** @param {number} amount de 0 a 1; se acumula, acotado al máximo. */
  add(amount) {
    this.trauma = Math.min(1, this.trauma + amount);
  }

  get isActive() {
    return this.trauma > 0.001;
  }

  /**
   * Avanza la sacudida y devuelve el desplazamiento a sumar a la cámara.
   * @returns {{offset: THREE.Vector3, roll: number}}
   */
  update(delta) {
    if (!this.isActive) {
      this.offset.set(0, 0, 0);
      return { offset: this.offset, roll: 0 };
    }

    this.elapsed += delta;
    this.trauma = Math.max(0, this.trauma - this.decay * delta);

    const intensity = this.trauma * this.trauma;
    const t = this.elapsed * 26;

    this.offset.set(
      Math.sin(t * 1.0) * Math.sin(t * 0.37) * this.maxOffset * intensity,
      Math.sin(t * 1.31) * Math.sin(t * 0.53) * this.maxOffset * intensity * 0.6,
      Math.sin(t * 0.79) * Math.sin(t * 0.41) * this.maxOffset * intensity
    );

    return { offset: this.offset, roll: Math.sin(t * 0.61) * this.maxRoll * intensity };
  }

  reset() {
    this.trauma = 0;
    this.offset.set(0, 0, 0);
  }
}
