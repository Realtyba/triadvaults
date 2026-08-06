/**
 * Base de todas las vistas.
 *
 * Cada vista declara `keys` (las claves de estado de las que depende) y solo se
 * vuelve a pintar cuando alguna cambia. Las que contienen formularios pueden
 * afinar más con `shouldRender` para no destruir un input mientras se escribe.
 */
export class View {
  /** @param {HTMLElement} root  @param {object} ctx  contexto compartido (t, form, store) */
  constructor(root, ctx) {
    this.root = root;
    this.ctx = ctx;
  }

  get t() {
    return this.ctx.t;
  }

  get form() {
    return this.ctx.form;
  }

  /** Claves observadas. `null` = cualquier cambio. */
  static keys = null;

  /** Gancho para vetar un repintado concreto. */
  shouldRender() {
    return true;
  }

  /** Devuelve HTML; las vistas que manipulan el DOM a mano sobrescriben `update`. */
  template() {
    return '';
  }

  render(state, dirty) {
    if (!this.shouldRender(state, dirty)) return;

    const focus = this.captureFocus();
    this.root.innerHTML = this.template(state);
    this.restoreFocus(focus);
    this.afterRender(state);
  }

  /**
   * Un repintado sustituye los nodos, así que el campo enfocado perdería el cursor.
   * Se guarda qué campo estaba activo y por dónde iba el caret para devolverlo después.
   */
  captureFocus() {
    const active = document.activeElement;
    if (!active || !this.root.contains(active) || !active.dataset.field) return null;
    return {
      field: active.dataset.field,
      start: active.selectionStart,
      end: active.selectionEnd
    };
  }

  restoreFocus(focus) {
    if (!focus) return;
    const node = this.root.querySelector(`[data-field="${focus.field}"]`);
    if (!node) return;

    node.focus();
    if (focus.start !== null && typeof node.setSelectionRange === 'function') {
      try {
        node.setSelectionRange(focus.start, focus.end);
      } catch {
        // Los inputs sin soporte de selección (email, number) lanzan aquí; da igual.
      }
    }
  }

  afterRender() {}
}
