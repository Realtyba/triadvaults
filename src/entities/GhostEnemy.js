import * as THREE from 'three';
import { turnTowards, moveWithSlide } from '../physics/collision.js';
import { TargetSelector } from './ghost/TargetSelector.js';
import { GhostBrain } from './ghost/GhostBrain.js';
import { PLAYER_COLORS } from './Player.js';
import { disposeObject3D } from '../engine/disposal.js';
import { PALETTE, prepareImportedMaterial } from '../engine/materials.js';
import { createGhostMaterial, updateGhostMaterial } from '../engine/ghostMaterial.js';
import { assets, AssetLoader } from '../engine/AssetLoader.js';
import { ghostModelUrl, GHOST_HEIGHT } from '../assets/manifest.js';
import { quality } from '../engine/QualitySettings.js';
import { GHOST_STATES } from '../../shared/events.js';
import { clamp01, pulse } from '../utils/math.js';

const ATTACK_RANGE = 1.3;
const ATTACK_COOLDOWN = 1.0;

/**
 * Radio de colisión mientras acecha.
 *
 * Algo mayor que el del jugador (0,4): flota, ocupa más y con el radio del agente se
 * colaba de refilón por huecos por los que el cuerpo no cabe.
 */
const GHOST_RADIUS = 0.55;

/** Suavizado del fantasma remoto, igual que el de los agentes. */
const REMOTE_LERP = 10;

/** Mezcla entre clips de animación, en segundos. El mismo valor que usan los agentes. */
const CROSSFADE = 0.18;

/**
 * El perseguidor.
 *
 * ## Estética
 *
 * Antes era un octaedro rojo emisivo con un toro de alambre girando y un foco rojo:
 * brillante, saturado y perfectamente inofensivo. El problema de fondo es que **lo
 * que da miedo es una ausencia de luz que se mueve**, no una bombilla. Así que el
 * cuerpo pasa a ser casi negro, la mortaja lo deshilacha para que no tenga una
 * silueta sólida que el ojo pueda fijar, y lo único luminoso son los ojos: en una
 * sala oscura es lo primero que se ve, y mira hacia ti.
 *
 * La mortaja se anima con rotación y escala por seno, sin tocar vértices, así que
 * el coste es el de cualquier otra malla estática.
 *
 * ## Autoridad
 *
 * Lo simula el cliente que hace de host; los demás solo lo interpolan. El servidor
 * no lo simula, solo arbitra el daño resultante.
 *
 * ## Colisión: depende de si te ha visto
 *
 * Antes atravesaba los muros **siempre**, con este argumento: sin pathfinding, una
 * aparición que respetase la geometría solo parecería un enemigo con la ruta rota. Es
 * verdad, y lo contrario también: atravesando siempre, la sala deja de significar nada
 * —no hay nada que hacer con un muro— y el fantasma se reduce a un cronómetro que se
 * acerca.
 *
 * Ahora el reparto lo hace el estado: **acechando** rodea los muros y **cazando o
 * embistiendo** los atraviesa. Así romper la línea de visión funciona de verdad, ser
 * visto es el momento en el que todo cambia, y la bóveda vuelve a ser un sitio sin que
 * el fantasma tenga que usar las puertas. El detalle está en `ghost/GhostBrain.js`.
 */
