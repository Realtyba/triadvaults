import { offlineStore } from '../network/OfflineStore.js';
import { NEXT_LEVEL_DELAY_MS } from './tuning.js';

/**
 * El sustituto del servidor cuando no hay servidor.
 *
 * Espejo de `NetworkBridge`: donde ése traduce eventos de socket en llamadas al motor,
 * éste traduce el final de un nivel en lo que en línea haría el servidor —anotar el
 * progreso, resolver los logros y mandar el nivel siguiente—, pero contra el almacén
 * local.
 *
 * Existe como fichero aparte porque estaba dentro de `UIManager`, y ahí desentonaba: no
 * pinta nada, no escucha ningún botón y es la única pieza de reglas de partida que vivía
 * en la capa de presentación. Que el motor le hable a él y no a la interfaz es lo que
 * cierra el círculo de `GameCommands`.
 *
 * La semilla se sortea una vez por sesión y no se guarda: el determinismo sólo hace falta
 * para que dos clientes de una sala construyan la misma bóveda, y aquí no hay segundo
 * cliente.
 */
export class OfflineBridge {
  /**
   * @param {object} deps
   * @param {import('./GameCommands.js').GameCommands} deps.commands
   * @param {import('../ui/state/Store.js').Store} deps.store
   * @param {() => object} deps.catalog     catálogo de logros vigente
   * @param {(keys: string[]) => void} deps.onUnlocked
   * @param {() => void} deps.onVictory
   */
  constructor({ commands, store, catalog, onUnlocked, onVictory }) {
    this.commands = commands;
    this.store = store;
    this.catalog = catalog;
    this.onUnlocked = onUnlocked;
    this.onVictory = onVictory;
    this.seed = 0;
    this.timer = null;
  }

  /** Arranca la partida local por el nivel más alto alcanzado, no desde el uno. */
  start() {
    this.seed = Math.floor(Math.random() * 1e9);
    this.store.patch({ offline: true, modal: null });
    this.commands.startLevel({
      level: offlineStore.nextLevel,
      seed: this.seed,
      seedOffset: 0,
      playersCount: 1
    });
  }

  /**
   * Nivel superado sin sala. Encadena al siguiente con la misma pausa de victoria que la
   * partida en línea; ver `NEXT_LEVEL_DELAY_MS`.
   */
  levelComplete(run) {
    const { unlocked } = offlineStore.recordLevel(run, this.catalog());

    this.store.patch({ offlinePending: offlineStore.pendingCount });
    if (unlocked.length > 0) this.onUnlocked(unlocked);
    this.onVictory();

    clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      // Se salió al menú mientras corría la pausa.
      if (this.store.get().view !== 'hud') return;
      this.commands.startLevel({
        level: run.level + 1,
        seed: this.seed,
        seedOffset: 0,
        playersCount: 1
      });
    }, NEXT_LEVEL_DELAY_MS);
  }

  destroy() {
    clearTimeout(this.timer);
  }
}
