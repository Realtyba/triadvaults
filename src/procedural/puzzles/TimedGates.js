import { PuzzleArchetype } from './PuzzleArchetype.js';

const ACTIVE_COLOR = 0x00ff66;
const IDLE_COLOR = 0xffa500;

/**
 * Compuertas temporizadas: activar todos los nodos antes de que expire el primero.
 *
 * Cada nodo se queda encendido unos segundos tras pisarlo. Con un agente es una
 * carrera contra el cronómetro por la ruta más corta; con tres, una cuestión de
 * salir a la vez. La ventana se acorta con el nivel, así que el mismo arquetipo
 * sirve para el nivel 3 y para el 40.
 */
export class TimedGates extends PuzzleArchetype {
  static key = 'timed';

  /** Un nodo más que agentes: con uno por cabeza no habría carrera. */
  static nodeCount(playersCount) {
    return Math.min(4, playersCount + 1);
  }

  /** Ventana en segundos. Nunca baja de 3,5 s o deja de ser jugable. */
  static windowFor(level) {
    return Math.max(3.5, 8 - Math.floor(level / 6) * 0.5);
  }

  get objectiveKey() {
    return 'objective_timed';
  }

  build(info) {
    this.window = TimedGates.windowFor(info.level || 1);
    this.expiries = new Map();

    info.plates
      .slice(0, TimedGates.nodeCount(this.playersCount))
      .forEach((cell, index) => this.addNode(cell, index, IDLE_COLOR));
  }

  evaluate(players) {
    const newlyPressed = [];
    const now = this.elapsed;

    for (const node of this.nodes) {
      const id = node.options.id;
      const expiry = this.expiries.get(id);

      if (this.isNodePressed(node, players)) {
        // Pisarlo de nuevo renueva su ventana; solo se avisa la primera vez.
        if (expiry === undefined || expiry <= now) newlyPressed.push(id);
        this.expiries.set(id, now + this.window);
      } else if (expiry !== undefined && expiry <= now) {
        this.expiries.delete(id);
      }

      const lit = this.expiries.has(id);
      node.setActive(lit);
      this.paintUrgency(node, lit ? this.expiries.get(id) - now : 0);
    }

    const active = this.expiries.size;
    const total = this.requiredPlateCount;

    return {
      solved: active >= total,
      progressPercent: Math.round((active / total) * 100),
      activeCount: active,
      newlyPressed
    };
  }

  /**
   * El nodo parpadea más rápido cuanto menos le queda.
   * Es lo que convierte el cronómetro en algo que se percibe sin mirar un número.
   */
  paintUrgency(node, remaining) {
    if (remaining <= 0) return;

    const urgency = 1 - Math.min(1, remaining / this.window);
    const blink = urgency > 0.55 ? 0.5 + Math.abs(Math.sin(this.elapsed * 14)) * 0.7 : 1;

    node.padMat.emissiveIntensity = blink;
    node.padMat.emissive.setHex(urgency > 0.75 ? IDLE_COLOR : ACTIVE_COLOR);
  }
}
