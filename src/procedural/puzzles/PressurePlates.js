import { PuzzleArchetype } from './PuzzleArchetype.js';

/**
 * Placas de presión simultáneas: el arquetipo original.
 *
 * Una placa por agente, y todas pisadas a la vez. Con tres agentes obliga a
 * repartirse la sala; en solitario es un simple "llega hasta ahí".
 */
export class PressurePlates extends PuzzleArchetype {
  static key = 'plates';

  static nodeCount(playersCount) {
    return Math.max(1, Math.min(playersCount, 3));
  }

  get objectiveKey() {
    return this.playersCount === 1
      ? 'solo_objective'
      : this.playersCount === 2
        ? 'duo_objective'
        : 'squad_objective';
  }

  build(info) {
    this.activeNodes = new Set();
    info.plates
      .slice(0, PressurePlates.nodeCount(this.playersCount))
      .forEach((cell, index) => this.addNode(cell, index, info.theme.color));
  }

  evaluate(players) {
    const nowActive = new Set();
    const newlyPressed = [];

    for (const node of this.nodes) {
      const pressed = this.isNodePressed(node, players);
      node.setActive(pressed);
      if (!pressed) continue;

      nowActive.add(node.options.id);
      if (!this.activeNodes.has(node.options.id)) newlyPressed.push(node.options.id);
    }

    this.activeNodes = nowActive;
    const required = this.requiredPlateCount;

    return {
      solved: nowActive.size >= required,
      progressPercent: Math.round((nowActive.size / required) * 100),
      activeCount: nowActive.size,
      newlyPressed
    };
  }
}
