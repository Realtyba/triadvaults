import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { quality } from './QualitySettings.js';

/**
 * Entorno de reflejo del bioma.
 *
 * ## El problema que resuelve
 *
 * El suelo se declara con `metalness: 0.72` y los muros con `0.65`
 * (`procedural/DungeonGen.js`), y `darkBodyMaterial` llega a `0.8`. En un modelo PBR
 * el parámetro `metalness` **traslada la respuesta de la superficie del término difuso
 * al especular**: cuanto más metálica, menos color propio devuelve y más depende de lo
 * que tenga alrededor para reflejar. Y este juego no tenía nada que reflejar: ni
 * `envMap`, ni `scene.environment`, ni PMREM en ninguna parte.
 *
 * Metal sin entorno = superficie apagada. Ésa era la causa técnica de que la bóveda se
 * viera plana pese a tener materiales físicos, iluminación por bioma y bloom: todo el
 * brillo salía de un puñado de luces puntuales, y el 90 % de los píxeles de la escena
 * —suelo y muros— devolvían casi negro.
 *
 * ## Por qué está dibujado y no cargado
 *
 * Un `.hdr` de entorno es el fichero más pesado de un juego web, y aquí no hace falta:
 * lo que tienen que reflejar unos muros de una bóveda cyberpunk son sus propias tiras
 * de neón. Se dibujan en un lienzo equirrectangular de 256×128 —doce kilobytes de
 * memoria de vídeo antes del prefiltrado— y se convolucionan una vez por bioma.
 *
 * ## Por qué hay franjas verticales y no solo un degradado
 *
 * Un degradado limpio deja el metal con un tono uniforme, que se lee como plástico. Lo
 * que delata a una superficie metálica es el **contraste** del reflejo: zonas claras y
 * oscuras que se desplazan al mover la cámara. Las franjas son eso, y son también la
 * razón de que la sala se vea distinta según hacia dónde mires.
 *
 * ## Dos fuentes, y por qué ninguna es un `.hdr`
 *
 * El lienzo de arriba tiene un techo: siete franjas planas se reflejan como siete
 * franjas planas, y desde que la cámara **se mueve con el agente** ese reflejo estático
 * es lo que delata que el suelo no es metal de verdad. Lo que hace falta es un entorno
 * con **estructura** —paneles, bloques, un gradiente de techo— para que el reflejo
 * cambie al desplazarse.
 *
 * La salida obvia sería un `.hdr`, y no vale: iría a `public/`, está en `.gitignore` y
 * habría que bajarlo, pero el juego tiene que poder jugarse sin descargas. O sea que
 * habría que conservar el lienzo **igualmente** como respaldo, y acabaríamos con dos
 * entornos para siempre en el que el bueno es el que casi nadie tiene.
 *
 * `RoomEnvironment` de `three/examples` no tiene ese problema: es geometría con
 * materiales emisivos que entra en el paquete, cuesta **cero bytes de red** y ya está
 * en `node_modules`. En crudo no sirve —es un estudio blanco neutro y borraría el
 * bioma, que es justo el argumento de este fichero—, así que se le repintan los
 * materiales con el acento y el fondo del nivel antes de prefiltrarlo. Ver `buildRoom`.
 *
 * Qué fuente se usa lo dice el preset (`envSource`): el lienzo en `bajo` y `movil`, la
 * sala prefiltrada de ahí para arriba.
 */

/** Ancho del lienzo equirrectangular. Se prefiltra a 128, así que más no aporta. */
const WIDTH = 256;
const HEIGHT = 128;

/** Cuántas tiras de neón verticales rodean la bóveda. */
const STRIPS = 7;

/**
 * Cuánto se baja la emisión de `RoomEnvironment` al teñirla.
 *
 * Sus paneles están calibrados para iluminar un estudio de producto sobre fondo claro
 * —radiancias de 17 a 100— y esta bóveda es una cueva. Sin bajarlo, cambiar de preset
 * reiluminaría el juego entero en vez de cambiar solo la textura del reflejo.
 *
 * Es la pieza a verificar en pantalla si algo se ve lavado o apagado al pasar de
 * `movil` a `medio`: **se ajusta aquí y no en los `envMapIntensity`**, que están
 * calibrados por superficie en tres ficheros distintos (suelo 1,6 en `DungeonGen`,
 * muros 0,55 en `wallMaterial`, cuerpos 0,8 en `materials`) y tocarlos partiría esa
 * calibración en tres.
 */
