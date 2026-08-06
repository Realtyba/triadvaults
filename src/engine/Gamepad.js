/**
 * Lectura de mando mediante la Gamepad API.
 *
 * Se consulta por sondeo dentro del bucle, no por eventos: el navegador no emite
 * nada cuando cambia un eje, solo al conectar y desconectar. `navigator.getGamepads()`
 * devuelve una foto nueva en cada llamada, así que hay que pedirla cada fotograma y
 * no guardarse el objeto.
 */

/**
 * Zona muerta radial —sobre el módulo del vector, no sobre cada eje por separado—
 * porque con umbral por eje una diagonal suave se corta en escalones y el personaje
 * anda a tirones. Los sticks desgastados no vuelven exactamente al centro, y 0.25
 * cubre ese descentrado sin comerse el movimiento lento.
 */
const DEADZONE = 0.25;

/** Distribución estándar: eje 0 horizontal, eje 1 vertical del stick izquierdo. */
const AXIS_X = 0;
const AXIS_Y = 1;

const DPAD = { up: 12, down: 13, left: 14, right: 15 };

// Botones por acción, en la disposición estándar (A/Cruz, X/Cuadrado, Start).
const BUTTONS = {
  interact: [0, 2],
  pause: [9],
  respawn: [3]
};

const PRESS_THRESHOLD = 0.5;

export class GamepadInput {
  constructor() {
    this.name = null;
    this.index = null;
    this.wasPressed = new Set();
    this.onConnectionChange = null;

    window.addEventListener('gamepadconnected', e => this.setConnected(e.gamepad));
    window.addEventListener('gamepaddisconnected', e => {
      if (this.index === e.gamepad.index) this.setConnected(null);
    });
  }

  setConnected(pad) {
    this.name = pad ? pad.id : null;
    this.index = pad ? pad.index : null;
    this.wasPressed.clear();
    if (this.onConnectionChange) this.onConnectionChange(this.name);
  }

  get isConnected() {
    return this.index !== null;
  }

  /**
   * Mando activo, o `null` si no hay ninguno.
   *
   * Mientras no se haya conectado nada NO se llama a `navigator.getGamepads()`. Esa
   * llamada construye una instantánea nueva del estado de todos los mandos cada vez,
   * y hacerla sesenta veces por segundo para descubrir que no hay ninguno costaba
   * un tercio de la tasa de refresco —lo detectó la comprobación de bucle del e2e—.
   *
   * Esperar al evento es además lo correcto: `gamepadconnected` también se emite por
   * un mando que ya estuviera enchufado al cargar la página, en cuanto se pulsa algo
   * en él. El navegador lo oculta hasta entonces a propósito, para no dar una huella
   * de identificación a cualquier página que pregunte.
   */
  read() {
    if (this.index === null || !navigator.getGamepads) return null;
    const pad = navigator.getGamepads()[this.index];
    return pad && pad.connected ? pad : null;
  }

  static isDown(pad, index) {
    const button = pad.buttons[index];
    if (!button) return false;
    return typeof button === 'object' ? button.pressed || button.value > PRESS_THRESHOLD : button > PRESS_THRESHOLD;
  }

  static anyDown(pad, indices) {
    return indices.some(index => GamepadInput.isDown(pad, index));
  }

  /**
   * Estado del mando en este fotograma.
   *
   * @returns {{x: number, y: number, interact: boolean, justPressed: Set<string>}|null}
   *          `x`/`y` en coordenadas de pantalla (y positivo hacia abajo).
   */
  poll() {
    const pad = this.read();
    if (!pad) {
      // El mando desapareció sin que llegase el evento de desconexión.
      if (this.index !== null) this.setConnected(null);
      return null;
    }

    let x = pad.axes[AXIS_X] || 0;
    let y = pad.axes[AXIS_Y] || 0;

    const magnitude = Math.hypot(x, y);
    if (magnitude < DEADZONE) {
      x = 0;
      y = 0;
    } else {
      // Se reescala el tramo útil a 0..1. Sin esto el personaje arrancaría de
      // golpe a un cuarto de velocidad en cuanto el stick sale de la zona muerta.
      const scaled = Math.min(1, (magnitude - DEADZONE) / (1 - DEADZONE)) / magnitude;
      x *= scaled;
      y *= scaled;
    }

    // La cruceta es digital y manda sobre el stick: quien la usa quiere ir recto.
    if (GamepadInput.isDown(pad, DPAD.left)) x = -1;
    if (GamepadInput.isDown(pad, DPAD.right)) x = 1;
    if (GamepadInput.isDown(pad, DPAD.up)) y = -1;
    if (GamepadInput.isDown(pad, DPAD.down)) y = 1;

    const justPressed = new Set();
    for (const [action, indices] of Object.entries(BUTTONS)) {
      const down = GamepadInput.anyDown(pad, indices);
      // Flanco de subida: la pausa se dispara al pulsar, no mientras se sostiene,
      // o un botón mantenido abriría y cerraría el menú sesenta veces por segundo.
      if (down && !this.wasPressed.has(action)) justPressed.add(action);
      if (down) this.wasPressed.add(action);
      else this.wasPressed.delete(action);
    }

    return { x, y, interact: GamepadInput.anyDown(pad, BUTTONS.interact), justPressed };
  }
}
