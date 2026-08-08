/**
 * Cada cuánto ocurren las cosas que no ocurren cada fotograma.
 *
 * Estaban escritas como números sueltos dentro de la función que las usaba —un `0.5`
 * aquí, un `0.125` allá—, cada una con su comentario justificándola. Aparte no se veía
 * nada; juntas se lee el **reparto** completo del presupuesto de fotograma, que es la
 * pregunta que uno se hace cuando algo va lento: qué corre a 60 y qué no.
 *
 * Todos los valores son **segundos entre ejecuciones**, no hercios, porque así es como se
 * comparan contra el acumulador de delta y no hay que dividir en el bucle caliente.
 *
 * Lo que NO está aquí, y a propósito:
 *  - `MOVE_SEND_HZ` y `GHOST_SEND_HZ` (`shared/constants.js`): son protocolo, los tiene
 *    que conocer también el servidor.
 *  - `edgeMarkerHz` (`engine/QualitySettings.js`): depende del preset de calidad, no es
 *    una constante de juego.
 *  - El retardo de la barra fantasma del HUD (`ui/views/HudView.js`): espeja una
 *    transición CSS, así que vive pegado a ella o los dos números se separan.
 */

/** Cronómetro, modo de entrada y estado de los compañeros. A 2 Hz no hace falta más. */
export const HUD_TICK_S = 0.5;

/**
 * Tensión sonora, latido y cierre de imagen por cercanía del fantasma.
 *
 * A 5 Hz. La **sacudida** de cámara por cercanía no entra aquí: ésa sí va por fotograma,
 * porque a 5 Hz se sentiría como tirones en vez de como temblor.
 */
export const TENSION_TICK_S = 0.2;

/**
 * Progreso del puzle hacia el HUD, a 8 Hz.
 *
 * Antes se hacía un `patch` en cada fotograma incluso cuando el valor no cambiaba, y era
 * la mayor fuente de repintados inútiles de la interfaz.
 */
export const PUZZLE_TICK_S = 0.125;

/** Motas del rastro del fantasma: por dónde ha pasado algo que ya no ves. */
export const GHOST_TRAIL_S = 0.15;

/**
 * Pausa de victoria antes de cargar el nivel siguiente.
 *
 * Estaba escrita dos veces —en `NetworkBridge` con nombre y en `UIManager` como un `2000`
 * suelto—, o sea que la partida en línea y la partida sin conexión podían acabar con
 * pausas distintas sin que nadie lo notara al cambiar una.
 */
export const NEXT_LEVEL_DELAY_MS = 2000;
