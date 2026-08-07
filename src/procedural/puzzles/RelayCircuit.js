import { PuzzleArchetype } from './PuzzleArchetype.js';
import { paintNode } from './paint.js';
import { PALETTE } from '../../engine/materials.js';
import { clampPlayers } from '../../../shared/constants.js';

const ANCHOR_COLOR = PALETTE.PURPLE;
const TERMINAL_IDLE = PALETTE.PLATE_IDLE;
const TERMINAL_DONE = PALETTE.PLATE_ACTIVE;

/**
 * Circuito de relevo: un agente sostiene el ancla mientras los demás cierran los
 * terminales.
 *
 * Es el único arquetipo que **exige** repartir papeles: quien sostiene el ancla no
 * puede moverse, así que queda expuesto al fantasma mientras el resto trabaja. Ahí
 * está el juego — decidir quién se queda quieto y cuándo relevarle.
 *
 * Por eso no se ofrece en solitario: sin un segundo agente el puzle no tiene
 * solución, no es que sea difícil.
 */
export class RelayCircuit extends PuzzleArchetype {
  static key = 'relay';

  static supports(playersCount) {
    return playersCount >= 2;
  }

  /** Un ancla más un terminal por cada agente restante. */
  static nodeCount(playersCount) {
    return Math.max(2, clampPlayers(playersCount)) + 1;
  }

  get objectiveKey() {
    return 'objective_relay';
  }

  build(info) {
    this.closed = new Set();

    const total = RelayCircuit.nodeCount(this.playersCount);
    info.plates.slice(0, total).forEach((cell, index) => {
      const isAnchor = index === 0;
      this.addNode(cell, index, isAnchor ? ANCHOR_COLOR : TERMINAL_IDLE, { anchor: isAnchor });
    });

    this.anchor = this.nodes[0];
    this.terminals = this.nodes.slice(1);
    this.paintAnchor(false);
    this.terminals.forEach(node => this.paintTerminal(node, false));
  }

  paintAnchor(held) {
    // El ancla brilla más que un terminal: es el nodo que hay que vigilar.
    paintNode(this.anchor, held, {
      color: ANCHOR_COLOR,
      activeIntensity: 1.4,
      idleIntensity: 0.3,
      activeOpacity: 0.85,
      idleOpacity: 0.35
    });
  }

  paintTerminal(node, done) {
    paintNode(node, done, { activeColor: TERMINAL_DONE, idleColor: TERMINAL_IDLE });
  }

  evaluate(players) {
    const newlyPressed = [];
    const held = this.isNodePressed(this.anchor, players);
    this.paintAnchor(held);

    if (!held) {
      // Soltar el ancla corta el circuito: los terminales cerrados se pierden.
      // Es la tensión del arquetipo, así que no se perdona.
      if (this.closed.size > 0) {
        this.closed.clear();
        this.terminals.forEach(node => this.paintTerminal(node, false));
      }
    } else {
      for (const node of this.terminals) {
        const id = node.options.id;
        if (this.closed.has(id)) continue;
        if (!this.isNodePressed(node, players)) continue;

        this.closed.add(id);
        this.paintTerminal(node, true);
        newlyPressed.push(id);
      }
    }

    const total = this.terminals.length;
    return {
      solved: held && this.closed.size >= total,
      progressPercent: Math.round((this.closed.size / total) * 100),
      activeCount: this.closed.size,
      newlyPressed
    };
  }
}
