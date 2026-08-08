import * as THREE from 'three';

/**
 * Texturas generadas por canvas.
 *
 * **Las superficies no cargan ningún fichero de imagen**: todo el aspecto de suelos y
 * muros sale de la semilla y del tema, así que las texturas se dibujan en tiempo de
 * ejecución. Eso mantiene el paquete pequeño y permite que cada bioma tenga su suelo sin
 * añadir megas al build. Con el entorno de reflejo de `environment.js`, que también es
 * un lienzo, la bóveda entera se pinta sin un solo binario.
 *
 * La regla dejó de ser absoluta el 2026-08-07: los **agentes** sí son modelos `.glb`
 * (ver `assets/manifest.js`). El motivo es que un personaje con esqueleto y animación de
 * caminar no se genera por código de forma razonable, mientras que un suelo o un muro
 * sí. Los modelos no van en el repositorio y el juego arranca sin ellos.
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
 * @param {{x: number, y: number}} [repeat] escala de repetición. Cada valor distinto
 *   devuelve un **clon** con esa escala puesta: instancias separadas, para que no se
 *   pisen, pero una sola imagen detrás de todas ellas.
 */
export function createGridTexture(colorHex, variant = 'default', repeat = null) {
  const base = cached(`grid:${colorHex}:${variant}`, () => buildGridTexture(colorHex));
  if (!repeat) return base;

  // Una imagen, varias escalas.
  //
  // El `repeat` sale de las dimensiones de la sala, que tienen nueve valores posibles.
  // Metiéndolo en la clave —que es como estaba— cada combinación de bioma y tamaño
  // dibujaba y **subía a la GPU** un lienzo entero de 256×256 idéntico al anterior: hasta
  // noventa copias byte a byte de la misma rejilla.
  //
  // Un clon comparte el `source` con el original, así que la subida ocurre una sola vez y
  // lo único que se duplica es el objeto de textura, que es un puñado de campos. Se
  // guarda en la misma caché para que `disposeTextureCache` siga siendo el único dueño:
  // devolver algo que nadie libera habría cambiado una fuga pequeña por otra peor.
  return cached(`grid:${colorHex}:${variant}:${repeat.x}x${repeat.y}`, () => {
    const clone = base.clone();
    clone.repeat.set(repeat.x, repeat.y);
    clone.needsUpdate = true;
    return clone;
  });
}

/** Dibuja la rejilla. Una sola vez por color y variante; el `repeat` va en los clones. */
function buildGridTexture(colorHex) {
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
  return texture;
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

/**
 * Relieve de los muros, derivado del mismo ruido que la rugosidad.
 *
 * ## Por qué hace falta
 *
 * Con el entorno de reflejo ya puesto (`engine/environment.js`), los muros pasan a
 * tener algo que reflejar — pero lo reflejan como un espejo plano, porque su normal es
 * constante en toda la cara. El mapa de rugosidad varía *cuánto* se difumina el
 * reflejo; lo que hace falta para que se lea el volumen es variar **hacia dónde**
 * apunta la superficie. Eso es este mapa.
 *
 * ## Por qué se deriva y no se dibuja aparte
 *
 * Se calcula por diferencias finitas sobre la misma señal de altura que genera la
 * rugosidad. Dibujar dos texturas independientes daría un muro cuyos brillos y cuyos
 * relieves están en sitios distintos, que es la forma clásica de que un material se vea
 * sucio sin que nadie sepa decir por qué.
 *
 * `normalMap` es un dato **direccional**, no un color: va en espacio lineal y no lleva
 * `colorSpace = SRGBColorSpace`. Marcarlo como sRGB le aplicaría la curva gamma a unas
 * coordenadas y el relieve saldría torcido.
 */
export function createWallNormalTexture() {
  return cached('wall-normal', () => {
    const size = 128;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;

    const ctx = canvas.getContext('2d');
    const image = ctx.createImageData(size, size);

    // Misma señal que `createWallRoughnessTexture`, sin el ruido aleatorio: un normal
    // con ruido por téxel produce un centelleo muy visible al mover la cámara.
    const height = (x, y) => {
      const panel = Math.sin(y * 0.45) * 0.5;
      const seam = Math.cos(x * 0.19) * 0.28;
      const rivet = Math.sin(x * 1.6) * Math.sin(y * 1.6) * 0.12;
      return panel + seam + rivet;
    };

    // Intensidad del relieve. Por encima de ~2 los muros se leen como roca, y esto es
    // una bóveda de paneles metálicos.
    const strength = 1.4;

    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        // Envuelve por los bordes: la textura se repite, y una discontinuidad ahí se
        // ve como una costura luminosa recorriendo el muro.
        const left = height((x - 1 + size) % size, y);
        const right = height((x + 1) % size, y);
        const up = height(x, (y - 1 + size) % size);
        const down = height(x, (y + 1) % size);

        const dx = (left - right) * strength;
        const dy = (up - down) * strength;
        const length = Math.hypot(dx, dy, 1);

        const i = (y * size + x) * 4;
        image.data[i] = ((dx / length) * 0.5 + 0.5) * 255;
        image.data[i + 1] = ((dy / length) * 0.5 + 0.5) * 255;
        image.data[i + 2] = (1 / length) * 0.5 * 255 + 127.5;
        image.data[i + 3] = 255;
      }
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

    const texture = new THREE.CanvasTexture(canvas);
    // Es un degradado de color, no un mapa de datos: sin declararlo, three lo trata como
    // lineal y la mota sale más clara en el centro de lo que se dibujó. Los mapas de
    // rugosidad y de relieve de arriba **no** lo llevan, y ahí es correcto.
    texture.colorSpace = THREE.SRGBColorSpace;
    return texture;
  });
}

/** Las texturas cacheadas sobreviven al nivel; solo se sueltan al cerrar. */
export function disposeTextureCache() {
  cache.forEach(texture => texture.dispose());
  cache.clear();
}
