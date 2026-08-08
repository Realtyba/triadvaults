import { MAX_HEALTH } from '../../shared/constants.js';

/**
 * Lo que la interfaz puede pedirle al motor, y nada más.
 *
 * La mitad simétrica de `GameState`. Antes la interfaz alcanzaba `game.input.touch`,
 * `game.players.localUid` y montaba a mano la llamada de reaparición con un `100` y un
 * `Date.now() % 7`: reglas de juego escritas en la capa que pinta, y dos números que sólo
 * por suerte coincidían con los del servidor.
 *
 * Aquí cada botón pide **una intención** —"que reaparezca el agente local"— y el motor
 * decide con qué números la cumple. Añadir un comando es una decisión consciente; alcanzar
 * `game.loQueSea` desde una vista ya no.
 */
export class GameCommands {
  constructor(game) {
    this.game = game;
  }

  // ------------------------------------------------------------- cámara

  cycleZoom() {
    this.game.cycleZoom();
  }

  // ------------------------------------------------------------ controles

  captureNextKey(onKey) {
    this.game.input.captureNextKey(onKey);
  }

  cancelKeyCapture() {
    this.game.input.cancelCapture();
  }

  // -------------------------------------------------------------- niveles

  startLevel(payload) {
    this.game.startLevel(payload);
  }

  regenerateLevel(payload = {}) {
    this.game.regenerateLevel(payload);
  }

  stop() {
    this.game.stop();
  }

  /**
   * Reaparición del agente local sin sala de por medio.
   *
   * El uid, la vida y la celda los resuelve el motor. La celda sale del reloj a propósito:
   * es un sorteo barato que basta para que dos caídas seguidas no devuelvan al agente al
   * mismo sitio, que era el motivo real de ese `Date.now() % 7`.
   */
  respawnLocal() {
    this.game.respawn(this.game.players.localUid, MAX_HEALTH, Date.now() % 7);
  }
}
