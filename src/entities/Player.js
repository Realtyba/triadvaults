import * as THREE from 'three';
import { moveWithSlide, turnTowards } from '../physics/collision.js';
import { disposeObject3D } from '../engine/disposal.js';
import { PALETTE, neonMaterial, darkBodyMaterial, prepareImportedMaterial } from '../engine/materials.js';
import { clamp01 } from '../utils/math.js';
import { quality } from '../engine/QualitySettings.js';
import { AssetLoader, assets } from '../engine/AssetLoader.js';
import { PLAYER_HEIGHT, playerModel, modelUrl } from '../assets/manifest.js';

export const PLAYER_COLORS = PALETTE.PLAYER; // agente 1, 2, 3
const PLAYER_RADIUS = 0.4;
const PLAYER_SPEED = 8.5;

/** Suavizado de las posiciones remotas: sin esto los otros agentes se ven a saltos. */
const REMOTE_LERP = 12;

/** Reutilizado en cada fotograma: `clone()` alocaba un Vector3 por agente y frame. */
const stepScratch = new THREE.Vector3();

/**
 * Segundo temporal, para la posición previa.
 *
 * Tiene que ser **otro** distinto de `stepScratch`: en `update` la posición anterior se
 * guarda y acto seguido se calcula el paso, así que compartiendo uno solo el "antes"
 * quedaría machacado por el propio desplazamiento y la velocidad medida saldría siempre
 * mal. Los dos se leen y se sueltan dentro de la misma llamada, así que no hay riesgo de
 * que dos agentes se pisen.
 */
const prevScratch = new THREE.Vector3();

/**
 * Hacia dónde mira el modelo en reposo, en radianes.
 *
 * El juego orienta al agente con `atan2(x, z)`, que apunta su eje **+Z** en la dirección
 * de la marcha; el cubo que hacía de cabeza estaba en `z = +0.1` por lo mismo. Los
 * modelos de estos packs salen de Blender con esa misma convención, así que vale cero.
 * Si algún día se pone un modelo que ande de espaldas, se corrige **aquí** y no
 * rotando la malla al cargarla: eso último desincronizaría la orientación que se envía
 * por la red del muñeco que se ve.
 */
const MODEL_FACING = 0;

/** Por debajo de esta fracción de la velocidad máxima, el agente se considera parado. */
const IDLE_THRESHOLD = 0.06;

/** A partir de aquí deja de andar y empieza a correr. */
const RUN_THRESHOLD = 0.55;

/** Duración de la mezcla entre animaciones. Más corto se ve como un salto. */
const CROSSFADE = 0.18;

export class PlayerEntity {
  constructor({ uid, name, index = 0, isLocal = false }) {
    this.uid = uid;
    this.name = name;
    this.index = index;
    this.isLocal = isLocal;
    this.speed = PLAYER_SPEED;
    this.alive = true;
    this.health = 100;

    this.colorHex = PLAYER_COLORS[index % PLAYER_COLORS.length];
    this.targetPosition = new THREE.Vector3();
    this.targetRotationY = 0;

    this.mesh = new THREE.Group();

    /** Mallas que se atenúan al morir y parpadean con el escudo. Ver `setAlive`. */
    this.fadeMeshes = [];
    /** Reproductor de animación; queda a `null` si se juega con la geometría base. */
    this.mixer = null;
    this.actions = {};
    this.currentClip = null;
    /** Velocidad real del último fotograma, para elegir entre parado, andar y correr. */
    this.moveSpeed = 0;
    this.disposed = false;

    this.buildMesh();
    /**
     * La promesa se guarda para que el arranque de nivel pueda esperarla **antes** de
     * precompilar. No cambia que el agente sea jugable desde el fotograma cero con su
     * geometría base: sólo le da a quien construye el nivel la opción de esperar. Si
     * no se espera, el `SkinnedMesh` entra en escena ya sin loader delante y su
     * programa de shader se compila con el jugador mirando. Ver `GameApp._buildLevel`.
     */
    this.modelReady = this.attachModel();
  }

