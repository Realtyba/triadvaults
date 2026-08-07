import * as THREE from 'three';
import { EngineRenderer } from '../engine/Renderer.js';
import { EngineCamera } from '../engine/Camera.js';
import { EngineLighting } from '../engine/Lighting.js';
import { EngineInput } from '../engine/Input.js';
import { SoundEngine } from '../audio/SoundEngine.js';
import { SocketClient } from '../network/SocketClient.js';
import { UIManager } from '../ui/UIManager.js';
import { ParticleField } from '../engine/Particles.js';
import { AmbientScene } from './AmbientScene.js';
import { LevelController } from './LevelController.js';
import { PlayerRegistry } from './PlayerRegistry.js';
import { NetworkBridge } from './NetworkBridge.js';
import { GHOST_DAMAGE } from '../../shared/events.js';
import { falloff } from '../utils/math.js';
import { quality } from '../engine/QualitySettings.js';
import { PALETTE } from '../engine/materials.js';

const MOVE_SEND_HZ = 20;
const GHOST_SEND_HZ = 15;

export class GameApp {
  constructor(container) {
    this.renderer = new EngineRenderer(container);
    this.camera = new EngineCamera();
    this.lighting = new EngineLighting(this.renderer.scene);
    this.particles = new ParticleField(this.renderer.scene);
    this.input = new EngineInput();
    this.sound = new SoundEngine();

    // El postprocesado necesita la cámara, que no existe cuando se crea el renderer.
    this.renderer.attachPostFX(this.camera.camera);

    this.socket = new SocketClient();
    this.level = new LevelController(this.renderer.scene, this.lighting);
    this.players = new PlayerRegistry(this.renderer.scene);
    this.ui = new UIManager({ socket: this.socket, sound: this.sound, game: this });
    this.bridge = new NetworkBridge({ socket: this.socket, game: this, ui: this.ui });

    this.clock = new THREE.Clock();
    this.running = false;
    this.deathCount = 0;
    this.lastPuzzleSolved = false;
    this.moveAccumulator = 0;
    this.ghostAccumulator = 0;
    this.hudAccumulator = 0;

    this.ambient = new AmbientScene({
      scene: this.renderer.scene,
      renderer: this.renderer,
      lighting: this.lighting,
      particles: this.particles
    });

    this.renderer.onResizeCallback = (w, h) => this.camera.updateAspect(w, h);
    this.input.onGamepadAction = action => this.onGamepadAction(action);
    this.input.gamepad.onConnectionChange = name => this.ui.setGamepad(name);
    this.bridge.register();

    if (!this.renderer.isAvailable) this.ui.alert(this.ui.ctx.t('error_no_webgl'));
    else this.ambient.start();

    this.animate();
  }

  get isHost() {
    return this.socket.isHost;
  }

  // -------------------------------------------------------------- niveles

  /** Arranca un nivel con la semilla que dicta el servidor. */
  startLevel({ level, seed, seedOffset = 0, playersCount }) {
    const room = this.socket.currentRoom;
    const count = playersCount || (room ? room.players.length : 1);

    // La sala decorativa del menú y la de la partida no pueden convivir: comparten
    // escena, luces y partículas.
    this.ambient.stop();

    // Cada agente lleva su propio cazador asignado; el orden sale de la sala, que
    // es igual en todos los clientes, así que la asignación coincide para todos.
    const owners = room ? room.players.map(p => ({ uid: String(p.uid) })) : [];
    this.level.build({ level, seed, seedOffset, playersCount: count, owners });
    this.deathCount = 0;
    // El daño del nivel lo lleva el servidor cuando hay sala; sin ella no hay quien
    // lo cuente, y los logros de "sin recibir un golpe" necesitan saberlo.
    this.levelDamage = 0;
    this.lastPuzzleSolved = false;
    this.running = true;

    // Atmósfera y motas del tema del nivel: cada bioma es un sitio distinto.
    const theme = this.level.info.theme;
    this.renderer.setAtmosphere({ bg: theme.bg, color: theme.color, fogDensity: theme.fogDensity });
    this.particles.setupAmbient(this.level.info.sizeX, this.level.info.sizeZ, theme.color);
    this.camera.reset();

    if (room) {
      this.players.sync(room.players, this.socket.uid, index => this.level.spawnFor(index));
      this.players.placeAll(index => this.level.spawnFor(index));
    } else {
      this.players.createSolo(this.level.spawnFor(0));
    }

    this.sound.startBGM();
    this.ui.onLevelStarted({
      level,
      playersCount: count,
      seedLabel: this.level.info.seedLabel,
      themeName: theme.name,
      themeColor: theme.color,
      roomCode: this.socket.roomCode,
      requiredPlates: this.level.puzzle.requiredPlateCount,
      objectiveKey: this.level.puzzle.objectiveKey,
      puzzleKind: this.level.puzzle.kind,
      health: this.localHealth()
    });
  }

