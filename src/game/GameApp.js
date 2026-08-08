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
import { themeForLevel } from '../procedural/LayoutGen.js';
import { PlayerRegistry } from './PlayerRegistry.js';
import { NetworkBridge } from './NetworkBridge.js';
import { GHOST_DAMAGE, GHOST_STATES } from '../../shared/events.js';
import { MOVE_SEND_HZ, GHOST_SEND_HZ } from '../../shared/constants.js';
import { HUD_TICK_S, TENSION_TICK_S, PUZZLE_TICK_S, GHOST_TRAIL_S } from './tuning.js';
import { falloff } from '../utils/math.js';
// Los marcadores de borde son DOM, no escena: su color viaja como cadena CSS.
import { hexColor } from '../ui/dom.js';
import { quality } from '../engine/QualitySettings.js';
import { PALETTE } from '../engine/materials.js';
import { StatsOverlay, statsRequested } from '../engine/Stats.js';
import { assets } from '../engine/AssetLoader.js';
import { mergedModel, disposeMergedModels } from '../engine/mergedModel.js';
import { PLAYER_MODELS, PUZZLE_MODELS, playerModelUrl, ghostModelUrl } from '../assets/manifest.js';

/**
 * Tope de fotogramas.
 *
 * Sin él el bucle pinta a la frecuencia del panel, y los móviles de 120 Hz —cada vez
 * más comunes— hacían el doble de trabajo de GPU para una diferencia que en una
 * cámara isométrica no se aprecia. Lo que sí se notaba era el calor y la bajada por
 * temperatura a los pocos minutos.
 *
 * El margen evita que un fotograma llegado un pelo antes de tiempo se descarte y
 * convierta 60 estables en 30 a saltos.
 */
const FRAME_BUDGET_MS = 1000 / 60;
const FRAME_TOLERANCE_MS = 2;

/**
 * Tope de fotogramas **fuera de partida**: menú, sala de espera, navegador de salas.
 *
 * La sala decorativa del fondo no es un adorno barato: `AmbientScene` la genera con el
 * mismo generador que una partida, y encima de ella corre la cadena completa de
 * postprocesado. O sea que rellenar el formulario de acceso costaba exactamente lo
 * mismo que jugar. A treinta se sigue viendo como una escena viva —es una órbita lenta,
 * no hay nada que responda a un botón— y en un portátil es la diferencia entre el
 * ventilador encendido en el menú y el silencio.
 */
const IDLE_FRAME_BUDGET_MS = 1000 / 30;

