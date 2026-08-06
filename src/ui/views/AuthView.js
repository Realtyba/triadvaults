import { View } from './View.js';
import { esc } from '../dom.js';

/**
 * Login, registro y recuperación.
 * Solo se repinta al cambiar de pestaña o al llegar un mensaje: los valores de los
 * campos viven en `FormState`, no en el store, así escribir no destruye el input.
 */
export class AuthView extends View {
  static keys = ['user', 'authMode', 'authMessage', 'recoverPinRequested', 'lang'];

  template(state) {
    const isRegister = state.authMode === 'register';
    const isRecover = state.authMode === 'recover';

    return `
      <div class="auth-panel">
        <nav class="auth-tabs">
          ${this.tab('login', state.authMode, this.t('tab_login'))}
          ${this.tab('register', state.authMode, this.t('tab_register'))}
          ${this.tab('recover', state.authMode, this.t('tab_recover'))}
        </nav>

        ${isRecover ? this.recoverForm(state) : this.credentialsForm(isRegister)}

        <p class="auth-feedback" role="status">${esc(state.authMessage)}</p>
      </div>
    `;
  }

  tab(mode, active, label) {
    return `<button class="tab-btn ${active === mode ? 'is-active' : ''}" data-action="auth:mode" data-mode="${mode}">${label}</button>`;
  }

  credentialsForm(isRegister) {
    return `
      <form class="form-grid" data-action="auth:submit" data-submit>
        ${isRegister ? `
          <div class="form-row">
            <input type="text" data-field="firstName" placeholder="${this.t('placeholder_firstname')}" maxlength="30" value="${esc(this.form.get('firstName'))}">
            <input type="text" data-field="lastName" placeholder="${this.t('placeholder_lastname')}" maxlength="30" value="${esc(this.form.get('lastName'))}">
          </div>
        ` : ''}

        <input type="text" data-field="username" placeholder="${this.t('user_placeholder')}" maxlength="16" autocomplete="username" value="${esc(this.form.get('username'))}">
        ${isRegister ? `<input type="email" data-field="email" placeholder="${this.t('email_placeholder')}" autocomplete="email" value="${esc(this.form.get('email'))}">` : ''}
        <input type="password" data-field="password" placeholder="${this.t('pass_placeholder')}" autocomplete="${isRegister ? 'new-password' : 'current-password'}" value="${esc(this.form.get('password'))}">

        ${isRegister ? `
          <label class="tos-label">
            <input type="checkbox" data-field="tosChecked" ${this.form.get('tosChecked') ? 'checked' : ''}>
            <span>${this.t('tos_agree')}</span>
          </label>
        ` : ''}

        <button type="submit" class="btn btn-primary">
          ${isRegister ? this.t('btn_register') : this.t('btn_login')}
        </button>
      </form>
    `;
  }

  recoverForm(state) {
    if (!state.recoverPinRequested) {
      return `
        <form class="form-grid" data-action="auth:request-pin" data-submit>
          <p class="form-desc">${this.t('recover_step1_desc')}</p>
          <input type="email" data-field="recoverEmail" placeholder="${this.t('email_placeholder')}" value="${esc(this.form.get('recoverEmail'))}">
          <button type="submit" class="btn btn-secondary">${this.t('btn_request_pin')}</button>
        </form>
      `;
    }

    return `
      <form class="form-grid" data-action="auth:reset-password" data-submit>
        <p class="form-desc">${this.t('recover_step2_desc')}</p>
        <input type="text" data-field="recoverPin" placeholder="${this.t('placeholder_pin')}" maxlength="6" inputmode="numeric" value="${esc(this.form.get('recoverPin'))}">
        <input type="password" data-field="recoverNewPassword" placeholder="${this.t('placeholder_new_password')}" value="${esc(this.form.get('recoverNewPassword'))}">
        <button type="submit" class="btn btn-success">${this.t('btn_change_password')}</button>
      </form>
    `;
  }
}
