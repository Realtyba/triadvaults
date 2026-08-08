/**
 * La frontera entre el motor y la interfaz.
 *
 * **No es un estado nuevo.** Es la rebanada del `Store` de la interfaz que el motor tiene
 * derecho a tocar, con un método por cosa. El almacén sigue siendo uno solo a propósito:
 * las claves en disputa —`paused`, `health`, `connection`— las escribe uno y las lee el
 * otro, así que duplicarlas en un segundo objeto no habría quitado el acoplamiento, lo
 * habría cambiado por un problema de sincronización, que es peor.
 *
 * Lo que sí cambia es que **no hay `patch` genérico**. Antes el motor hacía
 * `ui.store.patch({ loQueFuera })` desde tres sitios y leía `ui.isPaused` a través de la
 * clase entera de la interfaz, así que nada decía dónde acababa un lado y empezaba el
 * otro. Aquí la lista de claves compartidas **es** la lista de métodos de este fichero: si
 * no hay método, el motor no puede escribir esa clave.
 *
 * La otra mitad del contrato es `GameCommands`, que es lo que la interfaz puede pedirle al
 * motor. Y hay exactamente una excepción declarada a "el motor sólo escribe aquí":
 * `UIManager.framePort`, para lo que se recalcula por fotograma.
 */
export class GameState {
  constructor(store) {
    this.store = store;
  }

  // ------------------------------------- escribe el motor, lee la interfaz

  /** Overlay de carga. `null` lo apaga. */
  setLoading(key) {
    this.store.patch({ loading: key ?? null });
  }

  /**
   * Todo lo que la interfaz necesita saber de un nivel recién montado, en un solo envío.
   *
   * Va **crudo**: `themeName` y `objectiveKey` en vez de la etiqueta y el texto ya
   * compuestos. Antes el motor mandaba `levelLabel` y `objectiveText` armados —el segundo
   * ya traducido—, lo que le obligaba a conocer la i18n y, de paso, dejaba el objetivo
   * escrito en el idioma que hubiera al empezar el nivel: cambiarlo a mitad de partida no
   * lo retraducía. Ahora los compone `HudView`, que es quien se vuelve a pintar cuando el
   * idioma cambia.
   */
  startLevel({
    level,
    themeName,
    themeColor,
    seedLabel,
    roomCode,
    playersCount,
    objectiveKey,
    health
  }) {
    this.store.patch({
      level,
      themeName,
      themeColor,
      seedLabel,
      roomCode: roomCode || 'LOCAL',
      lastRoomCode: roomCode || this.store.get().lastRoomCode,
      playersCount,
      objectiveKey,
      health,
      puzzleProgress: 0,
      puzzleSolved: false,
      deathCount: 0,
      localAlive: true
    });
  }

  /** ¿Hay un nivel en curso? Lo mira el centinela de pantalla al volver de segundo plano. */
  setRunning(running) {
    this.store.patch({ running: !!running });
  }

  setHealth(health) {
    this.store.patch({ health: Math.max(0, health) });
  }

  /**
   * Caídas del agente local en este nivel.
   *
   * El motor publica el número; **no** abre el modal de caída. Antes lo abría con un
   * `patch({ modal: 'game-over' })` directo, saltándose `openModal` y con ella la regla de
   * que un modal bloqueante —la verificación de la cuenta— no se desplaza. La interfaz
   * decide qué hacer con este número, incluido si ofrecer regenerar el nivel.
   */
  setDeaths(count) {
    this.store.patch({ deathCount: count });
  }

  setLocalAlive(alive) {
    this.store.patch({ localAlive: !!alive });
  }

  setObjectiveProgress(progress, solved) {
    this.store.patch({ puzzleProgress: progress, puzzleSolved: solved });
  }

  /** Latido lento del HUD: cronómetro, modo de entrada y estado de los compañeros. */
  setHudTick({ elapsedTime, inputMode, teammates }) {
    this.store.patch({ elapsedTime, inputMode, teammates });
  }

  /** El zoom lo posee la cámara; aquí sólo se publica para que el botón lo pinte. */
  setZoom(percent) {
    this.store.patch({ zoom: percent });
  }

  setInputMode(mode) {
    this.store.patch({ inputMode: mode });
  }

  setGamepad(name) {
    this.store.patch({ gamepadName: name });
  }

  // ------------------------------------- escribe la interfaz, lee el motor

  get isPaused() {
    return this.store.get().paused;
  }

  /**
   * ¿Está la partida congelada por la red?
   *
   * Esta regla —*una partida sin conexión no se congela porque el socket reintente*— es de
   * **simulación**, no de presentación, y vivía en `UIManager.isReconnecting` sólo porque
   * el dato `offline` estaba allí. El motor la lee desde aquí y ya no necesita conocer la
   * clase de la interfaz para decidir si simula.
   */
  get isLinkFrozen() {
    const state = this.store.get();
    if (state.offline) return false;
    return state.connection !== 'online';
  }

  get isOffline() {
    return this.store.get().offline;
  }
}
