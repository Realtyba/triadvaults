import { icon } from '../icons.js';

/**
 * Capa de controles táctiles: el joystick virtual y la pausa.
 *
 * No hereda de `View` por el mismo motivo que `HudView`: se pinta en respuesta al
 * dedo, no al estado, y reconstruir el HTML mientras alguien arrastra el pulgar
 * cancelaría la captura del puntero a mitad de gesto. El esqueleto se monta una vez
 * y lo único que cambia por fotograma es un `transform`, que el navegador resuelve en
 * el compositor sin recalcular el diseño.
 *
 * La lógica —zona activa, zona muerta, pellizco— vive en `engine/TouchInput.js`. Aquí
 * solo está lo que se ve.
 */
export class TouchControlsView {
  static keys = ['view', 'isTouch', 'modal', 'paused', 'lang'];

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
  }

  get t() {
    return this.ctx.t;
  }

  mount() {
    this.root.innerHTML = `
      <div class="touch-stick" data-ref="stick" aria-hidden="true">
        <div class="touch-stick__base"></div>
        <div class="touch-stick__knob" data-ref="knob"></div>
      </div>
      <button class="touch-btn" data-action="game:pause"
              title="${this.t('btn_pause')}" aria-label="${this.t('btn_pause')}">
        ${icon('pause', { size: 22 })}
      </button>
    `;

    this.refs = {
      stick: this.root.querySelector('[data-ref="stick"]'),
      knob: this.root.querySelector('[data-ref="knob"]')
    };
    this.lang = this.ctx.lang;

    this.touch.onStickChange = state => this.drawStick(state);
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

  drawStick({ active, originX = 0, originY = 0, knobX = 0, knobY = 0 }) {
    if (!this.refs) return;
    this.refs.stick.classList.toggle('is-active', Boolean(active));
    if (!active) return;

    this.refs.stick.style.transform = `translate3d(${originX}px, ${originY}px, 0)`;
    this.refs.knob.style.transform = `translate3d(${knobX - originX}px, ${knobY - originY}px, 0)`;
  }
}
