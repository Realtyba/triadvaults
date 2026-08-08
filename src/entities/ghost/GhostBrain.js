import { GHOST_STATES } from '../../../shared/events.js';

/**
 * Cómo caza el fantasma. Lógica pura, sin Three.js.
 *
 * Va al lado de `TargetSelector.js` y con su misma disciplina: aquél decide **a quién**
 * persigue y éste decide **cómo**. Separarlos es lo que permite que la agresividad por
 * nivel siga calibrándose en un sitio mientras el comportamiento se calibra en otro, y
 * lo que deja los dos validables desde Node.
 *
 * ## Antes atravesaba los muros siempre, y era una decisión
 *
 * El comentario que había en `GhostEnemy` lo defendía así: sin pathfinding, una aparición
 * que respetase la geometría solo parecería un enemigo con la ruta rota. Es cierto, y
 * también lo es lo contrario: si atraviesa siempre, **la sala deja de significar nada**.
 * No hay nada que hacer con un muro, ninguna decisión que tomar con el trazado, y el
 * fantasma se reduce a un cronómetro que se acerca.
 *
 * Repartirlo por estado se queda con las dos mitades buenas:
 *
 *  - **Acechando** rodea los muros, despacio. Ahí la bóveda es un sitio: romper la línea
 *    de visión funciona de verdad y esconderse es jugar.
 *  - **Cazando** y **embistiendo** atraviesa lo que sea. Ahí no hay nada que negociar, y
 *    que se lleve por delante la pared por la que creías haber escapado es exactamente
 *    lo que se quería del bicho desde el principio.
 *
 * Lo que convierte una cosa en la otra es **ser visto**. Ese es el momento en el que
 * todo cambia, y por eso es el que suena (`playTargetLocked`) y el que enciende el borde
 * del material.
 *
 * ## La embestida no corrige
 *
 * Durante los 0,9 segundos de carga el vector queda congelado en el que tenía al
 * arrancar. Es lo que la hace **esquivable**, y por tanto justa: un enemigo que corrige
 * mientras carga no es un ataque, es solo velocidad. Y como no corrige, después necesita
 * un momento de recuperación, que es la ventana para escapar de verdad.
 */

/** Multiplicadores sobre la velocidad base del nivel (`setSpeedForLevel`). */
const SPEED = {
  [GHOST_STATES.STALK]: 0.55,
  [GHOST_STATES.HUNT]: 1,
  [GHOST_STATES.CHARGE]: 1.7
};

/** Se te ha visto y estás lo bastante cerca: deja de acechar. */
const SIGHT_RANGE = 12;

/** Sin verte durante este tiempo, vuelve a acechar. */
const LOST_SIGHT_SECONDS = 2.5;

/** Y a partir de esta distancia deja de perseguir en recto aunque te vea. */
const GIVE_UP_RANGE = 16;

/** Distancia a la que arranca la embestida. */
const CHARGE_RANGE = 4.5;

const CHARGE_SECONDS = 0.9;
const RECOVER_SECONDS = 0.7;
const CHARGE_COOLDOWN = 2.6;

/**
 * Cuánto puede acechar seguido antes de entrar igualmente.
 *
 * Existe para que esconderse sea una táctica y no una solución: en los niveles altos la
 * presión del selector lo recorta, así que el fantasma acaba viniendo a por ti aunque no
 * te haya visto.
 */
const STALK_PATIENCE_SECONDS = 9;

export class GhostBrain {
  /**
   * @param {number} [ghostIndex=0] índice del fantasma, para desfasar tiempos
   */
  constructor(ghostIndex = 0) {
    this.state = GHOST_STATES.STALK;
    this.stateTime = 0;
    this.sinceSeen = Infinity;
    this.chargeCooldown = 0;
    /** Dirección congelada de la embestida, en el plano del suelo. */
    this.chargeDir = { x: 0, z: 0 };
    /** 0 acechando, 1 embistiendo. Lo consume el material. Ver `createGhostMaterial`. */
    this.charge = 0;
    /** De 0 a 1 con el nivel: recorta la paciencia del acecho. */
    this.pressure = 0;

    /**
     * Jitter por fantasma: desfasa los tiempos de la máquina de estados para que
     * dos fantasmas no cambien de estado en el mismo fotograma. Sin él, si te ven a
     * la vez, los dos cazan, cargan y recuperan sincronizados, lo que se siente como
     * un único enemigo duplicado.
     */
    this.jitter = ghostIndex * 0.3;
  }