export class GhostEnemyEntity {
  /**
   * @param {THREE.Scene} scene
   * @param {{index?: number, ownerUid?: string|null}} options
   *   `ownerUid` fija la presa asignada; sin él persigue por puntuación.
   */
  constructor(scene, { index = 0, ownerUid = null } = {}) {
    this.scene = scene;
    this.index = index;
    this.ownerUid = ownerUid;
    this.speed = 2.5;
    this.damageCooldown = 0;
    this.targetSelector = new TargetSelector();
    this.brain = new GhostBrain(index);
    this.targetUid = null;
    this.elapsed = 0;

    /** Rejilla de la sala, para la línea de visión y la ruta del acecho. */
    this.navGrid = null;
    /** Campo de flujo hacia la presa. Lo pone `LevelController`, compartido por fantasmas. */
    this.flowField = null;
    /** Cajas de colisión de la sala. Solo se consultan acechando. */
    this.obstacleBoxes = null;
    /** Vector de trabajo del paso con deslizamiento; se reutiliza cada fotograma. */
    this.slideStep = new THREE.Vector3();
    /** Vector de trabajo de la separación entre fantasmas. */
    this.separationForce = new THREE.Vector3();

    /**
     * Sesgo angular por fantasma: hace que cada uno prefiera un lado distinto al
     * rodear los muros en acecho. Sin él, dos fantasmas con el mismo flow field
     * siguen exactamente la misma ruta y se agrupan en un punto.
     */
    this.angleBias = ((index % 2 === 0) ? 1 : -1) * (0.35 + index * 0.15);

    /** Distancia a su presa en el último fotograma; la usa la capa de tensión. */
    this.distanceToTarget = Infinity;

    this.remoteTarget = new THREE.Vector3();
    this.hasRemoteTarget = false;

    this.mesh = new THREE.Group();
    this.buildMesh();
    this.scene.add(this.mesh);
  }

  buildMesh() {
    // El material lleva dentro el borde de fresnel y la disolución, y es **el mismo**
    // para el modelo importado y para esta silueta de respaldo. Es lo que hace que quien
    // no haya ejecutado `npm run assets` no vea un fantasma peor, sino el mismo fantasma
    // con una silueta más simple. Ver `engine/ghostMaterial.js`.
    this.coreMat = createGhostMaterial(quality.get('ghostShader'));
    this.coreMesh = new THREE.Mesh(new THREE.IcosahedronGeometry(0.55, 1), this.coreMat);
    this.coreMesh.position.y = 1.6;
    // Una sombra que cruza el suelo antes de que veas la criatura.
    this.coreMesh.castShadow = quality.get('shadows');
    this.mesh.add(this.coreMesh);

    this.buildOutline();
    this.buildGroundMark();
    this.buildEyes();
    this.attachModel();

    // Luz tenue y fría en vez del foco rojo: insinúa la silueta sin revelarla.
    this.light = new THREE.PointLight(0x330011, 1.4, 8);
    this.light.position.set(0, 1.7, 0);
    this.baseLightIntensity = 1.4;
    this.mesh.add(this.light);
  }

  /**
   * Borde de la criatura, por casco invertido.
   *
   * ## Por qué hace falta
   *
   * La estética de más abajo funciona **mientras haya bloom**: lo único luminoso
   * son los ojos y son ellos los que lo recogen. En el preset bajo no hay
   * post-procesado *ni* mortaja, así que del fantasma solo quedaba un icosaedro casi
   * negro sobre suelo oscuro: invisible hasta que ya te había alcanzado. Y el preset
   * bajo es exactamente el que le toca a cualquier móvil.
   *
   * ## Cómo
   *
   * Una copia del núcleo ligeramente mayor, pintada por su **cara interior**: el
   * núcleo tapa todo menos el reborde. El material es sin iluminación, así que no
   * depende de luces, sombras ni post-procesado y se ve igual en los cuatro presets.
   * Cuesta una llamada de dibujo.
   *
   * El color es el rojo de amenaza y **no** el del agente perseguido: los ojos ya
   * dicen a por quién va (ver `setTargetIndicator`), y que las dos señales digan lo
   * mismo desperdicia una de las dos. El borde responde a "hay un fantasma ahí".
   */
  buildOutline() {
    this.outlineMat = new THREE.MeshBasicMaterial({
      color: PALETTE.GHOST_AURA,
      side: THREE.BackSide,
      transparent: true,
      opacity: 0.5,
      // Sin escritura de profundidad la mortaja no se recorta contra el borde.
      depthWrite: false
    });

    this.outlineMesh = new THREE.Mesh(new THREE.IcosahedronGeometry(0.55, 1), this.outlineMat);
    this.outlineMesh.scale.setScalar(1.13);
    this.outlineMesh.position.y = 1.6;
    this.mesh.add(this.outlineMesh);
  }

