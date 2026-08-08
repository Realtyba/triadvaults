import * as THREE from 'three';

/**
 * La geometría del encuadre: qué trozo de suelo se ve y cuánto hay que abrir o alejar
 * para que quepa lo que tiene que caber.
 *
 * Son **funciones puras**, no una clase, y por dos motivos. Uno: no tienen estado propio
 * —lo que necesitan se lo pasa `EngineCamera`—, así que una clase sólo añadiría ceremonia.
 * Dos: sin estado se pueden probar desde Node sin fingir un `window`, y de hecho
 * `scripts/validate-movement.js` fija sus resultados en tres formatos de pantalla. Ese
 * bloque de comprobaciones es la red que hace falta aquí, porque el fallo que este código
 * ya arregló una vez **no se ve en un monitor**: en 16:9 todo parece correcto y es en un
 * móvil tumbado donde la sala se corta o el agente queda diminuto.
 *
 * Estaban dentro de `EngineCamera`, mezcladas con el seguimiento, la sacudida y el zoom.
 * Eran 190 de sus 630 líneas y no compartían un solo campo con el resto.
 */

/** Ángulo de partida, en grados. El de siempre; sólo se abre si algo no cabe. */
export const BASE_FOV = 50;

/**
 * Techo del ángulo. Por encima, la deformación de perspectiva en los bordes se nota más
 * que lo que se gana de campo.
 */
export const MAX_FOV = 62;

/** Techo del alejamiento. Más allá el agente se vuelve un punto. */
export const MAX_DISTANCE_SCALE = 1.5;

/**
 * Cámara sonda reutilizada.
 *
 * `computeGroundQuad` construía una `PerspectiveCamera` nueva en cada llamada y
 * `applyAspect` la llama hasta tres veces por cambio de tamaño. No es camino de fotograma,
 * pero crear una cámara para tirarla es gratis de evitar.
 */
const probe = new THREE.PerspectiveCamera(BASE_FOV, 1, 0.1, 200);
const cornerScratch = new THREE.Vector3();

/**
 * Trozo de suelo que entra en pantalla, en coordenadas relativas al punto de mira.
 *
 * Se obtiene proyectando hacia atrás las cuatro esquinas de la imagen y cortándolas contra
 * el plano del suelo, en vez de con una fórmula de trigonometría: la cámara está
 * **inclinada** 53°, así que lo que se ve del suelo no es un rectángulo centrado sino un
 * trapecio —se ve mucho más lejos hacia el fondo que hacia delante—, y cualquier
 * aproximación simétrica deja una franja muerta arriba o recorta la sala abajo. Ése era
 * exactamente el fallo del encuadre anterior.
 *
 * Los cuatro rayos siempre cortan el suelo: con la inclinación de esta cámara y el ángulo
 * máximo, el borde superior de la imagen sigue apuntando por debajo del horizonte, así que
 * el horizonte nunca entra en cuadro.
 *
 * @param {{fov: number, aspect: number, offset: THREE.Vector3, distanceScale: number}} view
 * @returns {Array<{x: number, z: number}>} las cuatro esquinas, en orden no cruzado
 */
export function computeGroundQuad({ fov, aspect, offset, distanceScale }) {
  probe.fov = fov;
  probe.aspect = aspect;
  probe.position.copy(offset).multiplyScalar(distanceScale);
  probe.lookAt(0, 0, 0);
  probe.updateMatrixWorld(true);
  probe.updateProjectionMatrix();

  // En este orden las cuatro esquinas de la imagen recorren el trapecio del suelo sin
  // cruzarse: cerca-izquierda, cerca-derecha, lejos-derecha, lejos-izquierda. Un orden
  // cualquiera daría un polígono en forma de lazo y todos los cortes saldrían mal.
  return [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([nx, ny]) => {
    cornerScratch.set(nx, ny, 1).unproject(probe).sub(probe.position);
    // Parámetro del rayo que lleva la altura a 0. La componente Y es siempre negativa
    // aquí: los cuatro rayos bajan hacia el suelo.
    const hit = cornerScratch.multiplyScalar(-probe.position.y / cornerScratch.y).add(probe.position);
    return { x: hit.x, z: hit.z };
  });
}

/**
 * Distancia desde el punto de mira hasta el borde del trapecio, en la dirección dada.
 *
 * El punto de mira es el centro de la imagen, así que siempre está dentro del polígono y
 * el rayo sale por exactamente un lado.
 *
 * @param {number} dx dirección unitaria en X
 * @param {number} dz dirección unitaria en Z
 * @param {Array<{x: number, z: number}>} quad
 */
export function quadExitDistance(dx, dz, quad) {
  let best = 0;

  for (let i = 0; i < quad.length; i++) {
    const a = quad[i];
    const b = quad[(i + 1) % quad.length];
    const ex = b.x - a.x;
    const ez = b.z - a.z;

    const denominator = ex * dz - ez * dx;
    if (Math.abs(denominator) < 1e-9) continue; // rayo paralelo al lado

    // `s` recorre el lado (0..1) y `t` es la distancia sobre el rayo. El despeje de `t` se
    // hace por la componente **del rayo** que más lejos esté de cero; con la otra, una
    // dirección casi paralela a un eje dividiría por casi nada.
    const s = (a.z * dx - a.x * dz) / denominator;
    if (s < 0 || s > 1) continue;
    const t = Math.abs(dx) > Math.abs(dz)
      ? (a.x + ex * s) / dx
      : (a.z + ez * s) / dz;
    if (t > 0) best = best === 0 ? t : Math.min(best, t);
  }

  return best;
}

