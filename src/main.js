import * as THREE from 'three';
import { EngineRenderer } from './engine/Renderer.js';
import { EngineCamera } from './engine/Camera.js';
import { EngineLighting } from './engine/Lighting.js';
import { EngineInput } from './engine/Input.js';
import { PlayerEntity } from './entities/Player.js';
import { GhostEnemyEntity } from './entities/GhostEnemy.js';
import { DungeonGenerator } from './procedural/DungeonGen.js';
import { PuzzleGenerator } from './procedural/PuzzleGen.js';
import { SoundEngine } from './audio/SoundEngine.js';
import { SocketClient } from './network/SocketClient.js';
import { UIManager } from './ui/Menu.js';

class GameApp {
  constructor() {
    this.container = document.getElementById('canvas-container');
    
    // Core Engine Subsystems
    this.renderer = new EngineRenderer(this.container);
    this.camera = new EngineCamera();
    this.lighting = new EngineLighting(this.renderer.scene);
    this.input = new EngineInput();

    // Procedural Generators
    this.dungeonGen = new DungeonGenerator(this.renderer.scene);
    this.puzzleGen = new PuzzleGenerator(this.renderer.scene);
    
    // Audio Engine
    this.soundEngine = new SoundEngine();

    // Network & UI
    this.socketClient = new SocketClient();
    this.uiManager = new UIManager(this.socketClient, (level, playersCount) => this.startLevel(level, playersCount), this.soundEngine);
    this.uiManager.onRespawnCallback = () => this.respawnLocalPlayer();

    // Game Entities
    this.playersMap = new Map();
    this.localPlayer = null;
    this.ghostEnemy = null;
    this.playerHealth = 100;

    this.currentLevel = 1;
    this.activePlayersCount = 1;
    this.retryCount = 0;
    this.seedOffset = 0;
    this.clock = new THREE.Clock();
    this.isGameRunning = false;

    this.renderer.onResizeCallback = (w, h) => this.camera.updateAspect(w, h);

    // Setup Network Event Handlers
    this.setupNetworkEvents();

    // Main Game Loop
    this.animate();
  }

  setupNetworkEvents() {
    // Other player moved
    this.socketClient.onPlayerMoved(({ id, position, rotationY, health }) => {
      const player = this.playersMap.get(id);
      if (player) {
        player.setPosition(position.x, position.y, position.z);
        player.mesh.rotation.y = rotationY;
      }
    });

    // Ghost enemy position synced from Host
    this.socketClient.onGhostMoved(({ position }) => {
      if (this.ghostEnemy && (!this.socketClient.localPlayer || !this.socketClient.localPlayer.isHost)) {
        this.ghostEnemy.mesh.position.set(position.x, position.y, position.z);
      }
    });

    // Player damage update
    this.socketClient.onUpdateHealth(({ playerId, health }) => {
      if (this.socketClient.socket.id === playerId) {
        this.playerHealth = health;
        this.uiManager.updateHealth(health);
      }
    });

    // Next level triggered by server
    this.socketClient.onNextLevel(({ level, playersCount }) => {
      this.currentLevel = level;
      this.uiManager.showLevelCompleteModal();
      setTimeout(() => {
        this.startLevel(level, playersCount);
      }, 2000);
    });
  }

  regenerateLevel() {
    this.seedOffset++;
    this.retryCount = 0;
    this.startLevel(this.currentLevel, this.activePlayersCount, true);
  }

  startLevel(levelNum, playersCount = 1, isRegenerate = false) {
    if (!isRegenerate) {
      this.seedOffset = 0;
      this.retryCount = 0;
    }

    this.currentLevel = levelNum;
    this.activePlayersCount = playersCount || (this.socketClient.currentRoom ? this.socketClient.currentRoom.players.length : 1);
    this.isGameRunning = true;
    this.playerHealth = 100;
    this.lastPuzzleSolvedState = false;
    this.uiManager.updateHealth(100);
    this.soundEngine.startBGM();

    // 1. Generate Procedural Dungeon
    const dungeonInfo = this.dungeonGen.generateLevel(levelNum, this.seedOffset);
    this.lighting.setupCornerLights(dungeonInfo.sizeX, dungeonInfo.sizeZ, dungeonInfo.theme.color);
    this.uiManager.updateSeed(dungeonInfo.seed, dungeonInfo.theme.name);

    // 2. Generate Procedural Puzzle Matched EXACTLY to Connected Players Count
    const puzzleInfo = this.puzzleGen.generatePuzzle(levelNum, dungeonInfo, this.activePlayersCount);

    // 3. Setup Stalker Ghost Enemy with level speed scaling
    if (this.ghostEnemy) this.ghostEnemy.destroy();
    this.ghostEnemy = new GhostEnemyEntity(this.renderer.scene);
    this.ghostEnemy.setSpeedForLevel(levelNum);
    this.ghostEnemy.spawnAt(0, -dungeonInfo.sizeZ / 2 + 5);

    // 4. Update HUD
    this.uiManager.showHUD(levelNum, this.activePlayersCount);
    this.uiManager.updateObjective(
      this.puzzleGen.requiredPlateCount === 1
        ? this.uiManager.i18n.t('solo_objective')
        : (this.puzzleGen.requiredPlateCount === 2 ? this.uiManager.i18n.t('duo_objective') : this.uiManager.i18n.t('squad_objective')),
      0,
      false
    );

    // 5. Setup Players
    this.setupPlayers(dungeonInfo.spawnPos);
  }