  /**
   * Anillo en el suelo, bajo la criatura.
   *
   * Con una cámara isométrica en picado, la altura se lee mal: el cuerpo flota a
   * 1,6 unidades y el ojo no acierta a qué casilla corresponde. El anillo dice
   * **dónde** está, y aparece por el borde de la pantalla antes que el propio
   * fantasma, que es justo el aviso que faltaba.
   */
  buildGroundMark() {
    this.markMat = new THREE.MeshBasicMaterial({
      color: PALETTE.GHOST_AURA,
      transparent: true,
      opacity: 0.28,
      side: THREE.DoubleSide,
      depthWrite: false
    });

    this.groundMark = new THREE.Mesh(new THREE.RingGeometry(0.6, 0.76, 28), this.markMat);
    this.groundMark.rotation.x = -Math.PI / 2;
    // Despegado del suelo para que no parpadee por competir con él en profundidad.
    this.groundMark.position.y = 0.06;
    this.mesh.add(this.groundMark);
  }

  /**
   * Cambia la silueta de respaldo por el modelo con esqueleto, si lo hay.
   *
   * **Asíncrono y sin bloquear nada**, igual que `Player.attachModel`: la silueta de
   * respaldo está en escena desde el primer fotograma y el modelo la sustituye cuando
   * llega. Un nivel no puede esperar a una descarga.
   *
   * Si no hay modelo declarado en el manifiesto —el estado por defecto— esto no hace
   * nada y el fantasma se queda como está, con su material completo. Ver `GHOST_MODEL`.
   */
  async attachModel() {
    const url = ghostModelUrl();
    if (!url) return;

    const instance = await assets.instance(url, GHOST_HEIGHT);
    // La sala pudo terminar mientras se bajaba el modelo.
    if (!instance || !this.mesh.parent) return;

    instance.root.traverse(child => {
      if (!child.isMesh) return;
      // Se le impone el material del fantasma en vez de teñir el suyo: el borde y la
      // disolución **son** el personaje, y un material de pack no los tiene.
      child.material = this.coreMat;
      child.castShadow = quality.get('shadows');
    });
    prepareImportedMaterial(this.coreMat, { envMapIntensity: 0.35 });

    this.modelRoot = instance.root;
    this.mesh.add(this.modelRoot);

    // El núcleo de respaldo se apaga, no se destruye: sigue siendo lo que se ve si algo
    // sale mal, y el contorno por casco invertido cuelga de su misma geometría.
    this.coreMesh.visible = false;
    if (this.outlineMesh) this.outlineMesh.visible = false;

    this.setupAnimation(instance.root, instance.animations);
  }

  /**
   * Reproductor de clips.
   *
   * Copia deliberada del de `Player` en vez de una clase base compartida: aquél deduce
   * el estado de la **velocidad medida** del agente y éste lo recibe de la máquina de
   * estados, así que una base común necesitaría una estrategia por parámetro y saldría
   * más larga que las dos juntas. Si se toca uno, mirar el otro.
   */
  setupAnimation(root, animations = []) {
    if (animations.length === 0) return;

    this.mixer = new THREE.AnimationMixer(root);
    this.actions = {};

    for (const state of ['idle', 'run', 'attack']) {
      const clip = AssetLoader.findClip(animations, state);
      if (clip) this.actions[state] = this.mixer.clipAction(clip);
    }

    this.play('idle');
  }

  play(name) {
    if (!this.actions) return;
    // Un modelo sin clip de ataque embiste con el de correr: es el que ya expresa prisa,
    // y quedarse congelado sería peor que repetir una animación.
    const next = this.actions[name] || this.actions.run || this.actions.idle;
    if (!next || next === this.current) return;

    next.reset().fadeIn(CROSSFADE).play();
    if (this.current) this.current.fadeOut(CROSSFADE);
    this.current = next;
  }

  /**
   * Lo único brillante de la criatura.
   *
   * Por eso son lo que recoge el bloom y lo que se distingue a distancia. Toman el
   * color del agente perseguido, que es como se conserva la función que antes tenía
   * el anillo de alambre: saber a por quién va sin mirar el HUD.
   */
  buildEyes() {
    // Un poco mayores que antes: a 0.075 solo se distinguían gracias al bloom, y en
    // los presets que no lo tienen desaparecían por completo.
    const geometry = new THREE.SphereGeometry(0.095, 8, 8);
    this.eyeMat = new THREE.MeshBasicMaterial({ color: PALETTE.GHOST_AURA });

    this.eyes = [-1, 1].map(side => {
      const eye = new THREE.Mesh(geometry, this.eyeMat);
      eye.position.set(side * 0.19, 1.68, 0.42);
      this.mesh.add(eye);
      return eye;
    });
    this.eyeGeometry = geometry;
  }

