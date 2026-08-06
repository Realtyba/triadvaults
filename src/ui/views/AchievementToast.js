import { esc } from '../dom.js';
import { icon } from '../icons.js';
import { achievementText } from '../../../shared/achievements.js';

/**
 * Avisos de logro desbloqueado.
 *
 * No es una `View` del store porque no describe un estado, sino una **cola de
 * eventos**: pueden desbloquearse tres logros a la vez al superar un nivel y cada
 * uno necesita su turno en pantalla. Metido en el estado reactivo, el segundo
 * aviso pisaría al primero antes de que diera tiempo a leerlo.
 *
 * Va deliberadamente fuera del modal: un logro no debe interrumpir la partida.
 */

const VISIBLE_MS = 4200;
const GAP_MS = 300;

export class AchievementToast {
  /** @param {HTMLElement} root  @param {{t: Function, lang: string}} ctx */
  constructor(root, ctx) {
    this.root = root;
    this.ctx = ctx;
    this.queue = [];
    this.showing = false;
  }

  /**
   * @param {string[]} keys      claves recién desbloqueadas
   * @param {object[]} catalog   definiciones vigentes, servidas por el servidor
   */
  push(keys = [], catalog = []) {
    const byKey = new Map(catalog.map(definition => [definition.key, definition]));
    const items = keys.map(key => achievementText(byKey.get(key), this.ctx.lang)).filter(Boolean);
    if (items.length === 0) return;

    this.queue.push(...items);
    if (!this.showing) this.next();
  }

  next() {
    const item = this.queue.shift();
    if (!item) {
      this.showing = false;
      this.root.classList.add('hidden');
      return;
    }

    this.showing = true;
    this.root.classList.remove('hidden');
    this.root.innerHTML = `
      <div class="toast toast--achievement" role="status">
        <div class="toast__icon">${icon(item.icon, { size: 26 })}</div>
        <div class="toast__body">
          <span class="toast__kicker">${this.ctx.t('achievement_unlocked')}</span>
          <strong class="toast__title">${esc(item.title)}</strong>
          <span class="toast__desc">${esc(item.description)}</span>
        </div>
      </div>
    `;

    clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      // Salida animada antes de dar paso al siguiente, o el cambio se ve como un
      // parpadeo de contenido en la misma tarjeta.
      const card = this.root.firstElementChild;
      if (card) card.classList.add('is-leaving');
      setTimeout(() => this.next(), GAP_MS);
    }, VISIBLE_MS);
  }

  /** Al cerrar sesión o abandonar, los avisos pendientes dejan de tener sentido. */
  clear() {
    clearTimeout(this.timer);
    this.queue = [];
    this.showing = false;
    this.root.innerHTML = '';
    this.root.classList.add('hidden');
  }
}
