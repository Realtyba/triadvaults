import * as THREE from 'three';
import { clamp01 } from '../utils/math.js';

/**
 * Colisión y deslizamiento contra muros.
 *
 * Lo usa el jugador. El fantasma **no** colisiona a propósito: atraviesa la
 * geometría, que es lo que le da su carácter de aparición. Ver `GhostEnemy.js`.
 */

const tmpFull = new THREE.Vector3();
const tmpAxis = new THREE.Vector3();

function collidesAt(position, obstacleBoxes, radius = 0.4) {
  for (const box of obstacleBoxes) {
    if (
      position.x + radius > box.min.x &&
      position.x - radius < box.max.x &&
      position.z + radius > box.min.z &&
      position.z - radius < box.max.z
    ) {
      return true;
    }
  }
  return false;
}

/**
 * Mueve `position` según `step`, deslizando por el eje libre cuando el movimiento
 * completo choca. Devuelve `true` si hubo algún desplazamiento.
 */
export function moveWithSlide(position, step, obstacleBoxes, radius = 0.4) {
  if (step.lengthSq() === 0) return false;

  tmpFull.copy(position).add(step);
  if (!collidesAt(tmpFull, obstacleBoxes, radius)) {
    position.copy(tmpFull);
    return true;
  }

  tmpAxis.set(position.x + step.x, position.y, position.z);
  if (step.x !== 0 && !collidesAt(tmpAxis, obstacleBoxes, radius)) {
    position.copy(tmpAxis);
    return true;
  }

  tmpAxis.set(position.x, position.y, position.z + step.z);
  if (step.z !== 0 && !collidesAt(tmpAxis, obstacleBoxes, radius)) {
    position.copy(tmpAxis);
    return true;
  }

  return false;
}

/** Gira `current` hacia `target` por el camino corto. Devuelve el nuevo ángulo. */
export function turnTowards(current, target, delta, speed = 14) {
  let diff = target - current;
  while (diff < -Math.PI) diff += Math.PI * 2;
  while (diff > Math.PI) diff -= Math.PI * 2;
  return current + diff * clamp01(delta * speed);
}
