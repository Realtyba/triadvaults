/**
 * Repintado de nodos de puzle.
 *
 * Los tres arquetipos con nodos pisables tenían la misma función bajo tres
 * nombres (`paint`, `paintAnchor`, `paintTerminal`), y `PuzzleElement.setActive`
 * era una cuarta copia de la misma idea. Todas hacen lo mismo: color, brillo y
 * hundir la placa medio centímetro.
 *
 * El hundido no es decorativo. Es la única señal de estado que se lee cuando el
 * nodo queda fuera del alcance de una luz, que con salas grandes pasa a menudo.
 */

const ACTIVE_Y = 0.04;
const IDLE_Y = 0.1;

/**
 * La opacidad de la baliza es **opcional a propósito**: solo el ancla del circuito
 * de relevo la modula. Aplicarla a todos los nodos haría que cada terminal cerrado
 * disparase su pilar de luz, y con cinco nodos la sala se vuelve un árbol de Navidad
 * en el que ya no se distingue cuál es el que importa.
 *
 * @param {import('../../entities/PuzzleElement.js').PuzzleElement} node
 * @param {boolean} done
 * @param {{color?: number, activeColor?: number, idleColor?: number,
 *          activeIntensity?: number, idleIntensity?: number,
 *          activeOpacity?: number, idleOpacity?: number}} options
 */
export function paintNode(node, done, options = {}) {
  if (!node || !node.padMat) return;

  const {
    color,
    activeColor,
    idleColor,
    activeIntensity = 1.2,
    idleIntensity = 0.25,
    activeOpacity,
    idleOpacity
  } = options;

  // `color` fija un tono único para ambos estados (el orden en SequenceLock, el
  // ancla en RelayCircuit); si no, cada estado trae el suyo.
  const hex = color !== undefined ? color : done ? activeColor : idleColor;
  if (hex !== undefined) {
    node.padMat.color.setHex(hex);
    node.padMat.emissive.setHex(hex);
  }

  node.padMat.emissiveIntensity = done ? activeIntensity : idleIntensity;
  if (node.pad) node.pad.position.y = done ? ACTIVE_Y : IDLE_Y;

  const opacity = done ? activeOpacity : idleOpacity;
  if (node.beacon && opacity !== undefined) node.beacon.material.opacity = opacity;
}
