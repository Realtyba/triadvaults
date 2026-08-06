/**
 * Asignación de teclas, persistida entre sesiones.
 *
 * Las teclas estaban escritas dentro de `Input.js`, así que quien jugara en un
 * teclado que no fuera QWERTY —AZERTY mueve con ZQSD— no tenía forma de cambiarlas.
 * Es de lo primero que se mira al valorar un juego en Steam.
 *
 * Cada acción tiene dos huecos, principal y alternativa, para poder conservar
 * flechas y letras a la vez sin inventar una interfaz de lista variable.
 */

const STORAGE_KEY = 'triad_bindings';

/** Acciones remapeables. La pausa no está: la gobierna Escape en `UIManager`. */
export const ACTIONS = ['up', 'down', 'left', 'right', 'interact'];

export const DEFAULT_BINDINGS = {
  up: ['KeyW', 'ArrowUp'],
  down: ['KeyS', 'ArrowDown'],
  left: ['KeyA', 'ArrowLeft'],
  right: ['KeyD', 'ArrowRight'],
  interact: ['Space', 'KeyE']
};

/** Códigos que no se pueden asignar: dejarían al jugador sin salir del juego. */
const RESERVED = new Set(['Escape', 'F5', 'F11', 'F12', 'Tab']);

const SYMBOLS = {
  ArrowUp: '↑',
  ArrowDown: '↓',
  ArrowLeft: '←',
  ArrowRight: '→',
  ShiftLeft: '⇧ IZQ',
  ShiftRight: '⇧ DER',
  ControlLeft: 'CTRL IZQ',
  ControlRight: 'CTRL DER',
  AltLeft: 'ALT IZQ',
  AltRight: 'ALT DER',
  Enter: '⏎'
};

/**
 * Etiqueta legible de un `KeyboardEvent.code`.
 *
 * Se usa `code` y no `key` porque `code` describe la posición física: en un teclado
 * AZERTY la tecla que está donde la W del QWERTY sigue reportando `KeyW`, y así el
 * remapeo se guarda igual sin importar la distribución del sistema.
 *
 * @param {string} code
 * @param {Function} [t] traductor, para las teclas cuyo nombre sí se traduce
 */
export function keyLabel(code, t = key => key) {
  if (!code) return '—';
  if (code === 'Space') return t('key_space');
  if (SYMBOLS[code]) return SYMBOLS[code];
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  if (code.startsWith('Numpad')) return `NUM ${code.slice(6)}`;
  return code.toUpperCase();
}

export class Bindings {
  constructor() {
    this.map = this.load();
    this.reindex();
  }

  load() {
    const defaults = structuredClone(DEFAULT_BINDINGS);
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
      // Se fusiona sobre los valores por defecto en vez de sustituirlos: una
      // partida guardada de una versión anterior no conoce las acciones nuevas, y
      // sin la fusión esas acciones se quedarían sin ninguna tecla.
      for (const action of ACTIONS) {
        if (Array.isArray(saved[action])) defaults[action] = saved[action].slice(0, 2);
      }
    } catch {
      // Un valor corrupto en localStorage no puede dejar el juego sin controles.
    }
    return defaults;
  }

  save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.map));
    } catch {
      // Modo privado o cuota llena: se juega igual, solo no se recuerda.
    }
  }

  /** Índice inverso código → acción, para no recorrer el mapa en cada tecla. */
  reindex() {
    this.byCode = new Map();
    for (const action of ACTIONS) {
      (this.map[action] || []).forEach(code => code && this.byCode.set(code, action));
    }
  }

  actionFor(code) {
    return this.byCode.get(code) || null;
  }

  codesFor(action) {
    const codes = this.map[action] || [];
    return [codes[0] || null, codes[1] || null];
  }

  /**
   * Asigna una tecla a un hueco.
   *
   * Si esa tecla ya servía para otra cosa, se la quita: dejar un código en dos
   * acciones haría que moverse a la izquierda también activase una placa, y el
   * jugador no tendría ninguna pista de por qué.
   *
   * @returns {{ok: boolean, reason?: string, stolenFrom?: string}}
   */
  assign(action, slot, code) {
    if (!ACTIONS.includes(action) || slot < 0 || slot > 1) return { ok: false, reason: 'unknown' };
    if (RESERVED.has(code)) return { ok: false, reason: 'reserved' };

    let stolenFrom = null;
    for (const other of ACTIONS) {
      const codes = this.map[other];
      const index = codes.indexOf(code);
      if (index === -1) continue;
      if (other === action && index === slot) return { ok: true }; // ya estaba ahí
      codes[index] = null;
      stolenFrom = other;
    }

    this.map[action][slot] = code;

    // Una acción sin ninguna tecla es una acción que no se puede ejecutar. Si al
    // robar el código se quedó vacía, hereda el hueco que acaba de liberarse.
    if (stolenFrom && stolenFrom !== action && !this.map[stolenFrom].some(Boolean)) {
      this.map[stolenFrom][0] = this.map[action][slot === 0 ? 1 : 0];
      this.map[action][slot === 0 ? 1 : 0] = null;
    }

    this.reindex();
    this.save();
    return { ok: true, stolenFrom };
  }

  reset() {
    this.map = structuredClone(DEFAULT_BINDINGS);
    this.reindex();
    this.save();
    return this.map;
  }
}

/** Instancia única: la comparten el motor de entrada y la pantalla de ajustes. */
export const bindings = new Bindings();
