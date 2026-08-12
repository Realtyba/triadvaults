import { I18nManager } from '../i18n/I18nManager.js';
import { ApiClient } from '../network/ApiClient.js';
import { session } from '../network/session.js';
import { Store } from './state/Store.js';
import { createInitialState, FormState } from './state/initialState.js';
import { MainMenuView } from './views/MainMenuView.js';
import { LobbyView } from './views/LobbyView.js';
import { HudView } from './views/HudView.js';
import { EdgeMarkersView } from './views/EdgeMarkersView.js';
import { TouchControlsView } from './views/TouchControlsView.js';
import { ReconnectingOverlay } from './views/ReconnectingOverlay.js';
import { LoadingOverlay } from './views/LoadingOverlay.js';
import { RotateNotice } from './views/RotateNotice.js';
import { AchievementToast } from './views/AchievementToast.js';
import { ModalHost } from './modals/ModalHost.js';
import { BLOCKING_MODALS } from './modals/definitions.js';
import { AuthController } from './controllers/AuthController.js';
import { RoomController } from './controllers/RoomController.js';
import { el, hexColor } from './dom.js';
import { icon } from './icons.js';
import { quality } from '../engine/QualitySettings.js';
import { bindings } from '../engine/Bindings.js';
import { isCoarsePointer, watchViewport } from '../engine/device.js';
import {
  isFullscreen,
  isFullscreenSupported,
  lockLandscape,
  releaseWakeLock,
  requestWakeLock,
  toggleFullscreen,
  watchFullscreen
} from '../engine/fullscreen.js';
import { offlineStore } from '../network/OfflineStore.js';
import { mirrorToSteam, reconcileWithSteam } from '../network/SteamBridge.js';
import { NEXT_LEVEL_DELAY_MS } from '../game/tuning.js';
import { GameState } from '../game/GameState.js';
import { GameCommands } from '../game/GameCommands.js';
import { OfflineBridge } from '../game/OfflineBridge.js';

const AUDIO_KEY = 'triad_audio_muted';

/**
 * Orquestador de la interfaz.
 *
 * Monta el esqueleto una sola vez y deja que cada vista se repinte solo cuando
 * cambian las claves de estado que le importan. Los eventos se resuelven por
 * delegación con `data-action`, en lugar de la cadena de `if` sobre ids que había.
 */
export class UIManager {
  /** Margen para que llegue el reenganche a sala antes de darla por perdida. */
  static REJOIN_GRACE_MS = 2500;

  constructor({ socket, sound, game, touchInput }) {
    this.socket = socket;
    this.sound = sound;
    this.game = game;
    this.touchInput = touchInput;

    this.i18n = new I18nManager();
    this.api = new ApiClient();
    this.form = new FormState();

    this.store = new Store(
      createInitialState({
        user: session.isValid() ? session.getUser() : null,
        lang: this.i18n.currentLang,
        audioMuted: localStorage.getItem(AUDIO_KEY) === 'true',
        quality: quality.level,
        qualityOptions: quality.options(),
        controls: structuredClone(bindings.map),
        isTouch: isCoarsePointer()
      })
    );

    /**
     * Las dos mitades de la frontera con el motor.
     *
     * `state` es lo único que el motor puede escribir del almacén —lo lee él desde aquí,
     * `game.state`— y `commands` es lo único que esta clase y sus vistas pueden pedirle al
     * motor. Fuera de estas dos, ni la interfaz navega `game.loQueSea` ni el motor conoce
     * `UIManager`. La excepción, declarada y con nombre, es `framePort`.
     */
    this.state = new GameState(this.store);
    this.commands = new GameCommands(game);
    /** El servidor que no hay cuando se juega sin conexión. Ver `OfflineBridge`. */
    this.offline = new OfflineBridge({
      commands: this.commands,
      store: this.store,
      catalog: () => this.store.get().achievementCatalog,
      onUnlocked: keys => this.onAchievementsUnlocked(keys),
      onVictory: () => this.showVictory()
    });

    // Un convertible cambia de puntero al plegarse y un móvil al rotar, así que la
    // clase del documento y el estado se recalculan, no se fijan al arrancar.
    this.applyViewportState();
    // Las bajas se guardan. Antes se descartaban las dos, así que aunque hubiera un
    // camino de cierre no habría forma de soltar estos dos observadores. Ver `destroy`.
    this.teardown = [];
    this.teardown.push(watchViewport(() => this.applyViewportState()));

    // También se sale de pantalla completa con Escape o con el gesto del sistema, sin
    // pasar por el botón: el estado se escucha en vez de deducirlo de la última acción.
    this.teardown.push(watchFullscreen(active => this.store.patch({ isFullscreen: active })));

    // Sesión a medias (usuario sin token): se limpia para no mostrar un menú inservible.
    if (!session.isValid()) session.clear();

    this.ctx = {
      t: key => this.i18n.t(key),
      form: this.form,
      lang: this.i18n.currentLang,
      isLocalHost: () => this.socket.isHost
    };

    this.buildSkeleton();
    this.mountViews();
    this.watchWakeLock();
    this.bindEvents();
    this.registerActions();

    // El catálogo no depende de tener sesión: se pide siempre.
    this.fetchAchievementCatalog();
    
    const user = this.store.get().user;
    if (user) {
      if (user.isVerified === false) {
        this.store.patch({ modal: 'verify', view: 'main' });
      } else {
        this.refreshMenuData();
      }
    }
  }

