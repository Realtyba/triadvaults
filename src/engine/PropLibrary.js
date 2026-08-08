import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { assets } from './AssetLoader.js';
import { PROP_MODELS, propModelUrl } from '../assets/manifest.js';
import { prepareImportedMaterial } from './materials.js';
import { markShared } from './disposal.js';
import { quality } from './QualitySettings.js';

/**
 * Atrezo importado, dibujado en dos o tres llamadas.
 *
 * ## El presupuesto manda
 *
 * Los muros de esta sala son **dos** `InstancedMesh` a propósito (`DungeonGen`), y eso
 * es lo que paga que el preset `movil` conserve el bloom, que a su vez es lo que hace
 * que el neón se lea como luz. Meter atrezo con la geometría tal cual sale del `.glb`
 * —cada pieza con sus cuatro o cinco mallas sueltas— gastaría ese margen entero en
 * decoración.
 *
 * Por eso cada tipo de pieza pasa por dos filtros antes de entrar en escena:
 *
 *  1. **Se fusiona** en una sola `BufferGeometry`, horneando las transformaciones de su
 *     jerarquía. Una pieza de cuatro partes deja de ser cuatro envíos.
 *  2. **Se instancia**: todas las copias de un tipo comparten geometría y material, así
 *     que cuarenta cajas cuestan lo mismo que una.
 *
 * Techo autoimpuesto: **tres tipos, cuarenta piezas, +3 llamadas de dibujo**. Si una
 * medida con `?stats=1` da más, hay geometría sin fusionar.
 *
 * ## Sin `.glb` no hay atrezo, y está bien así
 *
 * Los modelos los baja `npm run assets` y no están en el repositorio, así que quien
 * clone y ejecute `npm run dev` no los tiene. Aquí, a diferencia de los agentes y del
 * fantasma, **no hay respaldo primitivo**: unas cajas genéricas de adorno no aportan
 * nada que no aporte la sala vacía, y sí ensucian la silueta contra la que se lee el
 * neón. Sin modelos, la bóveda es exactamente la de siempre.
 *
 * Es una excepción consciente a la regla de "todo tiene respaldo": la regla existe para
 * que el juego **se pueda jugar** sin descargas, y eso se cumple.
 */

/** Altura a la que se normaliza una pieza de atrezo, en unidades de mundo. */
const PROP_HEIGHT = 1.1;

export class PropLibrary {
  constructor(scene) {
    this.scene = scene;
    this.group = new THREE.Group();
    this.scene.add(this.group);
    /** Geometría fusionada por tipo, o `null` si ese modelo no está. */
    this.geometries = new Map();
    this.material = null;
    this.meshes = [];
    this.loading = null;
  }

  /**
   * Trae y fusiona los modelos. Se puede llamar cuantas veces se quiera: el trabajo
   * pesado ocurre una sola vez y `AssetLoader` ya cachea las descargas por URL.
   */
  preload() {
    if (!this.loading) {
      this.loading = Promise.all(PROP_MODELS.map((_, i) => this.prepare(i)));
    }
    return this.loading;
  }

  /**
   * Deja lista la geometría fusionada de un tipo.
   *
   * Se usa `assets.instance` y no `assets.load` para heredar la normalización de altura
   * y el apoyo en el suelo, que es el trozo delicado —y ya resuelto— de importar un
   * modelo con jerarquía. Ver `AssetLoader.normalize`.
   */
  async prepare(index) {
    if (this.geometries.has(index)) return;

    const url = propModelUrl(index);
    const instance = url ? await assets.instance(url, PROP_HEIGHT) : null;
    if (!instance) {
      // `null` y no ausencia: así `build` sabe que ya se intentó y no vuelve a pedirlo.
      this.geometries.set(index, null);
      return;
    }

    const parts = [];
    instance.root.updateMatrixWorld(true);
    instance.root.traverse(child => {
      if (!child.isMesh || !child.geometry) return;
      const geometry = child.geometry.clone();
      // La matriz de mundo lleva dentro la escala de la normalización y el apoyo en el
      // suelo. Horneándola, la geometría fusionada ya está a la altura correcta.
      geometry.applyMatrix4(child.matrixWorld);
      // `mergeGeometries` exige que todas las entradas tengan los mismos atributos.
      // Un pack cualquiera trae mallas con y sin UV, y sin esto devuelve `null` sin
      // decir por qué.
      for (const name of Object.keys(geometry.attributes)) {
        if (name !== 'position' && name !== 'normal') geometry.deleteAttribute(name);
      }
      parts.push(geometry);
    });

    const merged = parts.length > 0 ? mergeGeometries(parts, false) : null;
    parts.forEach(part => part.dispose());

    // Compartida: sobrevive al nivel igual que `UNIT_BOX`, y `disposeChildren` no debe
    // soltarla o la segunda sala se quedaría sin atrezo.
    this.geometries.set(index, merged ? markShared(merged) : null);
  }

