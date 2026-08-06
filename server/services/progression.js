import { evaluateAchievements } from '../../shared/achievements.js';
import { DatabaseManager } from '../db/index.js';

/**
 * Cómo se convierte un nivel superado en progreso y logros.
 *
 * Vive aquí y no dentro del manejador de sockets porque hay dos formas de llegar a
 * esto: terminar un nivel en línea, y sincronizar lo jugado sin conexión. Con una
 * copia en cada sitio acabarían dando resultados distintos —el mismo nivel
 * concediendo un logro por un camino y no por el otro—, y ese desajuste solo se
 * notaría meses después, cuando ya nadie recuerda que había dos copias.
 *
 * La evaluación es siempre del servidor, venga de donde venga el nivel. El cliente
 * sin conexión también evalúa, pero solo para poder avisar en el momento: lo que
 * queda registrado es lo que se decide aquí.
 */

/** Techo por nivel: una hora. Un `timeSpent` inflado no puede disparar el tiempo total. */
const MAX_LEVEL_SECONDS = 60 * 60;

/**
 * @param {{uid?: number|string, name?: string}} identity
 * @param {object} run  nivel superado
 * @returns {Promise<{stats: object, unlocked: string[]}|null>} null si no existe la cuenta
 */
export async function recordLevelCompletion(identity, run) {
  const completedLevel = Math.max(1, Math.round(Number(run.level) || 1));
  const timeSpent = Math.max(0, Math.min(MAX_LEVEL_SECONDS, Number(run.timeSpent) || 0));
  const playersCount = Math.max(1, Math.min(3, Number(run.playersCount) || 1));
  const damageTaken = Math.max(0, Number(run.damageTaken) || 0);
  const deaths = Math.max(0, Number(run.deaths) || 0);

  const stats = await DatabaseManager.saveProgress(identity, completedLevel + 1, timeSpent);
  if (!stats) return null;

  const unlocked = await awardAchievements(identity, {
    level: completedLevel,
    maxLevel: stats.maxLevelReached,
    puzzlesSolved: stats.totalPuzzlesSolved,
    totalTimePlayed: stats.totalTimePlayed,
    timeSpent,
    playersCount,
    deaths,
    damageTaken,
    flawless: damageTaken === 0
  });

  return { stats, unlocked };
}

/**
 * Evalúa el contexto y concede lo que corresponda.
 *
 * El catálogo se pide en cada evaluación —viene cacheado un minuto en el
 * repositorio— para que un logro añadido en la base de datos entre en juego sin
 * reiniciar el servidor.
 *
 * @returns {Promise<string[]>} claves realmente concedidas ahora
 */
export async function awardAchievements(identity, context) {
  try {
    const [owned, catalog] = await Promise.all([
      DatabaseManager.listAchievements(identity),
      DatabaseManager.getAchievementCatalog()
    ]);

    const unlocked = evaluateAchievements(context, catalog, owned);
    if (unlocked.length === 0) return [];

    // `grantAchievements` devuelve solo lo que realmente insertó: si dos clientes
    // de la sala reportan a la vez, el segundo no vuelve a avisar.
    return await DatabaseManager.grantAchievements(identity, unlocked);
  } catch (err) {
    // Un fallo aquí no puede tumbar el avance de nivel del resto de la sala.
    console.error('[logros] no se pudieron conceder:', err.message);
    return [];
  }
}
