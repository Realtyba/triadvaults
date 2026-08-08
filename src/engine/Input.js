import * as THREE from 'three';
import { bindings } from './Bindings.js';
import { GamepadInput } from './Gamepad.js';
import { TouchInput } from './TouchInput.js';

/**
 * Entrada del jugador: teclado remapeable, mando y dedo.
 *
 * Los tres se leen en coordenadas de **pantalla** (x a la derecha, y hacia abajo) y se
 * convierten a mundo en un único sitio. Antes cada tecla sumaba a mano su par de
 * componentes isométricas, y esa conversión repetida cinco veces no dejaba sitio
 * para un stick analógico.
 *
 * ## De pantalla a mundo
 *
 * La base la pone **la cámara** (`EngineCamera.getGroundBasis`), no este módulo. Aquí
 * había una rotación fija de 45° justificada con "la cámara es isométrica", y llevaba
 * tiempo siendo mentira: `EngineCamera.baseOffset` es `(0, 24, 18)`, sin componente en
 * X, o sea sin ningún giro. Empujar el stick hacia arriba movía al agente en diagonal
 * hacia arriba-izquierda, y todas las demás direcciones estaban desviadas otros 45°.
 * Con teclado casi no se notaba —son cuatro direcciones discretas y uno se acostumbra—,
 * pero con un pulgar analógico el control se sentía roto.
 */

/** Un campo de texto con el foco se queda las teclas: escribir no debe mover al agente. */
function isTyping(target) {
  if (!target) return false;
  return ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName) || target.isContentEditable;
}

/**
 * Teclas de zoom, fuera del remapeo.
 *
 * Están aquí y no en `Bindings` por el mismo motivo que Escape: son teclas de la
 * **cámara**, no del agente, y una lista de asignación con cinco filas de movimiento y
 * dos de zoom mezcladas invita a dejarse sin zoom por accidente. Van también en
 * `RESERVED` para que nadie pueda asignarlas a un movimiento y quedarse sin ellas.
 */
const ZOOM_KEYS = {
  Equal: -1,
  NumpadAdd: -1,
  Minus: 1,
  NumpadSubtract: 1
};

/** Cuánto mueve el zoom una pulsación o una muesca de rueda. Ver `EngineCamera.nudgeZoom`. */
const ZOOM_KEY_STEP = 0.12;

/**
 * Una muesca de rueda son 100 en `deltaY`, así que esto es un 6 % por muesca: unas doce
 * para recorrer el rango entero. Con el triple —lo primero que se probó— seis muescas
 * lo cruzaban de tope a tope y era imposible pararse en un encuadre concreto.
 */
const ZOOM_WHEEL_STEP = 0.0006;

/**
 * `deltaY` no viene siempre en píxeles: Firefox informa en líneas y algunos navegadores
 * en páginas. Sin convertirlo, la misma rueda mueve el zoom cien veces menos en un
 * navegador que en otro.
 */
const WHEEL_UNIT_TO_PIXELS = [1, 16, 100];

export class EngineInput {
  constructor() {
    this.keys = { up: false, down: false, left: false, right: false, interact: false };
    this.gamepad = new GamepadInput();
    this.touch = new TouchInput();
    this.moveVector = new THREE.Vector3();

    /** Acciones de mando sin equivalente en el bucle: las consume `GameApp`. */
    this.onGamepadAction = null;

    /** Modo captura: mientras se remapea, la tecla pulsada no debe mover a nadie. */
    this.capturing = null;

    /**
     * Zoom pedido y todavía sin aplicar.
     *
     * Se acumula porque llega por eventos —rueda y dedo— y se consume una vez por
     * fotograma en el bucle, igual que el resto de la entrada: aplicarlo en el propio
     * evento movería la cámara varias veces entre dos imágenes, que es trabajo tirado
     * y además hace que un ratón con rueda libre pegue saltos.
     */
    this.zoomDelta = 0;

    // Los escuchadores se guardan en vez de registrarse con una función anónima: sin
    // la referencia no hay forma de quitarlos, y esta clase vive hasta que se cierra la
    // pestaña. Ver `destroy`, que es lo que permite recargar el renderer de Electron sin
    // dejar la entrada duplicada.
    this.listeners = [
      ['keydown', e => this.onKey(e, true)],
      ['keyup', e => this.onKey(e, false)],
      ['wheel', e => this.onWheel(e), { passive: true }],
      // Al perder el foco (alt-tab) no llega el `keyup`, y el agente se quedaba
      // andando solo contra una pared hasta que se volvía a pulsar la tecla.
      ['blur', () => this.releaseAll()]
    ];
    this.listeners.forEach(([type, handler, options]) => window.addEventListener(type, handler, options));
  }

