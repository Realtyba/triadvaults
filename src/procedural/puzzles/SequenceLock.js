import { PuzzleArchetype } from './PuzzleArchetype.js';
import { paintNode } from './paint.js';
import { PALETTE } from '../../engine/materials.js';

/** Colores del orden, del primero al último. Se leen sin necesidad de números. */
const ORDER_COLORS = [
  PALETTE.EMERALD,
  PALETTE.CYAN,
  PALETTE.AMBER,
  PALETTE.MAGENTA,
  PALETTE.PURPLE
];

/** Margen tras pisar una placa antes de que cuente como "sigo aquí". */
const RELEASE_MS = 250;

/**
 * Cerradura de secuencia: pisar las placas en el orden que marca su color.
 *
 * Es el arquetipo que mejor escala en solitario, porque el reto es de ruta y
 * memoria, no de coordinación. Con varios agentes se convierte en un problema de
 * comunicación: cada uno ve el color pero hay que acordar quién pisa qué y cuándo.
 *
 * Equivocarse reinicia la secuencia. No castiga con daño a propósito: el fantasma
 * ya presiona bastante, y sumar castigo sobre castigo lo vuelve frustrante.
 */
export class SequenceLock extends PuzzleArchetype {
  static key = 'sequence';

  /** Una placa más que agentes, para que el orden importe de verdad. */
  static nodeCount(playersCount) {
    return Math.min(ORDER_COLORS.length, Math.max(3, playersCount + 2));
  }

  get objectiveKey() {
    return 'objective_sequence';
  }

  build(info) {
    this.step = 0;
    this.lastPressedId = null;
    this.lastPressedAt = -Infinity;

    const total = SequenceLock.nodeCount(this.playersCount);
    info.plates.slice(0, total).forEach((cell, index) => {
      const node = this.addNode(cell, index, ORDER_COLORS[index], { order: index });
      this.paint(node, false);
    });
  }

  /** El color indica el turno; el brillo, si ya está superado. */
  paint(node, done) {
    paintNode(node, done, { color: ORDER_COLORS[node.data.order] });
  }

  evaluate(players) {
    const newlyPressed = [];
    const pressed = this.nodes.find(node => this.isNodePressed(node, players));

    if (pressed) {
      const id = pressed.options.id;
      const stillStanding =
        id === this.lastPressedId && this.elapsed * 1000 - this.lastPressedAt < RELEASE_MS;

      // Sin esta guarda, mantenerse encima de una placa se leería como pisarla
      // muchas veces y reiniciaría la secuencia al instante.
      if (!stillStanding || id !== this.lastPressedId) {
        if (id === this.step) {
          this.step += 1;
          this.paint(pressed, true);
          newlyPressed.push(id);
        } else if (id > this.step) {
          this.reset();
        }
      }
      this.lastPressedId = id;
      this.lastPressedAt = this.elapsed * 1000;
    } else if (this.elapsed * 1000 - this.lastPressedAt > RELEASE_MS) {
      this.lastPressedId = null;
    }

    const total = this.requiredPlateCount;
    return {
      solved: this.step >= total,
      progressPercent: Math.round((this.step / total) * 100),
      activeCount: this.step,
      newlyPressed
    };
  }

  /** Vuelta al principio: se apagan todas y se avisa con el color. */
  reset() {
    this.step = 0;
    this.nodes.forEach(node => this.paint(node, false));
  }
}
