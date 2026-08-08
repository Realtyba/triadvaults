import { esc, setText, setWidth, toggleClass } from '../dom.js';
import { icon } from '../icons.js';

/**
 * HUD de partida.
 *
 * No reconstruye HTML nunca: monta el esqueleto una vez, cachea las referencias y
 * escribe propiedades sueltas. Es el punto donde antes se reescribía toda la
 * interfaz en cada frame del bucle de render.
 */
export class HudView {
  static keys = [
    'level',
    'levelLabel',
    'seedLabel',
    'roomCode',
    'playersCount',
    'health',
    'objectiveText',
    'puzzleProgress',
    'puzzleSolved',
    'elapsedTime',
    'inputMode',
    'isTouch',
    'teammates',
    'zoom',
    'lang'
  ];

  /**
   * Huecos de compañero que se montan en el esqueleto.
   *
   * Dos, porque la sala es de tres y el tercero es uno mismo. Se montan siempre y se
   * ocultan los que sobren, en vez de crearlos al vuelo: reconstruir HTML dentro del
   * HUD es justo lo que este módulo evita, y lo vigila un `MutationObserver` en los
   * e2e (`scripts/e2e/scenarios/solo.js`).
   */
  static TEAM_SLOTS = 2;

  constructor(root, ctx) {
    this.root = root;
    this.ctx = ctx;
    this.refs = null;
    this.lang = ctx.lang;
  }

  get t() {
    return this.ctx.t;
  }

  mount() {
    this.root.innerHTML = `
      <div class="hud-bar glass-bar">
        <div class="hud-item"><span class="hud-label">${this.t('level')}</span><span class="hud-value" data-ref="level">1</span></div>
        <div class="hud-item"><span class="hud-label">${this.t('seed')}</span><span class="hud-value" data-ref="seed">#0000</span></div>
        <div class="hud-item"><span class="hud-label">${this.t('code')}</span><span class="hud-value" data-ref="code">----</span></div>
        <div class="hud-item"><span class="hud-label">${this.t('active_agents')}</span><span class="hud-value" data-ref="agents">1 / 3</span></div>
        <div class="hud-item"><span class="hud-label">${this.t('puzzle_status')}</span><span class="hud-value" data-ref="status">${this.t('pending')}</span></div>
        <!-- El zoom vive en la barra y no en un menú: es un ajuste que se toca en
             mitad de la acción —para ver venir al fantasma o para leer una placa
             lejana—, no una vez al empezar. -->
        <button class="btn btn-sm btn-secondary hud-zoom" data-action="view:zoom"
                title="${this.t('btn_zoom')}" aria-label="${this.t('btn_zoom')}">
          ${icon('zoom', { size: 14 })}<span data-ref="zoom">100%</span>
        </button>
        <button class="btn btn-sm btn-secondary" data-action="game:pause">${this.t('btn_pause')}</button>
      </div>

      <div class="hud-health glass-panel" data-ref="healthPanel">
        <div class="hud-health__label">${this.t('health')} <span data-ref="healthValue">100</span>%</div>
        <div class="bar">
          <!-- La estela queda por detrás y baja con retardo: es lo que convierte
               una barra que salta en un golpe que se ve encajar. -->
          <div class="bar__ghost" data-ref="healthGhost"></div>
          <div class="bar__fill" data-ref="healthFill"></div>
        </div>
      </div>

      <div class="hud-team" data-ref="team">
        ${Array.from({ length: HudView.TEAM_SLOTS }, (_, i) => `
          <div class="hud-team__agent hidden" data-ref="teamSlot${i}">
            <span class="hud-team__name" data-ref="teamName${i}"></span>
            <div class="bar bar--slim"><div class="bar__fill" data-ref="teamFill${i}"></div></div>
          </div>
        `).join('')}
      </div>

      <div class="hud-objective glass-panel">
        <div class="hud-objective__tag">${this.t('objective_title')}</div>
        <div class="hud-objective__desc" data-ref="objective"></div>
        <div class="bar"><div class="bar__fill bar__fill--progress" data-ref="progressFill"></div></div>
        <div class="hud-objective__hint" data-ref="hint">${this.t('camera_hint')}</div>
      </div>

      <div class="hud-timer glass-panel">
        <span class="hud-timer__label">${this.t('hud_timer')}</span>
        <span class="hud-timer__value" data-ref="timer">00:00</span>
        <div class="hud-input-mode" data-ref="inputMode">
          ${icon('keyboard', { size: 14 })}
          <span data-ref="inputLabel">${this.t('hud_input_keyboard')}</span>
        </div>
      </div>
    `;

    const ref = name => this.root.querySelector(`[data-ref="${name}"]`);
    this.refs = {
      level: ref('level'),
      seed: ref('seed'),
      code: ref('code'),
      agents: ref('agents'),
      status: ref('status'),
      zoom: ref('zoom'),
      healthValue: ref('healthValue'),
      healthFill: ref('healthFill'),
      healthGhost: ref('healthGhost'),
      healthPanel: ref('healthPanel'),
      objective: ref('objective'),
      hint: ref('hint'),
      progressFill: ref('progressFill'),
      timer: ref('timer'),
      inputMode: ref('inputMode'),
      inputLabel: ref('inputLabel'),
      team: ref('team'),
      teamSlots: Array.from({ length: HudView.TEAM_SLOTS }, (_, i) => ({
        root: ref(`teamSlot${i}`),
        name: ref(`teamName${i}`),
        fill: ref(`teamFill${i}`)
      }))
    };
    this.lang = this.ctx.lang;
  }