  /** Reconstruye el nivel manteniendo a los jugadores (regeneración por atasco). */
  regenerateLevel({ level, seed, seedOffset }) {
    this.startLevel({
      level: level ?? this.level.level,
      seed: seed ?? this.level.seed,
      seedOffset: seedOffset ?? this.level.seedOffset + 1,
      playersCount: this.level.playersCount
    });
  }

  stop() {
    this.running = false;
    this.level.clear();
    this.players.clear();
    this.particles.clearAmbient();
    this.sound.stopBGM();

    // Volver al menú devuelve la escena decorativa: sin ella se quedaba una
    // pantalla negra detrás de la interfaz.
    if (this.renderer.isAvailable) this.ambient.start();
  }

  // ------------------------------------------------------ estado jugador

  localHealth() {
    const local = this.players.local;
    return local ? local.health : 100;
  }

  /** Aplica la vida que dicta el servidor (única autoridad sobre el daño). */
  applyHealth(uid, health, alive) {
    const entity = this.players.get(uid);
    if (!entity) return;

    const previousHealth = entity.health;
    const tookDamage = health < entity.health;
    entity.health = health;
    entity.setAlive(alive !== false && health > 0);

    // El impacto se ve en cualquier agente, no solo en el local: así se entiende
    // a quién está atacando el fantasma sin tener que mirar las barras de vida.
    if (tookDamage) {
      this.particles.burst(entity.getPosition(), 0xff0033, { spread: 4 });
    }

    if (String(uid) !== String(this.players.localUid)) return;

    if (tookDamage) {
      this.levelDamage += Math.max(0, previousHealth - health);
      this.sound.playDamage();
      this.camera.addShake(0.55);
      this.renderer.flash(0.8, 0xff0033);
    }
    this.ui.setHealth(health);

    if (!entity.alive) {
      this.deathCount += 1;
      this.camera.addShake(1);
      this.ui.onLocalDeath(this.deathCount);
    }
  }

  /** Reaparición autorizada por el servidor, en una celda libre distinta cada vez. */
  respawn(uid, health, spawnIndex, shieldMs = 0) {
    const entity = this.players.get(uid);
    if (!entity) return;

    const spawn = this.level.spawnFor(spawnIndex);
    entity.setPosition(spawn.x, 0, spawn.z);
    entity.health = health;
    entity.setAlive(true);
    entity.setShield(shieldMs);

    const themeColor = this.level.info ? this.level.info.theme.color : 0x00f3ff;
    this.particles.burst(entity.getPosition(), themeColor, { spread: 3, up: 4, count: 24 });

    if (String(uid) === String(this.players.localUid)) {
      this.ui.setHealth(health);
      this.ui.onLocalRespawn();
      this.camera.reset();
    }
  }

