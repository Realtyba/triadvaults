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
        </div>
        <div data-region="profile"></div>
        <div data-region="auth"></div>
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

    this.children.forEach(child => {
      const keys = child.constructor.keys;
      if (!dirty || keys === null || keys.some(key => dirty.has(key))) {
        child.render(state, dirty);
      }
    });
  }
}
