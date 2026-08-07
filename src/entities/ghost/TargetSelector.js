import { clamp01, falloff } from '../../utils/math.js';

/**
 * Elige a quién persigue el fantasma.
 *
 * ## Por qué no cambiaba de objetivo
 *
 * La lógica se reevaluaba cada fotograma; el problema no era ese, sino la **escala
 * de la puntuación**:
 *
 * 1. `maxDistance` valía 60 por defecto y nadie pasaba nunca otro valor, mientras
 *    que la sala más grande mide 36×36. Con ese divisor, dos agentes separados
 *    nueve unidades se diferenciaban en 9/60 = 0,15 de proximidad, que era
 *    **exactamente** el margen exigido para cambiar. Es decir: en las distancias en
 *    las que se juega de verdad, el cambio era imposible por construcción.
 * 2. `onPlate` sumaba un fijo de 0,7 cuando el recorrido realista de la proximidad
 *    ronda 0,2. Quien pisaba un nodo quedaba marcado y, por el punto anterior, el
 *    fantasma no podía soltarlo. En `RelayCircuit`, donde el portador del ancla
 *    debe quedarse quieto, eso era un bloqueo permanente.
 * 3. La única vía de escape era la fatiga a los 12 s, que se leía como "el fantasma
 *    me ignora doce segundos".
 *
 * Ahora el rango llega desde fuera —la diagonal real de la sala— y el margen, el
 * bloqueo mínimo y el peso del nodo están calibrados contra ese recorrido.
 */

const WEIGHTS = {
  proximity: 1.0, // lo cercano pesa, pero no lo decide todo
  lowHealth: 0.45, // rematar a quien ya está tocado
  onPlate: 0.35, // desalojar a quien resuelve, sin que eclipse a la distancia
  fatigue: 0.5 // penaliza insistir con el mismo objetivo demasiado tiempo
};

const SWITCH_MARGIN = 0.08; // el rival debe superar al actual por este margen
const MIN_LOCK_SECONDS = 1.2; // tiempo mínimo antes de plantearse un cambio
const MAX_CHASE_SECONDS = 6; // a partir de aquí la fatiga fuerza el relevo

/** Diagonal por defecto, si nadie informa del tamaño de la sala. */
const DEFAULT_RANGE = 45;

export class TargetSelector {
  constructor(options = {}) {
    this.weights = { ...WEIGHTS, ...options.weights };
    this.switchMargin = options.switchMargin ?? SWITCH_MARGIN;
    this.minLockSeconds = options.minLockSeconds ?? MIN_LOCK_SECONDS;
    this.maxChaseSeconds = options.maxChaseSeconds ?? MAX_CHASE_SECONDS;

    this.targetUid = null;
    this.chaseTime = 0;
    this.baseWeights = { ...this.weights };
    this.baseMinLock = this.minLockSeconds;
    this.baseSwitchMargin = this.switchMargin;

    /** Resultado reutilizado: `update` corre por fantasma y fotograma. */
    this.result = { player: null, distance: 0 };
  }

  /**
   * Sube la presión sin tocar la velocidad. La usa `GhostEnemy` en los niveles
   * altos, cuando el fantasma ya ha llegado a su tope de velocidad.
   *
   * @param {number} amount de 0 (base) a 1 (máxima)
   */
  setAggression(amount = 0) {
    const level = clamp01(amount);

    this.weights = {
      ...this.baseWeights,
      onPlate: this.baseWeights.onPlate * (1 + level),
      lowHealth: this.baseWeights.lowHealth * (1 + level * 0.6)
    };
    this.minLockSeconds = this.baseMinLock * (1 - level * 0.5);
    this.switchMargin = this.baseSwitchMargin * (1 - level * 0.5);
  }

  reset() {
    this.targetUid = null;
    this.chaseTime = 0;
  }

  /**
   * @param {Array<{uid, position, health, alive, onPlate}>} players
   * @param {import('three').Vector3} ghostPosition
   * @param {number} delta
   * @param {number} maxDistance diagonal de la sala; ver la nota de cabecera
   * @returns {{player: object, distance: number}|null} búfer reutilizado
   */
  update(players, ghostPosition, delta, maxDistance = DEFAULT_RANGE) {
    this.chaseTime += delta;

    let best = null;
    let bestScore = -Infinity;
    let current = null;
    let currentScore = -Infinity;
    let bestDistance = 0;
    let currentDistance = 0;

    // Un solo recorrido, sin map/sort/find: esto corre por fantasma y fotograma, y
    // con un fantasma por agente se multiplica.
    for (const player of players) {
      if (player.alive === false || player.health <= 0) continue;

      const distance = ghostPosition.distanceTo(player.position);
      const score = this.score(player, distance, maxDistance);

      if (score > bestScore) {
        bestScore = score;
        best = player;
        bestDistance = distance;
      }
      if (player.uid === this.targetUid) {
        currentScore = score;
        current = player;
        currentDistance = distance;
      }
    }

    if (!best) {
      this.reset();
      return null;
    }

    // Sin objetivo, o el actual ya no está disponible: se toma el mejor sin más.
    if (!current) {
      this.setTarget(best.uid);
      return this.emit(best, bestDistance);
    }

    const fatigued = this.chaseTime >= this.maxChaseSeconds;
    const canSwitch = this.chaseTime >= this.minLockSeconds;
    const clearlyBetter = bestScore > currentScore + this.switchMargin;

    if (best.uid !== current.uid && canSwitch && (clearlyBetter || fatigued)) {
      this.setTarget(best.uid);
      return this.emit(best, bestDistance);
    }

    return this.emit(current, currentDistance);
  }

  /** La distancia ya está calculada: devolverla evita que el llamante la repita. */
  emit(player, distance) {
    this.result.player = player;
    this.result.distance = distance;
    return this.result;
  }

  setTarget(uid) {
    if (this.targetUid !== uid) this.chaseTime = 0;
    this.targetUid = uid;
  }

  score(player, distance, maxDistance) {
    const proximity = falloff(distance, maxDistance);
    const lowHealth = 1 - clamp01((player.health ?? 100) / 100);
    const onPlate = player.onPlate ? 1 : 0;
    const fatigue =
      player.uid === this.targetUid ? clamp01(this.chaseTime / this.maxChaseSeconds) : 0;

    return (
      proximity * this.weights.proximity +
      lowHealth * this.weights.lowHealth +
      onPlate * this.weights.onPlate -
      fatigue * this.weights.fatigue
    );
  }
}
