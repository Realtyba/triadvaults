import * as THREE from 'three';
import { PostFX } from './PostFX.js';
import { quality } from './QualitySettings.js';
import { setMaxAnisotropy, disposeTextureCache } from './textures.js';
import { disposeSharedGeometry } from '../procedural/DungeonGen.js';

/** Color de fondo y niebla por defecto, hasta que un nivel imponga su tema. */
const DEFAULT_ATMOSPHERE = { bg: 0x060812, fogDensity: 0.035 };

export class EngineRenderer {
  constructor(container) {
    this.container = container;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(DEFAULT_ATMOSPHERE.bg);
    this.scene.fog = new THREE.FogExp2(DEFAULT_ATMOSPHERE.bg, DEFAULT_ATMOSPHERE.fogDensity);

    this.renderer = this.createRenderer();
    if (this.renderer) this.container.appendChild(this.renderer.domElement);

    this.postFX = null;

    window.addEventListener('resize', () => this.onResize());
    this.unsubscribeQuality = quality.subscribe(() => this.applyQuality());
  }

  /** ¿Hay contexto 3D? Si no, la interfaz sigue siendo usable, solo sin escena. */
  get isAvailable() {
    return !!this.renderer;
  }

  /**
   * Sin WebGL, `new WebGLRenderer()` lanza. Si eso tumba el constructor, se pierde
   * también el menú y el jugador solo ve una pantalla en negro sin explicación.
   */
  createRenderer() {
    try {
      const renderer = new THREE.WebGLRenderer({
        antialias: quality.get('antialias'),
        powerPreference: 'high-performance'
      });
      renderer.setSize(window.innerWidth, window.innerHeight);
      renderer.setPixelRatio(this.targetPixelRatio());
      renderer.shadowMap.enabled = quality.get('shadows');
      renderer.shadowMap.type = THREE.PCFSoftShadowMap;
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 1.05;

      // Solo aquí se sabe cuántas muestras admite la GPU real. Las texturas se
      // creaban con un 4 fijo y, al quedar cacheadas, ese valor ya no cambiaba
      // nunca: el suelo hormigueaba igual en todos los presets.
      setMaxAnisotropy(renderer.capabilities.getMaxAnisotropy());

      return renderer;
    } catch (err) {
      console.error('[renderer] WebGL no disponible:', err.message);
      return null;
    }
  }

  /** El preset acota el ratio, pero nunca por encima del que pide la pantalla. */
  targetPixelRatio() {
    return Math.min(window.devicePixelRatio, quality.get('pixelRatio'));
  }

  /**
   * La cadena de postprocesado necesita la cámara, que se crea después que el
   * renderer. Se engancha explícitamente desde `GameApp` en vez de adivinarla.
   */
  attachPostFX(camera) {
    if (!this.renderer || this.postFX) return;
    this.postFX = new PostFX(this.renderer, this.scene, camera);
  }

  /**
   * Atmósfera del nivel. El fondo y la niebla dejan de ser un azul fijo y pasan a
   * formar parte del tema, que es lo que hace que cada bioma se lea como un sitio
   * distinto y no como la misma sala repintada.
   */
  setAtmosphere({ bg, color, fogDensity = 0.035 } = {}) {
    const background = bg ?? DEFAULT_ATMOSPHERE.bg;
    this.scene.background.setHex(background);
    this.scene.fog.color.setHex(background);
    this.scene.fog.density = fogDensity;
    if (this.postFX && color !== undefined) this.postFX.setThemeColor(color);
  }

  /** Destello de pantalla (daño, apertura de compuerta). */
  flash(intensity, colorHex) {
    if (this.postFX) this.postFX.triggerFlash(intensity, colorHex);
  }

  /** Cierra la imagen según la cercanía del fantasma. Ver `PostFX.setDread`. */
  setDread(amount) {
    if (this.postFX) this.postFX.setDread(amount);
  }

  applyQuality() {
    if (!this.renderer) return;
    this.renderer.setPixelRatio(this.targetPixelRatio());
    this.renderer.shadowMap.enabled = quality.get('shadows');
    // `antialias` es un parámetro de creación del contexto: cambiarlo exigiría
    // recrear el renderer y perder la escena. El preset compensa con SMAA.
  }

  onResize() {
    if (this.renderer) {
      this.renderer.setSize(window.innerWidth, window.innerHeight);
      this.renderer.setPixelRatio(this.targetPixelRatio());
      // El composer tiene sus propios render targets: sin esto la imagen se
      // quedaba estirada al cambiar el tamaño de la ventana.
      if (this.postFX) this.postFX.setSize(window.innerWidth, window.innerHeight);
    }
    if (this.onResizeCallback) this.onResizeCallback(window.innerWidth, window.innerHeight);
  }

  render(camera, delta = 0) {
    if (!this.renderer) return;
    if (this.postFX && this.postFX.render(delta)) return;
    this.renderer.render(this.scene, camera);
  }

  destroy() {
    if (this.postFX) this.postFX.destroy();
    if (this.unsubscribeQuality) this.unsubscribeQuality();
    if (this.renderer) this.renderer.dispose();

    // Los recursos que sobreviven al nivel se sueltan aquí, que es el único sitio
    // donde consta que ya no hay escena. `disposeTextureCache` estaba escrita y
    // exportada pero no la llamaba nadie.
    disposeTextureCache();
    disposeSharedGeometry();
  }
}