/**
 * Cuánto habría que ampliar la vista para que quepa la burbuja de juego. 1 o menos = ya cabe.
 *
 * Se comprueban **las cuatro esquinas contra el trapecio**, no las medidas contra su caja
 * envolvente. La diferencia no es un detalle: la caja incluye el fondo lejano del trapecio,
 * que sólo se ve en una franja estrecha en lo alto de la pantalla, así que daba por
 * cubierta una profundidad que en los laterales no existe. Con esa cuenta, un móvil tumbado
 * se declaraba encuadrado mientras cortaba la sala por arriba y por abajo.
 *
 * Se apoya en que el trapecio crece **en proporción** a la distancia del ojo —es una
 * semejanza—, así que alejar la cámara `k` veces equivale a encoger la sala `k` veces: el
 * factor que falta sale de un solo corte por esquina, sin iterar.
 *
 * @param {Array<{x: number, z: number}>} quad
 * @param {{x: number, z: number}} frameHalf semiejes de la burbuja que hay que cubrir
 */
export function coverageFor(quad, frameHalf) {
  if (!frameHalf) return 1;

  const { x: halfX, z: halfZ } = frameHalf;
  let needed = 1;

  for (const [cx, cz] of [[-halfX, -halfZ], [halfX, -halfZ], [halfX, halfZ], [-halfX, halfZ]]) {
    const distance = Math.hypot(cx, cz);
    if (distance === 0) continue;
    const exit = quadExitDistance(cx / distance, cz / distance, quad);
    if (exit > 0) needed = Math.max(needed, distance / exit);
  }

  return needed;
}

/**
 * Ángulo y alejamiento para una ventana concreta.
 *
 * Se mide la huella real de suelo contra los dos ejes de la burbuja de juego y lo que falte
 * se cubre con dos mandos **en este orden**: primero abriendo el ángulo, y lo que quede,
 * alejando la cámara. Si con el ángulo original ya cabe —cualquier monitor—, no se toca
 * nada: el ángulo se queda en 50 y la distancia en 1, que es el encuadre de siempre.
 *
 * El orden importa: alejar la cámara empequeñece al agente, así que se usa como último
 * recurso; abrir el ángulo cuesta algo de deformación pero conserva el tamaño de lo que hay
 * en el centro.
 *
 * La versión anterior sólo miraba el eje **horizontal**, con una fórmula sobre la medida
 * mayor de la sala. En un monitor daba igual porque sobra ancho, pero en un móvil tumbado
 * (2,2:1) lo que no cabe es el fondo, y la sala se salía por arriba y por abajo sin que nada
 * lo compensara: se jugaba viendo una franja.
 *
 * @returns {{fov: number, distanceScale: number}}
 */
export function fitAspect({ aspect, offset, frameHalf }) {
  if (!frameHalf) return { fov: BASE_FOV, distanceScale: 1 };

  // El encuadre automático se calcula con el zoom **a 1**: es la distancia base de la sala,
  // y lo que el jugador elija se multiplica encima.
  const needed = coverageFor(computeGroundQuad({ fov: BASE_FOV, aspect, offset, distanceScale: 1 }), frameHalf);
  if (needed <= 1) return { fov: BASE_FOV, distanceScale: 1 };

  // Lo que da el ángulo: la huella escala con la tangente del semiángulo, así que ésta es
  // la apertura que multiplicaría la huella por `needed`.
  const half = Math.atan(Math.tan(THREE.MathUtils.degToRad(BASE_FOV) / 2) * needed);
  const fov = Math.min(MAX_FOV, THREE.MathUtils.radToDeg(half) * 2);

  // Y lo que quede, alejando. Se vuelve a medir en vez de restar: al inclinar la cámara,
  // abrir el ángulo agranda el fondo del trapecio más que el frente, y ese reparto desigual
  // no se deduce de la cuenta anterior.
  const remaining = coverageFor(computeGroundQuad({ fov, aspect, offset, distanceScale: 1 }), frameHalf);
  return { fov, distanceScale: Math.min(MAX_DISTANCE_SCALE, Math.max(1, remaining)) };
}

/**
 * Recorta un punto para que no se salga de la sala más el margen. Modifica en el sitio.
 *
 * @param {THREE.Vector3} target
 * @param {{x: number, z: number}|null} half semiejes de la sala
 * @param {number} overscan margen que se le concede
 */
export function clampToBounds(target, half, overscan) {
  if (!half) return target;

  const halfX = half.x + overscan;
  const halfZ = half.z + overscan;

  target.x = THREE.MathUtils.clamp(target.x, -halfX, halfX);
  target.z = THREE.MathUtils.clamp(target.z, -halfZ, halfZ);

  return target;
}
