import { View } from './View.js';
import { esc } from '../dom.js';
import { renderPlayerCard, renderEmptySlot } from '../components/PlayerCard.js';

const MAX_SLOTS = 3;

export class LobbyView extends View {
  static keys = ['room', 'lang', 'connection'];

  template(state) {
    const room = state.room;
    if (!room) return '';

    const players = room.players || [];
    const isHost = this.ctx.isLocalHost();
    const emptySlots = Math.max(0, MAX_SLOTS - players.length);
    const waiting = players.length < 2;

    return `
      <div class="lobby-shell">
        <header class="lobby-header">
          <span class="lobby-header__label">${this.t('lobby_room')}</span>
          <button class="room-code" data-action="room:copy-code" title="${this.t('copy_code_hint')}">
            ${esc(room.code)}
          </button>
          <p class="lobby-header__hint">${this.t('lobby_subtitle')}</p>
        </header>

        <ul class="player-grid">
          ${players.map(p => renderPlayerCard(p, this.t)).join('')}
          ${Array.from({ length: emptySlots }, () => renderEmptySlot(this.t)).join('')}
        </ul>

        <p class="lobby-note">
          ${this.t('lobby_puzzle_note').replace('{0}', String(Math.max(1, players.length)))}
        </p>

        <div class="lobby-controls">
          <button class="btn btn-success" data-action="room:start" ${isHost ? '' : 'disabled'}>
            ${isHost ? this.t('btn_start_game') : this.t('btn_waiting_host')}
          </button>
          <button class="btn btn-danger" data-action="room:leave">${this.t('btn_leave')}</button>
        </div>

        ${waiting ? `<p class="empty-hint">${this.t('lobby_solo_hint')}</p>` : ''}
      </div>
    `;
  }
}
