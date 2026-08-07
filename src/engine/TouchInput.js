/**
 * Entrada táctil: un joystick virtual flotante.
 *
 * Se lee **por sondeo dentro del bucle**, igual que el mando y por el mismo motivo:
 * los eventos de puntero llegan cuando el dedo se mueve, no una vez por fotograma, y
 * mezclar las dos cadencias hacía que el personaje acelerase al arrastrar deprisa.
 * Los eventos sólo actualizan un vector; quien lo consume es `poll()`.
 *
 * El contrato de salida es el mismo que el de `GamepadInput`: `x`/`y` en coordenadas
 * de **pantalla** (y positivo hacia abajo), que es lo que `EngineInput` sabe convertir
 * a mundo. No hay una segunda conversión aquí.
 *
 * ## Por qué flotante
 *
 * Un stick clavado en una esquina obliga a mirar el pulgar antes de moverlo. Éste
 * nace donde cae el dedo dentro de la mitad izquierda, así que se puede jugar sin
 * apartar la vista de la bóveda —que es justo lo que pide un juego en el que te
 * persigue algo—.
 *
 * ## Pausa y reaparición
 *
 * No están aquí. Son botones del DOM con `data-action`, y la delegación de clics de
 * `UIManager` ya los atiende con el dedo sin ningún cambio. Duplicarlos como acciones
 * de este módulo sería mantener dos caminos para el mismo botón.
 */

/** Recorrido del pomo, en píxeles de CSS. Por debajo de ~48 el control fino se pierde. */
const STICK_RADIUS = 56;

/**
 * Zona muerta radial, igual que en el mando pero mucho menor: un dedo no tiene el
 * descentrado mecánico de un stick desgastado, y lo único que hay que filtrar aquí es
 * el temblor de la mano.
 */
const DEADZONE = 0.08;

/** Cuántos píxeles de separación entre dos dedos equivalen a un paso de zoom. */
const PINCH_SCALE = 260;

export class TouchInput {
  constructor() {
    this.host = null;
    this.detach = null;

    /** Punteros vivos, por id. El joystick guarda el suyo aparte. */
    this.pointers = new Map();
    this.stickId = null;
    this.origin = { x: 0, y: 0 };
    this.knob = { x: 0, y: 0 };
    this.vector = { x: 0, y: 0 };

    this.pinchDistance = 0;

    /** Se avisa una sola vez, en el primer toque: es lo que enciende el modo táctil. */
    this.announced = false;
    this.onConnectionChange = null;

    /** Pellizco: recibe el incremento de zoom ya en unidades de la cámara. */
    this.onPinch = null;

    /** Cambios que la capa visual necesita para pintar el stick. */
    this.onStickChange = null;
  }

  get isActive() {
    return this.announced;
  }

  /**
   * Engancha los eventos a la capa de controles.
   *
   * Se hace contra un elemento y no contra `window` a propósito: la capa sabe cuándo
   * está en pantalla, así que el juego deja de escuchar dedos en cuanto se abre un
   * modal o se sale al menú, sin que este módulo tenga que consultar el estado de la
   * interfaz.
   */
  attach(element) {
    if (this.host === element) return;
    this.release();
    this.host = element;
    if (!element) return;

    const down = e => this.onPointerDown(e);
    const move = e => this.onPointerMove(e);
    const up = e => this.onPointerUp(e);

    element.addEventListener('pointerdown', down);
    element.addEventListener('pointermove', move);
    element.addEventListener('pointerup', up);
    element.addEventListener('pointercancel', up);
    // Sin esto, mantener el dedo quieto abre el menú contextual de la página.
    element.addEventListener('contextmenu', e => e.preventDefault());

    this.detach = () => {
      element.removeEventListener('pointerdown', down);
      element.removeEventListener('pointermove', move);
      element.removeEventListener('pointerup', up);
      element.removeEventListener('pointercancel', up);
    };
  }

  release() {
    if (this.detach) this.detach();
    this.detach = null;
    this.host = null;
    this.reset();
  }

  /** Suelta todo. Se llama al ocultar la capa: un dedo levantado fuera nunca avisa. */
  reset() {
    this.pointers.clear();
    this.stickId = null;
    this.pinchDistance = 0;
    this.vector.x = 0;
    this.vector.y = 0;
    this.emitStick(false);
  }

  // ------------------------------------------------------------ eventos

