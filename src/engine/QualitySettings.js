/**
 * Presets de calidad gráfica.
 *
 * Todo el coste visual que se añade (postprocesado, sombras, partículas) pasa por
 * aquí, para que exista un único sitio donde bajarlo. Un juego que solo se ve bien
 * en la máquina en la que se desarrolló no se puede publicar.
 *
 * Ninguna vista lee estos valores directamente: los consumen `Renderer`, `PostFX`,
 * `Lighting` y `Particles`, que son los que gastan.
 */

import { isCoarsePointer, isHandheld, isMobileGpu } from './device.js';

const STORAGE_KEY = 'triad_quality';

export const QUALITY_LEVELS = ['bajo', 'movil', 'medio', 'alto', 'ultra'];

/**
 * Nota sobre el coste real.
 *
 * Las texturas del juego ocupan unos 3,5 MB en total: son tres, procedurales y
 * pequeñas. Prácticamente **todo** el consumo de vídeo son los búferes de render
 * intermedios, y todos escalan con el CUADRADO del ratio de píxel. Por eso el
 * preset alto no es "el mismo juego con más detalle": es el mismo juego pintado
 * cuatro veces más grande.
 *
 * Con `pixelRatio: 2`, sombras de 4096 y las dos técnicas de suavizado a la vez,
 * ULTRA pedía unos 330 MB en una pantalla de 1080p —y superaba el giga en 4K—, que
 * es cuando una gráfica integrada empieza a fallar reservas y aparecen las bandas y
 * el muestreo sucio que se leían como "las texturas se ven raras".
 */
const PRESETS = {
  bajo: {
    label: 'BAJO',
    pixelRatio: 1,
    shadows: false,
    shadowMapSize: 512,
    postprocessing: false,
    bloomStrength: 0,
    bloomThreshold: 0.62,
    antialias: false,
    smaa: false,
    // Muestreo anisotrópico del suelo. En una GPU móvil cada muestra extra se paga
    // en el fragmento más repetido de la escena, y a esta resolución no se aprecia.
    anisotropy: 1,
    ambientParticles: 0,
    impactParticles: 0,
    cornerLights: 2,
    lightBreathing: false,
    // Luces puntuales de agente: 'all' las tres, 'local' solo la propia.
    playerLights: 'local',

    ghostShroud: false,
    ghostTrail: false,
    dreadPostFX: false,
    bloomScale: 1
  },
  /**
   * Móvil: el neón antes que las sombras.
   *
   * Existe porque `bajo` era lo que recibía **cualquier** teléfono, y `bajo` apaga el
   * postprocesado entero. Como todo el neón del juego son materiales `emissive` y no
   * `MeshBasicMaterial` brillante —decisión deliberada, ver `DungeonGen`—, sin bloom no
   * se lee como luz sino como color plano. O sea que el aparato en el que más se juega
   * era justo en el que el juego perdía su identidad visual. Al fantasma ya hubo que
   * ponerle un contorno por inversión de casco solo para que se viera en este caso.
   *
   * El presupuesto para pagarlo sale de dos sitios, no de la nada: los muros pasan a
   * `InstancedMesh` (de ~66 llamadas de dibujo a 2) y las luces dinámicas bajan de ~8 a
   * 4. Las sombras siguen apagadas: son lo más caro y lo que menos se nota en una
   * pantalla de seis pulgadas.
   */
  movil: {
    label: 'MÓVIL',
    pixelRatio: 1,
    shadows: false,
    shadowMapSize: 512,
    postprocessing: true,
    bloomStrength: 0.62,
    bloomThreshold: 0.66,
    // El bloom se calcula a media resolución y se estira al componer. Es el único
    // efecto de la cadena cuyo coste es puro relleno de píxeles, así que es donde el
    // recorte se nota en el fotograma y no en la imagen: lo que hace es difuminar.
    bloomScale: 0.5,
    antialias: false,
    smaa: false,
    anisotropy: 4,
    ambientParticles: 90,
    impactParticles: 10,
    cornerLights: 2,
    lightBreathing: true,
    playerLights: 'local',

    ghostShroud: true,
    ghostTrail: false,
    dreadPostFX: true
  },
  medio: {
    label: 'MEDIO',
    pixelRatio: 1.25,
    shadows: true,
    shadowMapSize: 1024,
    postprocessing: true,
    bloomStrength: 0.5,
    bloomThreshold: 0.62,
    antialias: false,
    smaa: false,
    anisotropy: 4,
    ambientParticles: 120,
    impactParticles: 12,
    cornerLights: 4,
    lightBreathing: true,
    playerLights: 'all',

    ghostShroud: true,
    ghostTrail: false,
    dreadPostFX: true,
    bloomScale: 1
  },
  alto: {
    label: 'ALTO',
    pixelRatio: 1.5,
    shadows: true,
    shadowMapSize: 2048,
    postprocessing: true,
    bloomStrength: 0.75,
    // Sube con la intensidad: si no, cuanto más fuerte es el bloom más superficies
    // arrastra consigo, y la rejilla emisiva del suelo es la primera en caer.
    bloomThreshold: 0.7,
    antialias: true,
    smaa: false, // ya hay MSAA; ver el comentario de `ultra`
    anisotropy: 8,
    ambientParticles: 260,
    impactParticles: 22,
    cornerLights: 4,
    lightBreathing: true,
    playerLights: 'all',

    ghostShroud: true,
    ghostTrail: true,
    dreadPostFX: true,
    bloomScale: 1
  },
  ultra: {
    label: 'ULTRA',
    // 1.5 en vez de 2: en una pantalla de alta densidad la diferencia no se
    // aprecia y recorta cerca del 45% de la memoria de vídeo.
    pixelRatio: 1.5,
    shadows: true,
    // 4096 daba un téxel ocho veces más fino que en el preset bajo mientras el
    // sesgo de sombra seguía siendo constante, así que el contacto de las sombras
    // se despegaba del suelo. 2048 con sesgo proporcional se ve mejor y cuesta la
    // mitad. Ver `Lighting.applyShadowBias`.
    shadowMapSize: 2048,
    postprocessing: true,
    bloomStrength: 0.8,
    bloomThreshold: 0.75,
    antialias: true,
    // MSAA y SMAA hacen el mismo trabajo. Tenerlos los dos no suavizaba el doble:
    // sumaba dos búferes a resolución completa por la cara.
    smaa: false,
    anisotropy: 8,
    ambientParticles: 420,
    impactParticles: 34,
    cornerLights: 6,
    lightBreathing: true,
    playerLights: 'all',

    ghostShroud: true,
    ghostTrail: true,
    dreadPostFX: true,
    bloomScale: 1
  }
};