  // ------------------------------------------------------------ montaje

  buildSkeleton() {
    this.layer = document.getElementById('ui-layer');
    this.layer.innerHTML = '';

    this.nodes = {
      topBar: el('div', { className: 'top-bar' }),
      main: el('div', { className: 'view view--main' }),
      lobby: el('div', { className: 'view view--lobby hidden' }),
      hud: el('div', { className: 'view view--hud hidden' }),
      // Fuera del HUD **a propósito**, aunque se dibuje sobre él: el escenario e2e
      // `solo` vigila `.view--hud` con un `MutationObserver` en modo `subtree` para
      // cazar reconstrucciones del HUD, y un marcador que se mueve cada fotograma
      // dentro de esa rama haría fallar esa comprobación sin tener nada que ver con
      // lo que vigila. Ver `EdgeMarkersView`.
      edge: el('div', { className: 'edge-markers hidden' }),
      // Va después del HUD y antes de los modales: por encima de los marcadores,
      // por debajo de cualquier diálogo.
      touch: el('div', { className: 'touch-layer hidden' }),
      modal: el('div', { className: 'modal-host hidden' }),
      // Por encima de los modales: si el móvil está de pie, ni el HUD ni un diálogo
      // se leen bien, así que este aviso es lo único que debe verse.
      rotate: el('div', { className: 'rotate-notice hidden' }),
      reconnect: el('div', { className: 'reconnect-overlay hidden' }),
      loading: el('div', { className: 'loading-overlay hidden' }),
      // Fuera de las vistas: los avisos de logro se ven en el menú y en partida.
      toast: el('div', { className: 'toast-host hidden' })
    };

    Object.values(this.nodes).forEach(node => this.layer.appendChild(node));
    this.renderTopBar();
  }

  renderTopBar() {
    const t = this.ctx.t;
    const { audioMuted, lang } = this.store.get();
    this.nodes.topBar.innerHTML = `
      <button type="button" class="icon-btn" data-action="app:audio" title="${t('btn_audio')}" aria-label="${t('btn_audio')}">
        ${icon(audioMuted ? 'audioOff' : 'audioOn', { size: 18 })}
      </button>
      <button type="button" class="icon-btn" data-action="modal:open" data-modal="settings"
              title="${t('settings_title')}" aria-label="${t('settings_title')}">
        ${icon('settings', { size: 18 })}
      </button>
      <div class="lang-picker">
        <button type="button" class="lang-btn ${lang === 'es' ? 'is-active' : ''}" data-action="app:lang" data-lang="es">ES</button>
        <button type="button" class="lang-btn ${lang === 'en' ? 'is-active' : ''}" data-action="app:lang" data-lang="en">EN</button>
      </div>
    `;
  }

