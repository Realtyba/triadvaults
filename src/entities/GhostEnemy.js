import * as THREE from 'three';
import { moveWithSlide } from '../physics/collision.js';
import { TargetSelector } from './ghost/TargetSelector.js';
import { PLAYER_COLORS } from './Player.js';

const GHOST_RADIUS = 0.55;
const ATTACK_RANGE = 1.3;
const ATTACK_COOLDOWN = 1.0;

/** Si el camino recto está bloqueado, se prueban desvíos a ambos lados. */
const DETOUR_ANGLES = [0, Math.PI / 4, -Math.PI / 4, Math.PI / 2, -Math.PI / 2, Math.PI * 0.75, -Math.PI * 0.75];

export class GhostEnemyEntity {
  constructor(scene) {
    this.scene = scene;
    this.speed = 2.5;
    this.damageCooldown = 0;
    this.targetSelector = new TargetSelector();
    this.targetUid = null;

    this.mesh = new THREE.Group();
    this.buildMesh();
    this.scene.add(this.mesh);
  }

  buildMesh() {
    this.coreMat = new THREE.MeshStandardMaterial({
      color: 0xff0033,
      emissive: 0xff0022,
      emissiveIntensity: 1.5,
      roughness: 0.1,
      transparent: true,
      opacity: 0.85
    });
    this.coreMesh = new THREE.Mesh(new THREE.OctahedronGeometry(0.7, 2), this.coreMat);
    this.coreMesh.position.y = 1.6;
    this.mesh.add(this.coreMesh);

    this.ringMat = new THREE.MeshBasicMaterial({ color: 0xff0044, wireframe: true });
    this.ringMesh = new THREE.Mesh(new THREE.TorusGeometry(1.0, 0.08, 16, 32), this.ringMat);
    this.ringMesh.position.y = 1.6;
    this.ringMesh.rotation.x = Math.PI / 3;
    this.mesh.add(this.ringMesh);

    this.light = new THREE.PointLight(0xff0033, 2.5, 10);
    this.light.position.set(0, 1.8, 0);
    this.mesh.add(this.light);
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
    const pressure = Math.max(0, Math.min(1, (level - 15) / 25));
    this.targetSelector.setAggression(pressure);
  }

  spawnAt(x, z) {
    this.mesh.position.set(x, 0, z);
    this.targetSelector.reset();
    this.targetUid = null;
  }

  setPosition(position) {
    this.mesh.position.set(position.x, position.y, position.z);
  }

  /** El aura toma el color del agente perseguido: se ve a quién va sin leer el HUD. */
  setTargetIndicator(uid, players) {
    if (this.targetUid === uid) return;
    this.targetUid = uid;

    const target = players.find(p => p.uid === uid);
    const color = target ? PLAYER_COLORS[target.index % PLAYER_COLORS.length] : 0xff0044;
    this.ringMat.color.setHex(color);
  }

  animateIdle(delta) {
    const time = Date.now() * 0.003;
    this.coreMesh.position.y = 1.6 + Math.sin(time * 2) * 0.25;
    this.ringMesh.rotation.z += delta * 1.5;
    this.ringMesh.rotation.y += delta * 0.8;
  }

  /**
   * Lógica autoritativa del host.
   *
   * @param {number} delta
   * @param {Array<{uid, index, position, health, alive, onPlate}>} players
   * @param {Array<THREE.Box3>} obstacleBoxes
   * @param {(targetUid: string, amount: number) => void} onDamage
   */
  update(delta, players = [], obstacleBoxes = [], onDamage) {
    this.animateIdle(delta);

    const target = this.targetSelector.update(players, this.mesh.position, delta);
    if (!target) return null;

    this.setTargetIndicator(target.uid, players);
    this.moveTowards(target.position, delta, obstacleBoxes);

    if (this.damageCooldown > 0) {
      this.damageCooldown -= delta;
    } else if (this.mesh.position.distanceTo(target.position) < ATTACK_RANGE) {
      this.damageCooldown = ATTACK_COOLDOWN;
      // El uid identifica a la víctima: antes el daño se atribuía siempre al host.
      if (onDamage) onDamage(target.uid);
    }

    return target.uid;
  }

  /**
   * Avanza hacia el objetivo directamente.
   * El fantasma traspasa los muros y obstáculos geométricos.
   */
  moveTowards(targetPosition, delta, obstacleBoxes) {
    const direction = new THREE.Vector3(
      targetPosition.x - this.mesh.position.x,
      0,
      targetPosition.z - this.mesh.position.z
    );
    if (direction.lengthSq() < 0.01) return;
    direction.normalize();

    const distance = this.speed * delta;
    const baseAngle = Math.atan2(direction.x, direction.z);

    const step = direction.multiplyScalar(distance);
    this.mesh.position.add(step);
    this.mesh.rotation.y = baseAngle;
  }

  destroy() {
    this.scene.remove(this.mesh);
    this.mesh.traverse(child => {
      if (child.geometry) child.geometry.dispose();
      if (child.material) child.material.dispose();
    });
  }
}
