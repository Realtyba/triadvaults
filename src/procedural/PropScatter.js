import { createRandom, deriveSeed } from './rng.js';

/**
 * Dónde va el atrezo de la sala.
 *
 * ## Solo datos
 *
 * Aquí no entra Three.js, igual que en `LayoutGen` y `NavGrid`: esto decide **sitios**
 * y quien los convierte en mallas es `engine/PropLibrary.js`. Así se puede validar sin
 * navegador, y así el repartidor no puede colar geometría por la puerta de atrás.
 *
 * ## Contra los muros, nunca en el paso
 *
 * Solo se colocan en celdas libres que tengan un muro al lado. Dos motivos: pegado a un
 * muro, un bulto se lee como parte de la sala y no como un obstáculo que hay que
 * rodear; y en mitad de un pasillo, un jugador intentaría esquivarlo aunque no colisione.
 *
 * ## El atrezo NO colisiona
 *
 * No entra en `obstacleBoxes`, y es una decisión, no un olvido. El número de props sale
 * del preset de calidad, o sea que **cada jugador ve una cantidad distinta**: si además
 * colisionaran, dos personas en la misma sala tendrían física distinta y el mismo salto
 * saldría bien en un portátil y mal en un teléfono. La sala que se juega es la de
 * `LayoutGen`; esto es lo que la decora.
 */

/** Distancia mínima, en celdas, a la que se mantienen de la aparición y las salidas. */
const CLEARANCE = 2;

/**
 * Elige un tipo respetando los pesos.
 *
 * Sin pesos, con ocho tipos y doce piezas sale una de cada, y una sala con exactamente
 * un bidón, exactamente un panel y exactamente una consola no parece almacenada: parece
 * un muestrario. Los pesos son los que dejan que las cajas se repitan y que las piezas
 * grandes aparezcan sueltas.
 */
function pickWeighted(rng, weights) {
  const total = weights.reduce((sum, weight) => sum + Math.max(0, weight), 0);
  if (total <= 0) return rng.int(0, weights.length - 1);

  let ticket = rng.float(0, total);
  for (let i = 0; i < weights.length; i++) {
    ticket -= Math.max(0, weights[i]);
    if (ticket <= 0) return i;
  }
  return weights.length - 1;
}

/**
 * Reparte atrezo por la sala.
 *
 * @param {object} layout          el trazado ya resuelto, tal cual lo devuelve `generateLayout`
 * @param {number} density         cuántas piezas como mucho; 0 apaga el atrezo
 * @param {number} kinds           cuántos tipos de pieza hay disponibles
 * @param {number[]} [weights]     frecuencia relativa de cada tipo, en el mismo orden.
 *   Sale del manifest, así que es igual en los tres clientes y no rompe el sembrado.
 * @returns {Array<{kind: number, x: number, z: number, rotY: number, scale: number}>}
 */
export function scatterProps(layout, density = 0, kinds = 1, weights = null) {
  if (!layout || density <= 0 || kinds <= 0) return [];

  const grid = layout.grid;
  // Semilla derivada de la de la sala: el atrezo es igual en las tres pantallas, que es
  // lo que permite hablar de "la caja del rincón" y que el otro sepa cuál es.
  const rng = createRandom(deriveSeed(layout.seed, 0x9707, 0));

  const forbidden = [layout.spawnCell, ...layout.exitCells, ...(layout.plateCells || [])]
    .filter(Boolean);

  const candidates = [];
  for (let row = 0; row < grid.rows; row++) {
    for (let col = 0; col < grid.cols; col++) {
      if (grid.isBlocked(col, row)) continue;
      // Pegado a un muro. `hasBlockedNeighbour` cuenta también el borde de la rejilla,
      // así que el perímetro de la sala vale como pared, que es lo que se quiere.
      if (!grid.hasBlockedNeighbour(col, row)) continue;
      if (forbidden.some(cell => Math.abs(cell.col - col) < CLEARANCE && Math.abs(cell.row - row) < CLEARANCE)) {
        continue;
      }
      candidates.push({ col, row });
    }
  }

  // Se baraja y se corta, en vez de sortear celdas hasta llenar el cupo: con pocas
  // celdas válidas —una sala muy abierta tiene poco perímetro interior— el sorteo
  // repetiría sitios y habría que descartarlos, y el número final dependería de la
  // suerte en vez del preset.
  return rng.shuffle(candidates).slice(0, density).map(cell => {
    const world = grid.toWorld(cell.col, cell.row);
    return {
      kind: weights && weights.length === kinds ? pickWeighted(rng, weights) : rng.int(0, kinds - 1),
      x: world.x,
      z: world.z,
      // Giro libre: son cajas y bidones, y alinearlos todos delataría la rejilla.
      rotY: rng.float(0, Math.PI * 2),
      scale: rng.float(0.85, 1.25)
    };
  });
}
