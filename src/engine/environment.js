import * as THREE from 'three';

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
 */

/** Ancho del lienzo equirrectangular. Se prefiltra a 128, así que más no aporta. */
const WIDTH = 256;
const HEIGHT = 128;

/** Cuántas tiras de neón verticales rodean la bóveda. */
const STRIPS = 7;

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
    const key = `${colorHex}:${bgHex}`;
    if (!this.cache.has(key)) {
      const source = this.paint(colorHex, bgHex);
      const target = this.pmrem.fromEquirectangular(source);
      // El lienzo ya está convolucionado en el mapa: conservarlo sería duplicar.
      source.dispose();
      this.cache.set(key, target.texture);
    }
    return this.cache.get(key);
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
    this.cache.forEach(texture => texture.dispose());
    this.cache.clear();
    this.pmrem.dispose();
  }
}
