import { View } from './View.js';
import { icon } from '../icons.js';

/**
 * Aviso de "gira el móvil", solo durante la partida.
 *
 * ## Por qué existe habiendo bloqueo de orientación
 *
 * Porque el bloqueo no se puede garantizar. `screen.orientation.lock()` no existe en
 * Safari de iOS, y donde sí existe sólo funciona dentro de pantalla completa, así que
 * deja de valer en cuanto el jugador sale. Este aviso es la única defensa que está
 * siempre: `engine/fullscreen.js` intenta el bloqueo, y esto cubre cuando falla.
 *
 * ## Por qué solo en partida
 *
 * El menú, el perfil y la lista de salas están pensados en vertical y se leen bien así.
 * Lo que no cabe en vertical es la bóveda: la cámara compensa las ventanas estrechas
 * abriendo el ángulo y alejándose (`EngineCamera.applyAspect`), y en un móvil de pie
 * eso llega al tope y deja al agente como un punto. Obligar a girar en el menú sería
 * molestar sin ganar nada.
 */
export class RotateNotice extends View {
  static keys = ['isPortrait', 'isTouch', 'view', 'lang'];

  render(state, dirty) {
    const visible = Boolean(state.isTouch) && Boolean(state.isPortrait) && state.view === 'hud';
    this.root.classList.toggle('hidden', !visible);
    if (!visible) {
      this.root.innerHTML = '';
      return;
    }
    super.render(state, dirty);
  }

  template() {
    return `
      <div class="rotate-notice__card">
        <div class="rotate-notice__icon">${icon('rotateDevice', { size: 56 })}</div>
        <h2>${this.t('rotate_title')}</h2>
        <p>${this.t('rotate_desc')}</p>
      </div>
    `;
  }
}