  buildMesh() {
    const body = new THREE.Mesh(
      new THREE.CylinderGeometry(0.4, 0.3, 1.4, 8),
      darkBodyMaterial(PALETTE.BODY_DARK, { metalness: 0.8, roughness: 0.3 })
    );
    body.position.y = 0.7;
    body.castShadow = true;
    body.receiveShadow = true;
    this.mesh.add(body);
    this.bodyMesh = body;

    const head = new THREE.Mesh(
      new THREE.BoxGeometry(0.5, 0.4, 0.5),
      neonMaterial(this.colorHex, { intensity: 0.8, roughness: 0.2 })
    );
    head.position.set(0, 1.4, 0.1);
    head.castShadow = true;
    this.mesh.add(head);
    this.headMesh = head;

    const ringGeo = new THREE.RingGeometry(0.5, 0.65, 16);
    ringGeo.rotateX(-Math.PI / 2);
    const ring = new THREE.Mesh(
      ringGeo,
      new THREE.MeshBasicMaterial({ color: this.colorHex, side: THREE.DoubleSide })
    );
    ring.position.y = 0.02;
    this.mesh.add(ring);
    this.ringMesh = ring;

    // Una luz puntual por agente son tres luces dinámicas más en la escena, y cada una
    // se evalúa por fragmento sobre todos los materiales físicos: en una GPU móvil de
    // teselas es el coste que manda. En el preset `movil` la lleva sólo el agente
    // propio, que es el único cuyo halo sirve para orientarse; los compañeros ya se
    // localizan por su anillo de suelo y su cabeza emisiva, que no cuestan luz.
    if (this.isLocal || quality.get('playerLights') === 'all') {
      this.light = new THREE.PointLight(this.colorHex, 1.5, 6);
      this.light.position.set(0, 1.5, 0);
      this.mesh.add(this.light);
    }

    this.fadeMeshes = [body, head, ring];
  }

  /**
   * Sustituye el cilindro y el cubo por un modelo animado, si lo hay.
   *
   * Es asíncrono y **sin esperar a nadie**: el agente ya está en la escena y jugable con
   * la geometría base desde el fotograma cero, y el modelo entra cuando llega. Así una
   * red lenta retrasa el aspecto pero nunca el arranque de la partida, y quien no haya
   * ejecutado `npm run assets` juega igual: `assets.instance` devuelve `null` y esto se
   * queda en nada.
   *
   * El anillo de suelo **no** se sustituye. Es la señal de "quién es quién" en una vista
   * cenital, funciona con el agente tapado por un muro y no cuesta ni una luz.
   */
  async attachModel() {
    const model = playerModel(this.index);
    const instance = await assets.instance(modelUrl(model), PLAYER_HEIGHT, {
      drop: model?.drop
    });
    // La partida puede haber terminado mientras se bajaba el fichero.
    if (!instance || this.disposed) return;

    const { root, animations } = instance;
    root.rotation.y = MODEL_FACING;
    this.mesh.add(root);
    this.modelRoot = root;

    // El cuerpo y la cabeza sobran, pero el anillo se queda.
    [this.bodyMesh, this.headMesh].forEach(mesh => {
      if (mesh) mesh.visible = false;
    });

    this.tintModel(root);
    this.setupAnimation(root, animations);

    this.fadeMeshes = [this.ringMesh];
    root.traverse(child => child.isMesh && this.fadeMeshes.push(child));

    // El estado pudo cambiar mientras cargaba: caer y reaparecer se resuelven en menos
    // de lo que tarda medio mega en llegar por una red móvil.
    this.setAlive(this.alive);
  }

