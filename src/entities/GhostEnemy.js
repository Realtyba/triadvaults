import * as THREE from 'three';
import { turnTowards } from '../physics/collision.js';
import { TargetSelector } from './ghost/TargetSelector.js';
import { PLAYER_COLORS } from './Player.js';
import { disposeObject3D } from '../engine/disposal.js';
import { PALETTE } from '../engine/materials.js';
import { quality } from '../engine/QualitySettings.js';
import { clamp01, pulse } from '../utils/math.js';

const ATTACK_RANGE = 1.3;
const ATTACK_COOLDOWN = 1.0;

/** Suavizado del fantasma remoto, igual que el de los agentes. */
const REMOTE_LERP = 10;

/** Jirones de la mortaja. Más de siete y se lee como una bola, no como tela. */
const SHROUD_COUNT = 6;

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
 * ## Colisión
 *
 * **Atraviesa muros a propósito.** No hay pathfinding, y con él una aparición que
 * respetase la geometría solo parecería un enemigo con la ruta rota.
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
    this.targetUid = null;
    this.elapsed = 0;

    /** Distancia a su presa en el último fotograma; la usa la capa de tensión. */
    this.distanceToTarget = Infinity;

    this.remoteTarget = new THREE.Vector3();
    this.hasRemoteTarget = false;

    this.mesh = new THREE.Group();
    this.buildMesh();
    this.scene.add(this.mesh);
  }

  buildMesh() {
    // Cuerpo: casi negro, apenas emisivo. Es un vacío con volumen, no una luz.
    this.coreMat = new THREE.MeshStandardMaterial({
      color: 0x0a0208,
      emissive: 0x330008,
      emissiveIntensity: 0.45,
      roughness: 0.95,
      metalness: 0,
      transparent: true,
      opacity: 0.92
    });
    this.coreMesh = new THREE.Mesh(new THREE.IcosahedronGeometry(0.55, 1), this.coreMat);
    this.coreMesh.position.y = 1.6;
    // Una sombra que cruza el suelo antes de que veas la criatura.
    this.coreMesh.castShadow = quality.get('shadows');
    this.mesh.add(this.coreMesh);

    this.buildOutline();
    this.buildGroundMark();
    this.buildShroud();
    this.buildEyes();

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
   * Jirones que cuelgan del cuerpo.
   *
   * Conos abiertos, sin tapa y a doble cara, con la punta hacia arriba: colgando
   * bajo el núcleo se leen como tela. Sin escritura de profundidad para que se
   * atraviesen entre sí en vez de recortarse con bordes duros.
   */
  buildShroud() {
    this.shroud = [];
    if (!quality.get('ghostShroud')) return;

    const geometry = new THREE.ConeGeometry(0.34, 1.7, 5, 1, true);
    this.shroudMat = new THREE.MeshStandardMaterial({
      color: 0x120310,
      emissive: 0x2a0010,
      emissiveIntensity: 0.3,
      roughness: 1,
      transparent: true,
      opacity: 0.38,
      side: THREE.DoubleSide,
      depthWrite: false
    });

    for (let i = 0; i < SHROUD_COUNT; i++) {
      const strip = new THREE.Mesh(geometry, this.shroudMat);
      const angle = (i / SHROUD_COUNT) * Math.PI * 2;

      strip.position.set(Math.cos(angle) * 0.28, 1.1, Math.sin(angle) * 0.28);
      strip.rotation.z = Math.PI; // punta hacia abajo: cuelga
      strip.userData.phase = i * 1.7;
      strip.userData.angle = angle;

      this.mesh.add(strip);
      this.shroud.push(strip);
    }
    this.shroudGeometry = geometry;
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
  }

  spawnAt(x, z) {
    this.mesh.position.set(x, 0, z);
    this.remoteTarget.set(x, 0, z);
    this.hasRemoteTarget = false;
    this.targetSelector.reset();
    this.targetUid = null;
    this.distanceToTarget = Infinity;
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

    // La mortaja ondea: cada jirón con su fase, o los seis laten a la vez y se lee
    // como un objeto rígido que se hincha.
    this.shroud.forEach(strip => {
      const wave = pulse(this.elapsed, 1.6, strip.userData.phase);
      strip.scale.y = 0.85 + wave * 0.35;
      strip.rotation.x = Math.sin(this.elapsed * 1.1 + strip.userData.phase) * 0.16;
      strip.position.y = 1.1 + wave * 0.1;
    });

    // La luz respira, más deprisa cuanto más cerca está de su presa.
    if (this.light) {
      const beat = pulse(this.elapsed, 2 + closeness * 6);
      this.light.intensity = this.baseLightIntensity * (0.6 + beat * 0.5 + closeness * 0.5);
    }
  }

  /**
   * Lógica autoritativa del host.
   *
   * @param {number} delta
   * @param {Array<{uid, index, position, health, alive, onPlate}>} players
   * @param {(targetUid: string) => void} onDamage
   * @param {number} roomRange diagonal de la sala, para calibrar la puntuación
   * @returns {string|null} uid perseguido
   */
  update(delta, players = [], onDamage, roomRange) {
    this.elapsed += delta;
    this.animateIdle(delta);

    const target = this.resolveTarget(players, delta, roomRange);
    if (!target) {
      this.distanceToTarget = Infinity;
      return null;
    }

    this.distanceToTarget = target.distance;
    this.setTargetIndicator(target.player.uid, players);
    this.moveTowards(target.player.position, delta);

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

  /** Avanza en línea recta hacia el objetivo, atravesando la geometría. */
  moveTowards(targetPosition, delta) {
    const dx = targetPosition.x - this.mesh.position.x;
    const dz = targetPosition.z - this.mesh.position.z;
    const lengthSq = dx * dx + dz * dz;
    if (lengthSq < 0.01) return;

    const length = Math.sqrt(lengthSq);
    const step = Math.min(this.speed * delta, length);

    this.mesh.position.x += (dx / length) * step;
    this.mesh.position.z += (dz / length) * step;

    // Gira progresivamente, como el jugador; antes el ángulo se asignaba de golpe
    // y el fantasma cambiaba de orientación de un fotograma a otro.
    this.mesh.rotation.y = turnTowards(this.mesh.rotation.y, Math.atan2(dx, dz), delta, 6);
  }

  destroy() {
    disposeObject3D(this.mesh, this.scene);
    // Geometrías compartidas entre los hijos: el recorrido las libera al toparse
    // con la primera malla, y disponer de más es un no-op inofensivo.
    if (this.shroudGeometry) this.shroudGeometry.dispose();
    if (this.eyeGeometry) this.eyeGeometry.dispose();
  }
}
