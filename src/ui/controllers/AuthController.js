import { session } from '../../network/session.js';

/** Registro, acceso, recuperación, verificación y edición de perfil. */
export class AuthController {
  constructor({ api, socket, store, form, t, ui }) {
    this.api = api;
    this.socket = socket;
    this.store = store;
    this.form = form;
    this.t = t;
    this.ui = ui;
  }

  setMode(mode) {
    this.store.patch({ authMode: mode, authMessage: '', recoverPinRequested: false });
  }

  async submit() {
    const mode = this.store.get().authMode;
    return mode === 'register' ? this.register() : this.login();
  }

  async login() {
    const identifier = this.form.get('username').trim();
    const password = this.form.get('password');

    if (!identifier || !password) {
      return this.store.patch({ authMessage: this.t('error_missing_fields_login') });
    }

    this.store.patch({ authMessage: this.t('status_connecting') });
    const res = await this.api.login(identifier, password);
    if (!res.success) return this.store.patch({ authMessage: res.error });

    this.onAuthenticated(res);
  }

  async register() {
    const username = this.form.get('username').trim();
    const email = this.form.get('email').trim();
    const password = this.form.get('password');

    if (!username || !email || !password) {
      return this.store.patch({ authMessage: this.t('error_missing_fields_reg') });
    }
    if (!this.form.get('tosChecked')) {
      return this.store.patch({ authMessage: this.t('error_accept_tos') });
    }

    this.store.patch({ authMessage: this.t('status_connecting') });
    const res = await this.api.register(
      this.form.get('firstName'),
      this.form.get('lastName'),
      username,
      email,
      password
    );
    if (!res.success) return this.store.patch({ authMessage: res.error });

    this.onAuthenticated(res);
  }

  /** Punto único tras un acceso válido: persistir, conectar el socket y abrir el menú. */
  onAuthenticated(res) {
    session.save(res.user, res.token);
    this.form.clear('password');
    this.socket.connectWithToken(res.token);
    this.store.patch({ user: res.user, authMessage: '' });

    if (res.user.isVerified === false) {
      this.store.patch({
        modal: 'verify',
        verifyMessage: '',
        // Solo llega en desarrollo y sin SMTP configurado; ver `deliverPin` en el servidor.
        verifyDevCode: res.devCode || null,
        resendCooldown: 0
      });
      return;
    }
    this.ui.refreshMenuData();
  }

  logout() {
    session.clear();
    this.socket.disconnect();
    this.form.clear('password', 'verifyPin');
    clearInterval(this.resendTimer);
    this.store.patch({
      user: null,
      modal: null,
      view: 'main',
      authMessage: '',
      verifyMessage: '',
      verifyDevCode: null,
      resendCooldown: 0,
      rooms: [],
      room: null,
      achievements: []
    });
    this.ui.toasts.clear();
  }

  async requestPin() {
    const email = this.form.get('recoverEmail').trim();
    if (!email) return this.store.patch({ authMessage: this.t('error_missing_email') });

    this.store.patch({ authMessage: this.t('status_requesting_pin') });
    const res = await this.api.requestReset(email);

    this.store.patch(
      res.success
        ? {
            authMessage: this.t('pin_generated').replace('{0}', res.username),
            recoverPinRequested: true
          }
        : { authMessage: res.error }
    );
  }

  async resetPassword() {
    const email = this.form.get('recoverEmail').trim();
    const pin = this.form.get('recoverPin').trim();
    const newPassword = this.form.get('recoverNewPassword');

    if (!email || !pin || !newPassword) {
      return this.store.patch({ authMessage: this.t('error_missing_pin') });
    }

    this.store.patch({ authMessage: this.t('status_updating_password') });
    const res = await this.api.resetPassword(email, pin, newPassword);

    if (!res.success) return this.store.patch({ authMessage: res.error });

    this.form.clear('recoverPin', 'recoverNewPassword');
    this.store.patch({ authMessage: res.message, authMode: 'login', recoverPinRequested: false });
  }

  async verify() {
    const pin = this.form.get('verifyPin').trim();
    const user = this.store.get().user;
    if (pin.length !== 6) return this.store.patch({ verifyMessage: this.t('error_pin_length') });

    this.store.patch({ verifyMessage: this.t('status_verifying') });
    const res = await this.api.verifyEmail(user.username, pin);
    if (!res.success) return this.store.patch({ verifyMessage: res.error });

    const updated = session.patchUser({ isVerified: true });
    this.form.clear('verifyPin');
    this.store.patch({ user: updated, modal: null, verifyMessage: '', verifyDevCode: null });
    this.ui.refreshMenuData();
  }

  /**
   * Pide un PIN nuevo. Es la salida del atasco que dejaba la verificación: las
   * cuentas sin código guardado no podían verificarse con ningún valor, y sin
   * SMTP el PIN del registro nunca llegaba a ninguna parte.
   */
  async resendPin() {
    if (this.store.get().resendCooldown > 0) return;

    this.store.patch({ verifyMessage: this.t('status_sending_pin') });
    const res = await this.api.resendVerification();

    if (!res.success) {
      this.store.patch({ verifyMessage: res.error });
      if (res.retryAfter) this.startResendCooldown(res.retryAfter);
      return;
    }

    this.store.patch({
      verifyMessage: this.t('verify_new_code_sent'),
      verifyDevCode: res.devCode || null
    });
    this.startResendCooldown(res.cooldown || 60);
  }

  /** Cuenta atrás visible del reenvío, para que el botón no parezca roto. */
  startResendCooldown(seconds) {
    clearInterval(this.resendTimer);
    this.store.patch({ resendCooldown: Math.ceil(seconds) });

    this.resendTimer = setInterval(() => {
      const remaining = this.store.get().resendCooldown - 1;
      this.store.patch({ resendCooldown: Math.max(0, remaining) });
      if (remaining <= 0) clearInterval(this.resendTimer);
    }, 1000);
  }

  openProfileEditor() {
    const user = this.store.get().user;
    if (!user) return;

    this.form.setMany({
      editFirstName: user.firstName,
      editLastName: user.lastName,
      editEmail: user.email,
      editUsername: user.username
    });
    this.store.patch({ modal: 'edit-profile', profileMessage: '' });
  }

  async saveProfile() {
    const firstName = this.form.get('editFirstName').trim();
    const lastName = this.form.get('editLastName').trim();
    const email = this.form.get('editEmail').trim();
    const username = this.form.get('editUsername').trim();

    if (!firstName || !lastName || !email || !username) {
      return this.store.patch({ profileMessage: this.t('error_all_fields_required') });
    }

    this.store.patch({ profileMessage: this.t('status_saving') });
    const res = await this.api.updateProfile(firstName, lastName, email, username);
    if (!res.success) return this.store.patch({ profileMessage: res.error });

    const updated = session.patchUser({
      firstName,
      lastName,
      email,
      username: res.username,
      isVerified: res.emailChanged ? false : this.store.get().user.isVerified
    });

    // Cambiar de usuario invalida el token anterior: el servidor emite uno nuevo.
    if (res.token) {
      session.save(updated, res.token);
      this.socket.connectWithToken(res.token);
    }

    this.store.patch({
      user: updated,
      profileMessage: '',
      modal: res.emailChanged ? 'verify' : null,
      verifyMessage: res.emailChanged ? this.t('verify_new_code_sent') : '',
      verifyDevCode: res.devCode || null,
      resendCooldown: 0
    });
  }
}
