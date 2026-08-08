import { View } from './View.js';

/**
 * Overlay de carga global.
 *
 * Se enciende con `store.patch({ loading: 'clave_i18n' })` y se apaga con
 * `loading: null`. Cubre la pantalla con un spinner cyberpunk y un mensaje
 * traducido. Los sitios que lo usan:
 *
 *  - Arranque de nivel (mientras `LevelController.build` trabaja)
 *  - Conexión a sala (crear / unirse)
 *  - Transición entre niveles
 *  - Sincronización sin conexión
 *
 * Diseño: un anillo giratório con glow del color del tema, fondo
 * semitransparente con blur, texto debajo del anillo.
 */
export class LoadingOverlay extends View {
  static keys = ['loading', 'lang'];

  render(state, dirty) {
    const visible = !!state.loading;
    this.root.classList.toggle('hidden', !visible);
    if (!visible) {
      this.root.innerHTML = '';
      return;
    }
    super.render(state, dirty);
  }

  template(state) {
    const message = this.t(state.loading) || state.loading || '';
    return `
      <div class="loading-overlay__card">
        <div class="loading-overlay__spinner" aria-hidden="true">
          <div class="loading-overlay__ring"></div>
          <div class="loading-overlay__ring loading-overlay__ring--inner"></div>
        </div>
        <p class="loading-overlay__text">${message}</p>
      </div>
    `;
  }
}
