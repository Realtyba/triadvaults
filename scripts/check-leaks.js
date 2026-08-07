/**
 * ¿Se libera todo lo que un nivel monta en la escena?
 *
 * Three.js no suelta geometrías ni materiales al quitar un objeto de la escena:
 * `scene.remove()` solo corta el enlace del grafo. Por eso una fuga de este tipo es
 * invisible —la escena se ve bien, los objetos ya no están— y solo se manifiesta
 * como memoria de vídeo que sube nivel tras nivel y no baja ni reiniciando.
 *
 * Justamente eso pasaba: `PuzzleArchetype.clear()` sacaba los nodos y las
 * compuertas sin disponerlos, entre 8 y 24 objetos GPU perdidos por transición.
 *
 * La comprobación acumula **todo** lo que ha pasado por la escena a lo largo de
 * varios niveles y verifica que a cada geometría y material se le llamó
 * `dispose()`. Mirar solo el estado final no valdría: lo que se fuga es
 * precisamente lo que ya no está en la escena.
 *
 * Uso: node scripts/check-leaks.js
 */
import * as THREE from 'three';

const LEVELS = 10;

const disposedGeometries = new Set();
const disposedMaterials = new Set();

const geometryDispose = THREE.BufferGeometry.prototype.dispose;
const materialDispose = THREE.Material.prototype.dispose;

THREE.BufferGeometry.prototype.dispose = function () {
  disposedGeometries.add(this);
  return geometryDispose.call(this);
};
THREE.Material.prototype.dispose = function () {
  disposedMaterials.add(this);
  return materialDispose.call(this);
};

// El cliente da por hecho un navegador. Aquí solo se necesita que las texturas
// procedurales se puedan construir sin pintar nada de verdad.
globalThis.window = {
  devicePixelRatio: 1,
  innerWidth: 1280,
  innerHeight: 720,
  addEventListener() {}
};
globalThis.localStorage = { getItem: () => 'alto', setItem() {} };
globalThis.document = {
  createElement: () => ({
    width: 0,
    height: 0,
    getContext: () => ({
      fillStyle: '',
      strokeStyle: '',
      lineWidth: 0,
      fillRect() {},
      strokeRect() {},
      beginPath() {},
      moveTo() {},
      lineTo() {},
      stroke() {},
      createImageData: (w, h) => ({ data: new Uint8ClampedArray(w * h * 4) }),
      putImageData() {},
      createRadialGradient: () => ({ addColorStop() {} })
    })
  })
};

const { LevelController } = await import('../src/game/LevelController.js');

const scene = new THREE.Scene();
const level = new LevelController(scene, { setupCornerLights() {}, clearCornerLights() {} });
const owners = [{ uid: 'a' }, { uid: 'b' }, { uid: 'c' }];

const geometries = new Set();
const materials = new Set();

function collect() {
  scene.traverse(object => {
    if (object.geometry) geometries.add(object.geometry);
    if (!object.material) return;
    const list = Array.isArray(object.material) ? object.material : [object.material];
    list.forEach(material => materials.add(material));
  });
}

for (let i = 1; i <= LEVELS; i++) {
  level.build({ level: i, seed: 11 * i, seedOffset: 0, playersCount: 3, owners });
  collect();
}

level.clear();

// El cubo unidad de los muros lo comparten todos los niveles: liberarlo al
// descargar uno dejaría sin geometría a los siguientes.
let shared = 0;
let leakedGeometries = 0;
let leakedMaterials = 0;

for (const geometry of geometries) {
  if (geometry.userData && geometry.userData.shared) {
    shared++;
    continue;
  }
  if (!disposedGeometries.has(geometry)) leakedGeometries++;
}
for (const material of materials) {
  if (!disposedMaterials.has(material)) leakedMaterials++;
}

let remaining = 0;
scene.traverse(object => {
  if (object.geometry || object.material) remaining++;
});

console.log(`Niveles construidos    : ${LEVELS}`);
console.log(`Recursos vistos        : ${geometries.size} geometrías, ${materials.size} materiales`);
console.log(`Compartidos (se quedan): ${shared}`);
console.log(`Sin liberar            : ${leakedGeometries} geometrías, ${leakedMaterials} materiales`);
console.log(`Siguen en la escena    : ${remaining}`);
console.log('');

const failed = leakedGeometries > 0 || leakedMaterials > 0 || remaining > 0;
console.log(failed ? '✗ Hay recursos GPU sin liberar.' : '✓ Cada nivel libera todo lo que monta.');
process.exit(failed ? 1 : 0);
