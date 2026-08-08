import * as THREE from 'three';
import { icon } from '../icons.js';
import { MAX_PLAYERS } from '../../../shared/constants.js';

/**
 * Flechas en el borde de la pantalla para lo que hay fuera de encuadre.
 *
 * ## Por qué existe
 *
 * Antes la cámara encuadraba la bóveda entera, así que todo lo que importaba estaba
 * siempre a la vista: los compañeros, los fantasmas y las placas. Desde que la cámara
 * **sigue al agente local**, en una sala grande un compañero al otro extremo sale de
 * pantalla —y en un puzle que exige pisar dos placas a la vez, no saber dónde está es
 * perder la información con la que se juega.
 *
 * Esto la devuelve sin devolver el problema: en vez de alejar la cámara hasta que
 * quepan todos —que es lo que dejaba al agente como un punto en un móvil—, se marca en
 * el borde por dónde están.
 *
 * ## Qué se marca y qué no
 *
 * Los compañeros, siempre, con **su color de agente**: es la misma señal que su anillo
 * de suelo, así que no hay que aprender un código nuevo.
 *
 * Los fantasmas, no todos. El tuyo siempre; los ajenos solo cuando están cerca. Marcar
 * los tres a todas horas convierte esto en un radar y desmonta la capa de tensión que
 * construyen `updateTension` y el latido del `SoundEngine`: si en todo momento sabes
 * dónde están, no hay nada que temer. Lo que se conserva es lo que te afecta.
 *
 * ## Por qué no hereda de `View`
 *
 * Igual que `HudView` y `TouchControlsView`: se pinta en respuesta al bucle de juego y
 * no al estado. El esqueleto se monta una vez y por fotograma solo cambian un
 * `transform` y una clase, que el navegador resuelve en el compositor. El estado sí lo
 * mira, pero solo para mostrarse u ocultarse y para traducir las etiquetas.
 *
 * ## Y por qué cuelga de su propio nodo
 *
 * Porque el escenario e2e `solo` vigila `.view--hud` con un `MutationObserver` en modo
 * `subtree` para detectar que el HUD se reconstruya. Un marcador dentro de esa rama
 * sería una mutación por fotograma y haría fallar esa comprobación con un cambio que no
 * tiene nada que ver con lo que vigila.
 */

/** Cuánto se separan los marcadores del borde, en píxeles. */
const EDGE_PADDING = 34;

/**
 * Histéresis del borde, en coordenadas normalizadas.
 *
 * Sin ella, algo justo en el límite de la pantalla entra y sale del encuadre con cada
 * paso del jugador, y su marcador parpadea. Con dos umbrales —se enciende un poco más
 * afuera de donde se apaga— la transición ocurre una sola vez.
 */
const SHOW_AT = 0.97;
const HIDE_AT = 0.94;

/** Altura sobre el suelo a la que se apunta, en unidades de mundo. */
const TORSO_HEIGHT = 1.2;

export class EdgeMarkersView {
  static keys = ['view', 'modal', 'paused', 'lang'];

  constructor(root, ctx) {
    this.root = root;
    this.ctx = ctx;
    this.refs = [];
    this.visible = false;
    this.lang = ctx.lang;
    /** Estado de encendido por hueco, para la histéresis. */
    this.shown = [];
    /** Vector de trabajo. Reutilizado: esto corre en el bucle y no debe generar basura. */
    this.scratch = new THREE.Vector3();
  }

  get t() {
    return this.ctx.t;
  }