/** Techo de la espera del primer fotograma de un nivel. Ver `nextRenderedFrame`. */
const FIRST_FRAME_WAIT_MS = 500;

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
    this.ui = new UIManager({
      socket: this.socket,
      sound: this.sound,
      game: this,
      // El aparato táctil se **inyecta**: es un periférico, no un comando. Antes la
      // interfaz lo alcanzaba con `game.input.touch` al montar sus vistas.
      touchInput: this.input.touch
    });
    /**
     * Todo lo que este motor puede escribir y leer de la interfaz. Ver `GameState`.
     * Fuera de estos tres puertos y de los dos avisos con nombre que quedan
     * (`enterPlaySession` y `onLevelStarted`), `this.ui` no se toca.
     */
    this.state = this.ui.state;
    /** La única vista que el bucle dibuja directo. Ver `UIManager.framePort`. */
    this.framePort = this.ui.framePort;
    /** Intenciones de interfaz que nacen del mando. Reusa la tabla de acciones. */
    this.uiDispatch = (action, dataset) => this.ui.dispatch(action, dataset);
    /** El servidor que no hay cuando se juega sin conexión. Ver `OfflineBridge`. */
    this.offline = this.ui.offline;
    this.bridge = new NetworkBridge({ socket: this.socket, game: this, ui: this.ui });

    this.clock = new THREE.Clock();
    // Se guarda una sola función en vez de crear un cierre nuevo en cada fotograma,
    // y así `requestAnimationFrame` puede pasarnos su marca de tiempo.
    this.boundAnimate = timestamp => this.animate(timestamp);
    this.lastFrameTime = -Infinity;
    // Mientras dura la construcción de un nivel el bucle no dibuja. Ver `animate`.
    this.renderSuspended = false;
    this._running = false;
    // Cada `startLevel` invalida al anterior: dos peticiones solapadas —cambio de
    // nivel y regeneración, o una reconexión que llega tarde— construían las dos, y
    // la que perdía dejaba a medias la escena de la que ganaba.
    this.buildId = 0;
    this.deathCount = 0;
    this.lastPuzzleSolved = false;
    this.moveAccumulator = 0;
    this.ghostAccumulator = 0;
    this.hudAccumulator = 0;
    this.edgeAccumulator = 0;
    this.puzzleAccumulator = 0;
    this.lastPuzzleProgress = -1;

    this.ambient = new AmbientScene({
      scene: this.renderer.scene,
      renderer: this.renderer,
      lighting: this.lighting,
      particles: this.particles
    });

    this.renderer.onResizeCallback = (w, h) => this.camera.updateAspect(w, h);
    this.input.onGamepadAction = action => this.onGamepadAction(action);
    this.input.gamepad.onConnectionChange = name => this.state.setGamepad(name);
    this.input.touch.onConnectionChange = () => this.state.setInputMode('touch');
    document.addEventListener('visibilitychange', () => this.onVisibilityChange());
    this.bridge.register();

    // Diagnóstico bajo demanda (`?stats=1`). Apagado no cuesta nada: el bucle ni lo mira.
    this.stats = statsRequested() && this.renderer.isAvailable
      ? new StatsOverlay(this.renderer.renderer)
      : null;

    if (!this.renderer.isAvailable) this.uiDispatch('app:alert', { key: 'error_no_webgl' });
    else {
      this.ambient.start();
      // Los modelos se traen mientras se mira el menú, que es tiempo que ya se gasta.
      // Ver `AssetLoader.preload`: hace innecesaria una pantalla de carga.
      //
      // Van **todos**, no sólo los agentes. Antes el atrezo, el fantasma y las piezas de
      // puzle se descargaban y fusionaban dentro del loader del primer nivel, que es
      // justo el rato que este bloque existe para no gastar. `PropLibrary.preload` es
      // idempotente y `mergedModel` cachea por fichero, así que llamarlo aquí no le
      // quita trabajo a nadie: se lo adelanta.
      assets.preload(PLAYER_MODELS.map((_, i) => playerModelUrl(i)));
      assets.preload([ghostModelUrl()].filter(Boolean));
      // Las piezas de puzle y el atrezo van por `mergedModel`/`PropLibrary` y no por
      // `assets`: en ellas lo caro no es bajar el fichero sino fusionarlo, y es esa
      // fusión —no la descarga— la que hay que tener hecha antes del primer nivel.
      mergedModel(PUZZLE_MODELS.gate);
      mergedModel(PUZZLE_MODELS.node);
      this.level.props.preload();
    }

    // Closures reutilizados: antes se recreaban en el bucle o en la primera llamada
    // a `step`, produciendo basura que el GC tiene que recoger.
    this.isOnPlateBound = pos => this.level.isPlayerOnPlate(pos);
    this.onGhostHitBound = uid => this.onGhostHit(uid);

    this.animate();
  }

  get isHost() {
    return this.socket.isHost;
  }

  /**
   * ¿Hay un nivel en curso?
   *
   * Es una propiedad y no un campo para que publicarlo en el estado no dependa de que
   * los cuatro sitios que lo escriben se acuerden de hacerlo. Sigue leyéndose como
   * `gameApp.running`, que es lo que miran los escenarios e2e.
   */
  get running() {
    return this._running;
  }

  set running(value) {
    const next = !!value;
    if (this._running === next) return;
    this._running = next;
    this.state?.setRunning(next);
  }

  // -------------------------------------------------------------- niveles

  /** Arranca un nivel con la semilla que dicta el servidor. */
  startLevel({ level, seed, seedOffset = 0, playersCount }) {
    // Se muestra el loader mientras se genera: la construcción de la sala bloquea
    // el hilo principal lo suficiente como para sentirse como un freeze.
    this.state.setLoading('loading_level');

    // Nadie simula mientras se construye, y esto es lo que pone a los **otros dos**
    // clientes de acuerdo: antes `running` sólo pasaba a false en el que cruzaba la
    // salida, así que los demás seguían moviéndose y colisionando contra una sala a
    // medio desmontar —`obstacleBoxes` vacío, arquetipo a `null`—.
    this.running = false;
    // El bucle deja de dibujar: el loader es opaco. Ver `animate`.
    this.renderSuspended = true;

    const buildId = ++this.buildId;

    // Se usa setTimeout en vez de requestAnimationFrame para darle al navegador
    // un ciclo real de repintado y que el loader aparezca en pantalla antes de
    // bloquear el event loop con las tareas de inicialización pesadas.
    setTimeout(() => {
      // Salir al menú en esos 50 ms cancelaba mal: se construía un nivel entero
      // encima de la sala decorativa del menú, que comparte escena y luces.
      if (buildId !== this.buildId) return;
      this._buildLevel({ level, seed, seedOffset, playersCount, buildId });
    }, 50);
  }

  /**
   * Construcción efectiva del nivel, una vez que el loader ya se ha pintado.
   *
   * El orden de esta función es el arreglo de los dos congelamientos del arranque, así
   * que no es arbitrario:
   *
   *  1. Pantalla completa **antes** de nada. Cambiar de tamaño reasigna los búferes del
   *     postprocesado, y pedirla al final —que es lo que se hacía— metía ese salto de
   *     resolución justo en el primer fotograma que veía el jugador. Aquí el cambio
   *     ocurre con el loader delante y da tiempo a que el freno de `watchViewport` lo
   *     aplique durante la construcción.
   *  2. Atmósfera antes de las mallas, para que nazcan con el reflejo del bioma. Al
   *     revés, la sala se dibujaba con el entorno cián por defecto y todo el metal
   *     cambiaba de golpe al llegar el PMREM.
   *  3. Los modelos con esqueleto se esperan antes de precompilar. Eran ellos los que
   *     entraban tarde y compilaban su shader con el loader ya quitado: literalmente
   *     "y entonces aparece el personaje".
   *  4. El loader no se va hasta que hay un fotograma real dibujado.
   *
   * Y todo dentro de un `try/finally`: sin él, cualquier excepción dejaba el overlay
   * puesto para siempre, que desde fuera es indistinguible de un cuelgue.
   *
   * @private
   */
  async _buildLevel({ level, seed, seedOffset = 0, playersCount, buildId }) {
    const room = this.socket.currentRoom;
    const count = playersCount || (room ? room.players.length : 1);
    /** ¿Sigue siendo esta la construcción vigente? Ver `startLevel`. */
    const current = () => buildId === undefined || buildId === this.buildId;

    try {
      // La sala decorativa del menú y la de la partida no pueden convivir: comparten
      // escena, luces y partículas.
      this.ambient.stop();

      await this.ui.enterPlaySession();
      if (!current()) return;

      // El bioma sale del número de nivel, así que se sabe sin generar nada: la
      // atmósfera —y con ella el prefiltrado del entorno, que es lo caro— se aplica
      // **antes** de que existan las mallas, y éstas nacen ya con su reflejo puesto.
      const theme = themeForLevel(level);
      this.renderer.setAtmosphere({ bg: theme.bg, color: theme.color, fogDensity: theme.fogDensity });

      // Cada agente lleva su propio cazador asignado; el orden sale de la sala, que
      // es igual en todos los clientes, así que la asignación coincide para todos.
      const owners = room ? room.players.map(p => ({ uid: String(p.uid) })) : [];
      const info = await this.level.build({ level, seed, seedOffset, playersCount: count, owners });
      // `build` devuelve `null` cuando otra construcción la ha adelantado.
      if (!info || !current()) return;

      this.deathCount = 0;
      // El daño del nivel lo lleva el servidor cuando hay sala; sin ella no hay quien
      // lo cuente, y los logros de "sin recibir un golpe" necesitan saberlo.
      this.levelDamage = 0;
      this.lastPuzzleSolved = false;
      this.lastPuzzleProgress = -1;
      this.puzzleAccumulator = 0;

      // Las motas sí necesitan la sala ya trazada: se reparten sobre su tamaño real.
      this.particles.setupAmbient(this.level.info.sizeX, this.level.info.sizeZ, theme.color);
      this.camera.reset();
      // La cámara encuadra la sala de este nivel, no la mayor que el juego puede
      // generar: sin la medida real, un nivel pequeño se veía desde demasiado lejos.
      // Los dos ejes por separado, porque también es lo que confina la vista dentro de
      // la sala cuando el jugador se pega a un muro. Ver `EngineCamera.clampToRoom`.
      this.camera.setRoomBounds(this.level.info.sizeX, this.level.info.sizeZ);
      // El zoom sobrevive entre sesiones, así que el botón tiene que arrancar con el
      // valor guardado y no con el 100 % del estado inicial.
      this.publishZoom(this.camera.zoomPercent);

      if (room) {
        this.players.sync(room.players, this.socket.uid, index => this.level.spawnFor(index));
        this.players.placeAll(index => this.level.spawnFor(index));
      } else {
        this.players.createSolo(this.level.spawnFor(0));
      }

      // Va aquí y no junto a `camera.reset()`: hasta esta línea no hay agente local del
      // que copiar la posición. Sin esto, la cámara entra al nivel desde la órbita del
      // menú y el primer par de segundos son un vuelo de aproximación durante el cual ya
      // se puede jugar. Ver `EngineCamera.snapTo`.
      const local = this.players.local;
      if (local) {
        this.camera.snapTo(local.getPosition());
        this.lighting.setShadowFocus(local.getPosition().x, local.getPosition().z);
      }

      this.sound.startBGM();

      // Los modelos con esqueleto —agentes y fantasmas— se montan solos y en paralelo.
      // Esperarlos aquí es lo que impide que entren en escena **después** del loader y
      // compilen su shader con el jugador ya jugando. Ninguna de las dos promesas puede
      // fallar el arranque: si el fichero no está, se resuelven sin hacer nada.
      await Promise.all([this.players.modelsReady(), this.level.modelsReady()]);
      if (!current()) return;

      await this.renderer.precompile(this.renderer.scene, this.camera.camera);
      if (!current()) return;

      // El bucle vuelve a dibujar y se espera un fotograma **de verdad** antes de
      // quitar el loader. Precompilar deja los programas listos, pero la primera
      // subida de búferes y la primera pasada del postprocesado siguen costando: sin
      // esta espera ese coste caía en el primer fotograma sin overlay delante, que es
      // el que el jugador ve. Son ~2 fotogramas de loader de más a cambio de entrar en
      // la sala con la imagen ya montada.
      this.renderSuspended = false;
      await this.nextRenderedFrame();
      if (!current()) return;

      this.running = true;

      // Los datos van por el estado; el aviso sólo dice "ya hay nivel", para que la
      // interfaz haga lo suyo —entrar en el HUD y teñirse con el color del bioma—.
      this.state.startLevel({
        level,
        playersCount: count,
        seedLabel: this.level.info.seedLabel,
        themeName: theme.name,
        themeColor: theme.color,
        roomCode: this.socket.roomCode,
        objectiveKey: this.level.puzzle.objectiveKey,
        health: this.localHealth()
      });
      this.ui.onLevelStarted();
    } catch (err) {
      // Esto se invoca desde un `setTimeout`, así que sin el `catch` la excepción sale
      // como un rechazo sin gestionar: no aparece en ningún sitio y lo único que se ve
      // es que la partida "no arranca". Se registra y se deja caer.
      console.error('[nivel] la construcción falló:', err);
      throw err;
    } finally {
      // Pase lo que pase el overlay se va. Sin este `finally`, una excepción a mitad de
      // la construcción —o una cancelación por `current()`— dejaba la pantalla de carga
      // puesta para siempre, que desde fuera no se distingue de un cuelgue.
      if (buildId === undefined || buildId === this.buildId) {
        this.renderSuspended = false;
        this.state.setLoading(null);
      }
    }
  }

  /**
   * Se resuelve cuando el bucle ha dibujado un fotograma completo, **o cuando se agota la
   * paciencia**.
   *
   * Dos `requestAnimationFrame` y no uno: el primero devuelve el control justo *antes* del
   * repintado que el propio bucle va a hacer, así que en ese momento el fotograma todavía
   * no está en pantalla. Es el segundo el que garantiza que ya se pintó.
   *
   * Y va acotado porque esto es una mejora, no un requisito: en una máquina normal los dos
   * fotogramas son unos 30 ms y la espera ni se nota, pero sobre un rasterizador por
   * software —una máquina de integración, una gráfica sin controlador— el primer fotograma
   * de una escena nueva puede costar más de medio segundo cada uno, y entonces esperarlo
   * deja de esconder un tirón y pasa a ser un retraso de más de un segundo antes de poder
   * jugar. Si se agota, lo que ocurre es lo de antes: el tirón se ve. Ni mejor ni peor.
   */
  nextRenderedFrame() {
    const deadline = performance.now() + FIRST_FRAME_WAIT_MS;
    return new Promise(resolve => {
      requestAnimationFrame(() => {
        // Al llegar aquí el bucle ya ha dibujado: su `requestAnimationFrame` estaba
        // encolado antes que éste, así que `animate` corre primero en este mismo
        // fotograma. El segundo turno es sólo para que el compositor lo presente.
        //
        // El tope se comprueba **aquí dentro** y no con un `setTimeout`: cuando cada
        // fotograma tarda cientos de milisegundos, el hilo no queda libre entre uno y otro
        // y el temporizador no llega a ejecutarse nunca —medido: no recortaba nada—.
        if (performance.now() >= deadline) resolve();
        else requestAnimationFrame(resolve);
      });
    });
  }

  /**
   * Cierre ordenado de la aplicación.
   *
   * **En el navegador no lo llama nadie, y es deliberado**: cerrar la pestaña ya libera
   * todo, y engancharlo a `pagehide` rompería la restauración desde la caché de retroceso.
   * Sus dos consumidores reales son Electron al recargar el renderer —donde el contexto
   * WebGL sí sobrevive al recargado— y `scripts/check-leaks.js`.
   *
   * Existe sobre todo porque de aquí cuelgan seis funciones de liberación que estaban
   * escritas, exportadas y **sin un solo llamante**: `disposeTextureCache`,
   * `disposeSharedGeometry`, `EnvironmentBuilder.dispose`, `PostFX.destroy`,
   * `EngineLighting.destroy` y `PropLibrary.dispose`. Código muerto que aparentaba estar
   * vivo, y que ahora el comprobador de fugas ejercita de verdad.
   */
  destroy() {
    this.stop();
    this.input.destroy();
    this.ui.destroy();
    this.lighting.destroy();
    this.level.props.dispose();
    disposeMergedModels();
    // El último: se lleva por delante el contexto WebGL, la caché de texturas y la
    // geometría compartida, así que todo lo que las use tiene que haber terminado.
    this.renderer.destroy();
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
    // Invalida cualquier construcción en vuelo: volver al menú mientras se generaba un
    // nivel dejaba que ésta terminara y montara la sala encima de la decorativa.
    this.buildId++;
    this.renderSuspended = false;
    this.level.clear();
    this.players.clear();
    this.particles.clearAmbient();
    this.sound.stopBGM();
    // La sala decorativa del menú tiene su propio encuadre; arrastrar el del último
    // nivel jugado la dejaba vista desde otra distancia cada vez, y además encerrada
    // dentro de los límites de una sala que ya no existe.
    this.camera.setRoomBounds(0, 0);

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
    this.state.setHealth(health);

    if (!entity.alive) {
      this.deathCount += 1;
      this.camera.addShake(1);
      // El motor publica el número de caídas y que el agente no está vivo; **no** abre
      // el modal. Ver `GameState.setDeaths`.
      this.state.setDeaths(this.deathCount);
      this.state.setLocalAlive(false);
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
      this.state.setHealth(health);
      this.state.setLocalAlive(true);
      this.camera.reset();
      // Reaparecer es un salto, no un desplazamiento: la celda de reaparición está lejos
      // de donde caíste. Con la cámara siguiendo al agente, dejar que `follow` cubra esa
      // distancia amortiguada sería un barrido por media sala justo cuando el jugador
      // vuelve a tener el control.
      this.camera.snapTo(entity.getPosition());
      this.lighting.setShadowFocus(spawn.x, spawn.z);
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
      ghost.setRemoteState(state.state);
      if (ghost.targetUid !== state.targetUid) {
        if (!snapshot) snapshot = this.players.snapshot();
        ghost.setTargetIndicator(state.targetUid, snapshot);
      }
    });
  }

  // ------------------------------------------------------------- el bucle

  animate(now = 0) {
    requestAnimationFrame(this.boundAnimate);

    // Con la pestaña oculta el navegador ya frena el bucle, pero no de forma
    // uniforme: en un móvil en segundo plano o a pantalla partida sigue llamando.
    // Salir aquí es lo que impide seguir gastando batería sobre una escena que
    // nadie ve. El reloj se descarta al volver, en `onVisibilityChange`.
    if (document.hidden) return;

    // `running` es lo que separa "hay un nivel" de "hay un menú con una sala de fondo".
    // Se mira aquí y no en la interfaz a propósito: es un dato del motor, y leerlo del
    // estado de la vista habría metido un acoplamiento nuevo en el bucle caliente.
    const budget = this.running ? FRAME_BUDGET_MS : IDLE_FRAME_BUDGET_MS;
    if (now - this.lastFrameTime < budget - FRAME_TOLERANCE_MS) return;
    this.lastFrameTime = now;

    const delta = Math.min(this.clock.getDelta(), 0.1);

    // Durante la construcción de un nivel el overlay de carga es **opaco**, así que
    // todo lo que se dibuje debajo es trabajo tirado — y no es trabajo cualquiera: es
    // la escena entera con la cadena de postprocesado. Cada `yieldToMain` de los
    // generadores compra un fotograma para que el navegador repinte, y ese fotograma
    // se lo comía este render antes de que al anillo del loader le tocara el turno.
    // El reloj sí se consume, para que al reanudar no llegue un delta de segundos.
    if (this.renderSuspended) return;

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
    // Después del render: `renderer.info` cuenta lo ya enviado a la GPU, así que
    // leerlo antes daría siempre las cifras del fotograma anterior.
    if (this.stats) this.stats.update();
  }

  /**
   * Botones del mando que no son movimiento.
   *
   * Se resuelven contra la interfaz y no contra la simulación porque es lo que
   * hacen sus equivalentes de teclado: Start es Escape, y el botón de reaparecer
   * pulsa el mismo botón del modal de caída.
   */
  onGamepadAction(action) {
    if (action === 'pause') this.uiDispatch('game:pause-toggle');
    else if (action === 'respawn' && this.players.local && !this.players.local.alive) {
      this.uiDispatch('game:respawn');
    }
  }

  /**
   * La pestaña pasa a segundo plano o vuelve.
   *
   * Al volver se descarta el tiempo acumulado leyendo el reloj y tirando el
   * resultado: sin eso, el primer fotograma llegaría con el delta de todo el rato
   * que el juego estuvo oculto. El recorte a 0,1 s del bucle lo contendría, pero
   * seguiría siendo un salto de dos segundos y medio de movimiento en un fotograma.
   */
  onVisibilityChange() {
    const audio = this.sound.audioCtx;
    if (document.hidden) {
      audio?.suspend?.();
      return;
    }

    this.clock.getDelta();
    this.lastFrameTime = -Infinity;
    audio?.resume?.();
    // El centinela de pantalla lo recupera la interfaz por su cuenta: también escucha
    // `visibilitychange` y sabe si hay nivel en curso por `state.running`.
  }

  /** Sin conexión no se simula: antes el juego seguía corriendo contra el vacío. */
  canSimulate() {
    if (!this.running || !this.level.info) return false;
    if (this.state.isPaused || this.state.isLinkFrozen) return false;
    return this.socket.currentRoom ? this.socket.isConnected : true;
  }

  /**
   * Zoom de cámara del jugador.
   *
   * Pasa por aquí y no directamente de la entrada a la cámara porque el botón del HUD
   * necesita ver el valor resultante: la cámara es la dueña del dato (topes,
   * escalones, persistencia) y este método es el único sitio que lo publica al estado
   * de la interfaz, venga de la rueda, del dedo o del botón.
   *
   * @param {number} percent zoom ya aplicado, en porcentaje
   */
  publishZoom(percent) {
    if (this.lastZoomPercent === percent) return;
    this.lastZoomPercent = percent;
    this.state.setZoom(percent);
  }

  /** Botón de zoom del HUD: salta al siguiente escalón. */
  cycleZoom() {
    this.camera.cycleZoom();
    this.publishZoom(this.camera.zoomPercent);
  }

  /** Rueda, teclas +/− y pellizco, acumulados por la entrada durante el fotograma. */
  applyZoomInput() {
    const delta = this.input.consumeZoom();
    if (delta === 0) return;
    this.camera.nudgeZoom(delta);
    this.publishZoom(this.camera.zoomPercent);
  }

  step(delta) {
    this.applyZoomInput();

    const local = this.players.local;
    if (local) {
      if (local.alive) {
        local.update(delta, this.input.getMovementVector(this.camera.getGroundBasis()), this.level.obstacleBoxes);
        this.throttledSendMove(delta, local);
      }
      const position = local.getPosition();
      this.camera.follow(position, delta);
      // El volumen de sombra va con el jugador, no con el origen del mundo: ver
      // `EngineLighting.setShadowFocus`. Se le pasa la posición del agente y no la de
      // la cámara porque es lo que está en el centro del encuadre, y porque así el
      // redondeo a téxel no depende del suavizado.
      this.lighting.setShadowFocus(position.x, position.z);
    }

    this.players.updateRemotes(delta);
    this.players.forEachEntity(entity => entity.updateShieldVisual());

    const snapshot = this.players.snapshot(this.isOnPlateBound);
    this.updateGhosts(delta, snapshot);
    this.updatePuzzle(snapshot, local, delta);
    this.updateTension(delta, local);
    this.throttledEdgeMarkers(delta, local);
    this.throttledHudUpdate(delta);
  }

  /**
   * Señala en el borde de la pantalla lo que se ha quedado fuera de encuadre.
   *
   * Se estrangula por preset y no por fotograma: es información, no animación, y a 12
   * actualizaciones por segundo un marcador ya se lee como que acompaña al objetivo.
   * Lo que se ahorra no son llamadas de dibujo —no cuesta ninguna— sino cinco
   * proyecciones y cinco escrituras de estilo en el teléfono más lento.
   */
  throttledEdgeMarkers(delta, local) {
    if (!local) return;

    this.edgeAccumulator += delta;
    const period = 1 / quality.get('edgeMarkerHz');
    if (this.edgeAccumulator < period) return;
    this.edgeAccumulator = 0;

    this.framePort.edgeMarkers.update(this.camera.camera, this.collectOffscreenTargets(local));
  }

  /**
   * Qué merece un marcador de borde.
   *
   * Los compañeros vivos, siempre y con su color de agente: es la misma señal que su
   * anillo de suelo, y en los puzles de placas simultáneas saber dónde está el otro
   * **es** la mecánica.
   *
   * Los fantasmas, no todos. El que te persigue a ti, siempre; los ajenos, solo dentro
   * del alcance en el que ya se oyen. Marcarlos todos a todas horas sería un radar, y
   * un radar desmonta la tensión que construyen `updateTension` y el latido: lo que da
   * miedo es no saber por dónde anda, y esto solo pretende que no te maten por algo que
   * habrías visto de estar la cámara donde estaba antes.
   */
  collectOffscreenTargets(local) {
    const targets = this.edgeTargets || (this.edgeTargets = []);
    targets.length = 0;

    for (const entity of this.players.list()) {
      if (entity.isLocal || !entity.alive) continue;
      targets.push({ position: entity.getPosition(), color: hexColor(entity.colorHex) });
    }

    const position = local.getPosition();
    for (const ghost of this.level.ghosts) {
      const mine = ghost.targetUid && String(ghost.targetUid) === String(this.socket.uid);
      if (!mine && ghost.mesh.position.distanceTo(position) > GameApp.TENSION_RANGE) continue;
      targets.push({
        position: ghost.mesh.position,
        color: hexColor(PALETTE.GHOST_AURA),
        // Embistiendo el marcador parpadea. Es el único momento en el que un aviso de
        // borde tiene derecho a pedir que le mires.
        urgent: mine && ghost.brain.state === GHOST_STATES.CHARGE
      });
    }

    return targets;
  }

  /** Timer, modo de entrada y estado de los compañeros van a ~2 Hz: no hace falta más. */
  throttledHudUpdate(delta) {
    this.hudAccumulator += delta;
    if (this.hudAccumulator < HUD_TICK_S) return;
    this.hudAccumulator = 0;

    this.state.setHudTick({
      elapsedTime: this.level.elapsedSeconds,
      inputMode: this.input.mode,
      teammates: this.collectTeammates()
    });
  }

  /**
   * Estado de los otros agentes para el HUD.
   *
   * Se lee del registro de entidades y no del último mensaje del servidor porque el
   * registro es el único sitio donde confluyen los dos caminos por los que cambia la
   * vida de un compañero: la conciliación de la sala (`PlayerRegistry.sync`) y los
   * avisos sueltos de daño. Mirando solo uno, la barra se quedaba atrás.
   */
  collectTeammates() {
    return this.players
      .list()
      .filter(entity => !entity.isLocal)
      .map(entity => ({
        uid: entity.uid,
        name: entity.name,
        health: entity.health,
        alive: entity.alive
      }));
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
  /** ¿Hay un fantasma embistiendo contra el agente de esta pantalla? */
  isChargingAtLocal() {
    return this.level.ghosts.some(
      ghost => ghost.brain.state === GHOST_STATES.CHARGE
        && ghost.targetUid && String(ghost.targetUid) === String(this.socket.uid)
    );
  }

  updateTension(delta, local) {
    // La sacudida por cercanía sí va por fotograma: a 5 Hz se sentiría como tirones.
    this.updateProximityShake(delta, local);

    this.tensionAccumulator = (this.tensionAccumulator || 0) + delta;
    if (this.tensionAccumulator < TENSION_TICK_S) return;
    this.tensionAccumulator = 0;

    if (!local || !local.alive) {
      this.sound.setTension(0);
      this.sound.setHeartbeat(0);
      this.renderer.setDread(0);
      return;
    }

    const distance = this.nearestGhostDistance(local.getPosition());
    const proximity = falloff(distance, GameApp.TENSION_RANGE);
    // Al cuadrado: solo aprieta de cerca. Salvo embistiendo, donde la distancia deja de
    // importar —la embestida se **oye** llegar, y para cuando la distancia bajara sola
    // ya sería tarde para que el aviso sirviera de algo—.
    const tension = this.isChargingAtLocal() ? 1 : proximity * proximity;

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
    const onHit = this.onGhostHitBound;

    // Las rutas del acecho, antes de mover a nadie: un campo por presa, compartido por
    // los fantasmas que vayan a por ella. Ver `LevelController.updateFlowFields`.
    this.level.updateFlowFields(snapshot);

    for (const ghost of ghosts) {
      const previous = ghost.targetUid;
      const wasStalking = ghost.brain.state === GHOST_STATES.STALK;
      const targetUid = ghost.update(delta, snapshot, onHit, range, ghosts);
      const mine = targetUid && targetUid === this.socket.uid;

      // El aviso suena cuando **te ve**, no cuando cambia de presa.
      //
      // Antes se disparaba con el cambio de objetivo, que con un fantasma asignado por
      // agente ocurre una vez por nivel y casi siempre antes de que pase nada. Ahora
      // marca la transición de acechar a cazar, que es el instante en el que el juego
      // cambia: hasta ahí rodeaba muros, a partir de ahí viene en línea recta y los
      // atraviesa. Es el momento que hay que oír.
      if (mine && wasStalking && ghost.brain.state !== GHOST_STATES.STALK) {
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
    if (ghost.trailAccumulator < GHOST_TRAIL_S) return;
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

    // Throttle del progreso: el HUD no necesita más de ~8 actualizaciones por
    // segundo y antes se hacía un `store.patch` en cada fotograma incluso cuando
    // el valor no había cambiado, que es la mayor fuente de repintados inútiles.
    this.puzzleAccumulator += delta;
    if (this.puzzleAccumulator >= PUZZLE_TICK_S || result.solved !== this.lastPuzzleSolved || result.progressPercent !== this.lastPuzzleProgress) {
      this.puzzleAccumulator = 0;
      this.lastPuzzleProgress = result.progressPercent;
      this.state.setObjectiveProgress(result.progressPercent, result.solved);
    }

    if (result.solved && local && local.alive && this.level.isAtExit(local.getPosition())) {
      this.running = false;

      // Con sala manda el servidor: él suma el progreso y responde con el siguiente
      // nivel. Sin ella no hay nadie al otro lado, así que la partida se cierra aquí.
      if (this.socket.currentRoom) {
        this.socket.notifyLevelComplete(this.level.elapsedSeconds, this.level.level);
        return;
      }

      this.offline.levelComplete({
        level: this.level.level,
        timeSpent: this.level.elapsedSeconds,
        damageTaken: this.levelDamage,
        deaths: this.deathCount
      });
    }
  }
}
