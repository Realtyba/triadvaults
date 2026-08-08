import * as THREE from 'three';
import { PostFX } from './PostFX.js';
import { quality } from './QualitySettings.js';
import { setMaxAnisotropy, disposeTextureCache } from './textures.js';
import { disposeSharedGeometry } from '../procedural/DungeonGen.js';
import { isHandheld, watchViewport } from './device.js';
import { EnvironmentBuilder } from './environment.js';

/** Color de fondo y niebla por defecto, hasta que un nivel imponga su tema. */
const DEFAULT_ATMOSPHERE = { bg: 0x060812, fogDensity: 0.035, color: 0x00f3ff };

export class EngineRenderer {
  constructor(container) {
    this.container = container;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(DEFAULT_ATMOSPHERE.bg);
    this.scene.fog = new THREE.FogExp2(DEFAULT_ATMOSPHERE.bg, DEFAULT_ATMOSPHERE.fogDensity);

    this.renderer = this.createRenderer();
    if (this.renderer) this.container.appendChild(this.renderer.domElement);

    this.postFX = null;

    // Sin esto los materiales metálicos —el suelo y todos los muros— no tienen nada
    // que reflejar y devuelven casi negro. Ver el porqué largo en `environment.js`.
    this.environment = this.renderer ? new EnvironmentBuilder(this.renderer) : null;
    this.applyEnvironment(DEFAULT_ATMOSPHERE.color, DEFAULT_ATMOSPHERE.bg);

    // Con freno y agrupando la rotación: en un móvil la barra de URL que se contrae
    // al desplazarse emite `resize` en ráfaga, y cada uno reasigna **todos** los
    // búferes intermedios del post-procesado. De ahí salían los tirones al empezar
    // a moverse. Ver `device.watchViewport`.
    this.unwatchViewport = watchViewport(({ width, height }) => this.onResize(width, height));
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
      const handheld = isHandheld();

      const renderer = new THREE.WebGLRenderer({
        antialias: quality.get('antialias'),
        // Pedir el perfil de máximo rendimiento en un aparato de mano solo adelanta
        // el momento en que el sistema lo baja por temperatura, y a partir de ahí va
        // peor que si no se hubiera pedido nada.
        powerPreference: handheld ? 'default' : 'high-performance',
        // No se usa plantilla en ningún pase: reservarla es memoria de búfer
        // desperdiciada, que es justo lo escaso en un móvil.
        stencil: false
      });
      renderer.setSize(window.innerWidth, window.innerHeight);
      renderer.setPixelRatio(this.targetPixelRatio());
      renderer.shadowMap.enabled = quality.get('shadows');
      // El filtrado suave es el más caro de los tres. En los presets sin
      // post-procesado la diferencia no se aprecia y el mapa de sombras es pequeño.
      renderer.shadowMap.type = quality.get('postprocessing') ? THREE.PCFSoftShadowMap : THREE.PCFShadowMap;
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 1.05;

      // Solo aquí se sabe cuántas muestras admite la GPU real. Las texturas se
      // creaban con un 4 fijo y, al quedar cacheadas, ese valor ya no cambiaba
      // nunca: el suelo hormigueaba igual en todos los presets.
      this.maxAnisotropy = renderer.capabilities.getMaxAnisotropy();
      setMaxAnisotropy(this.targetAnisotropy());

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

  /** Igual que el ratio: lo acota el preset, con el techo de lo que admita la GPU. */
  targetAnisotropy() {
    return Math.min(this.maxAnisotropy || 1, quality.get('anisotropy'));
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
    this.applyEnvironment(color ?? DEFAULT_ATMOSPHERE.color, background);
  }

  /**
   * Reflejo del bioma. Va con la atmósfera y no con las luces porque es lo mismo que
   * el fondo y la niebla: aquello dentro de lo cual está la sala.
   *
   * `EnvironmentBuilder` cachea por color, así que volver a un bioma ya visto —cada
   * cinco niveles— no vuelve a prefiltrar nada.
   */
  applyEnvironment(colorHex, bgHex) {
    if (!this.environment) return;
    this.scene.environment = this.environment.get(colorHex, bgHex);
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
    setMaxAnisotropy(this.targetAnisotropy());
    // `antialias` es un parámetro de creación del contexto: cambiarlo exigiría
    // recrear el renderer y perder la escena. El preset compensa con SMAA.
  }

  onResize(width = window.innerWidth, height = window.innerHeight) {
    if (this.renderer) {
      this.renderer.setSize(width, height);
      this.renderer.setPixelRatio(this.targetPixelRatio());
      // El composer tiene sus propios render targets: sin esto la imagen se
      // quedaba estirada al cambiar el tamaño de la ventana.
      if (this.postFX) this.postFX.setSize(width, height);
    }
    if (this.onResizeCallback) this.onResizeCallback(width, height);
  }

  render(camera, delta = 0) {
    if (!this.renderer) return;
    if (this.postFX && this.postFX.render(delta)) return;
    this.renderer.render(this.scene, camera);
  }

  destroy() {
    if (this.postFX) this.postFX.destroy();
    if (this.environment) this.environment.dispose();
    if (this.unwatchViewport) this.unwatchViewport();
    if (this.unsubscribeQuality) this.unsubscribeQuality();
    if (this.renderer) this.renderer.dispose();

    // Los recursos que sobreviven al nivel se sueltan aquí, que es el único sitio
    // donde consta que ya no hay escena. `disposeTextureCache` estaba escrita y
    // exportada pero no la llamaba nadie.
    disposeTextureCache();
    disposeSharedGeometry();
  }
}
