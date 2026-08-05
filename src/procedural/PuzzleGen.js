import * as THREE from 'three';
import { PuzzleElement } from '../entities/PuzzleElement.js';

export class PuzzleGenerator {
  constructor(scene) {
    this.scene = scene;
    this.elements = [];
    this.beacons = [];
    this.exitDoor = null;
    this.requiredPlateCount = 1;
    this.activePlates = new Set();
    this.puzzleSolved = false;
  }

  clear() {
    this.elements.forEach(elem => {
      if (elem.mesh) this.scene.remove(elem.mesh);
    });
    this.beacons.forEach(b => this.scene.remove(b));
    this.elements = [];
    this.beacons = [];
    this.exitDoor = null;
    this.activePlates.clear();
    this.puzzleSolved = false;
  }

  generatePuzzle(levelNum, dungeonInfo, activePlayersCount = 1) {
    this.clear();

    const { sizeX, sizeZ, exitPos, theme } = dungeonInfo;
    const halfX = sizeX / 2;
    const halfZ = sizeZ / 2;

    // 1. Create Exit Door Barrier at exitPos
    this.exitDoor = new PuzzleElement('door', exitPos.x, exitPos.z);
    this.scene.add(this.exitDoor.mesh);
    this.elements.push(this.exitDoor);

    // Add glowing beacon above Exit Door
    const exitBeaconGeo = new THREE.CylinderGeometry(0.1, 0.4, 8, 16);
    const exitBeaconMat = new THREE.MeshBasicMaterial({ color: 0xff0055, transparent: true, opacity: 0.4 });
    const exitBeacon = new THREE.Mesh(exitBeaconGeo, exitBeaconMat);
    exitBeacon.position.set(exitPos.x, 4, exitPos.z);
    
    // HIDE INITIALLY
    this.exitDoor.mesh.visible = false;
    exitBeacon.visible = false;
    
    this.scene.add(exitBeacon);
    this.beacons.push(exitBeacon);
    this.exitBeacon = exitBeacon;

    // 2. Set Plate Count EXCLUSIVELY matched to connected players!
    // Solo player = 1 plate
    // 2 players = 2 plates
    // 3 players = 3 plates
    this.requiredPlateCount = Math.max(1, Math.min(activePlayersCount, 3));

    // Position pressure plates randomly across the room
    const themeColor = theme ? theme.color : 0x00f3ff;

    for (let i = 0; i < this.requiredPlateCount; i++) {
      let px, pz, isValid = false;
      let attempts = 0;
      const plateBox = new THREE.Box3();

      while (!isValid && attempts < 100) {
        attempts++;
        px = Math.floor((Math.sin(i * 43 + levelNum * 77 + attempts * 19) * (halfX - 4)));
        pz = Math.floor((Math.cos(i * 83 + levelNum * 31 + attempts * 13) * (halfZ - 5)));

        // Ensure minimum distance from spawn (0, halfZ-3) and exit (0, -halfZ+2)
        const distToCenter = Math.hypot(px, pz - (halfZ - 3));
        const distToExit = Math.hypot(px, pz - (-halfZ + 2));
        
        if (distToCenter > 4 && distToExit > 4) {
          // Check collision with walls
          plateBox.setFromCenterAndSize(new THREE.Vector3(px, 0.5, pz), new THREE.Vector3(2.5, 2.0, 2.5));
          let collides = false;
          if (dungeonInfo.obstacleBoxes) {
            for (const obs of dungeonInfo.obstacleBoxes) {
              if (plateBox.intersectsBox(obs)) {
                collides = true;
                break;
              }
            }
          }
          if (!collides) {
            isValid = true;
          }
        }
      }

      const plate = new PuzzleElement('plate', px, pz, { id: i });
      this.scene.add(plate.mesh);
      this.elements.push(plate);

      // Light Beacon Pillar over Plate for clear visibility!
      const beaconGeo = new THREE.CylinderGeometry(0.08, 0.5, 6, 16);
      const beaconMat = new THREE.MeshBasicMaterial({ color: themeColor, transparent: true, opacity: 0.5 });
      const beacon = new THREE.Mesh(beaconGeo, beaconMat);
      beacon.position.set(px, 3, pz);
      this.scene.add(beacon);
      this.beacons.push(beacon);
    }

    let objectiveText = "";
    if (this.requiredPlateCount === 1) {
      objectiveText = "SOLO MISSION: Mantén presionada la placa de presión de la sala para abrir la compuerta.";
    } else if (this.requiredPlateCount === 2) {
      objectiveText = "MISIÓN DE DÚO: Ambos agentes deben presionar las 2 placas de presión al mismo tiempo.";
    } else {
      objectiveText = "MISIÓN DE ESCUADRÓN: Los 3 agentes deben coordinar y presionar las 3 placas simultáneamente.";
    }

    return {
      requiredCount: this.requiredPlateCount,
      objectiveText,
      exitPos
    };
  }

  update(playerPositions = []) {
    if (this.puzzleSolved) return { solved: true };

    const currentActive = new Set();

    // Check pressure plates against all active player positions
    this.elements.forEach(elem => {
      if (elem.type === 'plate') {
        let isPressed = false;
        for (const pos of playerPositions) {
          if (elem.checkCollision(pos)) {
            isPressed = true;
            break;
          }
        }

        elem.setActive(isPressed);
        if (isPressed) {
          if (!this.activePlates.has(elem.options.id)) {
            // Newly pressed plate, emit sound
            if (window.gameApp && window.gameApp.soundEngine) {
              window.gameApp.soundEngine.playPlateTrigger();
            }
          }
          currentActive.add(elem.options.id);
        }
      }
    });

    this.activePlates = currentActive;
    const progressPercent = (this.activePlates.size / this.requiredPlateCount) * 100;

    // Check Win Condition
    if (this.activePlates.size >= this.requiredPlateCount) {
      this.puzzleSolved = true;
      if (this.exitDoor) {
        this.exitDoor.mesh.visible = true;
        this.exitDoor.setActive(true);
      }
      if (this.exitBeacon) {
        this.exitBeacon.visible = true;
      }
      return { solved: true, progressPercent: 100 };
    }

    return { solved: false, progressPercent, activeCount: this.activePlates.size };
  }
}
