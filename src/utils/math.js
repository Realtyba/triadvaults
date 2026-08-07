/**
 * Utilidades numéricas compartidas.
 *
 * Estas cuatro operaciones estaban abiertas a mano en trece sitios distintos, con
 * variaciones sutiles entre copias. El problema no era la repetición en sí, sino
 * que al estar escritas inline nadie veía las **escalas**: el selector de objetivos
 * del fantasma normalizaba distancias contra 60 unidades y el motor de tensión
 * contra 18, en salas que como mucho miden 36×36. Con la fórmula en un solo sitio,
 * el rango es un argumento explícito y esos desajustes saltan a la vista.
 */

export function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

export function clamp01(value) {
  return clamp(value, 0, 1);
}

/**
 * Caída normalizada por distancia: 1 encima, 0 a partir de `range`.
 *
 * @param {number} distance
 * @param {number} range distancia a la que el resultado llega a 0
 * @returns {number} entre 0 y 1
 */
export function falloff(distance, range) {
  if (!(range > 0)) return 0;
  return 1 - Math.min(1, distance / range);
}

/**
 * Oscilación entre 0 y 1 a partir de un tiempo acumulado.
 *
 * Recibe el tiempo como argumento a propósito. Antes cada parpadeo llamaba a su
 * propio reloj —`Date.now()` en el fantasma, `performance.now()` en el jugador,
 * delta acumulado en la iluminación—, así que tres animaciones que debían latir
 * juntas iban cada una por su lado y ninguna se podía pausar.
 *
 * @param {number} elapsed segundos acumulados
 * @param {number} speed ciclos por segundo
 * @param {number} phase desfase en radianes
 */
export function pulse(elapsed, speed = 1, phase = 0) {
  return 0.5 + Math.sin(elapsed * speed + phase) * 0.5;
}
