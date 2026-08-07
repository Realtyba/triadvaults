/**
 * Qué clase de máquina está ejecutando el juego.
 *
 * Está aparte del resto del motor porque lo consultan capas que no se conocen entre
 * sí: `QualitySettings` para elegir preset, `Renderer` para el contexto de WebGL,
 * `Input` para decidir si monta los controles táctiles y `UIManager` para el estado
 * de la interfaz. Con la comprobación repetida en cada sitio bastaba con arreglar
 * una para dejar las otras tres mintiendo.
 *
 * No se mira el `userAgent`: es falsificable, cambia de formato cada dos años y lo
 * que hace falta saber no es la marca del aparato sino **si hay un dedo y si la GPU
 * es de las que se ahogan**. Eso lo contestan `matchMedia` y la cadena del renderer.
 */

/**
 * Puntero grueso: dedo o lápiz, no ratón.
 *
 * Se comprueba en cada llamada y no se cachea en un módulo: un portátil convertible
 * cambia de respuesta al plegar la pantalla, y un escritorio con panel táctil declara
 * los dos. `maxTouchPoints` es el respaldo para los navegadores donde la consulta de
 * medios `pointer` no está implementada.
 */
export function isCoarsePointer() {
  if (typeof window === 'undefined') return false;
  if (window.matchMedia?.('(pointer: coarse)').matches) return true;
  return (navigator.maxTouchPoints || 0) > 0;
}

/** Hay soporte táctil, aunque el puntero principal sea un ratón (convertibles). */
export function hasTouchSupport() {
  if (typeof window === 'undefined') return false;
  return 'ontouchstart' in window || (navigator.maxTouchPoints || 0) > 0;
}

/**
 * GPU de móvil o tableta, a partir de la cadena de `WEBGL_debug_renderer_info`.
 *
 * **Safari en iOS oculta esa extensión** (devuelve `null`, o "Apple GPU" a secas)
 * para no dar una huella de identificación, así que esto devuelve `false` en un
 * iPhone y quien decide allí es `isCoarsePointer`. Es un indicio que suma, nunca la
 * única prueba.
 */
export function isMobileGpu(rendererString) {
  if (!rendererString) return false;
  return /adreno|mali|powervr|apple\s?gpu|xclipse|immortalis|videocore|tegra/i.test(rendererString);
}

/** Pantalla pequeña, con independencia del dispositivo. */
export function isSmallViewport() {
  if (typeof window === 'undefined') return false;
  return Math.min(window.innerWidth, window.innerHeight) <= 600;
}

/** El aparato se sostiene en la mano: dedo **y** pantalla de mano. */
export function isHandheld() {
  return isCoarsePointer() && Math.min(window.innerWidth, window.innerHeight) <= 900;
}

/**
 * Cambios de tamaño y de orientación, agrupados y con freno.
 *
 * En un móvil la barra de URL se contrae y se expande al desplazarse, y cada píxel
 * de ese recorrido emite un `resize`. Sin freno, cada uno rehace el tamaño del
 * renderizador y **reasigna todos los búferes intermedios del post-procesado**, que
 * es de donde salen los tirones al empezar a moverse.
 *
 * `orientationchange` va aparte porque en varios navegadores llega **antes** de que
 * `innerWidth`/`innerHeight` reflejen la rotación: si se atendiera al vuelo, el
 * lienzo se quedaría con las medidas anteriores hasta el siguiente evento.
 *
 * @param {(size: {width: number, height: number}) => void} callback
 * @param {number} wait milisegundos de espera antes de atender
 * @returns {() => void} función para dejar de escuchar
 */
export function watchViewport(callback, wait = 150) {
  let timer = null;

  const fire = () => {
    timer = null;
    callback({ width: window.innerWidth, height: window.innerHeight });
  };

  const schedule = (delay = wait) => {
    clearTimeout(timer);
    timer = setTimeout(fire, delay);
  };

  const onResize = () => schedule();
  // Tras rotar hace falta un margen mayor: las medidas nuevas no están listas todavía.
  const onOrientation = () => schedule(wait + 150);

  window.addEventListener('resize', onResize);
  window.addEventListener('orientationchange', onOrientation);

  return () => {
    clearTimeout(timer);
    window.removeEventListener('resize', onResize);
    window.removeEventListener('orientationchange', onOrientation);
  };
}
