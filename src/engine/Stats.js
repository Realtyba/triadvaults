/**
 * Contador de fotogramas y de llamadas de dibujo.
 *
 * Existe porque no había **nada**: ni `Stats.js`, ni una lectura de `renderer.info`, ni
 * un contador de FPS. Sin eso, "va más fluido" es una opinión, y el preset `movil`
 * —que enciende el postprocesado en un teléfono y lo paga instanciando los muros— es
 * justo el cambio que no se puede validar a ojo. Con esto se comprueba en el aparato
 * real que el bloom cabe en el fotograma y que las llamadas bajaron de verdad.
 *
 * Va detrás de `?stats=1` y no de un ajuste del menú a propósito: es una herramienta de
 * desarrollo, no una opción del juego, y una opción más en Ajustes es una opción que
 * hay que traducir, mantener y explicar.
 *
 * El coste cuando está apagado es una comparación de una cadena al arrancar y nada por
 * fotograma: el bucle ni siquiera lo llama.
 */

/** Cada cuánto se refresca el texto. Más rápido y los números no se pueden leer. */
const REFRESH_MS = 500;

export function statsRequested() {
  if (typeof window === 'undefined') return false;
  return new URLSearchParams(window.location.search).get('stats') === '1';
}

export class StatsOverlay {
  /** @param {THREE.WebGLRenderer} renderer */
  constructor(renderer) {
    this.renderer = renderer;
    this.frames = 0;
    this.lastFlush = performance.now();
    this.peakCalls = 0;
    this.peakTriangles = 0;

    // `renderer.info` se pone a cero en CADA `render()`, y con el postprocesado activo
    // un fotograma son varios: el pase de escena, el bloom, el grading y la salida. Con
    // el reinicio automático, lo que quedaba al leerlo era el último pase —un cuadrilátero
    // a pantalla completa—, así que el contador informaba de "1 draw · 0 tris" con la
    // sala entera dibujada delante. Un contador que miente es peor que no tener ninguno:
    // habría dado por bueno cualquier presupuesto.
    renderer.info.autoReset = false;

    this.node = document.createElement('div');
    this.node.className = 'stats-overlay';
    document.body.appendChild(this.node);
  }

  /**
   * Se llama una vez por fotograma pintado, **después** del render: `renderer.info`
   * cuenta lo que se ha enviado, así que leerlo antes daría siempre las cifras del
   * fotograma anterior.
   */
  update() {
    this.frames++;

    // Se guarda el máximo del intervalo y no el del último fotograma: entre dos
    // refrescos hay unos treinta, y el que toque leer podría ser uno en el que el
    // fantasma o las partículas no estuvieran en pantalla.
    const { calls, triangles } = this.renderer.info.render;
    this.peakCalls = Math.max(this.peakCalls, calls);
    this.peakTriangles = Math.max(this.peakTriangles, triangles);

    // Ya acumulado todo el fotograma —todos los pases—, se pone a cero a mano: el
    // reinicio automático está desactivado, ver el constructor.
    this.renderer.info.reset();

    const now = performance.now();
    const elapsed = now - this.lastFlush;
    if (elapsed < REFRESH_MS) return;

    const fps = Math.round((this.frames * 1000) / elapsed);
    const { textures, geometries } = this.renderer.info.memory;

    this.node.textContent =
      `${fps} fps · ${this.peakCalls} draw · ${(this.peakTriangles / 1000).toFixed(1)}k tris · ` +
      `${geometries} geo · ${textures} tex`;

    this.frames = 0;
    this.peakCalls = 0;
    this.peakTriangles = 0;
    this.lastFlush = now;
  }

  destroy() {
    // Se devuelve el reinicio automático: sin él, cualquier otro consumidor de
    // `renderer.info` leería cifras que crecen sin parar.
    this.renderer.info.autoReset = true;
    this.node.remove();
  }
}