  /** La velocidad escala con el nivel sin llegar nunca a la del jugador (8.5). */
  /**
   * Dificultad por nivel, en dos tramos.
   *
   * La velocidad crece **asintóticamente** hacia 7,5 (el jugador va a 8,5), no de
   * forma lineal: con la rampa recta anterior el fantasma pegaba un estirón entre
   * los niveles 5 y 15 y luego dejaba de cambiar, de modo que la curva de
   * dificultad se sentía como un muro seguido de una meseta.
   *
   * Alcanzado el techo, lo que sube es la **agresividad**: cambia de objetivo
   * antes y se ceba más con quien está resolviendo el puzle. Seguir subiendo la
   * velocidad bruta solo haría el juego imposible, no más interesante.
   */
  setSpeedForLevel(levelNum) {
    const level = Math.max(1, levelNum);
    const ramp = 1 - Math.exp(-(level - 1) / 7); // 0 en el nivel 1, ~0.87 en el 15
    this.speed = 2.5 + ramp * 5.0;

    // De 0 en el nivel 15 a 1 en el 40.
    const pressure = clamp01((level - 15) / 25);
    this.targetSelector.setAggression(pressure);
    // La misma presión recorta la paciencia del acecho: a nivel alto deja de rondar y
    // entra a por ti aunque no te haya visto. Ver `GhostBrain.patience`.
    this.brain.setPressure(pressure);
  }

  spawnAt(x, z) {
    this.mesh.position.set(x, 0, z);
    this.remoteTarget.set(x, 0, z);
    this.hasRemoteTarget = false;
    this.targetSelector.reset();
    this.brain.reset();
    this.targetUid = null;
    this.distanceToTarget = Infinity;
  }

  /** La sala en la que caza: rejilla para ver y muros para rodear. */
  setLevel({ navGrid, obstacleBoxes }) {
    this.navGrid = navGrid || null;
    this.obstacleBoxes = obstacleBoxes || null;
  }

  /**
   * Estado que llega del host, en los clientes que no simulan.
   *
   * Es el único dato del fantasma que **no** se puede deducir de su posición: la
   * animación, el borde encendido y la disolución tienen que coincidir en las tres
   * pantallas, y desde fuera no hay forma de saber si lo que se ve acercarse es una
   * carga o un paseo rápido.
   */
  setRemoteState(state) {
    if (state === undefined || state === this.brain.state) return;
    this.brain.state = state;
    this.brain.charge = state === GHOST_STATES.CHARGE ? 1 : 0;
    this.play(state === GHOST_STATES.CHARGE ? 'attack' : state === GHOST_STATES.HUNT ? 'run' : 'idle');
  }

  /** Estado que llega del host. Se interpola en `updateRemote`, no se teletransporta. */
  setPosition(position) {
    this.remoteTarget.set(position.x, position.y, position.z);
    if (!this.hasRemoteTarget) {
      this.mesh.position.copy(this.remoteTarget);
      this.hasRemoteTarget = true;
    }
  }

  /**
   * Suavizado en los clientes que no son el host.
   *
   * El host manda 15 veces por segundo y antes cada paquete se aplicaba con un
   * `position.set` seco, así que el fantasma daba saltos mientras los agentes sí
   * se interpolaban. Con varios fantasmas ese salto se multiplicaba.
   */
  updateRemote(delta) {
    this.elapsed += delta;
    this.animateIdle(delta);
    if (!this.hasRemoteTarget) return;

    this.mesh.position.lerp(this.remoteTarget, clamp01(delta * REMOTE_LERP));
  }

  /** El color de los ojos delata a quién persigue. */
  setTargetIndicator(uid, players) {
    if (this.targetUid === uid) return;
    this.targetUid = uid;

    const target = players.find(p => p.uid === uid);
    const color = target ? PLAYER_COLORS[target.index % PLAYER_COLORS.length] : PALETTE.GHOST_AURA;
    this.eyeMat.color.setHex(color);
  }

