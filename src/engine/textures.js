import * as THREE from 'three';

/**
 * Texturas generadas por canvas.
 *
 * El juego no carga ningún fichero de imagen a propósito: todo el aspecto sale de
 * la semilla y del tema, así que las texturas se dibujan en tiempo de ejecución.
 * Eso mantiene el paquete pequeño y permite que cada bioma tenga su suelo sin
 * añadir megas al build.
 *
 * Las texturas se cachean por color: un nivel las pide una vez por material, y
 * regenerarlas en cada `build()` provocaba un tirón al cambiar de nivel.
 */
const cache = new Map();

function cached(key, factory) {
  if (!cache.has(key)) cache.set(key, factory());
  return cache.get(key);
}

/**
 * Rejilla tecnológica para el suelo: líneas finas, cruces marcadas y marcas de
 * esquina para que la repetición no se lea como un patrón plano.
 *
 * @param {number} colorHex color de acento del tema
 * @param {string} variant  clave de caché aparte. `repeat` es estado de la propia
 *   textura, así que dos superficies con escalas distintas —el suelo de la sala y
 *   la plataforma exterior— necesitan instancias separadas o se pisan entre sí.
 */
export function createGridTexture(colorHex, variant = 'default') {
  return cached(`grid:${colorHex}:${variant}`, () => {
    const size = 256;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;

    const ctx = canvas.getContext('2d');
    const color = new THREE.Color(colorHex);
    const rgb = `${Math.round(color.r * 255)}, ${Math.round(color.g * 255)}, ${Math.round(color.b * 255)}`;

    ctx.fillStyle = 'rgba(0, 0, 0, 0)';
    ctx.fillRect(0, 0, size, size);

    // Línea principal del borde de la celda.
    ctx.strokeStyle = `rgba(${rgb}, 0.55)`;
    ctx.lineWidth = 2;
    ctx.strokeRect(1, 1, size - 2, size - 2);

    // Subdivisión interior, más apagada.
    ctx.strokeStyle = `rgba(${rgb}, 0.14)`;
    ctx.lineWidth = 1;
    for (let i = 1; i < 4; i++) {
      const p = (size / 4) * i;
      ctx.beginPath();
      ctx.moveTo(p, 0);
      ctx.lineTo(p, size);
      ctx.moveTo(0, p);
      ctx.lineTo(size, p);
      ctx.stroke();
    }

    // Marcas de esquina: dan escala y hacen que la rejilla parezca diseñada.
    ctx.strokeStyle = `rgba(${rgb}, 0.8)`;
    ctx.lineWidth = 3;
    const tick = size * 0.12;
    [[0, 0, 1, 1], [size, 0, -1, 1], [0, size, 1, -1], [size, size, -1, -1]].forEach(([x, y, dx, dy]) => {
      ctx.beginPath();
      ctx.moveTo(x, y + dy * tick);
      ctx.lineTo(x, y);
      ctx.lineTo(x + dx * tick, y);
      ctx.stroke();
    });

    const texture = new THREE.CanvasTexture(canvas);
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.anisotropy = 4;
    texture.colorSpace = THREE.SRGBColorSpace;
    return texture;
  });
}

/**
 * Mapa de rugosidad para los muros: ruido suave que rompe el reflejo uniforme.
 * Sin él, las paredes metálicas reflejan como un espejo perfecto y se ven falsas.
 */
export function createWallRoughnessTexture() {
  return cached('wall-roughness', () => {
    const size = 128;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;

    const ctx = canvas.getContext('2d');
    const image = ctx.createImageData(size, size);

    for (let i = 0; i < image.data.length; i += 4) {
      // Franjas horizontales tenues + ruido: sugiere paneles sin dibujarlos.
      const y = Math.floor(i / 4 / size);
      const band = Math.sin(y * 0.45) * 18;
      const value = 150 + band + (Math.random() - 0.5) * 40;
      image.data[i] = image.data[i + 1] = image.data[i + 2] = value;
      image.data[i + 3] = 255;
    }
    ctx.putImageData(image, 0, 0);

    const texture = new THREE.CanvasTexture(canvas);
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    return texture;
  });
}

/** Punto suave para las partículas: un disco duro se ve como un cuadrado. */
export function createParticleTexture() {
  return cached('particle', () => {
    const size = 64;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;

    const ctx = canvas.getContext('2d');
    const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    gradient.addColorStop(0, 'rgba(255, 255, 255, 1)');
    gradient.addColorStop(0.4, 'rgba(255, 255, 255, 0.5)');
    gradient.addColorStop(1, 'rgba(255, 255, 255, 0)');

    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, size, size);

    return new THREE.CanvasTexture(canvas);
  });
}

/** Las texturas cacheadas sobreviven al nivel; solo se sueltan al cerrar. */
export function disposeTextureCache() {
  cache.forEach(texture => texture.dispose());
  cache.clear();
}
