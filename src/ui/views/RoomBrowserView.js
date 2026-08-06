import { View } from './View.js';
import { esc } from '../dom.js';
import { icon } from '../icons.js';
import { renderRoomCard } from '../components/RoomCard.js';

const FILTERS = [
  { id: 'all', key: 'filter_all' },
  { id: 'joinable', key: 'filter_joinable' },
  { id: 'in_game', key: 'filter_in_game' }
];

function applyFilter(rooms, filter) {
  if (filter === 'joinable') return rooms.filter(r => r.joinable && r.status !== 'in_game');
  if (filter === 'in_game') return rooms.filter(r => r.status === 'in_game');
  return rooms;
}

/**
 * Navegador de salas.
 *
 * Antes, crear sala, unirse por código, la lista y el ranking convivían apilados en
 * un mismo bloque, y la lista escondía toda sala llena o en partida. Ahora las
 * acciones están separadas de la exploración y el estado de cada sala es explícito.
 */
export class RoomBrowserView extends View {
  static keys = ['rooms', 'roomFilter', 'lang', 'user', 'connection'];

  /** Escribir el código de sala no debe repintar la lista y perder el foco. */
  shouldRender(state, dirty) {
    return !dirty || dirty.size > 0;
  }

  template(state) {
    const rooms = state.rooms || [];
    const visible = applyFilter(rooms, state.roomFilter);
    const level = state.user ? state.user.maxLevelReached : 1;

    return `
      <section class="panel panel--actions">
        <button class="btn btn-primary btn-block" data-action="room:create">
          <span class="btn__icon">${icon('bolt', { size: 18 })}</span>
          <span>${this.t('btn_create_room')}</span>
          <span class="btn__hint">${this.t('level')} ${esc(level)}</span>
        </button>

        <div class="join-by-code">
          <input
            type="text"
            data-field="roomCode"
            class="code-input"
            placeholder="${this.t('code')}"
            maxlength="4"
            autocapitalize="characters"
            value="${esc(this.form.get('roomCode'))}"
          >
          <button class="btn btn-secondary" data-action="room:join-code">${this.t('btn_join_room')}</button>
        </div>
      </section>

      <section class="panel panel--rooms">
        <header class="panel__header">
          <h3>${this.t('public_rooms_title')}</h3>
          <div class="filter-group" role="tablist">
            ${FILTERS.map(f => `
              <button
                class="filter-btn ${state.roomFilter === f.id ? 'is-active' : ''}"
                data-action="room:filter"
                data-filter="${f.id}"
              >${this.t(f.key)} <span class="filter-btn__count">${applyFilter(rooms, f.id).length}</span></button>
            `).join('')}
          </div>
        </header>

        ${visible.length === 0
          ? `<p class="empty-hint">${this.t(rooms.length === 0 ? 'no_public_rooms' : 'no_rooms_for_filter')}</p>`
          : `<ul class="room-list">${visible.map(room => renderRoomCard(room, this.t)).join('')}</ul>`}
      </section>
    `;
  }
}
