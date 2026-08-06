/**
 * Elige a quién persigue el fantasma.
 *
 * El comportamiento anterior era "el más cercano, recalculado cada frame": con dos
 * agentes eso se traduce en perseguir siempre al mismo (el host, que suele estar más
 * cerca al arrancar) y en oscilar cuando empatan. Aquí se puntúa la amenaza y se
 * añade histéresis para que el cambio de objetivo sea intencionado y legible.
 */

const WEIGHTS = {
  proximity: 1.0, // lo cercano pesa, pero no lo decide todo
  lowHealth: 0.45, // rematar a quien ya está tocado
  onPlate: 0.7, // desalojar a quien está resolviendo el puzle
  fatigue: 0.5 // penaliza insistir con el mismo objetivo demasiado tiempo
};

const SWITCH_MARGIN = 0.15; // el rival debe superar al actual por este margen
const MIN_LOCK_SECONDS = 2.5; // tiempo mínimo antes de plantearse un cambio
const MAX_CHASE_SECONDS = 12; // a partir de aquí la fatiga fuerza el relevo

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
  }

  /**
   * Sube la presión sin tocar la velocidad. La usa `GhostEnemy` en los niveles
   * altos, cuando el fantasma ya ha llegado a su tope de velocidad.
   *
   * Con la agresividad al máximo reacciona en la mitad de tiempo y prioriza mucho
   * más a quien está sobre un nodo: el puzle deja de poder resolverse ignorándolo.
   *
   * @param {number} amount de 0 (base) a 1 (máxima)
   */
  setAggression(amount = 0) {
    const level = Math.max(0, Math.min(1, amount));

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
   * @param {THREE.Vector3} ghostPosition
   * @param {number} delta
   * @returns {object|null} el jugador elegido
   */
  update(players, ghostPosition, delta, maxDistance = 60) {
    const candidates = players.filter(p => p.alive !== false && p.health > 0);
    if (candidates.length === 0) {
      this.reset();
      return null;
    }

    this.chaseTime += delta;

    const scored = candidates.map(player => ({
      player,
      score: this.score(player, ghostPosition, maxDistance)
    }));
    scored.sort((a, b) => b.score - a.score);

    const current = scored.find(s => s.player.uid === this.targetUid);
    const best = scored[0];

    // Sin objetivo, o el actual ya no está disponible: se toma el mejor sin más.
    if (!current) {
      this.setTarget(best.player.uid);
      return best.player;
    }

    const fatigued = this.chaseTime >= this.maxChaseSeconds;
    const canSwitch = this.chaseTime >= this.minLockSeconds;
    const clearlyBetter = best.score > current.score + this.switchMargin;

    if (best.player.uid !== current.player.uid && canSwitch && (clearlyBetter || fatigued)) {
      this.setTarget(best.player.uid);
      return best.player;
    }

    return current.player;
  }

  setTarget(uid) {
    if (this.targetUid !== uid) this.chaseTime = 0;
    this.targetUid = uid;
  }

  score(player, ghostPosition, maxDistance) {
    const distance = ghostPosition.distanceTo(player.position);
    const proximity = 1 - Math.min(1, distance / maxDistance);
    const lowHealth = 1 - Math.max(0, Math.min(1, (player.health ?? 100) / 100));
    const onPlate = player.onPlate ? 1 : 0;
    const fatigue = player.uid === this.targetUid
      ? Math.min(1, this.chaseTime / this.maxChaseSeconds)
      : 0;

    return (
      proximity * this.weights.proximity +
      lowHealth * this.weights.lowHealth +
      onPlate * this.weights.onPlate -
      fatigue * this.weights.fatigue
    );
  }
}