  mountViews() {
    const state = this.store.get();

    this.mainMenu = new MainMenuView(this.nodes.main, this.ctx);
    this.lobby = new LobbyView(this.nodes.lobby, this.ctx);
    this.hud = new HudView(this.nodes.hud, this.ctx);
    this.edgeMarkers = new EdgeMarkersView(this.nodes.edge, this.ctx);
    this.touchControls = new TouchControlsView(this.nodes.touch, this.ctx, this.touchInput);
    this.modals = new ModalHost(this.nodes.modal, this.ctx);
    this.rotateNotice = new RotateNotice(this.nodes.rotate, this.ctx);
    this.reconnect = new ReconnectingOverlay(this.nodes.reconnect, this.ctx);
    this.loadingOverlay = new LoadingOverlay(this.nodes.loading, this.ctx);
    this.toasts = new AchievementToast(this.nodes.toast, this.ctx);

    this.mainMenu.mount(state);
    this.hud.mount();
    this.edgeMarkers.mount();
    this.touchControls.mount();

    this.subscribeView(this.mainMenu, MainMenuView.keys ?? null);
    this.subscribeView(this.lobby, LobbyView.keys);
    this.subscribeView(this.hud, HudView.keys);
    this.subscribeView(this.edgeMarkers, EdgeMarkersView.keys);
    this.subscribeView(this.touchControls, TouchControlsView.keys);
    this.subscribeView(this.modals, ModalHost.keys);
    this.subscribeView(this.rotateNotice, RotateNotice.keys);
    this.subscribeView(this.reconnect, ReconnectingOverlay.keys);
    this.subscribeView(this.loadingOverlay, LoadingOverlay.keys);

    this.store.subscribe(['view'], s => this.applyViewVisibility(s));
    // La caída del agente la publica el motor como dato (`localAlive`), no abriendo el
    // modal él mismo: así pasa por `openModal` y respeta que un modal bloqueante —la
    // verificación de la cuenta— no se desplaza. Antes se colaba con un `patch` directo.
    this.store.subscribe(['localAlive'], s => {
      if (s.localAlive === false) this.openModal('game-over');
      else if (this.store.get().modal === 'game-over') this.store.patch({ modal: null });
    });
    this.store.subscribe(['lang', 'audioMuted'], () => this.renderTopBar());
    // Los avisos que llegaron mientras había un modal bloqueante salen ahora.
    this.store.subscribe(['modal'], s => {
      if (!s.modal) this.flushPendingAlert();
    });

    this.applyViewVisibility(state);
    this.lobby.render(state, null);
    this.hud.render(state);
    this.edgeMarkers.render(state);
    this.touchControls.render(state);
    this.modals.render(state, null);
    this.rotateNotice.render(state, null);
    this.reconnect.render(state, null);
    this.loadingOverlay.render(state, null);
  }

  /**
   * Vistas que el bucle de juego dibuja **directamente**, sin pasar por el estado.
   *
   * Es la única excepción a la regla "el motor sólo escribe en `GameState`", y está aquí
   * para que sea una excepción **con nombre** y no un `this.ui.loQueSea` perdido en
   * mitad del bucle.
   *
   * Para entrar en este puerto hay que cumplir las dos cosas: que el dato se recalcule
   * por fotograma (o casi) y que un `patch` por tick cueste más que el propio dibujo.
   * Hoy sólo lo cumple `EdgeMarkersView`: pasarla por el estado significaría construir
   * doce veces por segundo un array nuevo —que nunca puede cortocircuitar por
   * `Object.is`— y notificar a todos los suscriptores, cuando su repintado son cinco
   * `transform` que resuelve el compositor. La vista existe precisamente para no hacer
   * eso; encauzarla por el estado desharía su razón de ser.
   */
  get framePort() {
    return { edgeMarkers: this.edgeMarkers };
  }

  subscribeView(view, keys) {
    this.teardown.push(this.store.subscribe(keys, (state, dirty) => view.render(state, dirty)));
  }

  /**
   * Suelta lo que esta capa tiene enganchado fuera de sí misma.
   *
   * En el navegador no lo llama nadie **a propósito**: cerrar la pestaña ya lo libera
   * todo, y engancharlo a `pagehide` rompería la restauración desde la caché de
   * retroceso. Los consumidores reales son Electron al recargar el renderer y el
   * comprobador de fugas. Ver `GameApp.destroy`.
   */
  destroy() {
    this.teardown.forEach(off => off && off());
    this.teardown = [];
    this.offline.destroy();
    clearTimeout(this.rejoinTimer);
  }

  applyViewVisibility(state) {
    this.nodes.main.classList.toggle('hidden', state.view !== 'main');
    this.nodes.lobby.classList.toggle('hidden', state.view !== 'lobby');
    this.nodes.hud.classList.toggle('hidden', state.view !== 'hud');
    this.nodes.topBar.classList.toggle('hidden', state.view === 'hud');
  }

  // ------------------------------------------------------------- eventos

