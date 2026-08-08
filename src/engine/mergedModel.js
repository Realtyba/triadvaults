import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { assets } from './AssetLoader.js';
import { modelUrl } from '../assets/manifest.js';
import { prepareImportedMaterial } from './materials.js';
import { markShared } from './disposal.js';

/**
 * Convierte un modelo importado en **una** geometría y **un** material compartidos.
 *
 * Lo usan las tres cosas que traen geometría de un `.glb` y no necesitan su jerarquía:
 * el atrezo de la sala (`PropLibrary`), el núcleo que flota sobre cada nodo de puzle y el
 * marco de las compuertas (`PuzzleArchetype`). Es literalmente la misma operación en los
 * tres sitios, y tenerla escrita una sola vez es lo que evita que la parte delicada
 * —hornear las matrices, podar atributos, no romper el espacio de color— se implemente
 * tres veces con tres bugs distintos.
 *
 * ## Por qué fusionar
 *
 * Un `.glb` cualquiera llega como cuatro o cinco mallas con sus materiales, y cada malla
 * es una llamada de dibujo. Fusionadas en una geometría con un material, una pieza de
 * cinco partes deja de ser cinco envíos. El presupuesto de esta sala son 60 llamadas por
 * fotograma en el preset `movil` (ver `docs/ARCHITECTURE.md §8`), y la decoración no puede
 * comérselo.
 *
 * ## Los materiales se agrupan por textura, y eso es lo que abarata todo
 *
 * Los 81 modelos del Ultimate Space Kit comparten **un único atlas de 512×512, byte a
 * byte idéntico**. Como el material se cachea por la textura concreta, todas esas piezas
 * reciben **el mismo objeto material**, y dos mallas con el mismo material y la misma
 * geometría se pueden fusionar o instanciar juntas. De ahí sale que ocho tipos de atrezo
 * cuesten una sola llamada.
 *
 * Un modelo sin textura no puede compartir ese material, pero tampoco necesita uno propio:
 * su color plano por material se hornea en un atributo de color por vértice y todos los
 * modelos sin textura comparten un material con `vertexColors`.
 *
 * La clave del cubo es la **textura concreta**, no "tiene textura": dos atlas distintos no
 * pueden compartir material, y agruparlos por error pintaría uno con la textura del otro
 * sin avisar de nada.
 */

/** Tamaño al que se lleva una pieza que no declare `fit` en el manifest. */
const DEFAULT_FIT = 1.1;

/** Clave del cubo de las piezas sin textura. */
const TINTED = 'tinted';

/** Resultado por fichero. Cachea también los fallos, como `null`, para no reintentarlos. */
const cache = new Map();

/** Un material por cubo, compartido por todo el juego. */
const materials = new Map();

/**
 * Hornea el color plano de un material en un atributo de color por vértice.
 *
 * Los packs sin textura traen varios materiales que sólo se diferencian en su color base
 * —`Main`, `Accent`, `DarkGrey`, `Black`, `DarkAccent`—. Eso son cinco envíos por caja.
 * Metido el color en los vértices, las cinco partes se fusionan en una y un único
 * material con `vertexColors` las pinta todas.
 *
 * `material.color` **ya está en espacio lineal**: lo convirtió `GLTFLoader` al leer
 * `baseColorFactor`. Los colores por vértice se consumen también en espacio lineal, así
 * que se copia tal cual. Convertirlo aquí "por si acaso" es el error clásico y deja la
 * pieza lavada.
 *
 * **Lo que se pierde:** sólo viaja el color. El `metalness`, el `roughness` y la emisión
 * propios de cada material se sustituyen por los del material del cubo. Da igual para una
 * caja de colores planos; una pieza con una parte luminosa saldría apagada, y ese es el
 * precio de dibujarlas todas juntas.
 */
function bakeColor(geometry, color) {
  const count = geometry.attributes.position.count;
  const data = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    data[i * 3] = color.r;
    data[i * 3 + 1] = color.g;
    data[i * 3 + 2] = color.b;
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(data, 3));
}

/**
 * `mergeGeometries` rechaza una mezcla de geometrías indexadas y sin indexar: devuelve
 * `null` y lo cuenta por consola, no por excepción. Un pack cualquiera trae de las dos.
 */
export function alignIndexing(parts) {
  if (parts.every(part => part.index) || parts.every(part => !part.index)) return parts;
  return parts.map(part => {
    if (!part.index) return part;
    const flat = part.toNonIndexed();
    part.dispose();
    return flat;
  });
}

/**
 * Material de un cubo.
 *
 * La textura es **la del propio cargador**, no una copia: `assets.instance` clona los
 * materiales pero `Material.clone()` conserva la referencia al mapa. Construir aquí una
 * `THREE.Texture` nueva perdería el `SRGBColorSpace` que le puso `GLTFLoader` y la imagen
 * ya decodificada, y la pieza saldría lavada.
 */
