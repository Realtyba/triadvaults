import { PuzzleArchetype } from './PuzzleArchetype.js';

const ANCHOR_COLOR = 0x9d00ff;
const TERMINAL_IDLE = 0xffa500;
const TERMINAL_DONE = 0x00ff66;

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
    return Math.max(2, Math.min(playersCount, 3)) + 1;
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
    this.anchor.padMat.color.setHex(ANCHOR_COLOR);
    this.anchor.padMat.emissive.setHex(ANCHOR_COLOR);
    this.anchor.padMat.emissiveIntensity = held ? 1.4 : 0.3;
    this.anchor.pad.position.y = held ? 0.04 : 0.1;
    if (this.anchor.beacon) this.anchor.beacon.material.opacity = held ? 0.85 : 0.35;
  }

  paintTerminal(node, done) {
    const color = done ? TERMINAL_DONE : TERMINAL_IDLE;
    node.padMat.color.setHex(color);
    node.padMat.emissive.setHex(color);
    node.padMat.emissiveIntensity = done ? 1.2 : 0.25;
    node.pad.position.y = done ? 0.04 : 0.1;
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