const ROOM_EMISSION_SCALE = 0.09;

/** Coeficientes de luminancia Rec. 709. Ver `tintEmissive`. */
function luminance(color) {
  return 0.2126 * color.r + 0.7152 * color.g + 0.0722 * color.b;
}

/**
 * Genera y prefiltra el entorno de un bioma.
 *
 * El resultado se cachea por color: un bioma se repite cada cinco niveles y
 * `PMREMGenerator.fromEquirectangular` es lo bastante caro como para notarse si se
 * rehace en cada `build()`.
 */
export class EnvironmentBuilder {
  constructor(renderer) {
    this.renderer = renderer;
    this.pmrem = new THREE.PMREMGenerator(renderer);
    // Compilar el shader del prefiltrado ahora evita el tirón en el primer nivel.
    this.pmrem.compileEquirectangularShader();
    this.cache = new Map();
  }

  /**
   * @param {number} colorHex color de acento del bioma
   * @param {number} bgHex    color de fondo y niebla del bioma
   * @returns {THREE.Texture} mapa de entorno listo para `scene.environment`
   */
  get(colorHex, bgHex) {
    // La fuente entra en la clave: al cambiar de preset a mitad de partida hay que
    // prefiltrar de nuevo, y sin esto se serviría el mapa del preset anterior.
    const source = quality.get('envSource') === 'room' ? 'room' : 'canvas';
    const key = `${source}:${colorHex}:${bgHex}`;

    if (!this.cache.has(key)) {
      const target = source === 'room'
        ? this.buildRoom(colorHex, bgHex)
        : this.buildCanvas(colorHex, bgHex);
      // Se guarda el objetivo de render **entero**, no sólo su textura.
      //
      // `fromScene` y `fromEquirectangular` devuelven un `WebGLRenderTarget`, y aquí se
      // conservaba únicamente su `.texture`. `texture.dispose()` no libera el
      // framebuffer ni el búfer de profundidad del objetivo, así que cada bioma nuevo
      // —y cada cambio de preset— dejaba uno colgado sin forma de alcanzarlo. Con el
      // objetivo guardado, `dispose()` puede soltarlo todo.
      this.cache.set(key, target);
    }
    return this.cache.get(key).texture;
  }

  /** Prefiltra el lienzo pintado. Ver `paint`. */
  buildCanvas(colorHex, bgHex) {
    const source = this.paint(colorHex, bgHex);
    const target = this.pmrem.fromEquirectangular(source);
    // El lienzo ya está convolucionado en el mapa: conservarlo sería duplicar.
    source.dispose();
    return target;
  }

  /**
   * Prefiltra `RoomEnvironment` repintado con los colores del bioma.
   *
   * Sus materiales llegan **compartidos** entre varias mallas —una `roomMaterial` para
   * la caja envolvente, una `boxMaterial` para los bloques y una por panel emisivo—, así
   * que teñir recorriendo las mallas repintaría el mismo material varias veces. Se lleva
   * un conjunto de los ya vistos: es más barato que clonar y no cambia el resultado.
   *
   * La escena se desecha en cuanto está prefiltrada: lo que se guarda es el mapa, y
   * dejarla viva sería mantener en memoria una habitación que nadie va a mirar.
   */
  buildRoom(colorHex, bgHex) {
    const scene = new RoomEnvironment();
    const accent = new THREE.Color(colorHex);
    const bg = new THREE.Color(bgHex);
    const seen = new Set();

    scene.traverse(object => {
      // La luz puntual que trae dentro también es blanca de estudio.
      if (object.isPointLight) {
        object.color.copy(accent);
        object.intensity *= ROOM_EMISSION_SCALE;
        return;
      }
      if (!object.material || seen.has(object.material)) return;
      seen.add(object.material);

      if (object.material.isMeshBasicMaterial) this.tintEmissive(object.material, accent);
      // Las superficies no emisivas son las paredes y los bloques del estudio: son lo
      // que da estructura al reflejo, y en negro no reflejarían nada. Se van al color
      // de fondo del bioma, subido lo justo para que sigan leyéndose como volumen.
      else object.material.color.copy(bg).lerp(accent, 0.12).multiplyScalar(2.2);
    });

    const target = this.pmrem.fromScene(scene, 0.04);
    scene.dispose();
    return target;
  }

