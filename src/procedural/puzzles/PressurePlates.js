import { PuzzleArchetype } from './PuzzleArchetype.js';
import { clampPlayers } from '../../../shared/constants.js';

/**
 * Placas de presión simultáneas: el arquetipo original.
 *
 * Una placa por agente, y todas pisadas a la vez. Con tres agentes obliga a
 * repartirse la sala; en solitario es un simple "llega hasta ahí".
 */
export class PressurePlates extends PuzzleArchetype {
  static key = 'plates';

  static nodeCount(playersCount) {
    return clampPlayers(playersCount);
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
    // El segundo conjunto no es un duplicado: los dos se van alternando en `evaluate`.
    // Hace falta comparar el fotograma actual con el anterior para saber qué placa
    // acaba de pisarse, y crear un `Set` nuevo cada fotograma para eso —que es lo que
    // se hacía— son sesenta asignaciones por segundo por nada.
    this.pendingNodes = new Set();
    info.plates
      .slice(0, PressurePlates.nodeCount(this.playersCount))
      .forEach((cell, index) => this.addNode(cell, index, info.theme.color));
  }

  evaluate(players) {
    const newlyPressed = this.beginEvaluation();
    const nowActive = this.pendingNodes;
    nowActive.clear();

    for (const node of this.nodes) {
      const pressed = this.isNodePressed(node, players);
      node.setActive(pressed);
      if (!pressed) continue;

      nowActive.add(node.options.id);
      if (!this.activeNodes.has(node.options.id)) newlyPressed.push(node.options.id);
    }

    // Se intercambian: el de este fotograma pasa a ser el de referencia y el viejo queda
    // libre para que lo vacíe y lo rellene el siguiente.
    this.pendingNodes = this.activeNodes;
    this.activeNodes = nowActive;

    const required = this.requiredPlateCount;
    return this.report(nowActive.size, required, nowActive.size >= required);
  }
}