  setupPlayers(spawnPos) {
    this.playersMap.forEach(p => this.renderer.scene.remove(p.mesh));
    this.playersMap.clear();

    const room = this.socketClient.currentRoom;
    if (room && room.players) {
      room.players.forEach((p, idx) => {
        const isLocal = p.id === this.socketClient.socket.id;
        const playerEntity = new PlayerEntity(p.id, p.name, idx, isLocal);
        
        playerEntity.setPosition(
          spawnPos.x + (idx - 1) * 1.5,
          spawnPos.y,
          spawnPos.z
        );

        this.renderer.scene.add(playerEntity.mesh);
        this.playersMap.set(p.id, playerEntity);

        if (isLocal) {
          this.localPlayer = playerEntity;
        }
      });
    } else {
      const localP = new PlayerEntity('local', 'SoloAgent', 0, true);
      localP.setPosition(spawnPos.x, spawnPos.y, spawnPos.z);
      this.renderer.scene.add(localP.mesh);
      this.playersMap.set('local', localP);
      this.localPlayer = localP;
    }
  }

  respawnLocalPlayer() {
    this.playerHealth = 100;
    this.uiManager.updateHealth(100);
    this.isGameRunning = true;
    if (this.localPlayer) {
      this.localPlayer.setPosition(0, 0, 8);
    }
  }

  stopGameLoop() {
    this.isGameRunning = false;
    this.currentLevel = 1;
    this.dungeonGen.clear();
    this.puzzleGen.clear();
    if (this.ghostEnemy) {
      this.ghostEnemy.destroy();
      this.ghostEnemy = null;
    }
    this.playersMap.forEach(p => this.renderer.scene.remove(p.mesh));
    this.playersMap.clear();
    this.localPlayer = null;
    this.soundEngine.stopBGM();
  }

  animate() {
    requestAnimationFrame(() => this.animate());

    const delta = this.clock.getDelta();

    if (this.isGameRunning && this.localPlayer && this.playerHealth > 0 && !this.uiManager.state.isPaused) {
      // 1. Handle Local Input Movement with smooth wall sliding
      const moveVec = this.input.getMovementVector();
      this.localPlayer.update(delta, moveVec, this.dungeonGen.obstacleBoxes);

      // 2. Send Movement & Health to Server
      const pos = this.localPlayer.getPosition();
      this.socketClient.sendMove(
        { x: pos.x, y: pos.y, z: pos.z },
        this.localPlayer.mesh.rotation.y,
        this.playerHealth
      );

      // 3. Camera follow local player
      this.camera.follow(pos);

      // 4. Collect all player positions for Ghost AI & Puzzle
      const playerPositions = [];
      this.playersMap.forEach(p => playerPositions.push(p.getPosition()));

      // 5. Update Ghost Enemy AI
      if (this.ghostEnemy) {
        const isHost = !this.socketClient.currentRoom || (this.socketClient.localPlayer && this.socketClient.localPlayer.isHost);
        if (isHost) {
          this.ghostEnemy.update(delta, playerPositions, (damageAmount) => {
            this.playerHealth = Math.max(0, this.playerHealth - damageAmount);
            this.uiManager.updateHealth(this.playerHealth);
            this.socketClient.sendDamage(this.socketClient.socket.id, this.playerHealth);
            this.soundEngine.playDamage();
            if (this.playerHealth === 0) {
              this.isGameRunning = false;
              this.retryCount++;
              if (this.retryCount >= 3) {
                if (this.uiManager.showRegenerateButton) {
                  this.uiManager.showRegenerateButton();
                }
              }
            }
          });
          this.socketClient.sendGhostMove(this.ghostEnemy.mesh.position);
        }
      }

      // 6. Update Puzzle State
      const puzzleResult = this.puzzleGen.update(playerPositions);
      
      // Check if newly solved this frame to play unlock sound
      if (puzzleResult.solved && !this.lastPuzzleSolvedState) {
        this.soundEngine.playUnlock();
      }
      this.lastPuzzleSolvedState = puzzleResult.solved;

      this.uiManager.updateObjective(
        this.puzzleGen.requiredPlateCount === 1 
          ? this.uiManager.i18n.t('solo_objective')
          : (this.puzzleGen.requiredPlateCount === 2 ? this.uiManager.i18n.t('duo_objective') : this.uiManager.i18n.t('squad_objective')),
        puzzleResult.progressPercent || 0,
        puzzleResult.solved
      );

      // 7. Check Level Complete Exit Condition
      if (puzzleResult.solved && this.puzzleGen.exitDoor) {
        if (this.puzzleGen.exitDoor.checkCollision(pos)) {
          this.isGameRunning = false;
          this.socketClient.notifyLevelComplete();
        }
      }
    }

    // Render Scene
    this.renderer.render(this.camera.camera);
  }
}

// Instantiate Game on DOM Content Loaded
window.addEventListener('DOMContentLoaded', () => {
  const game = new GameApp();
  window.gameApp = game;
  window.stopGameLoop = () => game.stopGameLoop();
  window.regenerateMap = () => game.regenerateLevel();
});