  /** Material único para todo el atrezo: es lo que permite instanciar por tipo. */
  ensureMaterial() {
    if (this.material) return this.material;

    this.material = markShared(new THREE.MeshStandardMaterial({
      color: 0x39405c,
      metalness: 0.45,
      roughness: 0.7
    }));
    return prepareImportedMaterial(this.material, { envMapIntensity: 0.5 });
  }

  /**
   * Monta el atrezo de una sala.
   *
   * Es **asíncrono y no bloquea**: si los modelos aún no están fusionados, la sala se
   * ve sin atrezo y aparece en cuanto llegan. Misma regla que `Player.attachModel`.
   *
   * @param {Array} placements lo que devuelve `scatterProps`
   */
  async build(placements) {
    this.clear();
    if (!placements || placements.length === 0) return;

    await this.preload();

    const byKind = new Map();
    for (const placement of placements) {
      if (!this.geometries.get(placement.kind)) continue;
      if (!byKind.has(placement.kind)) byKind.set(placement.kind, []);
      byKind.get(placement.kind).push(placement);
    }
    if (byKind.size === 0) return;

    const material = this.ensureMaterial();
    const castShadow = quality.get('propShadows');
    const matrix = new THREE.Matrix4();
    const quaternion = new THREE.Quaternion();
    const position = new THREE.Vector3();
    const scale = new THREE.Vector3();

    for (const [kind, list] of byKind) {
      const mesh = new THREE.InstancedMesh(this.geometries.get(kind), material, list.length);
      mesh.castShadow = castShadow;
      mesh.receiveShadow = true;

      list.forEach((placement, i) => {
        position.set(placement.x, 0, placement.z);
        quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), placement.rotY);
        scale.setScalar(placement.scale);
        mesh.setMatrixAt(i, matrix.compose(position, quaternion, scale));
      });
      mesh.instanceMatrix.needsUpdate = true;

      // Obligatorio, y más desde que la cámara se mueve: sin esto el recorte por frustum
      // usa la esfera de la geometría **sin instanciar**, centrada en el origen, y el
      // atrezo entero desaparece en cuanto la cámara deja de mirar al centro de la sala.
      // Es exactamente el fallo que documenta `DungeonGen.buildWalls`.
      mesh.computeBoundingSphere();

      this.group.add(mesh);
      this.meshes.push(mesh);
    }
  }

  /**
   * Quita el atrezo de la sala anterior.
   *
   * Se sueltan los `InstancedMesh` pero **no** su geometría ni su material: los dos
   * están marcados como compartidos y los reutiliza la sala siguiente. Lo único propio
   * de cada malla es su búfer de matrices, que se va con ella.
   */
  clear() {
    this.meshes.forEach(mesh => {
      this.group.remove(mesh);
      mesh.dispose();
    });
    this.meshes = [];
  }

  /** Al cerrar el juego: aquí sí se suelta lo compartido. */
  dispose() {
    this.clear();
    this.scene.remove(this.group);
    this.geometries.forEach(geometry => geometry && geometry.dispose());
    this.geometries.clear();
    if (this.material) this.material.dispose();
    this.material = null;
  }
}
