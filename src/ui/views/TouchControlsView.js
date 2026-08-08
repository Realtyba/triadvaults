import { icon } from '../icons.js';

/**
 * Capa de controles táctiles: el joystick virtual y los botones de partida.
 *
 * No hereda de `View` por el mismo motivo que `HudView`: se pinta en respuesta al
 * dedo, no al estado, y reconstruir el HTML mientras alguien arrastra el pulgar
 * cancelaría la captura del puntero a mitad de gesto. El esqueleto se monta una vez
 * y lo único que cambia por fotograma es un `transform`, que el navegador resuelve en
 * el compositor sin recalcular el diseño.
 *
 * La lógica —zona activa, zona muerta, recorte del pomo— vive en
 * `engine/TouchInput.js`. Aquí solo está lo que se ve.
 *
 * ## La base se ve siempre
 *
 * Antes el joystick sólo aparecía al tocarlo, así que en una pantalla en la que no hay
 * ningún control a la vista no había forma de saber dónde apoyar el pulgar: había que
 * probar. Ahora la base está siempre en pantalla, apagada en reposo y encendida
 * mientras se usa. El origen sigue naciendo donde cae el dedo **dentro de la zona**;
 * lo que la base dice es dónde está esa zona, no dónde hay que pulsar exactamente.
 *
 * ## Dónde se posiciona cada cosa
 *
 * El reposo lo resuelve el CSS (`.touch-stick` centrado en su zona) y el arrastre lo
 * resuelve este módulo con un `transform` en línea, en coordenadas **locales a la
 * zona**. Por eso al soltar basta con borrar el `transform`: la regla del CSS vuelve a
 * ganar sola y no hay que recalcular ninguna posición de reposo.
 */
export class TouchControlsView {
  static keys = ['view', 'isTouch', 'modal', 'paused', 'lang', 'isFullscreen', 'zoom'];

  /**
   * @param {HTMLElement} root
   * @param {object} ctx
   * @param {import('../../engine/TouchInput.js').TouchInput} touch
   */
  constructor(root, ctx, touch) {
    this.root = root;
    this.ctx = ctx;
    this.touch = touch;
    this.refs = null;
    this.visible = false;
    this.lang = ctx.lang;
    this.fullscreen = null;
    /** Rectángulo de la zona, medido al empezar el arrastre. Ver `drawStick`. */
    this.zoneRect = null;
  }

  get t() {
    return this.ctx.t;
  }

  mount() {
    this.root.innerHTML = `
      <div class="touch-zone" data-ref="zone">
        <div class="touch-stick" data-ref="stick" aria-hidden="true">
          <div class="touch-stick__base"></div>
          <div class="touch-stick__knob" data-ref="knob"></div>
        </div>
      </div>
      <div class="touch-actions">
        <!-- El pellizco sobre la sala hace lo mismo, pero nada en pantalla lo anuncia:
             este botón es lo que hace descubrible el zoom, y de paso da pasos exactos
             a quien juega con una sola mano. -->
        <button type="button" class="touch-btn touch-btn--zoom" data-action="view:zoom"
                title="${this.t('btn_zoom')}" aria-label="${this.t('btn_zoom')}">
          ${icon('zoom', { size: 20 })}<span data-ref="zoom">100%</span>
        </button>
        <button type="button" class="touch-btn" data-action="view:fullscreen" data-ref="fullscreen"
                title="${this.t('btn_fullscreen')}" aria-label="${this.t('btn_fullscreen')}">
          ${icon('expand', { size: 22 })}
        </button>
        <button type="button" class="touch-btn" data-action="game:pause"
                title="${this.t('btn_pause')}" aria-label="${this.t('btn_pause')}">
          ${icon('pause', { size: 22 })}
        </button>
      </div>
    `;

    this.refs = {
      zone: this.root.querySelector('[data-ref="zone"]'),
      stick: this.root.querySelector('[data-ref="stick"]'),
      knob: this.root.querySelector('[data-ref="knob"]'),
      fullscreen: this.root.querySelector('[data-ref="fullscreen"]'),
      zoom: this.root.querySelector('[data-ref="zoom"]')
    };
    this.lang = this.ctx.lang;
    this.fullscreen = null;

    this.touch.onStickChange = state => this.drawStick(state);
    this.touch.setStickZone(this.refs.zone);
  }

  /**
   * La capa solo escucha cuando está en pantalla.
   *
   * Ésa es la razón de enganchar y soltar los eventos aquí en vez de dejarlos puestos
   * desde el arranque: con un modal abierto o en el menú, un dedo sobre el lienzo no
   * puede seguir moviendo al agente por detrás.
   */
  render(state) {
    if (!this.refs || this.lang !== state.lang) this.mount();

    this.renderFullscreenButton(state);
    this.refs.zoom.textContent = `${state.zoom ?? 100}%`;

    const shouldShow = Boolean(state.isTouch) && state.view === 'hud' && !state.modal && !state.paused;
    if (shouldShow === this.visible) return;

    this.visible = shouldShow;
    this.root.classList.toggle('hidden', !shouldShow);

    if (shouldShow) {
      this.touch.attach(this.root);
    } else {
      // `release` también pone el vector a cero. Sin eso, pausar con el pulgar
      // apoyado dejaba al agente andando solo al reanudar.
      this.touch.release();
      this.drawStick({ active: false });
    }
  }

  /** El icono alterna, pero el botón es el mismo: la acción sabe en qué estado está. */
  renderFullscreenButton(state) {
    const active = Boolean(state.isFullscreen);
    if (active === this.fullscreen) return;
    this.fullscreen = active;

    const label = this.t(active ? 'btn_fullscreen_exit' : 'btn_fullscreen');
    this.refs.fullscreen.innerHTML = icon(active ? 'collapse' : 'expand', { size: 22 });
    this.refs.fullscreen.title = label;
    this.refs.fullscreen.setAttribute('aria-label', label);
  }

  drawStick({ active, originX = 0, originY = 0, knobX = 0, knobY = 0 }) {
    if (!this.refs) return;
    this.refs.stick.classList.toggle('is-active', Boolean(active));

    if (!active) {
      // Borrar el `transform` devuelve la base a su sitio de reposo, que lo pone el CSS.
      this.refs.stick.style.transform = '';
      this.refs.knob.style.transform = '';
      this.zoneRect = null;
      return;
    }

    // Se mide una vez por gesto y no por fotograma: `getBoundingClientRect` fuerza un
    // recálculo de diseño, y aquí se llama en cada `pointermove`.
    if (!this.zoneRect) this.zoneRect = this.refs.zone.getBoundingClientRect();

    const x = originX - this.zoneRect.left;
    const y = originY - this.zoneRect.top;
    this.refs.stick.style.transform = `translate3d(${x}px, ${y}px, 0)`;
    this.refs.knob.style.transform = `translate3d(${knobX - originX}px, ${knobY - originY}px, 0)`;
  }
}
