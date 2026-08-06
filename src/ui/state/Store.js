/**
 * Estado de UI con notificación por claves.
 *
 * El problema que resuelve: antes cualquier cambio de estado reescribía el
 * `innerHTML` completo de la interfaz, y como el HUD se actualiza dentro del bucle
 * de render eso ocurría 60 veces por segundo. Aquí cada vista declara de qué claves
 * depende y solo se le avisa cuando alguna cambia de verdad.
 */
export class Store {
  constructor(initialState = {}) {
    this.state = { ...initialState };
    this.subscribers = [];
  }

  get() {
    return this.state;
  }

  /** Aplica cambios y notifica solo a quien dependa de las claves modificadas. */
  patch(partial) {
    const dirty = [];

    for (const [key, value] of Object.entries(partial)) {
      if (Object.is(this.state[key], value)) continue;
      this.state[key] = value;
      dirty.push(key);
    }

    if (dirty.length === 0) return dirty;

    const dirtySet = new Set(dirty);
    this.subscribers.forEach(({ keys, handler }) => {
      if (keys === null || keys.some(key => dirtySet.has(key))) handler(this.state, dirtySet);
    });

    return dirty;
  }

  /**
   * @param {string[]|null} keys claves observadas; `null` observa cualquier cambio
   * @param {(state: object, dirty: Set<string>) => void} handler
   */
  subscribe(keys, handler) {
    const entry = { keys, handler };
    this.subscribers.push(entry);
    return () => {
      const index = this.subscribers.indexOf(entry);
      if (index !== -1) this.subscribers.splice(index, 1);
    };
  }
}
