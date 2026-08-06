import { esc, formatDuration } from '../dom.js';

const MEDALS = ['#ffd700', '#c0c0c0', '#cd7f32'];
const VISIBLE_ROWS = 10;

/**
 * Criterios de orden. Cada uno lleva su desempate, porque con pocos agentes hay
 * muchos empates a cero y sin criterio secundario la tabla bailaba entre
 * refrescos según el orden en que llegaran las filas.
 */
const SORTS = {
  level: (a, b) =>
    b.maxLevelReached - a.maxLevelReached || b.totalPuzzlesSolved - a.totalPuzzlesSolved,
  puzzles: (a, b) =>
    b.totalPuzzlesSolved - a.totalPuzzlesSolved || b.maxLevelReached - a.maxLevelReached,
  time: (a, b) => b.totalTimePlayed - a.totalTimePlayed || b.maxLevelReached - a.maxLevelReached
};

function header(key, label, activeSort) {
  const active = activeSort === key;
  return `<th class="num rank-th ${active ? 'is-sorted' : ''}"
             data-action="rank:sort" data-sort="${key}"
             aria-sort="${active ? 'descending' : 'none'}">${label}</th>`;
}

/**
 * @param {Array} entries
 * @param {string|null} currentUsername  para resaltar la fila propia
 * @param {Function} t
 * @param {string} [sort]  criterio activo; ver `SORTS`
 */
export function renderLeaderboard(entries, currentUsername, t, sort = 'level') {
  if (!entries || entries.length === 0) {
    return `<p class="empty-hint">${t('leaderboard_empty')}</p>`;
  }

  // Copia antes de ordenar: `entries` es el array del store y `sort` muta en sitio.
  const ordered = [...entries].sort(SORTS[sort] || SORTS.level);

  // Si el agente no entra en el top visible, se añade igualmente al final con su
  // posición real: quedarse fuera de la tabla sin saber en qué puesto vas es
  // justo lo que quita las ganas de seguir subiendo.
  const myIndex = ordered.findIndex(e => e.username === currentUsername);
  const visible = ordered.slice(0, VISIBLE_ROWS).map((entry, index) => ({ entry, index }));
  if (myIndex >= VISIBLE_ROWS) visible.push({ entry: ordered[myIndex], index: myIndex });

  const rows = visible
    .map(({ entry, index }) => {
      const isMe = entry.username === currentUsername;
      const medal = MEDALS[index] ? `style="color:${MEDALS[index]}"` : '';
      return `
        <tr class="${isMe ? 'is-me' : ''}">
          <td ${medal}>#${index + 1}</td>
          <td>
            <span class="rank-name">${esc(entry.firstName)} ${esc(entry.lastName)}</span>
            <span class="rank-user">@${esc(entry.username)}</span>
          </td>
          <td class="num">${esc(entry.maxLevelReached)}</td>
          <td class="num">${esc(entry.totalPuzzlesSolved)}</td>
          <td class="num">${formatDuration(entry.totalTimePlayed)}</td>
        </tr>
      `;
    })
    .join('');

  return `
    <table class="rank-table">
      <thead>
        <tr>
          <th>${t('rank_position')}</th>
          <th>${t('rank_agent')}</th>
          ${header('level', t('level'), sort)}
          ${header('puzzles', t('rank_puzzles'), sort)}
          ${header('time', t('rank_time'), sort)}
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  `;
}