  animateIdle(delta) {
    // Reloj propio acumulado: antes era `Date.now()`, que no se puede pausar y va
    // por libre respecto al resto de animaciones de la escena.
    this.coreMesh.position.y = 1.6 + Math.sin(this.elapsed * 2) * 0.18;
    this.coreMesh.rotation.y += delta * 0.35;

    const closeness = clamp01(1 - this.distanceToTarget / 14);

    // El borde acompaña al cuerpo en el vaivén y en el giro: separarlo aunque sea
    // un fotograma lo delata como una segunda malla en vez de como un contorno.
    if (this.outlineMesh) {
      this.outlineMesh.position.y = this.coreMesh.position.y;
      this.outlineMesh.rotation.y = this.coreMesh.rotation.y;
      // Marca más cuanto más cerca está, igual que late la luz: así el recurso de
      // legibilidad trabaja a favor de la tensión en vez de aplanarla.
      this.outlineMat.opacity = 0.42 + closeness * 0.34;
    }

    if (this.groundMark) {
      const beat = pulse(this.elapsed, 2 + closeness * 4);
      this.markMat.opacity = 0.2 + closeness * 0.28 + beat * 0.08;
      const scale = 1 + beat * 0.08;
      this.groundMark.scale.set(scale, scale, 1);
    }

    // El reloj y la carga del material: es lo que deshilacha el bajo del cuerpo y
    // enciende el borde al cargar la embestida. Sustituye a los seis conos de tela que
    // colgaban de aquí, y a diferencia de ellos no cuesta ninguna llamada de dibujo.
    updateGhostMaterial(this.coreMat, this.elapsed, this.brain.charge);
    if (this.mixer) this.mixer.update(delta);

    // La luz respira, más deprisa cuanto más cerca está de su presa. Embistiendo se
    // dispara: es el aviso de que ya no hay nada que negociar.
    if (this.light) {
      const beat = pulse(this.elapsed, 2 + closeness * 6);
      const surge = 1 + this.brain.charge * 1.6;
      this.light.intensity = this.baseLightIntensity * (0.6 + beat * 0.5 + closeness * 0.5) * surge;
    }
  }

  /**
   * Lógica autoritativa del host.
   *
   * @param {number} delta
   * @param {Array<{uid, index, position, health, alive, onPlate}>} players
   * @param {(targetUid: string) => void} onDamage
   * @param {number} roomRange diagonal de la sala, para calibrar la puntuación
   * @param {GhostEnemyEntity[]} [siblings] todos los fantasmas, para la separación
   * @returns {string|null} uid perseguido
   */
  update(delta, players = [], onDamage, roomRange, siblings = []) {
    this.elapsed += delta;
    this.animateIdle(delta);

    const target = this.resolveTarget(players, delta, roomRange);
    if (!target) {
      this.distanceToTarget = Infinity;
      return null;
    }

    this.distanceToTarget = target.distance;
    this.setTargetIndicator(target.player.uid, players);
    this.hunt(delta, target, siblings);

    if (this.damageCooldown > 0) {
      this.damageCooldown -= delta;
    } else if (target.distance < ATTACK_RANGE) {
      this.damageCooldown = ATTACK_COOLDOWN;
      // El uid identifica a la víctima: antes el daño se atribuía siempre al host.
      if (onDamage) onDamage(target.player.uid);
    }

    return target.player.uid;
  }

  /**
   * A quién persigue este fantasma.
   *
   * Con un fantasma por agente, cada uno tiene su presa asignada y no cambia: eso
   * es lo que garantiza que nadie quede desatendido, que era el problema original.
   * El selector por puntuación sigue vivo como respaldo para cuando esa presa muere
   * o se desconecta, y es además lo que alimenta la rampa de agresividad.
   */
  resolveTarget(players, delta, roomRange) {
    if (this.ownerUid) {
      const owner = players.find(p => p.uid === this.ownerUid);
      if (owner && owner.alive !== false && owner.health > 0) {
        this.targetSelector.setTarget(this.ownerUid);
        return this.targetSelector.emit(owner, this.mesh.position.distanceTo(owner.position));
      }
    }
    return this.targetSelector.update(players, this.mesh.position, delta, roomRange);
  }

