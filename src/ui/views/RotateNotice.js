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
 * Lo que no cabe en vertical es la partida. Obligar a girar en el menú sería molestar
 * sin ganar nada.
 *
 * ## El motivo cambió, el aviso no
 *
 * Antes el argumento era el encuadre: la cámara tenía que meter la bóveda entera en la
 * ventana, en vertical llegaba a su tope de ángulo y distancia, y el agente quedaba como
 * un punto. Desde que la cámara **sigue al agente** en vez de encuadrar la sala, ese
 * problema no existe: en vertical se ve menos sala, pero el personaje conserva su tamaño.
 *
 * Lo que sigue sin caber es la interfaz. En vertical, la barra de estado del equipo, la
 * de vida y el joystick se disputan un ancho que no da: `styles.css` ya desplaza la vida
 * para esquivar el pulgar, y eso es lo máximo que se puede repartir. El aviso se queda
 * por eso, y los textos lo dicen así.
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
