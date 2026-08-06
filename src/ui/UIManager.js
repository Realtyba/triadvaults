import { I18nManager } from '../i18n/I18nManager.js';
import { ApiClient } from '../network/ApiClient.js';
import { session } from '../network/session.js';
import { Store } from './state/Store.js';
import { createInitialState, FormState } from './state/initialState.js';
import { MainMenuView } from './views/MainMenuView.js';
import { LobbyView } from './views/LobbyView.js';
import { HudView } from './views/HudView.js';
import { ReconnectingOverlay } from './views/ReconnectingOverlay.js';
import { AchievementToast } from './views/AchievementToast.js';
import { ModalHost } from './modals/ModalHost.js';
import { BLOCKING_MODALS } from './modals/definitions.js';
import { AuthController } from './controllers/AuthController.js';
import { RoomController } from './controllers/RoomController.js';
import { el } from './dom.js';
import { icon } from './icons.js';
import { quality } from '../engine/QualitySettings.js';
import { bindings } from '../engine/Bindings.js';

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

  constructor({ socket, sound, game }) {
    this.socket = socket;
    this.sound = sound;
    this.game = game;

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
        controls: structuredClone(bindings.map)
      })
    );

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
      modal: el('div', { className: 'modal-host hidden' }),
      reconnect: el('div', { className: 'reconnect-overlay hidden' }),
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
      <button class="icon-btn" data-action="app:audio" title="${t('btn_audio')}" aria-label="${t('btn_audio')}">
        ${icon(audioMuted ? 'audioOff' : 'audioOn', { size: 18 })}
      </button>
      <button class="icon-btn" data-action="modal:open" data-modal="settings"
              title="${t('settings_title')}" aria-label="${t('settings_title')}">
        ${icon('settings', { size: 18 })}
      </button>
      <div class="lang-picker">
        <button class="lang-btn ${lang === 'es' ? 'is-active' : ''}" data-action="app:lang" data-lang="es">ES</button>
        <button class="lang-btn ${lang === 'en' ? 'is-active' : ''}" data-action="app:lang" data-lang="en">EN</button>
      </div>
    `;
  }

  mountViews() {
    const state = this.store.get();

    this.mainMenu = new MainMenuView(this.nodes.main, this.ctx);
    this.lobby = new LobbyView(this.nodes.lobby, this.ctx);
    this.hud = new HudView(this.nodes.hud, this.ctx);
    this.modals = new ModalHost(this.nodes.modal, this.ctx);
    this.reconnect = new ReconnectingOverlay(this.nodes.reconnect, this.ctx);
    this.toasts = new AchievementToast(this.nodes.toast, this.ctx);

    this.mainMenu.mount(state);
    this.hud.mount();

    this.subscribeView(this.mainMenu, MainMenuView.keys ?? null);
    this.subscribeView(this.lobby, LobbyView.keys);
    this.subscribeView(this.hud, HudView.keys);
    this.subscribeView(this.modals, ModalHost.keys);
    this.subscribeView(this.reconnect, ReconnectingOverlay.keys);

    this.store.subscribe(['view'], s => this.applyViewVisibility(s));
    this.store.subscribe(['lang', 'audioMuted'], () => this.renderTopBar());

    this.applyViewVisibility(state);
    this.lobby.render(state, null);
    this.hud.render(state);
    this.modals.render(state, null);
    this.reconnect.render(state, null);
  }

  subscribeView(view, keys) {
    this.store.subscribe(keys, (state, dirty) => view.render(state, dirty));
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

      'game:pause': () => this.togglePause(true),
      'game:resume': () => this.togglePause(false),
      'game:respawn': () => this.requestRespawn(),
      'game:regenerate': () => this.requestRegenerate(),

      'net:retry': () => this.socket.socket.connect(),
      'net:abandon': () => this.abandonSession(),

      'modal:open': ({ modal }) => this.store.patch({ modal }),
      'modal:close': () => this.closeModal(),

      'app:lang': ({ lang }) => this.setLanguage(lang),
      'app:audio': () => this.toggleAudio(),
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
      this.game.input.cancelCapture();
      return this.store.patch({ capturingBind: null });
    }

    this.store.patch({ capturingBind: key });
    this.game.input.captureNextKey(code => {
      const result = bindings.assign(action, slot, code);
      this.store.patch({ controls: structuredClone(bindings.map), capturingBind: null });
      if (!result.ok && result.reason === 'reserved') this.alert(this.ctx.t('bind_reserved'));
    });
  }

  /** El mando aparece y desaparece en caliente; los ajustes lo reflejan. */
  setGamepad(name) {
    this.store.patch({ gamepadName: name });
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
    return this.store.get().connection !== 'online';
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

    if (this.store.get().user) this.refreshMenuData();
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
    this.game.startLevel({
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

    const hex = `#${colorHex.toString(16).padStart(6, '0')}`;
    const r = (colorHex >> 16) & 255;
    const g = (colorHex >> 8) & 255;
    const b = colorHex & 255;

    document.documentElement.style.setProperty('--accent', hex);
    document.documentElement.style.setProperty('--accent-soft', `rgba(${r}, ${g}, ${b}, 0.14)`);
  }

  onLevelStarted({
    level,
    playersCount,
    seedLabel,
    themeName,
    themeColor,
    roomCode,
    requiredPlates,
    objectiveKey,
    health
  }) {
    this.applyThemeAccent(themeColor);

    // El objetivo lo dicta el arquetipo de puzle, no el número de placas: con
    // secuencias y relevos la cuenta ya no describe lo que hay que hacer.
    const key =
      objectiveKey ||
      (requiredPlates === 1 ? 'solo_objective' : requiredPlates === 2 ? 'duo_objective' : 'squad_objective');

    this.store.patch({
      view: 'hud',
      modal: null,
      paused: false,
      level,
      levelLabel: `${level} · ${themeName}`,
      seedLabel,
      roomCode: roomCode || 'LOCAL',
      lastRoomCode: roomCode || this.store.get().lastRoomCode,
      playersCount,
      health,
      objectiveText: this.ctx.t(key),
      puzzleProgress: 0,
      puzzleSolved: false,
      canRegenerate: false
    });
  }

  setHealth(health) {
    this.store.patch({ health: Math.max(0, health) });
  }

  setObjectiveProgress(progress, solved) {
    this.store.patch({ puzzleProgress: progress, puzzleSolved: solved });
  }

  onLocalDeath(deathCount) {
    // Tras varias muertes seguidas se ofrece regenerar el nivel por si quedó injugable.
    this.store.patch({ modal: 'game-over', canRegenerate: deathCount >= 3, paused: false });
  }

  onLocalRespawn() {
    this.store.patch({ modal: null });
  }

  requestRespawn() {
    this.store.patch({ modal: null });
    if (this.socket.currentRoom) {
      this.socket.requestRespawn();
      return;
    }
    // Solitario sin sala: la reaparición se resuelve en el cliente.
    this.game.respawn(this.game.players.localUid, 100, Date.now() % 7);
  }

  requestRegenerate() {
    this.store.patch({ modal: null, canRegenerate: false });
    if (this.socket.currentRoom) this.socket.requestRegenerate();
    else this.game.regenerateLevel({});
  }

  showVictory() {
    this.store.patch({ modal: 'victory' });
  }

  /**
   * Logros recién desbloqueados, anunciados por el servidor.
   * Se refresca también la lista del perfil para que el contador cuadre al volver.
   */
  onAchievementsUnlocked(keys = []) {
    if (keys.length === 0) return;

    this.toasts.push(keys, this.store.get().achievementCatalog);
    this.sound.playUnlock();

    const owned = new Set([...(this.store.get().achievements || []), ...keys]);
    this.store.patch({ achievements: [...owned] });
  }

  async fetchAchievements() {
    const res = await this.api.getAchievements();
    if (res.success) this.store.patch({ achievements: res.keys || [] });
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
    if (this.game) this.game.stop();
  }

  /** Cerrar el menú de pausa también reanuda; el resto de modales no tocan la pausa. */
  closeModal() {
    const patch = { modal: null };
    if (this.store.get().modal === 'pause') patch.paused = false;
    this.store.patch(patch);
  }

  alert(message) {
    this.store.patch({ modal: 'alert', alertMessage: message });
  }
}
