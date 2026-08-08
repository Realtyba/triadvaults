import * as THREE from 'three';
import { quality } from './QualitySettings.js';
import { PALETTE } from './materials.js';

/**
 * Semiancho del frustum ortográfico de sombra, en unidades de mundo.
 *
 * Estaba en 35 —la sala más grande entera— porque el volumen estaba **clavado en el
 * origen del mundo** y tenía que cubrir la bóveda completa desde ahí. Ahora sigue a la
 * cámara (`setShadowFocus`), así que solo necesita cubrir lo que se ve: la mitad de
 * extensión reparte los mismos téxeles en la mitad de mundo, o sea sombras el doble de
 * finas sin tocar `shadowMapSize` ni gastar un byte más de memoria.
 */
const SHADOW_EXTENT = 20;

/** Desplazamiento de la luz clave respecto a lo que ilumina. Fija su dirección. */
const LIGHT_OFFSET = { x: 28, y: 34, z: 20 };

/** Factor del sesgo por téxel; calibrado para que 1024 dé el valor que ya funcionaba. */
const BIAS_PER_TEXEL = 0.015;

/**
 * Iluminación de la sala.
 *
 * La escena estaba iluminada de forma casi uniforme: ambiental alta, direccional
 * fuerte y cuatro puntos fijos. Todo quedaba legible pero plano, sin volumen ni
 * zonas de sombra donde el neón destaque. Aquí se baja el relleno, se sube el
 * contraste y las luces de acento laten, que es lo que da sensación de sitio vivo.
 */
export class EngineLighting {
  constructor(scene) {
    this.scene = scene;
    this.cornerLights = [];
    this.elapsed = 0;

    // Relleno bajo: define la silueta sin aplanar el resto.
    this.ambientLight = new THREE.AmbientLight(0x1a1f38, 0.55);
    this.scene.add(this.ambientLight);

    // Cielo frío contra suelo cálido: separa techo de suelo sin coste.
    this.hemiLight = new THREE.HemisphereLight(PALETTE.CYAN, 0x1a0a14, 0.35);
    this.hemiLight.position.set(0, 50, 0);
    this.scene.add(this.hemiLight);

    // Clave principal. Más rasante que antes, para que los muros proyecten
    // sombras largas y la sala tenga profundidad.
    this.dirLight = new THREE.DirectionalLight(0xdfe8ff, 1.15);
    this.dirLight.position.set(LIGHT_OFFSET.x, LIGHT_OFFSET.y, LIGHT_OFFSET.z);
    this.dirLight.castShadow = quality.get('shadows');
    this.configureShadow();
    this.scene.add(this.dirLight);

    // Una luz direccional apunta a su `target`, y por defecto ése es un objeto suelto
    // en el origen. Para poder mover el volumen de sombra hay que darle un objetivo
    // propio **y meterlo en la escena**: si no está, su matriz de mundo no se actualiza
    // y la luz sigue apuntando a donde estaba.
    this.shadowFocus = new THREE.Object3D();
    this.scene.add(this.shadowFocus);
    this.dirLight.target = this.shadowFocus;

    // Contraluz tenue del lado opuesto: despega a los personajes del fondo.
    this.rimLight = new THREE.DirectionalLight(0xff0077, 0.35);
    this.rimLight.position.set(-24, 16, -22);
    this.scene.add(this.rimLight);

    this.unsubscribeQuality = quality.subscribe(() => this.applyQuality());
  }

  configureShadow() {
    const size = quality.get('shadowMapSize');
    const shadow = this.dirLight.shadow;

    shadow.mapSize.width = size;
    shadow.mapSize.height = size;
    shadow.camera.near = 0.5;
    shadow.camera.far = 120;

    const d = SHADOW_EXTENT;
    shadow.camera.left = -d;
    shadow.camera.right = d;
    shadow.camera.top = d;
    shadow.camera.bottom = -d;
    shadow.camera.updateProjectionMatrix();

    this.applyShadowBias(size);
  }

  /**
   * Sesgo de sombra proporcional al tamaño del téxel.
   *
   * Estaba fijo, calibrado para un tamaño de mapa concreto. Pero el mismo frustum
   * de 70 unidades repartido entre 512 y 4096 téxeles da lados de 0,137 y 0,017:
   * ocho veces de diferencia. Con un valor constante, el preset bajo mostraba
   * bandas de auto-sombreado y el alto despegaba las sombras del suelo, y ninguna
   * de las dos cosas parecía tener que ver con el ajuste de calidad.
   */
  applyShadowBias(mapSize) {
    const texelWorldSize = (SHADOW_EXTENT * 2) / mapSize;
    const shadow = this.dirLight.shadow;

    shadow.bias = -0.6 * texelWorldSize * BIAS_PER_TEXEL;
    shadow.normalBias = Math.max(0.01, texelWorldSize * 0.6);
  }

