import * as THREE from 'three';
import { bindings } from './Bindings.js';
import { GamepadInput } from './Gamepad.js';

/**
 * Entrada del jugador: teclado remapeable y mando.
 *
 * Ambos se leen en coordenadas de **pantalla** (x a la derecha, y hacia abajo) y se
 * convierten a mundo en un único sitio. Antes cada tecla sumaba a mano su par de
 * componentes isométricas, y esa conversión repetida cinco veces no dejaba sitio
 * para un stick analógico.
 */

/**
 * La cámara es isométrica: la pantalla está girada 45° respecto al mundo. Empujar
 * el stick a la derecha tiene que llevar al personaje hacia donde el jugador ve la
 * derecha, no hacia el eje X del mundo.
 */
const ISO = Math.SQRT1_2;

/** Un campo de texto con el foco se queda las teclas: escribir no debe mover al agente. */
function isTyping(target) {
  if (!target) return false;
  return ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName) || target.isContentEditable;
}

export class EngineInput {
  constructor() {
    this.keys = { up: false, down: false, left: false, right: false, interact: false };
    this.gamepad = new GamepadInput();
    this.moveVector = new THREE.Vector3();

    /** Acciones de mando sin equivalente en el bucle: las consume `GameApp`. */
    this.onGamepadAction = null;

    /** Modo captura: mientras se remapea, la tecla pulsada no debe mover a nadie. */
    this.capturing = null;

    window.addEventListener('keydown', e => this.onKey(e, true));
    window.addEventListener('keyup', e => this.onKey(e, false));

    // Al perder el foco (alt-tab) no llega el `keyup`, y el agente se quedaba
    // andando solo contra una pared hasta que se volvía a pulsar la tecla.
    window.addEventListener('blur', () => this.releaseAll());
  }

  onKey(event, pressed) {
    if (isTyping(event.target)) return;

    // Una captura de remapeo se lleva la pulsación entera, incluida la repetición
    // automática, para no asignar la misma tecla dos veces.
    if (this.capturing) {
      if (pressed && !event.repeat) {
        const action = this.capturing;
        this.capturing = null;
        event.preventDefault();
        action(event.code);
      }
      return;
    }

    const action = bindings.actionFor(event.code);
    if (!action) return;

    event.preventDefault();
    this.keys[action] = pressed;
  }

  releaseAll() {
    Object.keys(this.keys).forEach(action => {
      this.keys[action] = false;
    });
  }

  /**
   * Espera la siguiente tecla y la entrega al callback, sin que llegue al juego.
   * @param {(code: string) => void} callback
   */
  captureNextKey(callback) {
    this.capturing = callback;
  }

  cancelCapture() {
    this.capturing = null;
  }

  /**
   * Sondea el mando. Se llama una vez por fotograma desde el bucle, **también en
   * pausa**: si solo se leyera durante la simulación, el botón Start podría abrir el
   * menú pero no cerrarlo.
   */
  update() {
    this.pad = this.gamepad.poll();
    if (!this.pad || this.pad.justPressed.size === 0) return;

    this.pad.justPressed.forEach(action => {
      if (action !== 'interact' && this.onGamepadAction) this.onGamepadAction(action);
    });
  }

  get interact() {
    return this.keys.interact || Boolean(this.pad && this.pad.interact);
  }

  get hasGamepad() {
    return this.gamepad.isConnected;
  }

  /**
   * Dirección de movimiento en coordenadas de mundo.
   *
   * El módulo se conserva por debajo de 1 a propósito: con el stick a medio camino
   * el agente anda despacio, porque `Player.update` multiplica este vector por la
   * velocidad. Un `normalize()` incondicional —lo que hacía la versión de teclado—
   * convertiría cualquier inclinación en carrera a tope.
   */
  getMovementVector() {
    let sx = 0;
    let sy = 0;

    if (this.keys.left) sx -= 1;
    if (this.keys.right) sx += 1;
    if (this.keys.up) sy -= 1;
    if (this.keys.down) sy += 1;

    if (this.pad) {
      sx += this.pad.x;
      sy += this.pad.y;
    }

    const length = Math.hypot(sx, sy);
    if (length === 0) return this.moveVector.set(0, 0, 0);

    // Teclado y mando pueden sumar más de 1 si se usan a la vez; se recorta sin
    // tocar la intensidad analógica cuando ya venía por debajo.
    const scale = Math.min(1, length) / length;
    return this.moveVector.set((sx + sy) * scale * ISO, 0, (sy - sx) * scale * ISO);
  }
}