function bucketMaterial(bucket, texture) {
  if (materials.has(bucket)) return materials.get(bucket);

  const material = markShared(texture
    ? new THREE.MeshStandardMaterial({ map: texture, metalness: 0.35, roughness: 0.8 })
    : new THREE.MeshStandardMaterial({ vertexColors: true, metalness: 0.45, roughness: 0.7 }));

  // La textura también sobrevive al cambio de nivel. No la libera nadie de aquí —es del
  // caché de `AssetLoader`, que la comparte con los agentes— pero marcarla mantiene
  // honesto al comprobador de fugas.
  if (texture) markShared(texture);

  // El único punto de calibración de un material importado. Sin él, una pieza de pack
  // refleja el entorno al doble que los muros que tiene al lado.
  prepareImportedMaterial(material, { envMapIntensity: 0.5 });

  materials.set(bucket, material);
  return material;
}

/**
 * Trae un modelo del manifest y lo devuelve como una geometría y un material listos para
 * fusionar o instanciar.
 *
 * Es **tolerante a que el fichero no esté**: devuelve `null`, que es lo que hace que la
 * sala se monte sin atrezo y los nodos de puzle se queden con su geometría procedural en
 * vez de reventar. Ver la cabecera de `assets/manifest.js`.
 *
 * @param {object|null} entry entrada del manifest (`file`, `fit`)
 * @returns {Promise<{geometry: THREE.BufferGeometry, material: THREE.Material, bucket: string}|null>}
 */
export function mergedModel(entry) {
  if (!entry) return Promise.resolve(null);
  if (cache.has(entry.file)) return cache.get(entry.file);

  const job = buildMergedModel(entry);
  cache.set(entry.file, job);
  return job;
}

async function buildMergedModel(entry) {
  const instance = await assets.instance(modelUrl(entry), 0, {
    fit: entry.fit || DEFAULT_FIT,
    drop: entry.drop
  });
  if (!instance) return null;

  // Primera pasada: a qué cubo va el modelo ENTERO. Si alguna de sus mallas no trae
  // textura o no trae UV, van todas al cubo de color por vértice; partir una pieza entre
  // dos cubos costaría una llamada de dibujo por pieza, que es justo lo que se evita.
  let texture = null;
  let textured = true;
  instance.root.traverse(child => {
    if (!child.isMesh || !child.geometry) return;
    const material = Array.isArray(child.material) ? child.material[0] : child.material;
    if (!material?.map || !child.geometry.attributes.uv) textured = false;
    else if (!texture) texture = material.map;
  });
  if (!textured) texture = null;

  const bucket = texture ? `tex:${texture.uuid}` : TINTED;
  const keep = texture ? ['position', 'normal', 'uv'] : ['position', 'normal'];

  const parts = [];
  instance.root.updateMatrixWorld(true);
  instance.root.traverse(child => {
    if (!child.isMesh || !child.geometry) return;
    const material = Array.isArray(child.material) ? child.material[0] : child.material;
    const geometry = child.geometry.clone();
    // La matriz de mundo lleva dentro la normalización por `fit` y el apoyo en y=0.
    // Horneándola, la geometría ya viene a la escala correcta. `applyMatrix4` transforma
    // también las normales con su matriz normal.
    geometry.applyMatrix4(child.matrixWorld);
    // `mergeGeometries` exige que todas las entradas tengan los mismos atributos, y un
    // pack cualquiera trae mallas con y sin UV. Sin podarlos devuelve `null` sin decir
    // por qué.
    for (const name of Object.keys(geometry.attributes)) {
      if (!keep.includes(name)) geometry.deleteAttribute(name);
    }
    if (!texture) bakeColor(geometry, material.color);
    parts.push(geometry);
  });

  const aligned = parts.length > 0 ? alignIndexing(parts) : [];
  const merged = aligned.length > 0 ? mergeGeometries(aligned, false) : null;
  aligned.forEach(part => part.dispose());

  // `assets.instance` clona los materiales para que teñir a uno no tiña a todos. Aquí no
  // se tiñe nada y no se conserva la jerarquía, así que esas copias sobran.
  // `Material.dispose()` no toca las texturas, o sea que el atlas sobrevive.
  instance.root.traverse(child => {
    if (!child.isMesh) return;
    const list = Array.isArray(child.material) ? child.material : [child.material];
    list.forEach(material => material?.dispose());
  });

  if (!merged) return null;

  // Compartida: sobrevive al cambio de nivel igual que `UNIT_BOX`, y `disposeChildren` no
  // debe soltarla o la segunda sala se quedaría sin ella.
  return { geometry: markShared(merged), material: bucketMaterial(bucket, texture), bucket };
}

/**
 * Suelta todo lo cacheado. Sólo al cerrar el juego.
 *
 * Los mapas **no** se liberan: son del caché de `AssetLoader`, que los comparte con los
 * agentes. Soltarlos aquí dejaría a los astronautas sin textura si la partida vuelve a
 * empezar sin recargar la página.
 */
export async function disposeMergedModels() {
  for (const job of cache.values()) {
    const entry = await job;
    if (entry) entry.geometry.dispose();
  }
  cache.clear();
  materials.forEach(material => material.dispose());
  materials.clear();
}