  /**
   * Centra el volumen de sombra sobre un punto del suelo. Lo llama el bucle de juego
   * con la posición del agente local.
   *
   * ## El redondeo a téxel no es un pulido, es el requisito
   *
   * El mapa de sombra es una rejilla fija de téxeles proyectada sobre el mundo. Si el
   * volumen se desplaza una cantidad cualquiera, cada borde de sombra cae en un trozo
   * distinto de téxel en cada fotograma y el resultado es que **las sombras hierven**:
   * los contornos vibran aunque no se mueva nada en la escena. Es un defecto que se
   * atribuye a cualquier cosa menos a la causa, así que conviene no estrenarlo.
   *
   * Redondeando el centro a múltiplos del téxel, el mapa se desplaza de téxel en téxel
   * y cada borde cae siempre en el mismo sitio: la sombra se queda quieta.
   *
   * La **dirección** de la luz no cambia nunca. Se mueven a la vez el objetivo y la
   * posición, conservando `LIGHT_OFFSET`: si solo se moviera uno, la sala se iría
   * iluminando desde un ángulo distinto según por dónde anduviera el jugador.
   */
  setShadowFocus(x, z) {
    if (!this.dirLight.castShadow) return;

    const texel = (SHADOW_EXTENT * 2) / quality.get('shadowMapSize');
    const fx = Math.round(x / texel) * texel;
    const fz = Math.round(z / texel) * texel;

    this.shadowFocus.position.set(fx, 0, fz);
    this.shadowFocus.updateMatrixWorld();
    this.dirLight.position.set(fx + LIGHT_OFFSET.x, LIGHT_OFFSET.y, fz + LIGHT_OFFSET.z);
  }

  applyQuality() {
    this.dirLight.castShadow = quality.get('shadows');
    this.configureShadow();
    if (this.lastSetup) {
      this.setupCornerLights(this.lastSetup.sizeX, this.lastSetup.sizeZ, this.lastSetup.color);
    }
  }

  /**
   * Luces de acento en el perímetro, del color del tema.
   * Su número sale del preset: son luces dinámicas y cada una cuesta en el shader.
   */
  setupCornerLights(sizeX, sizeZ, themeColor = 0x00f3ff) {
    this.lastSetup = { sizeX, sizeZ, color: themeColor };
    this.clearCornerLights();

    const count = quality.get('cornerLights');
    if (count <= 0) return;

    const hx = sizeX / 2 - 2;
    const hz = sizeZ / 2 - 2;

    // Las cuatro esquinas primero; a partir de ahí, los centros de los lados largos.
    const positions = [
      { x: -hx, z: -hz },
      { x: hx, z: -hz },
      { x: -hx, z: hz },
      { x: hx, z: hz },
      { x: 0, z: -hz },
      { x: 0, z: hz }
    ].slice(0, count);

    positions.forEach((pos, index) => {
      const light = new THREE.PointLight(themeColor, 2.4, 20, 1.6);
      light.position.set(pos.x, 4.2, pos.z);
      // Cada una con su desfase, o el latido sería un parpadeo global sincronizado.
      light.userData.phase = index * 1.37;
      light.userData.baseIntensity = 2.4;
      this.scene.add(light);
      this.cornerLights.push(light);
    });

    this.hemiLight.color.setHex(themeColor);
    this.rimLight.color.setHex(themeColor);
  }

  /** Latido lento de las luces de acento. Se llama desde el bucle de juego. */
  update(delta) {
    if (!quality.get('lightBreathing')) return;

    this.elapsed += delta;
    for (const light of this.cornerLights) {
      const wave = Math.sin(this.elapsed * 1.1 + light.userData.phase);
      light.intensity = light.userData.baseIntensity * (0.82 + wave * 0.18);
    }
  }

  clearCornerLights() {
    this.cornerLights.forEach(light => {
      this.scene.remove(light);
      light.dispose();
    });
    this.cornerLights = [];
  }

  destroy() {
    this.clearCornerLights();
    this.scene.remove(this.shadowFocus);
    if (this.unsubscribeQuality) this.unsubscribeQuality();
  }
}
