/**
 * Entrada táctil: un joystick virtual dentro de una zona fija.
 *
 * Se lee **por sondeo dentro del bucle**, igual que el mando y por el mismo motivo:
 * los eventos de puntero llegan cuando el dedo se mueve, no una vez por fotograma, y
 * mezclar las dos cadencias hacía que el personaje acelerase al arrastrar deprisa.
 * Los eventos sólo actualizan un vector; quien lo consume es `poll()`.
 *
 * El contrato de salida es el mismo que el de `GamepadInput`: `x`/`y` en coordenadas
 * de **pantalla** (y positivo hacia abajo). Quien las convierte a mundo es
 * `EngineInput`, con la base que le da la cámara. Aquí no hay ninguna conversión.
 *
 * ## Zona fija, origen flotante, origen que NO persigue
 *
 * Tres decisiones que hay que leer juntas, porque las dos primeras se conservan de la
 * versión anterior y la tercera es la que arregla el control:
 *
 * 1. El stick vive en una **zona acotada** (`setStickZone`), no en media pantalla. Antes
 *    la mitad izquierda entera lo activaba, HUD incluido, así que rozar la barra de
 *    arriba con la palma echaba a andar al agente.
 * 2. Dentro de esa zona **nace donde cae el dedo**. Un stick clavado en un punto exacto
 *    obliga a mirar el pulgar antes de moverlo, y este es un juego en el que te persigue
 *    algo. La base pintada en reposo dice dónde está la zona; no hay que apuntarle.
 * 3. El origen **se queda quieto** una vez fijado. Antes perseguía al dedo cuando éste
 *    se alejaba más de un radio, y ése era el motivo de que el control se sintiera
 *    resbaladizo: con el pulgar al tope, la dirección pasaba a salir del arrastre
 *    instantáneo en vez del desplazamiento absoluto, así que cualquier microcorrección
 *    giraba al personaje. Ahora el pomo simplemente topa contra el borde del anillo.
 *
 * ## Pausa y reaparición
 *
 * No están aquí. Son botones del DOM con `data-action`, y la delegación de clics de
 * `UIManager` ya los atiende con el dedo sin ningún cambio. Duplicarlos como acciones
 * de este módulo sería mantener dos caminos para el mismo botón.
 */

/**
 * Recorrido del pomo, en píxeles de CSS.
 *
 * Tiene que valer la **mitad** de `--touch-stick-size` en `styles.css`: es el radio del
 * anillo que se pinta, y si no coinciden el jugador llega al tope de velocidad antes de
 * tocar el borde visible (que es lo que pasaba con 56 contra una base de 128).
 */
const STICK_RADIUS = 64;

/**
 * Zona muerta radial, igual que en el mando pero mucho menor: un dedo no tiene el
 * descentrado mecánico de un stick desgastado, y lo único que hay que filtrar aquí es
 * el temblor de la mano.
 */
const DEADZONE = 0.08;

/**
 * Píxeles de separación entre los dos dedos que equivalen a duplicar la distancia de
 * la cámara. Calibrado para que un pellizco cómodo —de dedos juntos a la anchura de la
 * mano, unos 300 px— recorra el rango de zoom entero sin tener que repetirlo.
 */
const PINCH_SCALE = 320;

export class TouchInput {
  constructor() {
    this.host = null;
    this.zone = null;
    this.detach = null;

    this.stickId = null;
    this.origin = { x: 0, y: 0 };
    /** Posición del pomo ya recortada al radio; es lo que se pinta. */
    this.knob = { x: 0, y: 0 };
    this.vector = { x: 0, y: 0 };

    /** Se avisa una sola vez, en el primer toque: es lo que enciende el modo táctil. */
    this.announced = false;
    this.onConnectionChange = null;

    /** Cambios que la capa visual necesita para pintar el stick. */
    this.onStickChange = null;

    /** Separación entre los dos dedos en el último aviso de pellizco; 0 = sin gesto. */
    this.pinchDistance = 0;
    /** Zoom acumulado por el pellizco, a la espera de que lo recoja `EngineInput`. */
    this.zoomDelta = 0;
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

    // El pellizco va contra `window` y con eventos táctiles, no de puntero, por dos
    // motivos: se hace sobre la sala —que está en el lienzo, fuera de esta capa, y la
    // capa además no recibe eventos salvo en sus botones—, y `TouchEvent.touches` da
    // los dos dedos en un único aviso, mientras que con punteros habría que llevar a
    // mano un registro de cuáles siguen apoyados.
    const pinchMove = e => this.onPinchMove(e);
    const pinchEnd = e => this.onPinchEnd(e);
    window.addEventListener('touchmove', pinchMove, { passive: false });
    window.addEventListener('touchend', pinchEnd);
    window.addEventListener('touchcancel', pinchEnd);

    this.detach = () => {
      element.removeEventListener('pointerdown', down);
      element.removeEventListener('pointermove', move);
      element.removeEventListener('pointerup', up);
      element.removeEventListener('pointercancel', up);
      window.removeEventListener('touchmove', pinchMove);
      window.removeEventListener('touchend', pinchEnd);
      window.removeEventListener('touchcancel', pinchEnd);
    };
  }