/**
 * Primera conjetura razonable para una máquina desconocida.
 *
 * Se mira el renderer real vía `WEBGL_debug_renderer_info` porque
 * `devicePixelRatio` alto no implica GPU potente — un portátil con pantalla
 * retina e integrada es justo el caso que se atragantaría con `ultra`.
 *
 * **Los móviles se comprueban primero y por dos vías.** Antes solo había
 * heurísticas de escritorio, así que un Adreno o un Mali no encajaba en ninguna y
 * caía en la línea final, donde un `devicePixelRatio` de 3 —que tiene cualquier
 * teléfono— se leía como "pantalla buena, luego GPU buena" y devolvía `alto`. El
 * resultado era que el aparato más débil arrancaba con sombras de 2048, suavizado y
 * post-procesado. La cadena del renderer no basta por sí sola: **Safari en iOS
 * oculta esa extensión**, así que el respaldo por puntero grueso no es un extra,
 * es la única prueba que queda en un iPhone.
 */
function detectLevel() {
  if (typeof document === 'undefined') return 'alto';

  try {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
    if (!gl) return 'bajo';

    const info = gl.getExtension('WEBGL_debug_renderer_info');
    const renderer = info ? String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL)) : '';
    const lowered = renderer.toLowerCase();

    // Móvil o tableta: tienen preset propio. Antes caían en `bajo`, que apaga el
    // postprocesado y con él todo el neón; ver la nota del preset `movil`.
    if (isMobileGpu(lowered)) return 'movil';
    if (isHandheld()) return 'movil';

    // Software o integradas antiguas: no aguantan el postprocesado.
    if (/swiftshader|llvmpipe|software/.test(lowered)) return 'bajo';
    if (/intel.*(hd|uhd) graphics (5|6)/.test(lowered)) return 'bajo';
    if (/intel/.test(lowered) && !/arc|iris xe/.test(lowered)) return 'medio';

    // Un ratón descarta el caso anterior; la densidad de píxel ya solo distingue
    // entre una pantalla de trabajo y una normal.
    if (isCoarsePointer()) return 'medio';
    return window.devicePixelRatio > 1.5 ? 'alto' : 'medio';
  } catch {
    return 'medio';
  }
}

class QualitySettingsStore {
  constructor() {
    const saved = typeof localStorage !== 'undefined' ? localStorage.getItem(STORAGE_KEY) : null;
    this.level = QUALITY_LEVELS.includes(saved) ? saved : detectLevel();
    this.listeners = new Set();
  }

  /** El preset activo. Se lee en cada uso: cambiar de nivel no requiere recrear nada. */
  get current() {
    return PRESETS[this.level];
  }

  get(key) {
    return this.current[key];
  }

  set(level) {
    if (!QUALITY_LEVELS.includes(level) || level === this.level) return this.level;
    this.level = level;
    try {
      localStorage.setItem(STORAGE_KEY, level);
    } catch {
      // Modo privado o almacenamiento lleno: el ajuste vale para esta sesión.
    }
    this.listeners.forEach(fn => fn(this.current, level));
    return level;
  }

  /** @returns {() => void} función para dejar de escuchar */
  subscribe(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** Para pintar el selector de opciones. */
  options() {
    return QUALITY_LEVELS.map(level => ({ level, label: PRESETS[level].label }));
  }
}

export const quality = new QualitySettingsStore();
