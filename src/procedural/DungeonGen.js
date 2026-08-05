import * as THREE from 'three';

const LEVEL_THEMES = [
  { name: 'CÍAN CYBER', color: 0x00f3ff, bg: 0x060812, wall: 0x13172b },
  { name: 'MAGENTA SYNTH', color: 0xff0077, bg: 0x12060e, wall: 0x2b1320 },
  { name: 'MATRIX ESMERALDA', color: 0x00ff66, bg: 0x05120a, wall: 0x132b1a },
  { name: 'ÁMBAR IMPERIAL', color: 0xffaa00, bg: 0x120e05, wall: 0x2b2213 },
  { name: 'PÚRPURA CÓSMICO', color: 0x9d00ff, bg: 0x0c0512, wall: 0x20132b }
];

export class DungeonGenerator {
  constructor(scene) {
    this.scene = scene;
    this.dungeonGroup = new THREE.Group();
    this.scene.add(this.dungeonGroup);
    this.obstacleBoxes = [];
  }

  clear() {
    while (this.dungeonGroup.children.length > 0) {
      const obj = this.dungeonGroup.children[0];
      if (obj.geometry) obj.geometry.dispose();
      if (obj.material) {
        if (Array.isArray(obj.material)) obj.material.forEach(m => m.dispose());
        else obj.material.dispose();
      }
      this.dungeonGroup.remove(obj);
    }
    this.obstacleBoxes = [];
  }

  generateLevel(levelNum = 1, seedOffset = 0) {
    this.clear();

    const theme = LEVEL_THEMES[(levelNum - 1) % LEVEL_THEMES.length];
    const seed = Math.floor(Math.abs(Math.sin((levelNum + seedOffset * 100) * 9999) * 10000));

    // Room dimensions vary procedurally
    const sizeX = Math.min(18 + (levelNum % 3) * 4, 34);
    const sizeZ = Math.min(18 + Math.floor(levelNum / 2) * 4, 34);

    const halfX = sizeX / 2;
    const halfZ = sizeZ / 2;

    // Floor Mesh
    const floorGeo = new THREE.PlaneGeometry(sizeX, sizeZ);
    floorGeo.rotateX(-Math.PI / 2);

    const floorMat = new THREE.MeshStandardMaterial({
      color: theme.bg,
      roughness: 0.3,
      metalness: 0.8
    });

    const floor = new THREE.Mesh(floorGeo, floorMat);
    floor.receiveShadow = true;
    this.dungeonGroup.add(floor);

    // Dynamic Floor Grid Pattern with Theme Color
    const gridHelper = new THREE.GridHelper(Math.max(sizeX, sizeZ), Math.max(sizeX, sizeZ), theme.color, 0x222a45);
    gridHelper.position.y = 0.02;
    this.dungeonGroup.add(gridHelper);

    // Wall Material
    const wallMat = new THREE.MeshStandardMaterial({
      color: theme.wall,
      roughness: 0.3,
      metalness: 0.8
    });

    const wallHeight = 4.0;
    const wallThickness = 0.8;

    const createWall = (x, z, width, depth) => {
      const wallGeo = new THREE.BoxGeometry(width, wallHeight, depth);
      const wall = new THREE.Mesh(wallGeo, wallMat);
      wall.position.set(x, wallHeight / 2, z);
      wall.castShadow = true;
      wall.receiveShadow = true;
      this.dungeonGroup.add(wall);

      // Add Top Glowing Trim
      const trimGeo = new THREE.BoxGeometry(width + 0.05, 0.2, depth + 0.05);
      const trimMat = new THREE.MeshBasicMaterial({ color: theme.color });
      const trim = new THREE.Mesh(trimGeo, trimMat);
      trim.position.set(x, wallHeight + 0.1, z);
      this.dungeonGroup.add(trim);

      this.obstacleBoxes.push(new THREE.Box3().setFromObject(wall));
    };

    // Boundary Outer Walls
    createWall(0, -halfZ - wallThickness/2, sizeX + wallThickness*2, wallThickness);
    createWall(0, halfZ + wallThickness/2, sizeX + wallThickness*2, wallThickness);
    createWall(-halfX - wallThickness/2, 0, wallThickness, sizeZ);
    createWall(halfX + wallThickness/2, 0, wallThickness, sizeZ);

    // Procedural Internal Maze Walls based on seed
    const wallCount = 3 + Math.floor(levelNum * 1.2);
    for (let i = 0; i < wallCount; i++) {
      const isHorizontal = Math.sin(seed + i * 17) > 0;
      const wx = Math.floor(Math.sin(seed + i * 31) * (halfX - 5));
      const wz = Math.floor(Math.cos(seed + i * 47) * (halfZ - 5));

      const wLength = 4 + (i % 3) * 2;
      const wWidth = isHorizontal ? wLength : 1.2;
      const wDepth = isHorizontal ? 1.2 : wLength;

      // Construct a theoretical Box3 for the wall to test overlaps
      const wallBox = new THREE.Box3().setFromCenterAndSize(
        new THREE.Vector3(wx, wallHeight / 2, wz),
        new THREE.Vector3(wWidth, wallHeight, wDepth)
      );

      // Define exclusion zones for spawn and exit
      const spawnBox = new THREE.Box3().setFromCenterAndSize(
        new THREE.Vector3(0, wallHeight / 2, halfZ - 3),
        new THREE.Vector3(8, wallHeight, 8) // 8x8 exclusion area
      );

      const exitBox = new THREE.Box3().setFromCenterAndSize(
        new THREE.Vector3(0, wallHeight / 2, -halfZ + 2),
        new THREE.Vector3(8, wallHeight, 8)
      );

      // Check if wall overlaps with crucial zones
      if (wallBox.intersectsBox(spawnBox) || wallBox.intersectsBox(exitBox)) {
        continue;
      }
      
      // Also protect the very center (0,0) just in case
      if (Math.abs(wx) < 2 && Math.abs(wz) < 2) continue;

      createWall(wx, wz, wWidth, wDepth);
    }

    return {
      seed,
      theme,
      sizeX,
      sizeZ,
      spawnPos: new THREE.Vector3(0, 0, halfZ - 3),
      exitPos: new THREE.Vector3(0, 0, -halfZ + 2),
      obstacleBoxes: this.obstacleBoxes
    };
  }
}