  /** Suelta teclado y rueda, y con ellos el mando y el dedo. */
  destroy() {
    this.listeners.forEach(([type, handler]) => window.removeEventListener(type, handler));
    this.listeners = [];
    this.gamepad.destroy();
    // `TouchInput` ya sabía soltarse; se llama `release` porque también se usa al ocultar
    // la capa táctil, no sólo al cerrar.
    this.touch.release();
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

    if (ZOOM_KEYS[event.code] !== undefined) {
      // Solo al pulsar: la repetición automática del teclado la aporta el propio
      // sistema y con ella el zoom se dispara de un tope al otro.
      if (pressed) this.zoomDelta += ZOOM_KEYS[event.code] * ZOOM_KEY_STEP;
      event.preventDefault();
      return;
    }

    const action = bindings.actionFor(event.code);
    if (!action) return;

    event.preventDefault();
    this.keys[action] = pressed;
  }

  /**
   * Rueda del ratón.
   *
   * Se ignora sobre la interfaz: los ajustes y la lista de salas se desplazan con la
   * rueda, y quien está leyendo un modal no está moviendo la cámara. El lienzo no es
   * hijo de `#ui-layer`, así que la comprobación separa exactamente los dos casos.
   */
  onWheel(event) {
    if (event.target?.closest?.('#ui-layer')) return;
    const pixels = event.deltaY * (WHEEL_UNIT_TO_PIXELS[event.deltaMode] || 1);
    this.zoomDelta += pixels * ZOOM_WHEEL_STEP;
  }

  /**
   * Zoom pedido desde el último fotograma. Lo consume el bucle, que lo entrega a la
   * cámara; devolver y vaciar en la misma llamada evita que dos lectores se lo apliquen
   * dos veces.
   */
  consumeZoom() {
    const delta = this.zoomDelta + this.touch.consumeZoom();
    this.zoomDelta = 0;
    return delta;
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
   * Sondea los dispositivos que no avisan por eventos. Se llama una vez por fotograma
   * desde el bucle, **también en pausa**: si solo se leyera durante la simulación, el
   * botón Start podría abrir el menú pero no cerrarlo.
   */
  update() {
    this.touchAxes = this.touch.poll();

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

  get hasTouch() {
    return this.touch.isActive;
  }

  /**
   * Qué está usando el jugador ahora mismo, para el indicador del HUD.
   *
   * El mando gana al dedo porque quien enchufa uno en un móvil lo hace para usarlo;
   * el dedo gana al teclado porque en un táctil el teclado no existe. No se guarda
   * "el último usado" a propósito: el indicador cambiaría de sitio cada vez que se
   * roza la pantalla con la palma.
   */
  get mode() {
    if (this.gamepad.isConnected) return 'gamepad';
    if (this.touch.isActive) return 'touch';
    return 'keyboard';
  }

  /**
   * Dirección de movimiento en coordenadas de mundo.
   *
   * El módulo se conserva por debajo de 1 a propósito: con el stick a medio camino
   * el agente anda despacio, porque `Player.update` multiplica este vector por la
   * velocidad. Un `normalize()` incondicional —lo que hacía la versión de teclado—
   * convertiría cualquier inclinación en carrera a tope.
   *
   * @param {{right: THREE.Vector3, forward: THREE.Vector3}} [basis] ejes de pantalla
   *   proyectados al suelo, de `EngineCamera.getGroundBasis()`. Sin base se asume la
   *   correspondencia directa (derecha → +X, arriba → −Z), que es la de una cámara sin
   *   girar; sirve para las pruebas, no para el juego.
   */
  getMovementVector(basis) {
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

    if (this.touchAxes) {
      sx += this.touchAxes.x;
      sy += this.touchAxes.y;
    }

    const length = Math.hypot(sx, sy);
    if (length === 0) return this.moveVector.set(0, 0, 0);

    // Teclado, mando y dedo pueden sumar más de 1 si se usan a la vez; se recorta sin
    // tocar la intensidad analógica cuando ya venía por debajo.
    const scale = Math.min(1, length) / length;

    // `sy` crece hacia **abajo** en pantalla, así que se invierte para que empujar
    // hacia arriba avance en el sentido en el que mira la cámara.
    if (!basis) return this.moveVector.set(sx * scale, 0, sy * scale);

    return this.moveVector
      .copy(basis.right)
      .multiplyScalar(sx * scale)
      .addScaledVector(basis.forward, -sy * scale);
  }
}