  syncRoomPlayers(room) {
    if (!room || !this.running) return;
    this.players.sync(room.players, this.socket.uid, index => this.level.spawnFor(index));

    // Entra o sale alguien a mitad de partida: se reparten los cazadores otra vez,
    // o el recién llegado se quedaría sin perseguidor y sobraría uno huérfano.
    this.level.syncGhostOwners(room.players.map(p => ({ uid: String(p.uid) })));
  }

  applyRemoteTransform(uid, position, rotationY) {
    const entity = this.players.get(uid);
    if (entity && !entity.isLocal) entity.setNetworkTransform(position, rotationY);
  }

  /**
   * Estado de todos los fantasmas, tal como lo manda el host.
   *
   * Llega un lote por paquete en vez de un evento por fantasma: son quince envíos
   * por segundo y multiplicarlos por tres no aportaba nada.
   */
  applyGhostStates(ghosts = []) {
    if (this.isHost || this.level.ghosts.length === 0) return;

    // La instantánea solo hace falta si algún fantasma ha cambiado de presa: es un
    // recorrido de todos los agentes y antes se hacía en cada paquete solo para
    // repintar un color que casi nunca cambia.
    let snapshot = null;

    ghosts.forEach(state => {
      const ghost = this.level.ghosts[state.id];
      if (!ghost) return;

      ghost.setPosition(state.position);
      if (ghost.targetUid !== state.targetUid) {
        if (!snapshot) snapshot = this.players.snapshot();
        ghost.setTargetIndicator(state.targetUid, snapshot);
      }
    });
  }

  // ------------------------------------------------------------- el bucle

  animate() {
    requestAnimationFrame(() => this.animate());
    const delta = Math.min(this.clock.getDelta(), 0.1);

    // El mando se lee siempre, no solo cuando se simula: en pausa hace falta para
    // poder reanudar, y muerto para pedir la reaparición.
    this.input.update();

    if (this.canSimulate()) this.step(delta);
    this.ambient.update(delta, this.camera.camera);

    // Luces y partículas siguen vivas en pausa y durante la reconexión: congelar
    // la imagen entera hace pensar que el juego se ha colgado.
    this.lighting.update(delta);
    this.particles.update(delta);

    this.renderer.render(this.camera.camera, delta);
  }

  /**
   * Botones del mando que no son movimiento.
   *
   * Se resuelven contra la interfaz y no contra la simulación porque es lo que
   * hacen sus equivalentes de teclado: Start es Escape, y el botón de reaparecer
   * pulsa el mismo botón del modal de caída.
   */
  onGamepadAction(action) {
    if (action === 'pause') this.ui.togglePause();
    else if (action === 'respawn' && this.players.local && !this.players.local.alive) {
      this.ui.requestRespawn();
    }
  }

  /** Sin conexión no se simula: antes el juego seguía corriendo contra el vacío. */
  canSimulate() {
    if (!this.running || !this.level.info) return false;
    if (this.ui.isPaused || this.ui.isReconnecting) return false;
    return this.socket.currentRoom ? this.socket.isConnected : true;
  }

  step(delta) {
    const local = this.players.local;
    if (local) {
      if (local.alive) {
        local.update(delta, this.input.getMovementVector(), this.level.obstacleBoxes);
        this.throttledSendMove(delta, local);
      }
      this.camera.follow(local.getPosition(), delta);
    }

    this.players.updateRemotes(delta);
    this.players.list().forEach(entity => entity.updateShieldVisual());

    const snapshot = this.players.snapshot(this.isOnPlateBound || (this.isOnPlateBound = pos => this.level.isPlayerOnPlate(pos)));
    this.updateGhosts(delta, snapshot);
    this.updatePuzzle(snapshot, local, delta);
    this.updateTension(delta, local);
    this.throttledHudUpdate(delta);
  }

  /** Timer y modo de entrada se actualizan a ~2 Hz: no merece la pena más rápido. */
  throttledHudUpdate(delta) {
    this.hudAccumulator += delta;
    if (this.hudAccumulator < 0.5) return;
    this.hudAccumulator = 0;

    this.ui.store.patch({
      elapsedTime: this.level.elapsedSeconds,
      hasGamepad: this.input.hasGamepad
    });
  }