  /**
   * Tiñe el modelo con el color del agente.
   *
   * ## Cuánto teñir, y por qué tanto
   *
   * A la distancia de la cámara el agente ocupa unos veinte píxeles de alto. A ese
   * tamaño el detalle del modelo no se percibe: lo único que se lee es el **contraste**
   * de la silueta contra un pavimento casi negro. Los modelos vienen con colores de
   * ropa y piel apagados, así que sin subirles la emisión el personaje desaparecía —y
   * el diseño anterior no tenía ese problema porque el agente llevaba por cabeza un cubo
   * emisivo a 0,8 que hacía de faro—.
   *
   * Se sube la emisión y se aclara **un poco** el color base hacia el del agente, en vez
   * de repintarlo entero: pintado del todo, el personaje vuelve a ser una mancha plana y
   * se pierde el volumen, que es justo lo que se venía a ganar con el modelo. Lo que
   * queda es un cuerpo que sigue teniendo sombras y un tinte que dice de quién es.
   *
   * La emisión es además lo que recoge el bloom, o sea lo que hace que se lea de lejos
   * en un móvil.
   *
   * ## Un material con textura no se tiñe como uno sin ella
   *
   * Todo lo anterior se escribió para materiales de **color plano**, donde `color` *es*
   * la superficie: aclararlo hacia el acento y emitir a 0,55 era lo único que hacía
   * legible al agente.
   *
   * Con textura, las dos cosas dejan de valer. `color` **multiplica** al mapa base, así
   * que teñirlo apaga el dibujo en vez de aclararlo; y una emisión plana se suma por
   * igual a todos los píxeles, lo que tapa el atlas entero bajo una capa de color —se
   * pierde justo lo que el modelo venía a aportar—. La emisión se modula entonces con el
   * propio mapa base: las zonas oscuras del traje siguen oscuras y las claras son las que
   * brillan, que además es como se comporta una luz de verdad. De lejos se lee igual; de
   * cerca sigue siendo un modelo pintado.
   */
  tintModel(root) {
    const accent = new THREE.Color(this.colorHex);

    root.traverse(child => {
      if (!child.isMesh) return;
      const materials = Array.isArray(child.material) ? child.material : [child.material];
      materials.forEach(material => {
        // Lo primero es integrarlo en la iluminación de la sala; el tinte va encima.
        // Ver `prepareImportedMaterial`: sin ello el agente reflejaba el entorno al
        // doble que los muros que tiene al lado.
        prepareImportedMaterial(material);

        if (!material.emissive) return;
        material.emissive.copy(accent);

        if (material.map) {
          material.emissiveMap = material.map;
          material.emissiveIntensity = 0.22;
          material.color.lerp(accent, 0.12);
          // Añadir un mapa cambia el programa de sombreado: sin esto, three.js reutiliza
          // el compilado anterior y el mapa emisivo no llega a aplicarse.
          material.needsUpdate = true;
        } else {
          material.emissiveIntensity = 0.55;
          material.color.lerp(accent, 0.25);
        }
      });
    });
  }

  setupAnimation(root, animations) {
    if (!animations || animations.length === 0) return;

    this.mixer = new THREE.AnimationMixer(root);
    ['idle', 'walk', 'run', 'death'].forEach(state => {
      const clip = AssetLoader.findClip(animations, state);
      if (!clip) return;

      const action = this.mixer.clipAction(clip);
      if (state === 'death') {
        // Morir termina y se queda: en bucle, el agente caído se levantaría para
        // volver a caerse una y otra vez.
        action.setLoop(THREE.LoopOnce);
        action.clampWhenFinished = true;
      }
      this.actions[state] = action;
    });

    this.play(this.alive ? 'idle' : 'death');
  }

  /** Cambia de animación mezclando desde la actual. */
  play(state) {
    const next = this.actions[state];
    if (!next || this.currentClip === state) return;

    const previous = this.actions[this.currentClip];
    next.reset().setEffectiveWeight(1).play();
    if (previous) previous.crossFadeTo(next, CROSSFADE, false);

    this.currentClip = state;
  }

  /**
   * Elige la animación a partir de lo que el agente se ha movido de verdad.
   *
   * Se mide el desplazamiento y no se lee el input por dos motivos. Uno, los agentes
   * remotos no tienen input: sólo llega su posición, así que ésta es la única señal
   * disponible y usarla para todos evita mantener dos caminos. Y dos, empujar contra un
   * muro deja el input a tope con el agente quieto, y con el input se vería correr sin
   * avanzar.
   *
   * Que sea local es también la razón de que **esto no toque la red**: no hace falta
   * ningún campo nuevo en el protocolo ni en `shared/events.js`.
   */
  updateAnimation(delta) {
    if (!this.mixer) return;

    if (!this.alive) this.play('death');
    else {
      const fraction = this.moveSpeed / this.speed;
      if (fraction < IDLE_THRESHOLD) this.play('idle');
      else if (fraction < RUN_THRESHOLD) this.play('walk');
      else this.play('run');
    }

    this.mixer.update(delta);
  }

  setPosition(x, y, z) {
    this.mesh.position.set(x, y, z);
    this.targetPosition.set(x, y, z);
  }

  getPosition() {
    return this.mesh.position;
  }

  /** Estado de red de un jugador remoto; se interpola en `updateRemote`. */
  setNetworkTransform(position, rotationY) {
    this.targetPosition.set(position.x, position.y, position.z);
    if (typeof rotationY === 'number') this.targetRotationY = rotationY;
  }

