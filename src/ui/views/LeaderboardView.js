import { View } from './View.js';
import { renderLeaderboard } from '../components/LeaderboardTable.js';

export class LeaderboardView extends View {
  static keys = ['leaderboard', 'rankSort', 'user', 'lang'];

  template(state) {
    const username = state.user ? state.user.username : null;
    return `
      <section class="panel panel--rank">
        <header class="panel__header">
          <h3>${this.t('leaderboard_title')}</h3>
          <button class="btn btn-sm btn-outline" data-action="rank:refresh">${this.t('btn_refresh')}</button>
        </header>
        ${renderLeaderboard(state.leaderboard, username, this.t, state.rankSort)}
      </section>
    `;
  }
}
