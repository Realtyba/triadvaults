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
 * Anisotropía efectiva.
 *
 * Estaba fijada a 4 en el momento de crear la textura, y como la textura queda
 * cacheada para siempre, subir la calidad gráfica no podía mejorarla nunca. Cuatro
 * muestras se quedan cortas para el suelo: es una rejilla repetida hasta 18 veces
 * vista en picado a unos 53°, que es el caso de libro del hormigueo por submuestreo.
 *
 * El renderer publica su máximo real (normalmente 16); se llama a `setMaxAnisotropy`
 * al crearlo. Se topa en 8 porque a partir de ahí la mejora no se ve y el coste de
 * muestreo sí.
 */
const ANISOTROPY_CAP = 8;
let maxAnisotropy = 4;

export function setMaxAnisotropy(value) {
  const next = Math.max(1, Math.min(ANISOTROPY_CAP, Math.floor(value) || 1));
  if (next === maxAnisotropy) return maxAnisotropy;

  maxAnisotropy = next;
  // Las texturas ya creadas siguen vivas en el caché: hay que reajustarlas o el
  // cambio solo afectaría a los niveles que aún no se han visto.
  cache.forEach(texture => {
    if (texture.anisotropy === undefined) return;
    texture.anisotropy = next;
    texture.needsUpdate = true;
  });
  return maxAnisotropy;
}

/**
 * Rejilla tecnológica para el suelo: líneas finas, cruces marcadas y marcas de
 * esquina para que la repetición no se lea como un patrón plano.
 *
 * @param {number} colorHex color de acento del tema
 * @param {string} variant  clave de caché aparte. `repeat` es estado de la propia
 *   textura, así que dos superficies con escalas distintas —el suelo de la sala y
 *   la plataforma exterior— necesitan instancias separadas o se pisan entre sí.
 * @param {{x: number, y: number}} [repeat] escala de repetición. Va en la clave de
 *   caché justo por lo anterior: quien la pedía tenía que mutar el objeto devuelto,
 *   y como el mismo tema se repite cada cinco niveles, dos superficies del mismo
 *   color compartían instancia y la última en escribir ganaba.
 */
export function createGridTexture(colorHex, variant = 'default', repeat = null) {
  const repeatKey = repeat ? `:${repeat.x}x${repeat.y}` : '';
  return cached(`grid:${colorHex}:${variant}${repeatKey}`, () => {
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
    texture.anisotropy = maxAnisotropy;
    texture.colorSpace = THREE.SRGBColorSpace;
    if (repeat) texture.repeat.set(repeat.x, repeat.y);
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
    texture.anisotropy = maxAnisotropy;
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
