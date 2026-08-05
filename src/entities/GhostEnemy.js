import * as THREE from 'three';

export class GhostEnemyEntity {
  constructor(scene) {
    this.scene = scene;
    this.speed = 2.5; // Base speed
    this.damageCooldown = 0;

    // Create 3D Phantom Mesh Group
    this.mesh = new THREE.Group();

    // Phantom Core (Floating Crimson Crystal/Orb)
    const coreGeo = new THREE.OctahedronGeometry(0.7, 2);
    const coreMat = new THREE.MeshStandardMaterial({
      color: 0xff0033,
      emissive: 0xff0022,
      emissiveIntensity: 1.5,
      roughness: 0.1,
      transparent: true,
      opacity: 0.85
    });
    this.coreMesh = new THREE.Mesh(coreGeo, coreMat);
    this.coreMesh.position.y = 1.6;
    this.mesh.add(this.coreMesh);

    // Phantom Ring Aura
    const ringGeo = new THREE.TorusGeometry(1.0, 0.08, 16, 32);
    const ringMat = new THREE.MeshBasicMaterial({ color: 0xff0044, wireframe: true });
    this.ringMesh = new THREE.Mesh(ringGeo, ringMat);
    this.ringMesh.position.y = 1.6;
    this.ringMesh.rotation.x = Math.PI / 3;
    this.mesh.add(this.ringMesh);

    // Dynamic Red Danger Point Light
    this.light = new THREE.PointLight(0xff0033, 2.5, 10);
    this.light.position.set(0, 1.8, 0);
    this.mesh.add(this.light);

    // Initial position
    this.mesh.position.set(0, 0, -10);
    this.scene.add(this.mesh);
  }

  setSpeedForLevel(levelNum) {
    // Speed increases progressively with each solved level, up to a maximum of 8.0
    // Player speed is 8.5, so at max level it is almost as fast as the player!
    this.speed = Math.min(8.0, 2.5 + (levelNum - 1) * 0.4);
  }

  spawnAt(x, z) {
    this.mesh.position.set(x, 0, z);
  }

  update(delta, playerPositions = [], onDamagePlayerCallback) {
    if (!playerPositions || playerPositions.length === 0) return;

    // Floating idle animation
    const time = Date.now() * 0.003;
    this.coreMesh.position.y = 1.6 + Math.sin(time * 2) * 0.25;
    this.ringMesh.rotation.z += delta * 1.5;
    this.ringMesh.rotation.y += delta * 0.8;

    // Find nearest player
    let nearestPos = null;
    let minDistance = Infinity;

    playerPositions.forEach(pos => {
      const dist = this.mesh.position.distanceTo(pos);
      if (dist < minDistance) {
        minDistance = dist;
        nearestPos = pos;
      }
    });

    if (nearestPos) {
      // Move towards nearest player
      const dir = nearestPos.clone().sub(this.mesh.position);
      dir.y = 0; // Keep on horizontal plane

      if (dir.lengthSq() > 0.01) {
        dir.normalize();
        this.mesh.position.add(dir.multiplyScalar(this.speed * delta));
      }

      // Check collision / attack distance
      if (this.damageCooldown > 0) {
        this.damageCooldown -= delta;
      } else if (minDistance < 1.3) {
        // Deal 20 Damage to Player Shield
        this.damageCooldown = 1.0; // 1 second attack cooldown
        if (onDamagePlayerCallback) {
          onDamagePlayerCallback(20);
        }
      }
    }
  }

  destroy() {
    if (this.mesh) {
      this.scene.remove(this.mesh);
    }
  }
}
