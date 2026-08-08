import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { CLIP_NAMES } from '../assets/manifest.js';

/**
 * Carga de modelos glTF.
 *
 * ## Sin descodificador en tiempo de ejecución
 *
 * Nada de Draco ni de KTX2. Los dos añaden un WebAssembly que hay que bajar y arrancar
 * **antes** del primer modelo, y aquí se trata de tres ficheros de medio mega de
 * geometría muy sencilla: el descodificador costaría más de lo que ahorra, y en la
 * primera partida en un móvil ese coste se paga entero antes de ver nada. Si algún día
 * los modelos crecen, la salida es podar y optimizar **en disco** —ver
 * `public/models/CREDITS.md`—, no descomprimir en el cliente.
 *
 * ## El fallback no es una red de seguridad, es el camino normal
 *
 * Los `.glb` no están en el repositorio: los baja `npm run assets`. Quien clone y
 * ejecute `npm run dev` sin más **no los tiene**, y tiene que poder jugar igual. Por eso
 * `loadPlayer` nunca rechaza: devuelve `null` y quien llama monta la geometría
 * primitiva de siempre. Es la misma regla que ya se aplica a `steamworks.js`.
 *
 * ## La escala se mide, no se supone
 *
 * Un modelo con esqueleto guarda sus vértices en el espacio de la pose de reposo, y su
 * tamaño real sale de la jerarquía de huesos: leer el `min`/`max` del accesor da cifras
 * que no significan nada. Así que se mide la caja del objeto ya montado y se lleva a la
 * altura que pide el juego. Eso además hace que un modelo distinto puesto en su sitio
 * encaje sin tocar código, que es justo lo que se quiere de una carpeta de assets.
 */
export class AssetLoader {
  constructor() {
    this.loader = new GLTFLoader();
    /** Promesas en curso o resueltas, por URL. Evita bajar dos veces el mismo agente. */
    this.pending = new Map();
    /** URLs que ya fallaron: no se reintenta en cada reaparición. */
    this.failed = new Set();
  }

  /**
   * Va trayendo los modelos mientras el jugador está en el menú.
   *
   * Sustituye a una pantalla de carga, y a propósito. Con la carga en diferido y el
   * respaldo inmediato, el juego nunca se queda esperando: lo único que se notaría sin
   * esto es que el agente aparece como cilindro y al segundo se convierte en persona.
   * Precargando mientras alguien lee el menú, ese salto ocurre antes de que haya nadie
   * mirando. Bloquear el arranque para evitarlo sería cambiar un parpadeo por una espera.
   *
   * No se espera el resultado ni se propaga ningún fallo: `load` ya los absorbe.
   */
  preload(urls) {
    urls.forEach(url => this.load(url));
  }

  /**
   * @param {string} url
   * @returns {Promise<{scene: THREE.Group, animations: THREE.AnimationClip[]}|null>}
   *   `null` si el fichero no está o no se pudo leer.
   */
  load(url) {
    if (this.failed.has(url)) return Promise.resolve(null);

    // Fuera del navegador no hay nada que cargar y sí mucho que ensuciar.
    // `scripts/check-leaks.js` construye diez niveles enteros en Node, y desde que el
    // fantasma pide su modelo al nacer, `GLTFLoader` —que por dentro es
    // `XMLHttpRequest`— fallaba treinta veces. El fallo lo absorbía el `catch` de abajo,
    // así que no rompía nada, pero llenaba la salida de la validación de avisos que no
    // significan nada. Cortarlo aquí, en el cargador, y no en cada llamante.
    if (typeof XMLHttpRequest === 'undefined') return Promise.resolve(null);

    if (!this.pending.has(url)) {
      const promise = this.loader
        .loadAsync(url)
        .then(gltf => ({ scene: gltf.scene, animations: gltf.animations }))
        .catch(err => {
          // Un aviso, no un error: no tener los modelos es un estado previsto.
          console.warn(`[assets] sin modelo ${url} (${err.message}); se usa la geometría base`);
          this.failed.add(url);
          this.pending.delete(url);
          return null;
        });
      this.pending.set(url, promise);
    }

    return this.pending.get(url);
  }

