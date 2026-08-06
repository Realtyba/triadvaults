import { esc } from '../dom.js';
import { icon } from '../icons.js';
import { AuthView } from './AuthView.js';
import { ProfileView } from './ProfileView.js';
import { RoomBrowserView } from './RoomBrowserView.js';
import { LeaderboardView } from './LeaderboardView.js';

/**
 * Menú principal. Es un contenedor: monta una vez el esqueleto y delega cada
 * región en su propia vista, para que un cambio en la lista de salas no repinte
 * el formulario de acceso ni el ranking.
 */
export class MainMenuView {
  /** Unión de las claves de sus hijas: fuera de aquí el menú ni se entera. */
  static keys = [
    ...new Set([
      'user',
      'lang',
      'connection',
      'offlinePending',
      ...AuthView.keys,
      ...ProfileView.keys,
      ...RoomBrowserView.keys,
      ...LeaderboardView.keys
    ])
  ];

  constructor(root, ctx) {
    this.root = root;
    this.ctx = ctx;
    this.mounted = false;
    this.children = [];
  }

  get t() {
    return this.ctx.t;
  }

  mount(state) {
    this.root.innerHTML = `
      <div class="menu-shell">
        <div class="brand">
          <h1 class="glitch-title">${this.t('title')}</h1>
          <p class="subtitle">${esc(this.t('subtitle'))}</p>
          <span class="server-status" data-region="server-status">
            <span class="server-dot"></span>
            <span>${this.t('server_online')}</span>
          </span>
        </div>
        <div data-region="profile"></div>
        <div data-region="auth"></div>

        <!-- Siempre visible, con y sin sesión: es la vía de entrada para quien no
             tiene cuenta, o la tiene pero no hay servidor al que conectarse. -->
        <div class="offline-entry">
          <button class="btn btn-outline btn-block" data-action="game:offline">
            ${icon('bolt')} <span>${this.t('btn_play_offline')}</span>
          </button>
          <p class="offline-entry__hint" data-region="offline-hint">${this.t('offline_hint')}</p>
        </div>
        <div class="menu-columns" data-region="columns">
          <div data-region="rooms"></div>
          <div data-region="rank"></div>
        </div>
        <footer class="lore-footer">
          <p>${esc(this.t('lore_footer'))}</p>
          <div class="footer-links">
            <button class="link-btn" data-action="modal:open" data-modal="tos">${icon('doc')}<span>${this.t('btn_show_tos')}</span></button>
            <button class="link-btn" data-action="modal:open" data-modal="instructions">${icon('help')}<span>${this.t('btn_show_instructions')}</span></button>
          </div>
          <span class="version-label">${this.t('game_version')}</span>
        </footer>
      </div>
    `;

    const region = name => this.root.querySelector(`[data-region="${name}"]`);
    this.regions = {
      profile: region('profile'),
      auth: region('auth'),
      columns: region('columns')
    };

    this.children = [
      new ProfileView(region('profile'), this.ctx),
      new AuthView(region('auth'), this.ctx),
      new RoomBrowserView(region('rooms'), this.ctx),
      new LeaderboardView(region('rank'), this.ctx)
    ];

    this.mounted = true;
    this.render(state, null);
  }

  render(state, dirty) {
    if (!this.mounted) return this.mount(state);

    // Con sesión iniciada se ven perfil, salas y ranking; sin ella, el formulario.
    const authenticated = !!state.user;
    this.regions.auth.classList.toggle('hidden', authenticated);
    this.regions.profile.classList.toggle('hidden', !authenticated);
    this.regions.columns.classList.toggle('hidden', !authenticated);

    // Indicador de servidor: pasa a rojo si no hay enlace.
    const statusEl = this.root.querySelector('[data-region="server-status"]');
    if (statusEl) {
      const offline = state.connection !== 'online';
      const dot = statusEl.querySelector('.server-dot');
      if (dot) dot.classList.toggle('is-offline', offline);
      const label = statusEl.lastElementChild;
      if (label) label.textContent = this.t(offline ? 'server_offline' : 'server_online');
    }

    // Lo jugado sin red que aún no ha llegado al servidor: si el jugador no ve que
    // hay algo pendiente, un progreso que tarda en aparecer parece progreso perdido.
    const hint = this.root.querySelector('[data-region="offline-hint"]');
    if (hint) {
      hint.textContent =
        state.offlinePending > 0
          ? this.t('offline_pending').replace('{0}', state.offlinePending)
          : this.t('offline_hint');
    }

    this.children.forEach(child => {
      const keys = child.constructor.keys;
      if (!dirty || keys === null || keys.some(key => dirty.has(key))) {
        child.render(state, dirty);
      }
    });
  }
}