  /**
   * Lleva un panel emisivo al color del bioma **sin cambiar su brillo**.
   *
   * `RoomEnvironment` codifica la intensidad de cada panel en el propio color, como un
   * gris de valor 17 a 100. Multiplicar ese gris por un acento saturado —un cian es
   * `(0, 0.95, 1)`— le quita casi toda la componente roja y la escena se oscurece de
   * paso, así que el cambio de tono vendría con un cambio de exposición encima.
   *
   * Dividiendo por la luminancia del acento se conserva la energía: el panel emite lo
   * mismo, solo que en color. Es lo que permite que cambiar de bioma cambie el tono del
   * reflejo y no lo que se ve.
   */
  tintEmissive(material, accent) {
    const intensity = material.color.r * ROOM_EMISSION_SCALE;
    const energy = Math.max(luminance(accent), 0.05);
    material.color.copy(accent).multiplyScalar(intensity / energy);
  }

  /** Dibuja el lienzo equirrectangular del bioma. */
  paint(colorHex, bgHex) {
    const canvas = document.createElement('canvas');
    canvas.width = WIDTH;
    canvas.height = HEIGHT;
    const ctx = canvas.getContext('2d');

    const accent = new THREE.Color(colorHex);
    const bg = new THREE.Color(bgHex);
    const rgb = c => `${Math.round(c.r * 255)}, ${Math.round(c.g * 255)}, ${Math.round(c.b * 255)}`;

    // Vertical: techo casi negro, horizonte con el color del bioma, suelo apagado.
    // El horizonte es lo que ve un suelo reflectante mirado en picado, que es
    // exactamente el encuadre de este juego.
    const sky = ctx.createLinearGradient(0, 0, 0, HEIGHT);
    sky.addColorStop(0, `rgb(${rgb(bg.clone().multiplyScalar(0.45))})`);
    sky.addColorStop(0.46, `rgb(${rgb(bg)})`);
    sky.addColorStop(0.52, `rgb(${rgb(accent.clone().multiplyScalar(0.5))})`);
    sky.addColorStop(0.62, `rgb(${rgb(bg.clone().multiplyScalar(0.8))})`);
    sky.addColorStop(1, `rgb(${rgb(bg.clone().multiplyScalar(0.25))})`);
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, WIDTH, HEIGHT);

    // Tiras verticales de neón: el contraste que hace que el metal se lea como metal.
    // Van con separación irregular a propósito; repartidas a intervalos iguales, girar
    // la cámara producía un parpadeo regular que se leía como un defecto.
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < STRIPS; i++) {
      const x = ((i + Math.sin(i * 2.3) * 0.32) / STRIPS) * WIDTH;
      const width = 4 + (i % 3) * 3;

      const strip = ctx.createLinearGradient(x - width, 0, x + width, 0);
      strip.addColorStop(0, 'rgba(0, 0, 0, 0)');
      strip.addColorStop(0.5, `rgba(${rgb(accent)}, ${0.5 + (i % 2) * 0.28})`);
      strip.addColorStop(1, 'rgba(0, 0, 0, 0)');

      ctx.fillStyle = strip;
      // Solo la mitad superior: una tira que llegue al suelo se refleja debajo del
      // agente y parece una grieta luminosa en el pavimento.
      ctx.fillRect(x - width, 0, width * 2, HEIGHT * 0.56);
    }

    // Franja de horizonte continua: es la que le da al suelo su brillo rasante.
    const horizon = ctx.createLinearGradient(0, HEIGHT * 0.44, 0, HEIGHT * 0.56);
    horizon.addColorStop(0, 'rgba(0, 0, 0, 0)');
    horizon.addColorStop(0.5, `rgba(${rgb(accent)}, 0.4)`);
    horizon.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = horizon;
    ctx.fillRect(0, HEIGHT * 0.44, WIDTH, HEIGHT * 0.12);
    ctx.globalCompositeOperation = 'source-over';

    const texture = new THREE.CanvasTexture(canvas);
    texture.mapping = THREE.EquirectangularReflectionMapping;
    texture.colorSpace = THREE.SRGBColorSpace;
    return texture;
  }

  dispose() {
    // `WebGLRenderTarget.dispose()` suelta el framebuffer, el búfer de profundidad y la
    // textura. Llamar sólo a `texture.dispose()`, que es lo que se hacía, dejaba los dos
    // primeros vivos por cada bioma visitado.
    this.cache.forEach(target => target.dispose());
    this.cache.clear();
    this.pmrem.dispose();
  }
}
