import { View } from './View.js';
import { esc } from '../dom.js';

/**
 * Ventana de reconexión.
 *
 * Antes una caída de red no se comunicaba: el juego seguía corriendo, el personaje
 * dejaba de responder y no había forma de saber si se estaba volviendo a la sala.
 */
export class ReconnectingOverlay extends View {
  static keys = ['connection', 'reconnectAttempt', 'lastRoomCode', 'lang'];

  render(state, dirty) {
    const visible = state.connection !== 'online';
    this.root.classList.toggle('hidden', !visible);
    if (!visible) {
      this.root.innerHTML = '';
      return;
    }
    super.render(state, dirty);
  }

  template(state) {
    const failed = state.connection === 'offline';

    return `
      <div class="reconnect-card glass-panel">
        <div class="reconnect-card__icon ${failed ? '' : 'is-spinning'}">${failed ? '⛔' : '📡'}</div>
        <h2>${failed ? this.t('reconnect_failed_title') : this.t('reconnect_title')}</h2>

        ${state.lastRoomCode
          ? `<p class="reconnect-card__room">${this.t('reconnect_room')} <strong>${esc(state.lastRoomCode)}</strong></p>`
          : ''}

        <p class="reconnect-card__status">
          ${failed
            ? this.t('reconnect_failed_desc')
            : this.t('reconnect_attempt').replace('{0}', String(state.reconnectAttempt || 1))}
        </p>

        <div class="reconnect-card__actions">
          ${failed ? `<button class="btn btn-primary" data-action="net:retry">${this.t('btn_retry')}</button>` : ''}
          <button class="btn btn-danger" data-action="net:abandon">${this.t('btn_abandon_session')}</button>
        </div>
      </div>
    `;
  }
}