  setAlive(alive) {
    this.alive = alive;
    this.applyOpacity(alive ? 1 : 0.25, !alive);
    if (this.light) this.light.intensity = alive ? 1.5 : 0.3;
  }

  /**
   * Opacidad de todo lo que se ve del agente.
   *
   * Va contra `fadeMeshes` y no contra referencias sueltas porque el conjunto cambia:
   * arranca siendo el cilindro, el cubo y el anillo, y pasa a ser las mallas del modelo
   * más el anillo en cuanto el `.glb` llega. Un modelo puede traer varias mallas —camisa,
   * pantalón, piel, pelo— y cada una con su material.
   */
  applyOpacity(opacity, transparent) {
    this.fadeMeshes.forEach(mesh => {
      if (!mesh || !mesh.material) return;
      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      materials.forEach(material => {
        material.transparent = transparent;
        material.opacity = opacity;
      });
    });
  }

  /**
   * Escudo de reaparición. El parpadeo es lo que comunica que estos segundos no
   * cuentan: sin señal visible, no recibir daño se lee como que el juego falla.
   */
  setShield(durationMs) {
    this.shieldUntil = performance.now() + (durationMs || 0);
  }

  get isShielded() {
    return this.shieldUntil !== undefined && performance.now() < this.shieldUntil;
  }

  updateShieldVisual() {
    if (this.fadeMeshes.length === 0) return;

    if (!this.isShielded) {
      if (this.shieldWasOn) {
        this.setAlive(this.alive); // restaura opacidad y luz al terminar
        this.shieldWasOn = false;
      }
      return;
    }

    this.shieldWasOn = true;
    const blink = 0.45 + Math.abs(Math.sin(performance.now() * 0.012)) * 0.55;
    this.applyOpacity(blink, true);
    if (this.light) this.light.intensity = 1.5 * blink;
  }

  /** Movimiento del jugador local a partir del input. */
  update(delta, moveVector, obstacleBoxes = []) {
    if (!this.alive || !moveVector || moveVector.lengthSq() === 0) {
      this.moveSpeed = 0;
      this.updateAnimation(delta);
      return false;
    }

    const before = prevScratch.copy(this.mesh.position);
    const step = stepScratch.copy(moveVector).multiplyScalar(this.speed * delta);
    const moved = moveWithSlide(this.mesh.position, step, obstacleBoxes, PLAYER_RADIUS);

    this.mesh.rotation.y = turnTowards(
      this.mesh.rotation.y,
      Math.atan2(moveVector.x, moveVector.z),
      delta
    );

    // Desplazamiento **real**, ya resueltas las colisiones: empujar contra un muro deja
    // el input a tope con el agente quieto, y con el input se vería correr sin avanzar.
    this.trackSpeed(before, delta);
    this.updateAnimation(delta);
    return moved;
  }

  /** Interpolación de un jugador remoto hacia su último estado conocido. */
  updateRemote(delta) {
    const before = prevScratch.copy(this.mesh.position);
    const factor = clamp01(delta * REMOTE_LERP);
    this.mesh.position.lerp(this.targetPosition, factor);
    this.mesh.rotation.y = turnTowards(this.mesh.rotation.y, this.targetRotationY, delta);

    this.trackSpeed(before, delta);
    this.updateAnimation(delta);
  }

  /**
   * Velocidad de este fotograma, medida contra la posición anterior.
   *
   * `before` se toma del mismo `stepScratch` que se reutiliza justo después, así que
   * hay que leerlo antes de que lo pise nadie. Es una copia por valor: `Vector3.copy`
   * escribe los componentes, no guarda una referencia.
   */
  trackSpeed(before, delta) {
    if (delta <= 0) return;
    this.moveSpeed = before.distanceTo(this.mesh.position) / delta;
  }

  dispose(scene) {
    this.disposed = true;
    // Sin esto el reproductor sigue apuntando a un esqueleto que ya no está en escena, y
    // sus pistas mantienen viva la jerarquía entera del modelo al cambiar de nivel.
    if (this.mixer) {
      this.mixer.stopAllAction();
      this.mixer.uncacheRoot(this.modelRoot);
      this.mixer = null;
    }
    disposeObject3D(this.mesh, scene);
  }
}
