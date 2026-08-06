import { esc } from '../dom.js';

const STATUS_LABELS = {
  lobby: { key: 'room_status_lobby', className: 'is-lobby' },
  in_game: { key: 'room_status_in_game', className: 'is-ingame' },
  full: { key: 'room_status_full', className: 'is-full' }
};

/**
 * Una sala del navegador. Muestra el estado real —incluidas las partidas en curso—
 * en vez de ocultarlas, que era el motivo de que la lista pareciese siempre vacía.
 */
export function renderRoomCard(room, t) {
  const status = STATUS_LABELS[room.status] || STATUS_LABELS.lobby;
  const disabled = !room.joinable;
  const buttonLabel = room.status === 'in_game' ? t('btn_join_running') : t('btn_join_room');

  return `
    <li class="room-card ${status.className}" data-room-code="${esc(room.code)}">
      <div class="room-card__main">
        <div class="room-card__code">${esc(room.code)}</div>
        <div class="room-card__meta">
          <span class="room-card__host">${esc(room.hostName)}</span>
          <span class="room-card__level">${t('level')} ${esc(room.currentLevel)}</span>
        </div>
      </div>
      <div class="room-card__side">
        <span class="room-badge ${status.className}">${t(status.key)}</span>
        <span class="room-card__players">${esc(room.playersCount)}/${esc(room.maxPlayers)}</span>
        <button
          class="btn btn-sm btn-secondary"
          data-action="room:join-public"
          data-code="${esc(room.code)}"
          ${disabled ? 'disabled' : ''}
          title="${disabled ? t('room_full_hint') : ''}"
        >${buttonLabel}</button>
      </div>
    </li>
  `;
}
