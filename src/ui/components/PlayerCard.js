import { esc } from '../dom.js';
import { PLAYER_COLORS } from '../../entities/Player.js';

/** Tarjeta de agente del lobby, con el color que usará en partida. */
export function renderPlayerCard(player, t) {
  const color = `#${PLAYER_COLORS[player.index % PLAYER_COLORS.length].toString(16).padStart(6, '0')}`;
  const offline = player.connected === false;

  return `
    <li class="player-card ${offline ? 'is-offline' : ''}" style="--agent-color: ${color}">
      <span class="player-card__avatar">🤖</span>
      <span class="player-card__name">${esc(player.name)}</span>
      <span class="player-card__tags">
        ${player.isHost ? `<span class="tag tag--host">${t('tag_host')}</span>` : ''}
        ${offline ? `<span class="tag tag--offline">${t('tag_reconnecting')}</span>` : ''}
      </span>
    </li>
  `;
}

/** Huecos libres, para que se vea cuánta gente falta. */
export function renderEmptySlot(t) {
  return `
    <li class="player-card player-card--empty">
      <span class="player-card__avatar">＋</span>
      <span class="player-card__name">${t('slot_waiting')}</span>
    </li>
  `;
}