  render(state) {
    // Las etiquetas fijas están en el esqueleto, así que un cambio de idioma sí lo rehace.
    if (!this.refs || this.lang !== state.lang) this.mount();

    setText(this.refs.level, state.levelLabel || state.level);
    setText(this.refs.seed, state.seedLabel);
    setText(this.refs.code, state.roomCode || '----');
    setText(this.refs.agents, `${state.playersCount} / 3`);
    setText(this.refs.status, state.puzzleSolved ? this.t('solved') : this.t('pending'));
    toggleClass(this.refs.status, 'is-done', state.puzzleSolved);
    setText(this.refs.zoom, `${state.zoom ?? 100}%`);

    this.renderHealth(state.health);
    this.renderTeam(state.teammates);
    this.renderTimer(state.elapsedTime || 0);
    this.renderInputMode(state.inputMode);
    this.renderHint(state.inputMode);

    if (this.refs.objective.textContent !== state.objectiveText) {
      this.refs.objective.innerHTML = esc(state.objectiveText);
    }
    setWidth(this.refs.progressFill, state.puzzleProgress);
  }

  /**
   * Vida y estado de los otros dos agentes.
   *
   * En partida el HUD solo decía "1 / 3", así que no había forma de saber si un
   * compañero estaba en pie sin buscarlo con la vista por la sala. Importa porque los
   * puzles exigen sincronía: en `PressurePlates` hay que pisar N placas a la vez, y si
   * uno está caído la partida está esperando a un respawn que nadie ve venir.
   *
   * @param {Array<{uid: string, name: string, health: number, alive: boolean}>} teammates
   */
  renderTeam(teammates = []) {
    if (!this.refs.teamSlots) return;

    this.refs.teamSlots.forEach((slot, i) => {
      const mate = teammates[i];
      toggleClass(slot.root, 'hidden', !mate);
      if (!mate) return;

      setText(slot.name, mate.name || '···');
      setWidth(slot.fill, mate.health ?? 0);
      slot.fill.dataset.level = mate.health > 50 ? 'high' : mate.health > 20 ? 'mid' : 'low';
      toggleClass(slot.root, 'is-down', !mate.alive);
    });

    // Sin compañeros —en solitario o sin conexión— el bloque entero desaparece: dejar
    // un hueco vacío en la franja inferior le come sitio al pulgar en un móvil.
    toggleClass(this.refs.team, 'hidden', teammates.length === 0);
  }

  /** Formatea segundos como MM:SS. */
  renderTimer(seconds) {
    const total = Math.max(0, Math.floor(seconds));
    const m = String(Math.floor(total / 60)).padStart(2, '0');
    const s = String(total % 60).padStart(2, '0');
    setText(this.refs.timer, `${m}:${s}`);
  }

  renderInputMode(mode = 'keyboard') {
    if (!this.refs.inputMode) return;
    const iconName = mode === 'gamepad' ? 'gamepad' : mode === 'touch' ? 'touch' : 'keyboard';
    const label = this.t(`hud_input_${mode}`);
    // Solo reescribe si cambió, para no animar el icono en cada frame.
    if (this.refs.inputLabel.textContent !== label) {
      this.refs.inputMode.innerHTML = `${icon(iconName, { size: 14 })}<span data-ref="inputLabel">${label}</span>`;
      this.refs.inputLabel = this.refs.inputMode.querySelector('[data-ref="inputLabel"]');
    }
  }

  /** La pista habla de la rueda del ratón, que en un táctil no existe. */
  renderHint(mode = 'keyboard') {
    if (!this.refs.hint) return;
    setText(this.refs.hint, this.t(mode === 'touch' ? 'camera_hint_touch' : 'camera_hint'));
  }

  /**
   * Vida con acuse de recibo.
   *
   * La barra bajaba en silencio: mirando al personaje no había forma de notar el
   * golpe salvo comprobando el número. Ahora el panel destella al recibir daño y
   * late cuando la vida es crítica, así que el estado se percibe sin apartar la
   * vista de la acción.
   */
  renderHealth(health) {
    const previous = this.lastHealth ?? health;
    this.lastHealth = health;

    setText(this.refs.healthValue, health);
    setWidth(this.refs.healthFill, health);
    setWidth(this.refs.healthGhost, previous);
    this.refs.healthFill.dataset.level = health > 50 ? 'high' : health > 20 ? 'mid' : 'low';

    toggleClass(this.refs.healthPanel, 'is-critical', health > 0 && health <= 20);

    if (health >= previous) return;

    // Reiniciar la animación exige retirar la clase y forzar un reflujo; sin eso
    // dos golpes seguidos solo se ven una vez.
    this.refs.healthPanel.classList.remove('is-hit');
    void this.refs.healthPanel.offsetWidth;
    this.refs.healthPanel.classList.add('is-hit');

    // La estela persigue al valor real tras una pausa, no de inmediato.
    clearTimeout(this.ghostTimer);
    this.ghostTimer = setTimeout(() => setWidth(this.refs.healthGhost, health), 260);
  }
}