  bindEvents() {
    this.auth = new AuthController({
      api: this.api,
      socket: this.socket,
      store: this.store,
      form: this.form,
      t: this.ctx.t,
      ui: this
    });
    this.rooms = new RoomController({
      socket: this.socket,
      store: this.store,
      form: this.form,
      t: this.ctx.t,
      ui: this
    });

    // Los campos no viven en el store: escribir no debe provocar repintados.
    this.layer.addEventListener('input', e => {
      const field = e.target.dataset.field;
      if (!field) return;
      this.form.set(field, e.target.type === 'checkbox' ? e.target.checked : e.target.value);
    });

    this.layer.addEventListener('submit', e => {
      const form = e.target.closest('[data-submit]');
      if (!form) return;
      e.preventDefault();
      this.dispatch(form.dataset.action, form.dataset);
    });

    this.layer.addEventListener('click', e => {
      const trigger = e.target.closest('[data-action]');
      if (!trigger || trigger.tagName === 'FORM' || trigger.disabled) return;

      // Un botón dentro de un formulario ya dispara la acción vía 'submit'.
      // (Ojo: un <button> sin `type` reporta type="submit" aunque esté fuera de un form.)
      if (e.target.closest('[data-submit]') && e.target.closest('button')?.type !== 'button') return;

      e.preventDefault();
      this.dispatch(trigger.dataset.action, trigger.dataset);
    });

    window.addEventListener('keydown', e => this.onKeyDown(e));
  }

  onKeyDown(e) {
    if (e.key !== 'Escape') return;
    const { view, modal, health } = this.store.get();

    if (modal && !BLOCKING_MODALS.has(modal)) return this.closeModal();
    if (view === 'hud' && health > 0) this.togglePause();
  }

  registerActions() {
    this.actions = {
      'auth:mode': ({ mode }) => this.auth.setMode(mode),
      'auth:submit': () => this.auth.submit(),
      'auth:logout': () => this.auth.logout(),
      'auth:request-pin': () => this.auth.requestPin(),
      'auth:reset-password': () => this.auth.resetPassword(),
      'auth:open-verify': () => this.auth.openVerifyModal(),

      'profile:edit': () => this.auth.openProfileEditor(),
      'profile:save': () => this.auth.saveProfile(),
      'profile:verify': () => this.auth.verify(),
      'profile:resend-pin': () => this.auth.resendPin(),

      'room:create': () => this.rooms.create(),
      'room:join-code': () => this.rooms.joinByCode(),
      'room:join-public': ({ code }) => this.rooms.join(code),
      'room:filter': ({ filter }) => this.rooms.setFilter(filter),
      'room:leave': () => this.rooms.leave(),
      'room:start': () => this.rooms.start(),
      'room:copy-code': () => this.rooms.copyCode(),

      'rank:refresh': () => this.fetchLeaderboard(),
      'rank:sort': ({ sort }) => this.store.patch({ rankSort: sort }),

      'game:offline': () => this.startOffline(),

      'game:pause': () => this.togglePause(true),
      // El mando alterna; el botón del HUD fuerza. Son dos gestos distintos.
      'game:pause-toggle': () => this.togglePause(),
      'game:resume': () => this.togglePause(false),
      'game:respawn': () => this.requestRespawn(),
      'game:regenerate': () => this.requestRegenerate(),

      'net:retry': () => this.socket.socket.connect(),
      'net:abandon': () => this.abandonSession(),

      'modal:open': ({ modal }) => this.store.patch({ modal }),
      'modal:close': () => this.closeModal(),

      'view:fullscreen': () => this.toggleFullscreen(),
      'view:zoom': () => this.commands.cycleZoom(),

      'app:lang': ({ lang }) => this.setLanguage(lang),
      'app:audio': () => this.toggleAudio(),
      // Para que el motor pueda avisar de un fallo sin conocer la i18n.
      'app:alert': ({ key }) => this.alert(this.ctx.t(key)),
      'app:quality': ({ level }) => this.store.patch({ quality: quality.set(level) }),

      'input:rebind': ({ bind, slot }) => this.captureBinding(bind, Number(slot)),
      'input:reset-bindings': () => {
        bindings.reset();
        this.store.patch({ controls: structuredClone(bindings.map), capturingBind: null });
      }
    };
  }

