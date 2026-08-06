import { evaluateAchievements } from '../../shared/achievements.js';

/**
 * Progreso guardado en la máquina del jugador.
 *
 * Existe porque un juego de escritorio no puede depender de que un servidor esté
 * vivo: quien compra en Steam espera poder jugar en un avión, y espera que lo que
 * hizo allí siga contando cuando vuelva a haber red.
 *
 * Cada nivel superado se apunta en dos sitios: en el resumen local —que es lo que se
 * enseña mientras no hay conexión— y en una **cola de partidas pendientes**. El
 * servidor no puede fiarse del resumen, porque está en `localStorage` y cualquiera
 * puede editarlo; lo que se le manda es la cola, y es él quien vuelve a evaluarla
 * con las mismas reglas que aplica en línea.
 */

const STORAGE_KEY = 'triad_offline_progress';

/** Tope de la cola. Sin él, jugar mil niveles sin red llenaría el almacenamiento. */
const MAX_PENDING = 500;

const EMPTY = {
  maxLevelReached: 1,
  totalPuzzlesSolved: 0,
  totalTimePlayed: 0,
  achievements: [],
  pending: []
};

export class OfflineStore {
  constructor() {
    this.data = this.load();
  }

  load() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
      if (!saved || typeof saved !== 'object') return { ...EMPTY };
      return {
        ...EMPTY,
        ...saved,
        achievements: Array.isArray(saved.achievements) ? saved.achievements : [],
        pending: Array.isArray(saved.pending) ? saved.pending : []
      };
    } catch {
      // Un valor corrupto no puede impedir jugar: se empieza de cero.
      return { ...EMPTY };
    }
  }

  save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.data));
    } catch {
      // Cuota llena o modo privado. Se sigue jugando, solo no se recuerda.
    }
  }

  /** Nivel por el que continuar una partida sin conexión. */
  get nextLevel() {
    return Math.max(1, this.data.maxLevelReached);
  }

  get stats() {
    return {
      maxLevelReached: this.data.maxLevelReached,
      totalPuzzlesSolved: this.data.totalPuzzlesSolved,
      totalTimePlayed: this.data.totalTimePlayed
    };
  }

  get achievements() {
    return [...this.data.achievements];
  }

  get pendingCount() {
    return this.data.pending.length;
  }

  /**
   * Apunta un nivel superado y devuelve los logros que desbloquea.
   *
   * La evaluación local usa el mismo motor y el mismo catálogo que el servidor, así
   * que el aviso que ve el jugador sin conexión coincide con lo que se le concederá
   * al sincronizar. Si no coincidiera, vería desbloquearse un logro que luego
   * desaparece, que es peor que no avisar.
   *
   * @param {object} run       nivel superado
   * @param {object[]} catalog catálogo de logros vigente
   * @returns {{stats: object, unlocked: string[]}}
   */
  recordLevel(run, catalog = []) {
    const level = Math.max(1, Math.round(Number(run.level) || 1));
    const timeSpent = Math.max(0, Math.round(Number(run.timeSpent) || 0));

    this.data.maxLevelReached = Math.max(this.data.maxLevelReached, level + 1);
    this.data.totalPuzzlesSolved += 1;
    this.data.totalTimePlayed += timeSpent;

    const entry = {
      level,
      timeSpent,
      playersCount: 1,
      damageTaken: Math.max(0, Number(run.damageTaken) || 0),
      deaths: Math.max(0, Number(run.deaths) || 0),
      at: Date.now()
    };

    // Se descartan las más antiguas, no las nuevas: si hay que perder algo, que sea
    // lo que ya quedó lejos y no el nivel que el jugador acaba de terminar.
    this.data.pending.push(entry);
    if (this.data.pending.length > MAX_PENDING) {
      this.data.pending = this.data.pending.slice(-MAX_PENDING);
    }

    const unlocked = evaluateAchievements(
      {
        level,
        maxLevel: this.data.maxLevelReached,
        puzzlesSolved: this.data.totalPuzzlesSolved,
        totalTimePlayed: this.data.totalTimePlayed,
        timeSpent,
        playersCount: 1,
        deaths: entry.deaths,
        damageTaken: entry.damageTaken,
        flawless: entry.damageTaken === 0
      },
      catalog,
      this.data.achievements
    );

    this.data.achievements.push(...unlocked);
    this.save();

    return { stats: this.stats, unlocked };
  }

  /**
   * Copia de la cola para enviarla. No se borra hasta que el servidor confirme.
   *
   * `at` viaja con cada nivel: es lo que permite al servidor reconocer un reenvío
   * —cuando su acuse se perdió y el cliente lo mandó otra vez— y no contarlo dos
   * veces. Ver migración 006.
   */
  pendingRuns() {
    return this.data.pending.map(run => ({ ...run }));
  }

  /**
   * Vacía la cola tras una sincronización confirmada.
   *
   * Se borran solo las `count` primeras, las que se enviaron. Vaciar entera
   * perdería lo que el jugador hubiera terminado mientras la petición viajaba.
   */
  clearSynced(count) {
    this.data.pending = this.data.pending.slice(count);
    this.save();
  }

  /** Borrado completo, para cerrar sesión o empezar de nuevo. */
  reset() {
    this.data = { ...EMPTY, achievements: [], pending: [] };
    this.save();
  }
}

/** Instancia única: la comparten el menú y el bucle de partida. */
export const offlineStore = new OfflineStore();
