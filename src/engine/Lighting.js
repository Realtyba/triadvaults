import * as THREE from 'three';
import { quality } from './QualitySettings.js';

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
    this.hemiLight = new THREE.HemisphereLight(0x00f3ff, 0x1a0a14, 0.35);
    this.hemiLight.position.set(0, 50, 0);
    this.scene.add(this.hemiLight);

    // Clave principal. Más rasante que antes, para que los muros proyecten
    // sombras largas y la sala tenga profundidad.
    this.dirLight = new THREE.DirectionalLight(0xdfe8ff, 1.15);
    this.dirLight.position.set(28, 34, 20);
    this.dirLight.castShadow = quality.get('shadows');
    this.configureShadow();
    this.scene.add(this.dirLight);

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
    shadow.bias = -0.0006; // sin esto aparecen bandas de auto-sombreado en el suelo
    shadow.normalBias = 0.02;

    const d = 35;
    shadow.camera.left = -d;
    shadow.camera.right = d;
    shadow.camera.top = d;
    shadow.camera.bottom = -d;
    shadow.camera.updateProjectionMatrix();
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
    if (this.unsubscribeQuality) this.unsubscribeQuality();
  }
}