  /**
   * Espera la siguiente tecla y se la asigna a ese hueco.
   *
   * La captura la hace el motor de entrada, no esta capa: es el único sitio que
   * puede tragarse la pulsación antes de que mueva al agente, algo que importa
   * porque los ajustes también se abren desde la pausa, con la partida detrás.
   */
  captureBinding(action, slot) {
    const key = `${action}:${slot}`;

    // Volver a pulsar el hueco que ya estaba capturando lo cancela.
    if (this.store.get().capturingBind === key) {
      this.commands.cancelKeyCapture();
      return this.store.patch({ capturingBind: null });
    }

    this.store.patch({ capturingBind: key });
    this.commands.captureNextKey(code => {
      const result = bindings.assign(action, slot, code);
      this.store.patch({ controls: structuredClone(bindings.map), capturingBind: null });
      if (!result.ok && result.reason === 'reserved') this.alert(this.ctx.t('bind_reserved'));
    });
  }

  // -------------------------------------------------- pantalla completa

  /**
   * El estado no se escribe aquí: lo publica `watchFullscreen`.
   *
   * Es a propósito. El navegador puede negar la petición —fuera de un gesto del
   * usuario, o en un iPhone, donde el elemento raíz no la admite— y el jugador también
   * puede salirse por su cuenta con Escape. Si este método marcase el estado, el icono
   * se quedaría mintiendo en los dos casos.
   */
  async toggleFullscreen() {
    await toggleFullscreen();
  }

  /**
   * Entrar en partida es el momento de pedir pantalla completa y apaisado.
   *
   * Se pide aquí y no al arrancar el juego porque las dos APIs exigen un gesto reciente
   * del jugador, y "pulsar Jugar" lo es. Que fallen no es excepcional: en iOS el
   * bloqueo de orientación no existe, y para eso está `RotateNotice`.
   */
  async enterPlaySession() {
    if (!this.store.get().isTouch) return;
    if (isFullscreenSupported() && !isFullscreen()) await toggleFullscreen();
    else await lockLandscape();
    await requestWakeLock();
  }

