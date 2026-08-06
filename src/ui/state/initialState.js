import { DEFAULT_ACHIEVEMENTS, sortCatalog } from '../../../shared/achievements.js';

/** Estado reactivo de la UI. Los valores de formularios NO viven aquí: ver `FormState`. */
export function createInitialState({ user, lang, audioMuted, quality, qualityOptions, controls }) {
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

    // conexión
    connection: 'online', // 'online' | 'reconnecting' | 'offline'
    reconnectAttempt: 0,
    lastRoomCode: null,

    // partida
    level: 1,
    levelLabel: '',
    seedLabel: '#0000',
    roomCode: '----',
    playersCount: 1,
    health: 100,
    objectiveText: '',
    puzzleProgress: 0,
    puzzleSolved: false,
    elapsedTime: 0,
    hasGamepad: false,
    paused: false,
    canRegenerate: false,
    alertMessage: ''
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
