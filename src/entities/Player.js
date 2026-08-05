import * as THREE from 'three';

const PLAYER_COLORS = [0x00f3ff, 0xff0077, 0x00ff66]; // Cyan, Pink, Green for players 1, 2, 3

export class PlayerEntity {
  constructor(id, name, playerIndex = 0, isLocal = false) {
    this.id = id;
    this.name = name;
    this.playerIndex = playerIndex;
    this.isLocal = isLocal;
    this.speed = 8.5;

    this.colorHex = PLAYER_COLORS[playerIndex % PLAYER_COLORS.length];

    // Create 3D Mesh Container
    this.mesh = new THREE.Group();

    // Body (Low-poly Capsule / Cyber Bot)
    const bodyGeo = new THREE.CylinderGeometry(0.4, 0.3, 1.4, 8);
    const bodyMat = new THREE.MeshStandardMaterial({
      color: 0x111525,
      roughness: 0.3,
      metalness: 0.8
    });
    this.bodyMesh = new THREE.Mesh(bodyGeo, bodyMat);
    this.bodyMesh.position.y = 0.7;
    this.bodyMesh.castShadow = true;
    this.bodyMesh.receiveShadow = true;
    this.mesh.add(this.bodyMesh);

    // Head / Visor (Glowing Neon Color)
    const headGeo = new THREE.BoxGeometry(0.5, 0.4, 0.5);
    const headMat = new THREE.MeshStandardMaterial({
      color: this.colorHex,
      emissive: this.colorHex,
      emissiveIntensity: 0.8,
      roughness: 0.2
    });
    this.headMesh = new THREE.Mesh(headGeo, headMat);
    this.headMesh.position.set(0, 1.4, 0.1);
    this.headMesh.castShadow = true;
    this.mesh.add(this.headMesh);

    // Light ring under player
    const ringGeo = new THREE.RingGeometry(0.5, 0.65, 16);
    ringGeo.rotateX(-Math.PI / 2);
    const ringMat = new THREE.MeshBasicMaterial({
      color: this.colorHex,
      side: THREE.DoubleSide
    });
    this.ringMesh = new THREE.Mesh(ringGeo, ringMat);
    this.ringMesh.position.y = 0.02;
    this.mesh.add(this.ringMesh);

    // Dynamic Pointlight
    this.light = new THREE.PointLight(this.colorHex, 1.5, 6);
    this.light.position.set(0, 1.5, 0);
    this.mesh.add(this.light);
  }

  setPosition(x, y, z) {
    this.mesh.position.set(x, y, z);
  }

  getPosition() {
    return this.mesh.position;
  }

  checkCollisionAt(pos, obstacleBoxes, radius = 0.4) {
    for (const box of obstacleBoxes) {
      if (
        pos.x + radius > box.min.x &&
        pos.x - radius < box.max.x &&
        pos.z + radius > box.min.z &&
        pos.z - radius < box.max.z
      ) {
        return true; // Collision detected
      }
    }
    return false;
  }

  update(delta, moveVector, obstacleBoxes = []) {
    if (!moveVector || moveVector.lengthSq() === 0) return;

    const moveStep = moveVector.clone().multiplyScalar(this.speed * delta);
    const currentPos = this.mesh.position;
    
    // 1. Try full movement (dx, dz)
    const fullNextPos = currentPos.clone().add(moveStep);
    
    if (!this.checkCollisionAt(fullNextPos, obstacleBoxes)) {
      this.mesh.position.copy(fullNextPos);
    } else {
      // 2. Wall Sliding: Try moving X-axis only
      const xOnlyPos = currentPos.clone().add(new THREE.Vector3(moveStep.x, 0, 0));
      if (!this.checkCollisionAt(xOnlyPos, obstacleBoxes)) {
        this.mesh.position.copy(xOnlyPos);
      } else {
        // 3. Wall Sliding: Try moving Z-axis only
        const zOnlyPos = currentPos.clone().add(new THREE.Vector3(0, 0, moveStep.z));
        if (!this.checkCollisionAt(zOnlyPos, obstacleBoxes)) {
          this.mesh.position.copy(zOnlyPos);
        }
      }
    }

    // Smooth rotation facing move direction with Slerp lerping
    const targetAngle = Math.atan2(moveVector.x, moveVector.z);
    
    let diff = targetAngle - this.mesh.rotation.y;
    while (diff < -Math.PI) diff += Math.PI * 2;
    while (diff > Math.PI) diff -= Math.PI * 2;
    
    this.mesh.rotation.y += diff * Math.min(1.0, delta * 14.0);
  }
}