  /**
   * Monta los huecos de una vez y para siempre.
   *
   * Son un número fijo —dos compañeros y tres fantasmas, los topes del juego— en vez de
   * crearlos y destruirlos según quién esté en la sala. Reciclar nodos evita tocar el
   * DOM en el bucle, que es justo lo que esta vista existe para no hacer.
   */
  mount() {
    const slots = (MAX_PLAYERS - 1) + MAX_PLAYERS;
    this.root.innerHTML = Array.from({ length: slots }, (_, i) => `
      <div class="edge-marker hidden" data-ref="${i}" aria-hidden="true">
        ${icon('marker', { size: 22, className: 'edge-marker__arrow' })}
      </div>
    `).join('');

    this.refs = Array.from({ length: slots }, (_, i) => this.root.querySelector(`[data-ref="${i}"]`));
    this.shown = new Array(slots).fill(false);
    this.lang = this.ctx.lang;
  }

  render(state) {
    if (!this.refs.length || this.lang !== state.lang) this.mount();

    const shouldShow = state.view === 'hud' && !state.modal && !state.paused;
    if (shouldShow === this.visible) return;

    this.visible = shouldShow;
    this.root.classList.toggle('hidden', !shouldShow);
    if (!shouldShow) this.hideFrom(0);
  }

  /**
   * Coloca los marcadores. Lo llama el bucle de juego con lo que hay que señalar.
   *
   * @param {THREE.Camera} camera
   * @param {Array<{position: THREE.Vector3, color: string, urgent?: boolean}>} entries
   */
  update(camera, entries) {
    if (!this.visible || !camera) return;

    const halfW = this.root.clientWidth / 2;
    const halfH = this.root.clientHeight / 2;
    if (halfW === 0 || halfH === 0) return;

    let slot = 0;
    for (const entry of entries) {
      if (slot >= this.refs.length) break;
      if (this.place(slot, entry, camera, halfW, halfH)) slot++;
    }
    this.hideFrom(slot);
  }

  /**
   * Proyecta una posición del mundo y, si cae fuera, deja su marcador en el borde.
   *
   * @returns {boolean} si el hueco se ha consumido
   */
  place(slot, entry, camera, halfW, halfH) {
    const node = this.refs[slot];
    if (!node) return false;

    // Se apunta al torso y no a los pies: un compañero pegado al borde de abajo tiene
    // los pies medio fuera de cuadro y su marcador daría tumbos entre dentro y fuera.
    const v = this.scratch.copy(entry.position);
    v.y += TORSO_HEIGHT;
    v.project(camera);

    // `z > 1` es "por detrás del ojo", y ahí la proyección devuelve el punto **espejado**:
    // alguien justo detrás aparecería marcado en el lado contrario. Invertir los dos
    // ejes lo devuelve al lado por el que realmente está.
    if (v.z > 1) {
      v.x = -v.x;
      v.y = -v.y;
    }

    const outside = Math.max(Math.abs(v.x), Math.abs(v.y));
    const threshold = this.shown[slot] ? HIDE_AT : SHOW_AT;
    if (outside < threshold) {
      this.shown[slot] = false;
      node.classList.add('hidden');
      // El hueco se consume igual: si no, al salir de pantalla el siguiente de la lista
      // heredaría este marcador y su color, y se vería un salto de identidad.
      return true;
    }

    this.shown[slot] = true;

    // Escalar la dirección hasta tocar el rectángulo: el eje que primero se sale manda.
    const scale = 1 / outside;
    const x = v.x * scale * (halfW - EDGE_PADDING);
    const y = v.y * scale * (halfH - EDGE_PADDING);

    // En pantalla la Y crece hacia abajo y en coordenadas normalizadas hacia arriba.
    node.style.transform = `translate(-50%, -50%) translate(${x}px, ${-y}px)`;
    node.style.setProperty('--marker-color', entry.color);
    node.style.setProperty('--marker-angle', `${Math.atan2(-y, x)}rad`);
    node.classList.toggle('edge-marker--urgent', Boolean(entry.urgent));
    node.classList.remove('hidden');
    return true;
  }

  hideFrom(slot) {
    for (let i = slot; i < this.refs.length; i++) {
      this.shown[i] = false;
      this.refs[i].classList.add('hidden');
    }
  }
}
