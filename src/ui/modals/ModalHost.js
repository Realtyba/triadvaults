import { View } from '../views/View.js';
import { MODALS, BLOCKING_MODALS } from './definitions.js';

/** Renderiza el modal activo, si lo hay. Solo uno a la vez. */
export class ModalHost extends View {
  static keys = [
    'modal',
    'alertMessage',
    'profileMessage',
    'verifyMessage',
    'verifyDevCode',
    'resendCooldown',
    'canRegenerate',
    'audioMuted',
    'quality',
    'controls',
    'capturingBind',
    'gamepadName',
    'lang'
  ];

  render(state, dirty) {
    const definition = state.modal ? MODALS[state.modal] : null;
    this.root.classList.toggle('hidden', !definition);

    if (!definition) {
      this.root.innerHTML = '';
      return;
    }
    super.render(state, dirty);
  }

  template(state) {
    const { title, body, className = '' } = MODALS[state.modal](state, this.ctx);
    const dismissible = !BLOCKING_MODALS.has(state.modal);

    return `
      <div class="modal-backdrop" ${dismissible ? 'data-action="modal:close"' : ''}></div>
      <div class="modal glass-panel ${className}" role="dialog" aria-modal="true">
        <h3 class="modal__title">${title}</h3>
        <div class="modal__body">${body}</div>
      </div>
    `;
  }
}