  /**
   * Elemento dentro del cual nace el joystick.
   *
   * Es un nodo del DOM y no unas coordenadas para que **el sitio y el tamaño de la zona
   * los decida el CSS**, que es donde se resuelven ya el apaisado, los recortes de
   * pantalla y `safe-area`. Este módulo sólo pregunta "¿el dedo cayó aquí dentro?".
   */
  setStickZone(element) {
    this.zone = element || null;
  }

  release() {
    if (this.detach) this.detach();
    this.detach = null;
    this.host = null;
    this.reset();
  }

  /** Suelta todo. Se llama al ocultar la capa: un dedo levantado fuera nunca avisa. */
  reset() {
    this.stickId = null;
    this.vector.x = 0;
    this.vector.y = 0;
    this.pinchDistance = 0;
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

    if (this.stickId !== null || !this.isInStickZone(e)) return;

    this.stickId = e.pointerId;
    this.origin.x = e.clientX;
    this.origin.y = e.clientY;
    this.knob.x = e.clientX;
    this.knob.y = e.clientY;
    // Capturar el puntero mantiene vivo el arrastre aunque el dedo salga de la
    // zona: sin esto, empujar hasta el borde soltaba al personaje de golpe.
    e.target.setPointerCapture?.(e.pointerId);
    this.emitStick(true);

    e.preventDefault();
  }

  onPointerMove(e) {
    if (e.pointerId !== this.stickId) return;
    this.updateStick(e.clientX, e.clientY);
    e.preventDefault();
  }

  onPointerUp(e) {
    if (e.pointerId !== this.stickId) return;
    this.stickId = null;
    this.vector.x = 0;
    this.vector.y = 0;
    this.emitStick(false);
  }

  // ------------------------------------------------------------- pellizco

  /**
   * Zoom por pellizco: separar los dedos acerca la cámara.
   *
   * Se descarta mientras el joystick está en uso. No es una comodidad: al andar, la
   * palma que sujeta el móvil roza la pantalla constantemente, y sin este filtro cada
   * roce se contaría como segundo dedo y la cámara daría tirones durante toda la
   * partida.
   */
  onPinchMove(e) {
    if (this.stickId !== null || e.touches.length !== 2) {
      this.pinchDistance = 0;
      return;
    }

    const distance = Math.hypot(
      e.touches[0].clientX - e.touches[1].clientX,
      e.touches[0].clientY - e.touches[1].clientY
    );

    // El primer aviso solo fija la referencia: sin distancia anterior no hay gesto,
    // solo dos dedos apoyados.
    if (this.pinchDistance > 0) {
      this.zoomDelta += (this.pinchDistance - distance) / PINCH_SCALE;
    }
    this.pinchDistance = distance;

    // La etiqueta `viewport` ya desactiva la ampliación de la página, pero Safari en
    // iOS la ignora desde hace años y el gesto acabaría ampliando el HUD.
    e.preventDefault();
  }

  onPinchEnd(e) {
    if (e.touches.length < 2) this.pinchDistance = 0;
  }

  /** Zoom acumulado desde la última lectura. Lo recoge `EngineInput.consumeZoom`. */
  consumeZoom() {
    const delta = this.zoomDelta;
    this.zoomDelta = 0;
    return delta;
  }

  // ------------------------------------------------------------- cálculo

  /** @returns {boolean} si el toque cayó dentro de la zona del joystick */
  isInStickZone(e) {
    if (!this.zone) return false;
    const rect = this.zone.getBoundingClientRect();
    return (
      e.clientX >= rect.left &&
      e.clientX <= rect.right &&
      e.clientY >= rect.top &&
      e.clientY <= rect.bottom
    );
  }

  updateStick(x, y) {
    const dx = x - this.origin.x;
    const dy = y - this.origin.y;
    const distance = Math.hypot(dx, dy);

    // El pomo topa contra el borde del anillo. El origen no se mueve: ver la nota 3 de
    // la cabecera, es lo que hace que la dirección sea la que el jugador señaló.
    const limited = distance > STICK_RADIUS ? STICK_RADIUS / distance : 1;
    this.knob.x = this.origin.x + dx * limited;
    this.knob.y = this.origin.y + dy * limited;

    const magnitude = Math.min(1, distance / STICK_RADIUS);
    if (magnitude < DEADZONE || distance === 0) {
      this.vector.x = 0;
      this.vector.y = 0;
    } else {
      // Se reescala el tramo útil a 0..1, igual que el mando: si no, el personaje
      // arrancaría ya a un 8% de velocidad en cuanto el dedo sale del centro.
      const scaled = (magnitude - DEADZONE) / (1 - DEADZONE) / distance;
      this.vector.x = dx * scaled;
      this.vector.y = dy * scaled;
    }

    this.emitStick(true);
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
