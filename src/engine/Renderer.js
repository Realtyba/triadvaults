import * as THREE from 'three';
import { PostFX } from './PostFX.js';
import { quality } from './QualitySettings.js';
import { setMaxAnisotropy, disposeTextureCache } from './textures.js';
import { disposeSharedGeometry } from '../procedural/DungeonGen.js';
import { isHandheld, watchViewport } from './device.js';
import { EnvironmentBuilder } from './environment.js';
import { yieldToMain } from '../utils/async.js';

/** Color de fondo y niebla por defecto, hasta que un nivel imponga su tema. */
const DEFAULT_ATMOSPHERE = { bg: 0x060812, fogDensity: 0.035, color: 0x00f3ff };

/**
 * Trabajo de compilación que se hace del tirón antes de devolver el hilo, en ms.
 *
 * Es el intercambio entre "el anillo del loader gira" y "la carga termina": cada pausa
 * cuesta un fotograma completo, así que un presupuesto pequeño anima mejor y tarda más.
 * A 16 ms el loader se repinta a unos 30 por segundo, que ya se lee como fluido, y la
 * espera añadida no llega a doblar lo que cuesta compilar. Ver `precompile`.
 */
const COMPILE_SLICE_MS = 16;

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

  /**
   * Fuerza la compilación de todos los shaders antes de que el nivel se vea.
   *
   * WebGL es vago: no compila el programa de un material hasta el primer fotograma en
   * que lo dibuja. Sin esto, el tirón caía justo en los peores momentos —al aparecer el
   * agente y al abrirse las compuertas—, que es cuando el jugador está mirando.
   *
   * Dos cosas que no son evidentes y que costaron el fallo que esto arregla:
   *
   * 1. `compile()` recorre con `traverse`, **no** con `traverseVisible`, y no mira el
   *    frustum. O sea que los objetos ocultos —las compuertas antes de resolver el
   *    puzle— ya entran solos. La versión anterior los forzaba a `visible = true` sin
   *    necesidad, y de paso dejaba la escena en un estado inconsistente mientras tanto.
   * 2. Lo que `compile()` **no** toca es el `MeshDepthMaterial` que el mapa de sombras
   *    fabrica por su cuenta. Ahí estaba el tirón de las compuertas: sus marcos
   *    proyectan sombra, y su programa de profundidad se compilaba en el primer
   *    fotograma en que se hacían visibles. Eso lo cubre `warmUpShadows`.
   *
   * Se trocea por hijos de la escena porque el tercer argumento de `compile` existe
   * justamente para eso: recoge las luces de la escena entera pero solo prepara los
   * materiales del subárbol que se le pasa. Así el anillo del loader gira entre tanda y
   * tanda en vez de quedarse clavado hasta el último shader.
   */
  async precompile(scene, camera) {
    if (!this.renderer || !scene || !camera) return;

    // Se cede por **tiempo gastado**, no por hijo.
    //
    // Ceder tras cada hijo parece más fino y es peor: cada `yieldToMain` cuesta un
    // fotograma entero (~16 ms) se haya trabajado 30 ms o 0,2 ms, así que una escena de
    // treinta objetos pagaba medio segundo de espera con la CPU parada para repartir un
    // trabajo que dura bastante menos. Con un presupuesto por tanda, el número de esperas
    // lo marca el trabajo real y el anillo del loader sigue girando igual.
    let sliceStart = performance.now();
    for (const child of scene.children) {
      this.renderer.compile(child, camera, scene);
      if (performance.now() - sliceStart < COMPILE_SLICE_MS) continue;
      await yieldToMain();
      sliceStart = performance.now();
    }

    await this.warmUpShadows(scene, camera);

    // Compilar no es enlazar. Con la extensión disponible, esto espera a que los
    // programas estén **listos** sondeando en vez de bloquear el hilo en el
    // `getProgramParameter` del primer dibujo. Su `compile()` interno ya no cuesta
    // nada: encuentra todos los programas en la caché que acaba de llenar el bucle.
    if (this.renderer.extensions.get('KHR_parallel_shader_compile') && this.renderer.compileAsync) {
      await this.renderer.compileAsync(scene, camera);
    }
  }

  /**
   * Obliga al mapa de sombras a fabricar sus materiales de profundidad.
   *
   * No hay API para pedirlo, así que se dibuja un fotograma completo a un objetivo de
   * 1×1: el pase de sombras se ejecuta a su resolución real —que es lo que compila los
   * programas— y el pase de color no cuesta relleno porque no hay dónde pintarlo.
   *
   * Aquí sí hay que forzar `visible` y `frustumCulled`, al revés que en `precompile`:
   * el pase de sombras respeta los dos, y las compuertas están ocultas y fuera de
   * cámara precisamente hasta el momento en que queremos que no haya tirón.
   */
  async warmUpShadows(scene, camera) {
    if (!this.renderer.shadowMap.enabled) return;

    const hidden = [];
    const culled = [];
    scene.traverse(obj => {
      if (obj.visible === false) {
        obj.visible = true;
        hidden.push(obj);
      }
      if (obj.frustumCulled) {
        obj.frustumCulled = false;
        culled.push(obj);
      }
    });

    if (!this.shadowWarmupTarget) this.shadowWarmupTarget = new THREE.WebGLRenderTarget(1, 1);

    const previousTarget = this.renderer.getRenderTarget();
    try {
      this.renderer.shadowMap.needsUpdate = true;
      this.renderer.setRenderTarget(this.shadowWarmupTarget);
      this.renderer.render(scene, camera);
    } finally {
      this.renderer.setRenderTarget(previousTarget);
      hidden.forEach(obj => { obj.visible = false; });
      culled.forEach(obj => { obj.frustumCulled = true; });
    }

    await yieldToMain();
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
    if (this.shadowWarmupTarget) this.shadowWarmupTarget.dispose();
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
