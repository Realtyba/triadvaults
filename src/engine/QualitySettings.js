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

const STORAGE_KEY = 'triad_quality';

export const QUALITY_LEVELS = ['bajo', 'medio', 'alto', 'ultra'];

const PRESETS = {
  bajo: {
    label: 'BAJO',
    pixelRatio: 1,
    shadows: false,
    shadowMapSize: 512,
    postprocessing: false,
    bloomStrength: 0,
    antialias: false,
    smaa: false,
    ambientParticles: 0,
    impactParticles: 0,
    cornerLights: 2,
    lightBreathing: false
  },
  medio: {
    label: 'MEDIO',
    pixelRatio: 1.25,
    shadows: true,
    shadowMapSize: 1024,
    postprocessing: true,
    bloomStrength: 0.5,
    antialias: false,
    smaa: false,
    ambientParticles: 120,
    impactParticles: 12,
    cornerLights: 4,
    lightBreathing: true
  },
  alto: {
    label: 'ALTO',
    pixelRatio: 1.5,
    shadows: true,
    shadowMapSize: 2048,
    postprocessing: true,
    bloomStrength: 0.75,
    antialias: true,
    smaa: true,
    ambientParticles: 260,
    impactParticles: 22,
    cornerLights: 4,
    lightBreathing: true
  },
  ultra: {
    label: 'ULTRA',
    pixelRatio: 2,
    shadows: true,
    shadowMapSize: 4096,
    postprocessing: true,
    bloomStrength: 0.95,
    antialias: true,
    smaa: true,
    ambientParticles: 420,
    impactParticles: 34,
    cornerLights: 6,
    lightBreathing: true
  }
};

/**
 * Primera conjetura razonable para una máquina desconocida.
 *
 * Se mira el renderer real vía `WEBGL_debug_renderer_info` porque
 * `devicePixelRatio` alto no implica GPU potente — un portátil con pantalla
 * retina e integrada es justo el caso que se atragantaría con `ultra`.
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

    // Software o integradas antiguas: no aguantan el postprocesado.
    if (/swiftshader|llvmpipe|software/.test(lowered)) return 'bajo';
    if (/intel.*(hd|uhd) graphics (5|6)/.test(lowered)) return 'bajo';
    if (/intel/.test(lowered) && !/arc|iris xe/.test(lowered)) return 'medio';

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