  reset() {
    this.state = GHOST_STATES.STALK;
    this.stateTime = 0;
    this.sinceSeen = Infinity;
    this.chargeCooldown = 0;
    this.charge = 0;
  }

  setPressure(pressure) {
    this.pressure = Math.min(Math.max(pressure, 0), 1);
  }

  /** Paciencia efectiva: a nivel alto se agota antes. Desfasada por jitter. */
  get patience() {
    return STALK_PATIENCE_SECONDS * (1 - this.pressure * 0.7) + this.jitter;
  }

  enter(state) {
    if (this.state === state) return;
    this.state = state;
    this.stateTime = 0;
  }

  /**
   * Avanza la máquina un fotograma.
   *
   * @param {number} delta
   * @param {number} distance      a la presa
   * @param {boolean} visible      hay línea de visión
   * @param {{x: number, z: number}} toTarget dirección unitaria hacia la presa
   * @returns {{state: number, speedScale: number, direction: {x, z}|null, pathfinding: boolean}}
   */
  update(delta, distance, visible, toTarget) {
    this.stateTime += delta;
    this.chargeCooldown = Math.max(0, this.chargeCooldown - delta);
    this.sinceSeen = visible ? 0 : this.sinceSeen + delta;

    switch (this.state) {
      case GHOST_STATES.CHARGE:
        this.updateCharge(delta);
        break;
      case GHOST_STATES.HUNT:
        this.updateHunt(distance, toTarget);
        break;
      default:
        this.updateStalk(distance, visible);
        break;
    }

    return {
      state: this.state,
      speedScale: this.speedScale,
      // Embistiendo manda la dirección congelada; en los demás casos decide quien llama
      // (recto hacia la presa cazando, la celda siguiente del campo de flujo acechando).
      direction: this.state === GHOST_STATES.CHARGE ? this.chargeDir : null,
      pathfinding: this.state === GHOST_STATES.STALK
    };
  }

  updateStalk(distance, visible) {
    this.charge = 0;
    // O te ve de cerca, o se le acaba la paciencia. Lo segundo es lo que impide que
    // quedarse quieto detrás de un muro sea una victoria.
    if ((visible && distance < SIGHT_RANGE) || this.stateTime > this.patience) {
      this.enter(GHOST_STATES.HUNT);
    }
  }

  updateHunt(distance, toTarget) {
    // La carga se anuncia antes de dispararse: es la fracción de segundo en la que el
    // borde se enciende y da tiempo a apartarse.
    this.charge = distance < CHARGE_RANGE * 1.8 && this.chargeCooldown === 0
      ? Math.min(1, (CHARGE_RANGE * 1.8 - distance) / (CHARGE_RANGE * 0.8))
      : 0;

    if (distance < CHARGE_RANGE && this.chargeCooldown === 0) {
      // El vector se congela **aquí**, al entrar, y no se vuelve a tocar.
      this.chargeDir = { x: toTarget.x, z: toTarget.z };
      // El cooldown se desfasa por fantasma para que no embistan a la vez.
      this.chargeCooldown = CHARGE_COOLDOWN + CHARGE_SECONDS + RECOVER_SECONDS + this.jitter;
      this.enter(GHOST_STATES.CHARGE);
      return;
    }

    if (this.sinceSeen > LOST_SIGHT_SECONDS && distance > GIVE_UP_RANGE) {
      this.enter(GHOST_STATES.STALK);
    }
  }

  updateCharge(delta) {
    this.charge = 1;
    if (this.stateTime > CHARGE_SECONDS + RECOVER_SECONDS) this.enter(GHOST_STATES.HUNT);
  }

  /** Cuánto de la velocidad del nivel se aplica ahora mismo. */
  get speedScale() {
    if (this.state !== GHOST_STATES.CHARGE) return SPEED[this.state];
    // La recuperación es parte de la embestida: se para en seco tras el impulso, y ése
    // es el hueco por el que se escapa.
    return this.stateTime <= CHARGE_SECONDS ? SPEED[GHOST_STATES.CHARGE] : 0;
  }
}