  /** Distancia a la que el fantasma empieza a notarse en la música. */
  static TENSION_RANGE = 18;

  /** A partir de aquí, además, la cámara empieza a temblar. */
  static DREAD_SHAKE_RANGE = 4;

  /**
   * Traduce la cercanía del fantasma en tensión sonora.
   *
   * Se recalcula a ~5 Hz, no en cada fotograma: los parámetros de audio ya se
   * suavizan solos y actualizarlos 60 veces por segundo no cambia nada de lo que
   * se oye, solo gasta.
   */
  updateTension(delta, local) {
    // La sacudida por cercanía sí va por fotograma: a 5 Hz se sentiría como tirones.
    this.updateProximityShake(delta, local);

    this.tensionAccumulator = (this.tensionAccumulator || 0) + delta;
    if (this.tensionAccumulator < 0.2) return;
    this.tensionAccumulator = 0;

    if (!local || !local.alive) {
      this.sound.setTension(0);
      this.sound.setHeartbeat(0);
      this.renderer.setDread(0);
      return;
    }

    const distance = this.nearestGhostDistance(local.getPosition());
    const proximity = falloff(distance, GameApp.TENSION_RANGE);
    const tension = proximity * proximity; // al cuadrado: solo aprieta de cerca

    this.sound.setTension(tension);
    // El latido acompaña a la música en vez de sustituirla: es la señal que se
    // percibe antes de llegar a ver de dónde viene la amenaza.
    this.sound.setHeartbeat(proximity);
    this.renderer.setDread(tension);
  }

  /** Distancia al fantasma más cercano. Con varios, manda el que más aprieta. */
  nearestGhostDistance(position) {
    let nearest = Infinity;
    for (const ghost of this.level.ghosts) {
      const distance = ghost.mesh.position.distanceTo(position);
      if (distance < nearest) nearest = distance;
    }
    return nearest;
  }

  /** A bocajarro la cámara tiembla. Antes solo temblaba al recibir un golpe. */
  updateProximityShake(delta, local) {
    if (!local || !local.alive || this.level.ghosts.length === 0) return;

    const distance = this.nearestGhostDistance(local.getPosition());
    if (distance > GameApp.DREAD_SHAKE_RANGE) return;

    const closeness = falloff(distance, GameApp.DREAD_SHAKE_RANGE);
    this.camera.addShake(closeness * closeness * delta * 0.6);
  }

  throttledSendMove(delta, local) {
    this.moveAccumulator += delta;
    if (this.moveAccumulator < 1 / MOVE_SEND_HZ) return;
    this.moveAccumulator = 0;

    const pos = local.getPosition();
    this.socket.sendMove({ x: pos.x, y: pos.y, z: pos.z }, local.mesh.rotation.y);
  }

  updateGhosts(delta, snapshot) {
    const ghosts = this.level.ghosts;
    if (ghosts.length === 0) return;

    // Los clientes que no son el host solo interpolan lo que reciben, pero la
    // estela es cosmética y se genera en local: si solo la emitiese el host, el
    // fantasma se vería distinto según en qué pantalla lo mirases.
    if (!this.isHost) {
      ghosts.forEach(ghost => {
        ghost.updateRemote(delta);
        // Su presa la sabemos por el paquete, así que la luz puede latir aquí
        // igual que en la máquina del host en vez de quedarse en reposo.
        const prey = ghost.targetUid ? snapshot.find(p => p.uid === ghost.targetUid) : null;
        ghost.distanceToTarget = prey ? ghost.mesh.position.distanceTo(prey.position) : Infinity;
        this.emitGhostTrail(ghost, delta);
      });
      return;
    }

    const range = this.level.roomRange;
    const onHit = this.onGhostHitBound || (this.onGhostHitBound = uid => this.onGhostHit(uid));

    for (const ghost of ghosts) {
      const previous = ghost.targetUid;
      const targetUid = ghost.update(delta, snapshot, onHit, range);

      // Solo cuando el objetivo pasa a ser el jugador de esta pantalla: un aviso
      // que sonara con cada cambio ajeno dejaría de significar nada.
      if (targetUid !== previous && targetUid && targetUid === this.socket.uid) {
        this.sound.playTargetLocked();
        this.renderer.flash(0.25, PALETTE.DANGER);
      }

      this.emitGhostTrail(ghost, delta);
    }

    this.ghostAccumulator += delta;
    if (this.ghostAccumulator >= 1 / GHOST_SEND_HZ) {
      this.ghostAccumulator = 0;
      this.socket.sendGhostStates(ghosts);
    }
  }

