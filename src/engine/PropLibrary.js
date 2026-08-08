import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { PROP_MODELS, propModel } from '../assets/manifest.js';
import { mergedModel, alignIndexing } from './mergedModel.js';
import { quality } from './QualitySettings.js';

/**
 * Atrezo importado, dibujado en una o dos llamadas.
 *
 * ## El presupuesto manda
 *
 * Los muros de esta sala son **dos** `InstancedMesh` a propósito (`DungeonGen`), y eso es
 * lo que paga que el preset `movil` conserve el bloom, que a su vez es lo que hace que el
 * neón se lea como luz. Meter atrezo con la geometría tal cual sale del `.glb` —cada
 * pieza con sus cuatro o cinco mallas sueltas— gastaría ese margen entero en decoración.
 *
 * ## Se agrupa por material, no por tipo de pieza
 *
 * Esta es la decisión de la que cuelga todo lo demás, y sustituye a la anterior —una
 * malla instanciada por tipo, con un techo autoimpuesto de tres tipos—.
 *
 * Como casi todas las piezas del manifest salen del mismo pack y comparten atlas,
 * `mergedModel` les entrega **el mismo objeto material**. Y dos mallas con el mismo
 * material se pueden fusionar: **todas las piezas de la sala, de todos los tipos, se
 * hornean en una sola geometría y se dibujan de una vez**. Ocho tipos cuestan lo mismo
 * que uno.
 *
 * Con el manifest de hoy —seis piezas del kit y dos de otro sitio, que no traen atlas y
 * caen en el cubo de color por vértice— son **dos llamadas de dibujo**, sea cual sea la
 * densidad del preset.
 *
 * ## La geometría de la sala no se recorta pieza a pieza
 *
 * Consecuencia de fusionar: la malla resultante ocupa la sala entera, así que siempre pasa
 * la prueba del frustum y se envían sus triángulos aunque la cámara mire a una esquina.
 * **No es una regresión** —un `InstancedMesh` también se recorta entero— y no hay que
 * "arreglarlo" volviendo a separar por tipo: eso cambia una malla que siempre se dibuja
 * por ocho que casi siempre se dibujan también, y paga siete llamadas por ello.
 *
 * ## Sin `.glb` no hay atrezo, y está bien así
 *
 * Aquí, a diferencia de los agentes y del fantasma, **no hay respaldo primitivo**: unas
 * cajas genéricas de adorno no aportan nada que no aporte la sala vacía, y sí ensucian la
 * silueta contra la que se lee el neón. Sin modelos, la bóveda es exactamente la de
 * siempre.
 *
 * Es una excepción consciente a la regla de "todo tiene respaldo": la regla existe para
 * que el juego **se pueda jugar** sin modelos, y eso se cumple.
 */

const UP = new THREE.Vector3(0, 1, 0);

export class PropLibrary {
  constructor(scene) {
    this.scene = scene;
    this.group = new THREE.Group();
    this.scene.add(this.group);
    /**
     * Por índice de `PROP_MODELS`: lo que devuelve `mergedModel`, o `null` si ese modelo
     * no está. `null` y no ausencia: así `build` sabe que ya se intentó.
     */
    this.sources = new Map();
    this.meshes = [];
    this.loading = null;
    /**
     * Cuenta de salas montadas. `build` es asíncrono y `LevelController.buildProps` no lo
     * espera, así que una fusión lenta puede terminar cuando ya se cambió de nivel: sin
     * esto, el atrezo de la sala anterior aparecería en la siguiente.
     */
    this.generation = 0;
  }

  /**
   * Trae y fusiona los modelos. Se puede llamar cuantas veces se quiera: el trabajo pesado
   * ocurre una sola vez, y tanto `AssetLoader` como `mergedModel` cachean por fichero.
   */
  preload() {
    if (!this.loading) {
      this.loading = Promise.all(PROP_MODELS.map(async (_, index) => {
        this.sources.set(index, await mergedModel(propModel(index)));
      }));
    }
    return this.loading;
  }

  /**
   * Monta el atrezo de una sala.
   *
   * Es **asíncrono y no bloquea**: si los modelos aún no están fusionados, la sala se ve
   * sin atrezo y aparece en cuanto llegan. Misma regla que `Player.attachModel`.
   *
   * @param {Array} placements lo que devuelve `scatterProps`
   */
  async build(placements) {
    this.clear();
    if (!placements || placements.length === 0) return;

    const generation = this.generation;
    await this.preload();
    // La sala pudo cambiar mientras se fusionaban los modelos.
    if (generation !== this.generation) return;

    const buckets = new Map();
    const matrix = new THREE.Matrix4();
    const quaternion = new THREE.Quaternion();
    const position = new THREE.Vector3();
    const scale = new THREE.Vector3();

    for (const placement of placements) {
      const source = this.sources.get(placement.kind);
      if (!source) continue;

      position.set(placement.x, 0, placement.z);
      quaternion.setFromAxisAngle(UP, placement.rotY);
      scale.setScalar(placement.scale);

      const geometry = source.geometry.clone();
      geometry.applyMatrix4(matrix.compose(position, quaternion, scale));

      if (!buckets.has(source.bucket)) {
        buckets.set(source.bucket, { parts: [], material: source.material });
      }
      buckets.get(source.bucket).parts.push(geometry);
    }
    if (buckets.size === 0) return;

    const castShadow = quality.get('propShadows');

    for (const { parts, material } of buckets.values()) {
      const aligned = alignIndexing(parts);
      const merged = mergeGeometries(aligned, false);
      aligned.forEach(part => part.dispose());
      if (!merged) continue;

      // Obligatorio, y más desde que la cámara se mueve: sin esto el recorte por frustum
      // usa la esfera que traía la geometría fuente, centrada en el origen, y el atrezo
      // entero desaparece en cuanto la cámara deja de mirar al centro de la sala. Es
      // exactamente el fallo que documenta `DungeonGen.buildWalls`.
      merged.computeBoundingSphere();

      const mesh = new THREE.Mesh(merged, material);
      mesh.castShadow = castShadow;
      mesh.receiveShadow = true;

      this.group.add(mesh);
      this.meshes.push(mesh);
    }
  }

  /**
   * Quita el atrezo de la sala anterior.
   *
   * Aquí **sí** se suelta la geometría, al revés que en la versión instanciada: la malla
   * de una sala lleva las posiciones de esa sala horneadas dentro y no la reutiliza nadie.
   * Sin soltarla, cada nivel dejaría en la GPU un búfer del tamaño de la sala.
   *
   * Lo que no se suelta es el material, que es compartido y lo reutiliza la sala
   * siguiente; de las geometrías fuente y del atlas se encarga `disposeMergedModels`.
   */
  clear() {
    this.generation++;
    this.meshes.forEach(mesh => {
      this.group.remove(mesh);
      mesh.geometry.dispose();
    });
    this.meshes = [];
  }

  /** Al cerrar el juego. Lo compartido lo suelta `disposeMergedModels`. */
  dispose() {
    this.clear();
    this.scene.remove(this.group);
    this.sources.clear();
    this.loading = null;
  }
}
