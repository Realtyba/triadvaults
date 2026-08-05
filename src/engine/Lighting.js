import * as THREE from 'three';

export class EngineLighting {
  constructor(scene) {
    this.scene = scene;
    this.cornerLights = [];

    // Brighter Ambient Light for clear visibility
    this.ambientLight = new THREE.AmbientLight(0x282e4a, 1.2);
    this.scene.add(this.ambientLight);

    // Hemisphere Light (Sky & Ground Synthwave colors)
    this.hemiLight = new THREE.HemisphereLight(0x00f3ff, 0xff0077, 0.6);
    this.hemiLight.position.set(0, 50, 0);
    this.scene.add(this.hemiLight);

    // Main Directional Light (Sun/Spot with Shadows)
    this.dirLight = new THREE.DirectionalLight(0xffffff, 1.4);
    this.dirLight.position.set(25, 45, 25);
    this.dirLight.castShadow = true;

    // Shadow Map Config
    this.dirLight.shadow.mapSize.width = 2048;
    this.dirLight.shadow.mapSize.height = 2048;
    this.dirLight.shadow.camera.near = 0.5;
    this.dirLight.shadow.camera.far = 120;
    const d = 35;
    this.dirLight.shadow.camera.left = -d;
    this.dirLight.shadow.camera.right = d;
    this.dirLight.shadow.camera.top = d;
    this.dirLight.shadow.camera.bottom = -d;

    this.scene.add(this.dirLight);
  }

  setupCornerLights(sizeX, sizeZ, themeColor = 0x00f3ff) {
    // Clear old corner lights
    this.cornerLights.forEach(l => this.scene.remove(l));
    this.cornerLights = [];

    const hx = sizeX / 2 - 2;
    const hz = sizeZ / 2 - 2;
    const corners = [
      { x: -hx, z: -hz },
      { x: hx, z: -hz },
      { x: -hx, z: hz },
      { x: hx, z: hz }
    ];

    corners.forEach(c => {
      const pLight = new THREE.PointLight(themeColor, 2.0, 18);
      pLight.position.set(c.x, 4, c.z);
      this.scene.add(pLight);
      this.cornerLights.push(pLight);
    });

    this.hemiLight.color.setHex(themeColor);
  }
}