  /**
   * Una copia independiente, lista para animar y escalada a la altura pedida.
   *
   * Se usa `SkeletonUtils.clone` y no `Object3D.clone`: el segundo copia las mallas pero
   * las deja apuntando al esqueleto del original, así que los tres agentes se moverían
   * con la animación del último en actualizarse.
   *
   * @param {string} url
   * @param {number} height altura objetivo en unidades de mundo
   * @returns {Promise<{root: THREE.Group, animations: THREE.AnimationClip[]}|null>}
   */
  async instance(url, height) {
    const asset = await this.load(url);
    if (!asset) return null;

    const root = cloneSkinned(asset.scene);
    this.normalize(root, height);

    root.traverse(child => {
      if (!child.isMesh) return;
      child.castShadow = true;
      child.receiveShadow = true;
      // Los materiales llegan compartidos con el original. Sin clonarlos, teñir a un
      // agente teñiría a los tres.
      child.material = Array.isArray(child.material)
        ? child.material.map(m => m.clone())
        : child.material.clone();
    });

    return { root, animations: asset.animations };
  }

  /**
   * Lleva el modelo a la altura pedida y lo apoya en el suelo.
   *
   * Lo segundo importa tanto como lo primero: el juego coloca a los agentes en `y = 0` y
   * da por hecho que ahí están sus pies. Un modelo cuyo origen esté en la cadera queda
   * medio hundido en el pavimento, y no es un fallo que se atribuya al cargador.
   *
   * ## Por qué no vale `Box3.setFromObject`
   *
   * Porque para una malla con esqueleto mide la caja de la **geometría en bruto**, que
   * está en el espacio de la pose de reposo y no tiene nada que ver con el tamaño del
   * personaje: el tamaño real lo ponen los huesos. Con estos modelos devolvía unas 91
   * unidades para un muñeco de 1,7, así que el factor salía 53 veces más pequeño de la
   * cuenta y el agente acababa midiendo **nueve centímetros** y flotando a la altura de
   * la rodilla. Se veía como que el modelo no había cargado.
   *
   * `SkinnedMesh.computeBoundingBox()` sí recorre los vértices aplicándoles la
   * transformación de sus huesos. Sólo necesita que las matrices de mundo estén al día,
   * y este objeto acaba de clonarse sin pasar por ningún render.
   */
  normalize(root, height) {
    root.updateMatrixWorld(true);

    const box = new THREE.Box3();
    const local = new THREE.Box3();

    root.traverse(child => {
      if (!child.isMesh) return;

      if (child.isSkinnedMesh) {
        child.computeBoundingBox();
        local.copy(child.boundingBox);
      } else {
        if (!child.geometry.boundingBox) child.geometry.computeBoundingBox();
        local.copy(child.geometry.boundingBox);
      }

      box.union(local.applyMatrix4(child.matrixWorld));
    });

    const size = box.getSize(new THREE.Vector3());
    if (size.y <= 0) return;

    const scale = height / size.y;
    root.scale.setScalar(scale);
    root.position.y = -box.min.y * scale;
  }

  /**
   * Busca un clip por estado (`idle`, `walk`, `run`, `death`).
   *
   * Compara por contenido y sin distinguir mayúsculas porque estos packs nombran los
   * clips `HumanArmature|Man_Walk`, con la armadura por delante. Exigir el nombre exacto
   * ataría la carpeta de assets a la convención de Blender de un pack concreto.
   *
   * @returns {THREE.AnimationClip|null}
   */
  static findClip(animations, state) {
    const wanted = CLIP_NAMES[state] || [state];
    for (const needle of wanted) {
      const found = animations.find(clip => clip.name.toLowerCase().includes(needle));
      if (found) return found;
    }
    return null;
  }
}

/** Única instancia: el caché por URL solo sirve si lo comparten todos los agentes. */
export const assets = new AssetLoader();