  onPointerDown(e) {
    // El ratón ya tiene teclado; tratarlo como dedo haría aparecer el stick al
    // hacer clic en un escritorio con pantalla táctil.
    if (e.pointerType === 'mouse') return;

    if (!this.announced) {
      this.announced = true;
      if (this.onConnectionChange) this.onConnectionChange('touch');
    }

    // Los botones de la capa se atienden por la delegación de clics de la interfaz.
    if (e.target.closest?.('[data-action]')) return;

    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

    const inStickZone = e.clientX < window.innerWidth / 2;
    if (this.stickId === null && inStickZone) {
      this.stickId = e.pointerId;
      this.origin.x = e.clientX;
      this.origin.y = e.clientY;
      this.knob.x = e.clientX;
      this.knob.y = e.clientY;
      // Capturar el puntero mantiene vivo el arrastre aunque el dedo salga de la
      // zona: sin esto, empujar hasta el borde soltaba al personaje de golpe.
      e.target.setPointerCapture?.(e.pointerId);
      this.emitStick(true);
    }

    e.preventDefault();
  }

  onPointerMove(e) {
    const tracked = this.pointers.get(e.pointerId);
    if (!tracked) return;

    tracked.x = e.clientX;
    tracked.y = e.clientY;

    if (e.pointerId === this.stickId) {
      this.updateStick(e.clientX, e.clientY);
    } else {
      this.updatePinch();
    }

    e.preventDefault();
  }

  onPointerUp(e) {
    if (!this.pointers.delete(e.pointerId)) return;

    if (e.pointerId === this.stickId) {
      this.stickId = null;
      this.vector.x = 0;
      this.vector.y = 0;
      this.emitStick(false);
    }

    // Al levantar un dedo del pellizco, la referencia anterior ya no vale: mantenerla
    // provocaba un salto de zoom al volver a juntar los dedos.
    if (this.pointers.size < 2) this.pinchDistance = 0;
  }

  // ------------------------------------------------------------- cálculo

  updateStick(x, y) {
    const dx = x - this.origin.x;
    const dy = y - this.origin.y;
    const distance = Math.hypot(dx, dy);

    // El pomo se queda en el borde del anillo, pero el origen **también persigue al
    // dedo** cuando éste se aleja más de un radio. Sin ese arrastre, un pulgar que
    // deriva hacia el centro de la pantalla acaba con el stick en un sitio y el dedo
    // en otro, y el jugador siente que el control se ha soltado.
    if (distance > STICK_RADIUS) {
      const excess = distance - STICK_RADIUS;
      this.origin.x += (dx / distance) * excess;
      this.origin.y += (dy / distance) * excess;
    }

    const clampedX = x - this.origin.x;
    const clampedY = y - this.origin.y;
    this.knob.x = x;
    this.knob.y = y;

    let nx = clampedX / STICK_RADIUS;
    let ny = clampedY / STICK_RADIUS;

    const magnitude = Math.min(1, Math.hypot(nx, ny));
    if (magnitude < DEADZONE) {
      nx = 0;
      ny = 0;
    } else {
      // Se reescala el tramo útil a 0..1, igual que el mando: si no, el personaje
      // arrancaría ya a un 8% de velocidad en cuanto el dedo sale del centro.
      const scaled = ((magnitude - DEADZONE) / (1 - DEADZONE)) / Math.hypot(nx, ny);
      nx *= scaled;
      ny *= scaled;
    }

    this.vector.x = nx;
    this.vector.y = ny;
    this.emitStick(true);
  }

  updatePinch() {
    // Sólo pellizcan los dedos que no llevan el joystick: mover el stick con el
    // pulgar mientras se sujeta el móvil con la otra mano no debe cambiar el zoom.
    const free = [];
    this.pointers.forEach((point, id) => {
      if (id !== this.stickId) free.push(point);
    });
    if (free.length !== 2) {
      this.pinchDistance = 0;
      return;
    }

    const distance = Math.hypot(free[0].x - free[1].x, free[0].y - free[1].y);
    if (this.pinchDistance > 0 && this.onPinch) {
      // Separar los dedos acerca la cámara, que es al revés que el nivel de zoom.
      this.onPinch((this.pinchDistance - distance) / PINCH_SCALE);
    }
    this.pinchDistance = distance;
  }

  emitStick(active) {
    if (!this.onStickChange) return;
    this.onStickChange({
      active,
      originX: this.origin.x,
      originY: this.origin.y,
      knobX: this.knob.x,
      knobY: this.knob.y
    });
  }

  /**
   * Estado del dedo en este fotograma.
   *
   * Devuelve `null` mientras no se haya tocado nunca la pantalla, para que en un
   * escritorio no sume un vector de ceros a cada llamada de `getMovementVector`.
   *
   * @returns {{x: number, y: number}|null} en coordenadas de pantalla
   */
  poll() {
    if (!this.announced) return null;
    return this.vector;
  }
}