  /**
   * Rastro de partículas.
   *
   * Reutiliza el pool de impactos con ráfagas mínimas y color casi negro: no es un
   * efecto nuevo, es el mismo sistema emitiendo poco y a menudo. Deja un reguero
   * que indica por dónde ha pasado algo aunque ya no lo tengas a la vista.
   */
  emitGhostTrail(ghost, delta) {
    if (!quality.get('ghostTrail')) return;

    ghost.trailAccumulator = (ghost.trailAccumulator || 0) + delta;
    if (ghost.trailAccumulator < 0.15) return;
    ghost.trailAccumulator = 0;

    this.particles.burst(ghost.mesh.position, 0x330011, { spread: 0.6, up: 0.4, count: 2 });
  }

  /** El host solo reporta el impacto; la vida resultante la calcula el servidor. */
  onGhostHit(targetUid) {
    if (this.socket.currentRoom) {
      this.socket.sendGhostHit(targetUid, GHOST_DAMAGE);
      return;
    }
    // Partida en solitario sin sala: se resuelve en local.
    const entity = this.players.get(targetUid);
    if (entity) this.applyHealth(targetUid, Math.max(0, entity.health - GHOST_DAMAGE), true);
  }

  updatePuzzle(snapshot, local, delta = 0) {
    // Los arquetipos con cronómetro (`TimedGates`) necesitan el delta: sin él no
    // hay forma de que una ventana temporal avance.
    const result = this.level.updatePuzzle(snapshot, delta);
    const themeColor = this.level.info.theme.color;

    if (result.newlyPressed && result.newlyPressed.length > 0) {
      this.sound.playPlateTrigger();
      result.newlyPressed.forEach(id => {
        const position = this.level.puzzle.platePosition(id);
        if (position) this.particles.burst(position, themeColor, { spread: 2, up: 3.4 });
      });
    }

    if (result.solved && !this.lastPuzzleSolved) {
      this.sound.playUnlock();
      // La compuerta abriéndose es el momento que se estaba buscando: se subraya.
      this.camera.addShake(0.35);
      this.renderer.flash(0.5, themeColor);
      // Una ráfaga por compuerta: con varias salidas, marcarlas todas es lo que
      // convierte "ya está" en "¿a cuál corremos?".
      const exits = this.level.puzzle.exitPositions;
      exits.forEach(exit => this.particles.burst(exit, themeColor, { spread: 5, up: 5, count: 40 }));
    }
    this.lastPuzzleSolved = result.solved;

    this.ui.setObjectiveProgress(result.progressPercent, result.solved);

    if (result.solved && local && local.alive && this.level.isAtExit(local.getPosition())) {
      this.running = false;

      // Con sala manda el servidor: él suma el progreso y responde con el siguiente
      // nivel. Sin ella no hay nadie al otro lado, así que la partida se cierra aquí.
      if (this.socket.currentRoom) {
        this.socket.notifyLevelComplete(this.level.elapsedSeconds, this.level.level);
        return;
      }

      this.ui.onOfflineLevelComplete({
        level: this.level.level,
        timeSpent: this.level.elapsedSeconds,
        damageTaken: this.levelDamage,
        deaths: this.deathCount
      });
    }
  }
}
