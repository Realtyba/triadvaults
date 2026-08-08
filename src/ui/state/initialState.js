import { DEFAULT_ACHIEVEMENTS, sortCatalog } from '../../../shared/achievements.js';
import { offlineStore } from '../../network/OfflineStore.js';

/** Estado reactivo de la UI. Los valores de formularios NO viven aquí: ver `FormState`. */
export function createInitialState({ user, lang, audioMuted, quality, qualityOptions, controls, isTouch = false }) {
  return {
    view: 'main', // 'main' | 'lobby' | 'hud'
    modal: null,
    lang,
    audioMuted,
    quality, // preset gráfico activo: 'bajo' | 'medio' | 'alto' | 'ultra'
    qualityOptions,

    // controles
    controls, // asignación de teclas vigente, acción → [principal, alternativa]
    capturingBind: null, // "acción:hueco" mientras se espera una pulsación
    gamepadName: null, // identificador del mando conectado, si lo hay
    // El aparato admite dedo: decide si se monta la capa de controles táctiles. Es
    // una propiedad del dispositivo, no de lo que el jugador esté usando ahora.
    isTouch,
    // Portrait obliga a recolocar el HUD, no solo a encogerlo.
    isPortrait: false,
    // Lo publica `watchFullscreen`, nunca el botón: también se sale con Escape o con
    // el gesto del sistema, y el icono tiene que reflejar la realidad.
    isFullscreen: false,
    // Compañeros de sala en partida: [{ uid, name, health, alive, isLocal }].
    teammates: [],

    // sesión
    user,
    authMode: 'login', // 'login' | 'register' | 'recover'
    authMessage: '',
    recoverPinRequested: false,
    profileMessage: '',
    verifyMessage: '',
    verifyDevCode: null, // PIN mostrado en pantalla solo en desarrollo sin SMTP
    resendCooldown: 0, // segundos que faltan para poder reenviar el PIN

    // salas
    rooms: [],
    roomFilter: 'all', // 'all' | 'joinable' | 'in_game'
    leaderboard: [],
    rankSort: 'level', // 'level' | 'puzzles' | 'time'
    achievements: [], // claves desbloqueadas por el agente conectado
    // Catálogo de logros. Arranca con los de salida que vienen en el paquete y se
    // reemplaza por el del servidor en cuanto responde: así el perfil pinta algo
    // desde el primer fotograma y el modo sin conexión sigue teniendo metas.
    achievementCatalog: sortCatalog(DEFAULT_ACHIEVEMENTS),
    room: null,

    // sin conexión
    offline: false, // partida local en curso, sin servidor de por medio
    offlinePending: offlineStore.pendingCount, // niveles sin red esperando a sincronizarse

    // conexión
    connection: 'online', // 'online' | 'reconnecting' | 'offline'
    reconnectAttempt: 0,
    lastRoomCode: null,

    // partida
    level: 1,
    // El bioma **crudo**: `HudView` compone con él la etiqueta, y `--accent` sale del
    // color. Antes el motor mandaba la etiqueta ya montada y el objetivo ya traducido,
    // lo que le obligaba a conocer la i18n y dejaba el objetivo en el idioma que hubiera
    // al empezar el nivel: cambiarlo a mitad de partida no lo retraducía.
    themeName: '',
    themeColor: null,
    seedLabel: '#0000',
    roomCode: '----',
    playersCount: 1,
    health: 100,
    objectiveKey: '',
    puzzleProgress: 0,
    puzzleSolved: false,
    elapsedTime: 0,
    inputMode: 'keyboard', // lo que el jugador está usando: 'keyboard' | 'gamepad' | 'touch'
    // Zoom de cámara en porcentaje; 100 es el encuadre por defecto. Lo publica
    // `GameApp.publishZoom`, que es quien habla con la cámara: aquí solo se pinta.
    zoom: 100,
    paused: false,
    // Estado del agente local en el nivel. Los escribe el motor; la interfaz decide qué
    // modal abrir y si ofrecer regenerar. Ver `GameState.setDeaths`.
    localAlive: true,
    deathCount: 0,
    // ¿Hay un nivel en curso? Lo publica `GameApp.running`.
    running: false,
    alertMessage: '',
    // null = no cargando; string = clave i18n del mensaje que muestra el overlay.
    // Lo encienden `showLoading` / `hideLoading` de UIManager.
    loading: null
  };
}

/**
 * Valores de los campos de formulario, deliberadamente fuera del store.
 * Si formaran parte del estado reactivo, cada tecla provocaría un re-render y el
 * input perdería el foco y el cursor a mitad de escritura.
 */
export class FormState {
  constructor() {
    this.values = {};
  }

  get(name, fallback = '') {
    return this.values[name] !== undefined ? this.values[name] : fallback;
  }

  set(name, value) {
    this.values[name] = value;
  }

  setMany(patch) {
    Object.assign(this.values, patch);
  }

  clear(...names) {
    names.forEach(name => delete this.values[name]);
  }
}
