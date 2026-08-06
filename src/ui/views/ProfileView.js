import { View } from './View.js';
import { esc, formatDuration } from '../dom.js';
import { icon } from '../icons.js';
import { achievementText } from '../../../shared/achievements.js';

/**
 * Cabecera con el agente conectado, sus estadísticas y sus logros.
 *
 * Los logros bloqueados se muestran igualmente, apagados y con su descripción: son
 * la lista de razones para volver a jugar. Ocultarlos hasta conseguirlos deja al
 * jugador sin ninguna meta a la vista.
 *
 * El catálogo llega por el estado, no importado: lo sirve el servidor desde la base
 * de datos, así que un logro nuevo aparece aquí sin publicar una versión del juego.
 */
export class ProfileView extends View {
  static keys = ['user', 'achievements', 'achievementCatalog', 'lang'];

  template(state) {
    const user = state.user;
    if (!user) return '';

    const owned = new Set(state.achievements || []);
    const catalog = state.achievementCatalog || [];

    return `
      <header class="profile-card">
        <div class="profile-card__identity">
          <span class="profile-card__label">${this.t('agent')}</span>
          <strong class="profile-card__name">${esc(user.firstName)} ${esc(user.lastName)}</strong>
          <span class="profile-card__user">@${esc(user.username)}</span>
        </div>

        <dl class="profile-card__stats">
          <div><dt>${this.t('stat_max_level')}</dt><dd>${esc(user.maxLevelReached)}</dd></div>
          <div><dt>${this.t('stat_puzzles')}</dt><dd>${esc(user.totalPuzzlesSolved || 0)}</dd></div>
          <div><dt>${this.t('stat_time')}</dt><dd>${formatDuration(user.totalTimePlayed)}</dd></div>
          <div><dt>${this.t('stat_achievements')}</dt><dd>${owned.size} / ${catalog.length}</dd></div>
        </dl>

        <div class="profile-card__actions">
          <button class="btn btn-sm btn-outline" data-action="profile:edit">${this.t('btn_edit')}</button>
          <button class="btn btn-sm" data-action="auth:logout">${this.t('btn_logout')}</button>
        </div>
      </header>

      ${this.achievementRow(owned, catalog)}
    `;
  }

  achievementRow(owned, catalog) {
    const badges = catalog.map(definition => {
      const text = achievementText(definition, this.ctx.lang);
      const unlocked = owned.has(definition.key);

      // `title` nativo en lugar de una capa flotante propia: es una fila de
      // adorno, y montar un sistema de tooltips para esto no se sostiene.
      return `
        <li class="badge ${unlocked ? 'is-unlocked' : 'is-locked'}"
            title="${esc(text.title)} — ${esc(text.description)}">
          ${icon(unlocked ? definition.icon : 'lock', { size: 18 })}
          <span class="badge__label">${esc(text.title)}</span>
        </li>
      `;
    }).join('');

    return `
      <section class="panel panel--badges">
        <header class="panel__header">
          <h3>${this.t('achievements_title')}</h3>
        </header>
        <ul class="badge-row">${badges}</ul>
      </section>
    `;
  }
}
