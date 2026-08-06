import { pool, isPgConnected } from './pool.js';
import { readUsers } from './jsonStore.js';

const LIMIT = 100;

export async function getLeaderboard() {
  if (isPgConnected()) {
    try {
      const res = await pool.query(
        `SELECT username, first_name, last_name, max_level_reached, total_puzzles_solved, total_time_played
           FROM triad_game_users
          ORDER BY max_level_reached DESC, total_puzzles_solved DESC
          LIMIT $1`,
        [LIMIT]
      );
      return res.rows.map(u => ({
        username: u.username,
        firstName: u.first_name || 'Agente',
        lastName: u.last_name || 'Desconocido',
        maxLevelReached: u.max_level_reached || 1,
        totalPuzzlesSolved: u.total_puzzles_solved || 0,
        totalTimePlayed: u.total_time_played || 0
      }));
    } catch (err) {
      console.error('[leaderboard.repo] getLeaderboard:', err.message);
      return [];
    }
  }

  return Object.values(readUsers())
    .map(u => ({
      username: u.username,
      firstName: u.firstName || 'Agente',
      lastName: u.lastName || 'Desconocido',
      maxLevelReached: u.maxLevelReached || 1,
      totalPuzzlesSolved: u.totalPuzzlesSolved || 0,
      totalTimePlayed: u.totalTimePlayed || 0
    }))
    .sort((a, b) =>
      b.maxLevelReached !== a.maxLevelReached
        ? b.maxLevelReached - a.maxLevelReached
        : b.totalPuzzlesSolved - a.totalPuzzlesSolved
    )
    .slice(0, LIMIT);
}