  /**
   * Decide el estado y da el paso que le toca.
   *
   * La máquina de estados solo devuelve **qué** hacer; traducirlo a una dirección de
   * mundo es cosa de aquí, porque es lo único que necesita conocer la rejilla y la
   * escena. Ver `ghost/GhostBrain.js`.
   */
  hunt(delta, target, siblings = []) {
    const position = this.mesh.position;
    const dx = target.player.position.x - position.x;
    const dz = target.player.position.z - position.z;
    const length = Math.hypot(dx, dz) || 1;
    const toTarget = { x: dx / length, z: dz / length };

    // Sin rejilla —una sala aún sin construir— se comporta como siempre lo hizo: recto y
    // atravesando. Es el respaldo, no el caso normal.
    const visible = this.navGrid
      ? this.navGrid.hasLineOfSight(position.x, position.z, target.player.position.x, target.player.position.z)
      : true;

    const plan = this.brain.update(delta, target.distance, visible, toTarget);
    this.play(plan.state === GHOST_STATES.CHARGE ? 'attack' : plan.state === GHOST_STATES.HUNT ? 'run' : 'idle');

    if (plan.speedScale === 0) return;

    // Acechando sigue el campo de flujo, que rodea los muros; en los demás estados va
    // recto. La embestida usa su dirección congelada y no la recalcula.
    const direction = plan.direction
      || (plan.pathfinding ? this.stalkDirection(toTarget) : toTarget);

    // Separación entre fantasmas: se repelen mutuamente para no agruparse.
    // Solo se aplica en estados que no son embestida (la embestida va congelada).
    if (plan.state !== GHOST_STATES.CHARGE && siblings.length > 1) {
      this.applySeparation(direction, siblings, delta);
    }

    this.step(direction, this.speed * plan.speedScale * delta, target.distance, plan, delta);
  }

  /**
   * Siguiente paso del acecho, leído del campo de flujo con sesgo angular.
   *
   * Se mira la celda vecina de menor distancia y se apunta a su centro. Con eso basta:
   * el campo ya contiene la ruta entera, así que no hay nada que recorrer ni recordar.
   * Sin campo —o en una celda desde la que no se llega— cae a la línea recta.
   *
   * El **sesgo angular** (angleBias) hace que cada fantasma prefiera un vecino lateral
   * distinto cuando dos celdas están a la misma distancia: así dos fantasmas con el
   * mismo flow field toman caminos opuestos alrededor de un obstáculo.
   */
  stalkDirection(fallback) {
    if (!this.navGrid || !this.flowField) return fallback;

    const here = this.navGrid.toCell(this.mesh.position.x, this.mesh.position.z);
    let best = null;
    let bestDistance = this.flowField[this.navGrid.index(here.col, here.row)] ?? Infinity;
    // Segundo mejor: se elige cuando empata con el mejor, según el sesgo del fantasma.
    let second = null;
    let secondDistance = Infinity;

    // Vecinos en 8 direcciones (4 cardinales + 4 diagonales) para rutas más orgánicas.
    const neighbors = [
      [here.col + 1, here.row], [here.col - 1, here.row],
      [here.col, here.row + 1], [here.col, here.row - 1],
      [here.col + 1, here.row + 1], [here.col - 1, here.row - 1],
      [here.col + 1, here.row - 1], [here.col - 1, here.row + 1]
    ];

    for (const [c, r] of neighbors) {
      if (!this.navGrid.inBounds(c, r)) continue;
      const distance = this.flowField[this.navGrid.index(c, r)];
      if (distance < bestDistance) {
        second = best;
        secondDistance = bestDistance;
        bestDistance = distance;
        best = { col: c, row: r };
      } else if (distance < secondDistance && distance !== bestDistance) {
        secondDistance = distance;
        second = { col: c, row: r };
      }
    }
    if (!best) return fallback;

    // Si hay un segundo camino casi igual de bueno, los fantasmas impares lo
    // prefieren: esto es lo que los hace rodear el muro por lados opuestos.
    const chosen = (second && secondDistance <= bestDistance + 1 && this.angleBias > 0)
      ? second
      : best;

    const world = this.navGrid.toWorld(chosen.col, chosen.row);
    const dx = world.x - this.mesh.position.x;
    const dz = world.z - this.mesh.position.z;
    const length = Math.hypot(dx, dz) || 1;
    return { x: dx / length, z: dz / length };
  }

