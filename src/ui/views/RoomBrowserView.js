import { View } from './View.js';
import { esc } from '../dom.js';
import { renderRoomCard } from '../components/RoomCard.js';
import { ROOM_STATUS, CODE_LENGTH } from '../../../shared/constants.js';

const FILTERS = [
  { id: 'all', key: 'filter_all' },
  { id: 'joinable', key: 'filter_joinable' },
  { id: 'in_game', key: 'filter_in_game' }
];

function applyFilter(rooms, filter) {
  if (filter === 'joinable') {
    return rooms.filter(r => r.joinable && r.status !== ROOM_STATUS.IN_GAME);
  }
  if (filter === 'in_game') return rooms.filter(r => r.status === ROOM_STATUS.IN_GAME);
  return rooms;
}

/**
 * Las tres listas de una vez.
 *
 * El contador de cada pestaña llamaba a `applyFilter` por su cuenta, así que la
 * lista se recorría cuatro veces por repintado —una por pestaña más la visible—
 * y con `ROOMS_UPDATED` llegando por cada movimiento del servidor eso se repetía
 * constantemente.
 */
function partition(rooms) {
  return FILTERS.reduce((acc, f) => {
    acc[f.id] = applyFilter(rooms, f.id);
    return acc;
  }, {});
}

/**
 * Navegador de salas.
 *
 * Antes, crear sala, unirse por código, la lista y el ranking convivían apilados en
 * un mismo bloque, y la lista escondía toda sala llena o en partida. Ahora las
 * acciones están separadas de la exploración y el estado de cada sala es explícito.
 * Crear sala vive en `MainMenuView` como acción hero junto a jugar sin conexión;
 * aquí solo queda unirse por código, que depende de esta lista para dar feedback.
 */
export class RoomBrowserView extends View {
  static keys = ['rooms', 'roomFilter', 'lang', 'user', 'connection'];

  // Sin `shouldRender` propio: el que había devolvía siempre true —`dirty` nunca
  // llega vacío— y el foco del input ya lo conserva `View.render` guardando y
  // restaurando el caret.

  template(state) {
    const rooms = state.rooms || [];
    const byFilter = partition(rooms);
    const visible = byFilter[state.roomFilter] || rooms;

    return `
      <section class="panel panel--actions">
        <div class="join-by-code">
          <input
            type="text"
            data-field="roomCode"
            class="code-input"
            placeholder="${this.t('code')}"
            maxlength="${CODE_LENGTH}"
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
              >${this.t(f.key)} <span class="filter-btn__count">${byFilter[f.id].length}</span></button>
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
