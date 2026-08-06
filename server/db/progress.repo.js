import { pool, isPgConnected } from './pool.js';
import { readUsers, writeUsers, findUserKey } from './jsonStore.js';

/**
 * Guarda el avance de nivel y suma el tiempo jugado.
 *
 * `timeSpent` faltaba en la firma original mientras se usaba dentro de la consulta,
 * lo que lanzaba un ReferenceError y hacía que ningún progreso llegase a guardarse.
 *
 * La cuenta se identifica por `uid` cuando se conoce, no por nombre: el perfil
 * permite renombrarse, y buscando por nombre el progreso de la partida en curso se
 * escribía sobre una fila que ya no existía. El nombre queda como respaldo, porque
 * en el almacén JSON sigue siendo la clave.
 *
 * @param {{uid?: string|number, name?: string}|string} player  identidad del agente
 */
export async function saveProgress(player, levelReached, timeSpent = 0) {
  const identity = typeof player === 'string' ? { name: player } : player || {};
  const { uid, name } = identity;
  if (uid === undefined && !name) return null;

  const cleanUser = name ? String(name).trim().toLowerCase() : null;
  const level = Math.max(1, parseInt(levelReached, 10) || 1);
  const seconds = Math.max(0, Math.round(Number(timeSpent) || 0));

  if (isPgConnected()) {
    try {
      // `$3::int IS NOT NULL` decide la vía: id si lo hay, nombre si no.
      const res = await pool.query(
        `UPDATE triad_game_users
            SET max_level_reached = GREATEST(max_level_reached, $1),
                total_puzzles_solved = total_puzzles_solved + 1,
                total_time_played = total_time_played + $2,
                updated_at = CURRENT_TIMESTAMP
          WHERE ($3::int IS NOT NULL AND id = $3::int)
             OR ($3::int IS NULL AND LOWER(username) = $4)
      RETURNING username, max_level_reached, total_puzzles_solved, total_time_played`,
        [level, seconds, Number.isFinite(Number(uid)) ? Number(uid) : null, cleanUser]
      );
      if (res.rows.length === 0) return null;

      const row = res.rows[0];
      return {
        username: row.username,
        maxLevelReached: row.max_level_reached,
        totalPuzzlesSolved: row.total_puzzles_solved,
        totalTimePlayed: row.total_time_played
      };
    } catch (err) {
      console.error('[progress.repo] saveProgress:', err.message);
      return null;
    }
  }

  // En el respaldo JSON la clave sigue siendo el nombre: no hay ids numéricos.
  try {
    const users = readUsers();
    const key = findUserKey(users, cleanUser || uid);
    if (!key) return null;

    const user = users[key];
    user.maxLevelReached = Math.max(user.maxLevelReached || 1, level);
    user.totalPuzzlesSolved = (user.totalPuzzlesSolved || 0) + 1;
    user.totalTimePlayed = (user.totalTimePlayed || 0) + seconds;
    writeUsers(users);

    return {
      username: user.username,
      maxLevelReached: user.maxLevelReached,
      totalPuzzlesSolved: user.totalPuzzlesSolved,
      totalTimePlayed: user.totalTimePlayed
    };
  } catch (err) {
    console.error('[progress.repo] saveProgress (json):', err.message);
    return null;
  }
}