  /**
   * Separación entre fantasmas.
   *
   * Empuja la dirección de movimiento lejos de los hermanos cercanos, para que no se
   * amontonen. El cálculo es O(n²) pero n ≤ 3, así que son 6 comparaciones como máximo.
   *
   * La fuerza se mezcla con la dirección original en vez de sustituirla: así no dejan
   * de perseguir, solo se apartan.
   *
   * @param {{x: number, z: number}} direction se modifica in-place
   * @param {GhostEnemyEntity[]} siblings
   * @param {number} delta
   */
  applySeparation(direction, siblings, delta) {
    const SEPARATION_RADIUS = 2.5;
    const SEPARATION_STRENGTH = 3.0;
    let fx = 0;
    let fz = 0;
    let count = 0;

    for (const other of siblings) {
      if (other === this) continue;
      const dx = this.mesh.position.x - other.mesh.position.x;
      const dz = this.mesh.position.z - other.mesh.position.z;
      const dist = Math.hypot(dx, dz);
      if (dist < SEPARATION_RADIUS && dist > 0.01) {
        // Fuerza inversamente proporcional a la distancia.
        const strength = (SEPARATION_RADIUS - dist) / SEPARATION_RADIUS;
        fx += (dx / dist) * strength;
        fz += (dz / dist) * strength;
        count++;
      }
    }

    if (count === 0) return;

    // Se mezcla: 70% dirección original, 30% separación.
    const mix = SEPARATION_STRENGTH * delta;
    direction.x += fx * mix;
    direction.z += fz * mix;
    const length = Math.hypot(direction.x, direction.z) || 1;
    direction.x /= length;
    direction.z /= length;
  }

  /**
   * Un paso en una dirección, girando el cuerpo hacia ella.
   *
   * Acechando el paso pasa por el mismo deslizamiento contra muros que usa el jugador;
   * en los demás estados atraviesa. El giro es progresivo, como el del agente: antes el
   * ángulo se asignaba de golpe y el fantasma cambiaba de orientación de un fotograma
   * a otro.
   */
  step(direction, distance, remaining, plan, delta) {
    // Cazando y embistiendo no se pasa de largo de la presa; acechando sí puede, porque
    // la ruta rodea y el último tramo no apunta a ella.
    const travel = plan.pathfinding ? distance : Math.min(distance, remaining);
    if (travel <= 0) return;

    if (plan.pathfinding && this.obstacleBoxes) {
      // El mismo deslizamiento que usa el jugador: sin él, la ruta del campo de flujo
      // corta las esquinas y el fantasma se queda enganchado en el canto de un muro.
      this.slideStep.set(direction.x * travel, 0, direction.z * travel);
      moveWithSlide(this.mesh.position, this.slideStep, this.obstacleBoxes, GHOST_RADIUS);
    } else {
      this.mesh.position.x += direction.x * travel;
      this.mesh.position.z += direction.z * travel;
    }

    this.mesh.rotation.y = turnTowards(
      this.mesh.rotation.y,
      Math.atan2(direction.x, direction.z),
      delta,
      // Embistiendo apenas gira: la dirección está congelada y girar el cuerpo hacia la
      // presa haría que pareciese un misil teledirigido en vez de una carga recta.
      plan.state === GHOST_STATES.CHARGE ? 0.6 : 6
    );
  }

  destroy() {
    // El mixer guarda referencias a las pistas del modelo clonado: sin soltarlas, cada
    // sala deja atrás un esqueleto entero. Es lo mismo que hace `Player.dispose`.
    if (this.mixer) {
      this.mixer.stopAllAction();
      if (this.modelRoot) this.mixer.uncacheRoot(this.modelRoot);
      this.mixer = null;
    }

    disposeObject3D(this.mesh, this.scene);
    // Geometrías compartidas entre los hijos: el recorrido las libera al toparse
    // con la primera malla, y disponer de más es un no-op inofensivo.
    if (this.eyeGeometry) this.eyeGeometry.dispose();
  }
}