  /**
   * Vuelve a pedir el centinela de pantalla al regresar de segundo plano.
   *
   * Se escucha aquí y no en el motor: el sistema suelta el centinela al irse a segundo
   * plano y no lo devuelve solo, así que sin esto volver de una llamada deja el móvil
   * apagándose otra vez. **No** se vuelve a pedir pantalla completa: sin un gesto
   * reciente el navegador la niega, y pedirla en cada cambio de pestaña sólo llenaría
   * la consola de rechazos.
   */
  watchWakeLock() {
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden && this.store.get().running) requestWakeLock();
    });
  }

  /** Al volver al menú se suelta el centinela; la pantalla puede apagarse otra vez. */
  leavePlaySession() {
    releaseWakeLock();
  }

  // ------------------------------------------------------- puerta de acceso

  /**
   * ¿Está la cuenta en condiciones de jugar?
   *
   * Con la sesión iniciada y el correo sin verificar, **no se juega de ninguna
   * manera**: ni en sala ni sin conexión. Quien quiera seguir jugando sin conexión
   * tiene que cerrar sesión, y el botón para hacerlo está en el propio modal que
   * abre esta función.
   *
   * Sin sesión no hay nada que verificar y se juega sin más; ése es justamente el
   * caso para el que existe el modo sin conexión.
   *
   * Vive aquí y no en `RoomController` porque la comprobación estaba solo en el
   * camino de las salas, y por eso la partida sin conexión se colaba por el lado.
   */
  requireVerifiedAccount() {
    const user = this.store.get().user;
    if (!user || user.isVerified !== false) return true;

    this.openModal('verify');
    return false;
  }

  /**
   * Forma y capacidades de la ventana.
   *
   * Se marcan también como clases del documento porque hay reglas de CSS que no
   * pueden expresarse con una consulta de medios: `(pointer: coarse)` no distingue
   * una tableta apaisada de un móvil, y el HUD necesita reordenarse por lo segundo.
   */
  applyViewportState() {
    const isTouch = isCoarsePointer();
    const isPortrait = window.innerHeight > window.innerWidth;

    const root = document.documentElement;
    root.classList.toggle('is-touch', isTouch);
    root.classList.toggle('is-portrait', isPortrait);

    this.store.patch({ isTouch, isPortrait });
  }

  dispatch(action, dataset) {
    const handler = this.actions[action];
    if (!handler) return;
    try {
      handler(dataset);
    } catch (err) {
      console.error(`[ui] acción "${action}" falló:`, err);
      this.alert(this.ctx.t('error_internal'));
    }
  }

  // --------------------------------------------------------- ajustes app

  setLanguage(lang) {
    this.i18n.setLanguage(lang);
    this.ctx.lang = lang;
    this.store.patch({ lang });
    this.mainMenu.mount(this.store.get());
  }

  toggleAudio() {
    const muted = this.sound.toggleMute();
    localStorage.setItem(AUDIO_KEY, String(muted));
    this.store.patch({ audioMuted: muted });
  }

  // ------------------------------------------------------- datos de menú

  refreshMenuData() {
    this.rooms.refresh();
    this.fetchLeaderboard();
    this.fetchAchievements();
    // La sincronización refresca por su cuenta el ranking si llega a aplicar algo,
    // así que no importa que salga después de haberlo pedido.
    this.syncOfflineProgress();
  }

  async fetchLeaderboard() {
    const res = await this.api.getLeaderboard();
    if (res.success) this.store.patch({ leaderboard: res.leaderboard || [] });
  }

  setRooms(rooms) {
    this.store.patch({ rooms: rooms || [] });
  }

  setRoom(room) {
    this.store.patch({ room, roomCode: room ? room.code : '----' });
  }

  // ---------------------------------------------------------- ciclo de red

  get isPaused() {
    return this.store.get().paused;
  }

  get isReconnecting() {
    const state = this.store.get();
    // Una partida local no depende del enlace: congelarla porque el socket esté
    // reintentando sería castigar precisamente el caso para el que existe.
    if (state.offline) return false;
    return state.connection !== 'online';
  }

  onConnected() {
    this.store.patch({ connection: 'online', reconnectAttempt: 0 });

    // Si veníamos de una sala, el servidor debe devolvernos a ella. Si no llega
    // (p. ej. se reinició y perdió las salas), no podemos quedarnos en una sala
    // fantasma enviando movimientos a la nada.
    if (this.pendingRoomCode) {
      clearTimeout(this.rejoinTimer);
      this.rejoinTimer = setTimeout(() => this.onRoomLost(), UIManager.REJOIN_GRACE_MS);
    }

    // La misma guarda que hace `AuthController.onAuthenticated` al iniciar sesión.
    // Aquí faltaba, y era el camino por el que la sincronización sin conexión
    // acababa lanzando su aviso encima del modal de verificación.
    const user = this.store.get().user;
    if (user && user.isVerified !== false) this.refreshMenuData();
  }

  onDisconnected(roomCode) {
    const code = roomCode || this.store.get().lastRoomCode;
    this.pendingRoomCode = this.socket.currentRoom ? code : null;
    this.store.patch({ connection: 'reconnecting', reconnectAttempt: 0, lastRoomCode: code });
  }

  onRoomLost() {
    this.pendingRoomCode = null;
    this.socket.currentRoom = null;
    this.stopGame();
    this.store.patch({
      view: 'main',
      room: null,
      roomCode: '----',
      paused: false,
      connection: 'online',
      modal: 'alert',
      alertMessage: this.ctx.t('error_room_lost')
    });
    this.rooms.refresh();
  }

  /** Un administrador cerró la sala desde el panel. Mismo camino que `onRoomLost`. */
  onRoomClosedByAdmin(reason) {
    this.pendingRoomCode = null;
    this.socket.currentRoom = null;
    this.stopGame();
    this.store.patch({
      view: 'main',
      room: null,
      roomCode: '----',
      paused: false,
      connection: 'online',
      modal: 'alert',
      alertMessage: reason
        ? this.ctx.t('error_room_closed_by_admin').replace('{0}', reason)
        : this.ctx.t('error_room_closed_by_admin_generic')
    });
    this.rooms.refresh();
  }

  onReconnectAttempt(attempt) {
    this.store.patch({ connection: 'reconnecting', reconnectAttempt: attempt });
  }

  onReconnectFailed() {
    this.store.patch({ connection: 'offline' });
  }

  onConnectionError(message) {
    // Token caducado o inválido: no sirve de nada seguir reintentando.
    if (message && message.includes('Autenticación')) {
      this.auth.logout();
      this.alert(this.ctx.t('error_session_expired'));
    }
  }

  onReconnectedToRoom(room) {
    clearTimeout(this.rejoinTimer);
    this.pendingRoomCode = null;
    this.store.patch({
      connection: 'online',
      reconnectAttempt: 0,
      room,
      roomCode: room.code,
      lastRoomCode: room.code,
      view: room.inGame ? 'hud' : 'lobby',
      modal: null
    });
  }

  abandonSession() {
    this.socket.leaveRoom();
    this.stopGame();
    this.store.patch({ view: 'main', connection: 'online', room: null, modal: null, paused: false });
  }

  // ------------------------------------------------------- ciclo de juego

  onGameStarted() {
    this.store.patch({ view: 'hud', modal: null, paused: false });
  }

  /** Entrada a una partida ya empezada: se reconstruye su nivel desde la semilla de la sala. */
  joinRunningLevel(room) {
    this.store.patch({ room, roomCode: room.code, modal: null, paused: false });
    this.commands.startLevel({
      level: room.currentLevel,
      seed: room.seed,
      seedOffset: room.seedOffset,
      playersCount: room.players.length
    });
  }

  /**
   * Tiñe la interfaz con el color del bioma activo.
   *
   * Toda la hoja de estilos consume `--accent`, así que basta con reescribirlo en
   * la raíz: el HUD, los botones y los focos acompañan al nivel en vez de quedarse
   * siempre en cián mientras la escena cambia de color.
   */
  applyThemeAccent(colorHex) {
    if (colorHex === undefined || colorHex === null) return;

    const hex = hexColor(colorHex);
    const r = (colorHex >> 16) & 255;
    const g = (colorHex >> 8) & 255;
    const b = colorHex & 255;

    document.documentElement.style.setProperty('--accent', hex);
    document.documentElement.style.setProperty('--accent-soft', `rgba(${r}, ${g}, ${b}, 0.14)`);
  }

  /**
   * El motor ha terminado de montar un nivel.
   *
   * Es un **aviso**, no un traspaso de datos: esos ya viajaron por `GameState.startLevel`
   * antes de esta llamada. Aquí sólo queda lo que es interfaz —entrar en el HUD, cerrar lo
   * que hubiera abierto y teñirse con el color del bioma—.
   *
   * Pantalla completa y apaisado **ya se pidieron**, al principio de `GameApp._buildLevel`.
   * Aquí llegaban demasiado tarde: cambiar de tamaño reasigna los búferes del
   * postprocesado, y hacerlo justo después de quitar el loader metía un salto de
   * resolución en el primer fotograma que el jugador veía de la sala.
   */
  onLevelStarted() {
    this.applyThemeAccent(this.store.get().themeColor);
    this.store.patch({ view: 'hud', modal: null, paused: false });
  }

  requestRespawn() {
    this.store.patch({ modal: null });
    if (this.socket.currentRoom) {
      this.socket.requestRespawn();
      return;
    }
    // Solitario sin sala: la reaparición se resuelve en el cliente.
    this.commands.respawnLocal();
  }

  requestRegenerate() {
    this.store.patch({ modal: null });
    if (this.socket.currentRoom) this.socket.requestRegenerate();
    else this.commands.regenerateLevel();
  }

  showVictory() {
    this.store.patch({ modal: 'victory' });
  }

  // ----------------------------------------------------------- sin conexión

  /**
   * Arranca una partida en solitario que no necesita servidor.
   *
   * Lo que ocurre después —anotar el progreso, resolver los logros, encadenar niveles— lo
   * lleva `OfflineBridge`: son reglas de partida, y no tenían por qué vivir en la capa que
   * pinta. Aquí sólo queda la puerta de acceso, que sí es de esta capa.
   */
  startOffline() {
    // Era el único camino al juego sin comprobar la cuenta, y el que dejaba a un
    // correo sin verificar acumular partidas que después se sincronizaban.
    if (!this.requireVerifiedAccount()) return;
    this.offline.start();
  }

  /**
   * Vuelca al servidor lo jugado sin conexión.
   *
   * Se lanza al iniciar sesión y al recuperar el enlace. Solo se borra de la cola lo
   * que el servidor confirma haber aplicado: si la petición se corta a medias, lo que
   * quede se reenvía en el siguiente intento en lugar de perderse.
   */
  async syncOfflineProgress() {
    const runs = offlineStore.pendingRuns();
    if (runs.length === 0 || !this.store.get().user) return;

    this.showLoading('loading_syncing');
    const res = await this.api.syncProgress(runs);
    this.hideLoading();
    if (!res.success) return;

    offlineStore.clearSynced(res.applied || 0);
    this.store.patch({ offlinePending: offlineStore.pendingCount });

    if (res.stats) this.onProgressUpdated(res.stats);
    if (res.unlocked && res.unlocked.length > 0) this.onAchievementsUnlocked(res.unlocked);

    if (res.applied > 0) {
      this.alert(this.ctx.t('offline_synced').replace('{0}', res.applied));
      this.fetchLeaderboard();
    }
  }

  /**
   * Logros recién desbloqueados, anunciados por el servidor.
   * Se refresca también la lista del perfil para que el contador cuadre al volver.
   */
  onAchievementsUnlocked(keys = []) {
    if (keys.length === 0) return;

    const catalog = this.store.get().achievementCatalog;

    this.toasts.push(keys, catalog);
    this.sound.playUnlock();

    // Espejo en Steam, sin esperarlo: el aviso y el perfil del juego no dependen de
    // que Steam conteste, y en el navegador esta llamada no hace absolutamente nada.
    mirrorToSteam(keys, catalog);

    const owned = new Set([...(this.store.get().achievements || []), ...keys]);
    this.store.patch({ achievements: [...owned] });
  }

  async fetchAchievements() {
    const res = await this.api.getAchievements();
    if (!res.success) return;

    const keys = res.keys || [];
    this.store.patch({ achievements: keys });

    // Steam no sabe nada de lo conseguido en otra máquina, en el navegador o antes
    // de instalar por Steam. Aquí es donde se pone al día.
    reconcileWithSteam(keys, this.store.get().achievementCatalog);
  }

  /**
   * Catálogo de logros del servidor.
   *
   * Se pide una vez al arrancar y sin sesión: es la lista de metas del juego, la
   * misma para todos. Si no llega, el estado conserva los logros de salida que vienen
   * en el paquete, así que el perfil nunca se queda en blanco.
   */
  async fetchAchievementCatalog() {
    const res = await this.api.getAchievementCatalog();
    if (res.success && Array.isArray(res.catalog) && res.catalog.length > 0) {
      this.store.patch({ achievementCatalog: res.catalog });
    }
  }

  onProgressUpdated(stats) {
    const user = session.patchUser({
      maxLevelReached: stats.maxLevelReached,
      totalPuzzlesSolved: stats.totalPuzzlesSolved,
      totalTimePlayed: stats.totalTimePlayed
    });
    if (user) this.store.patch({ user });
  }

  togglePause(force = null) {
    const state = this.store.get();
    if (state.view !== 'hud' || state.health <= 0) return;

    const paused = force === null ? !state.paused : force;
    this.sound.setMuffled(paused); // la música se ahoga en pausa, no se corta
    this.store.patch({ paused, modal: paused ? 'pause' : null });
  }

  stopGame() {
    this.leavePlaySession();
    this.commands.stop();
  }

  /** Cerrar el menú de pausa también reanuda; el resto de modales no tocan la pausa. */
  closeModal() {
    const patch = { modal: null };
    if (this.store.get().modal === 'pause') patch.paused = false;
    this.store.patch(patch);
  }

  /**
   * Punto único para abrir un modal, con una regla: **un modal bloqueante no se
   * desplaza**.
   *
   * Solo hay un hueco de modal, así que cualquier `patch({ modal })` pisaba el que
   * hubiera. Eso convertía en incidental un bloqueo que debería ser explícito: la
   * verificación de correo se cerraba sola en cuanto la sincronización sin conexión
   * anunciaba su resultado, y como ese aviso sí es descartable, el jugador se
   * quedaba con el menú libre y la cuenta todavía sin verificar.
   *
   * Los avisos que llegan mientras hay una puerta abierta no se pierden: esperan en
   * la cola y salen cuando la puerta se resuelve.
   */
  openModal(id, patch = {}) {
    const current = this.store.get().modal;
    if (current && current !== id && BLOCKING_MODALS.has(current)) {
      if (id === 'alert') this.pendingAlert = patch.alertMessage;
      return false;
    }

    this.store.patch({ modal: id, ...patch });
    return true;
  }

  /** Suelta el aviso que se quedó esperando a que se cerrase un modal bloqueante. */
  flushPendingAlert() {
    if (!this.pendingAlert) return;
    const message = this.pendingAlert;
    this.pendingAlert = null;
    this.alert(message);
  }

  alert(message) {
    this.openModal('alert', { alertMessage: message });
  }

  /**
   * Enciende el overlay de carga con un mensaje traducido.
   * @param {string} key clave i18n del texto a mostrar
   */
  showLoading(key = 'loading_connecting') {
    this.store.patch({ loading: key });
  }

  /** Apaga el overlay de carga. */
  hideLoading() {
    this.store.patch({ loading: null });
  }
}
