import { esc } from '../dom.js';
import { icon } from '../icons.js';
import { ACTIONS, keyLabel } from '../../engine/Bindings.js';

/**
 * Fila de remapeo por acción, con hueco principal y alternativo.
 *
 * El hueco que está capturando se pinta distinto y no muestra su tecla: mientras se
 * espera una pulsación, enseñar la asignación anterior hace dudar de si el clic
 * llegó a registrarse.
 */
function controlsSection(state, t) {
  const rows = ACTIONS.map(action => {
    const slots = (state.controls && state.controls[action]) || [];
    const buttons = [0, 1]
      .map(slot => {
        const capturing = state.capturingBind === `${action}:${slot}`;
        return `
          <button class="key-slot ${capturing ? 'is-capturing' : ''}"
                  data-action="input:rebind" data-bind="${action}" data-slot="${slot}">
            ${capturing ? t('bind_press_key') : esc(keyLabel(slots[slot], t))}
          </button>`;
      })
      .join('');

    return `<li class="key-row"><span class="key-row__name">${t(`action_${action}`)}</span>${buttons}</li>`;
  }).join('');

  return `
    <div class="settings-group">
      <label>${t('settings_controls')}</label>
      <ul class="key-list">${rows}</ul>
      <p class="settings-hint">
        ${state.gamepadName ? `${t('gamepad_detected')} ${esc(state.gamepadName)}` : t('gamepad_none')}
      </p>
      <button class="btn btn-outline btn-sm btn-block" data-action="input:reset-bindings">
        ${t('btn_reset_bindings')}
      </button>
    </div>
  `;
}

/**
 * Cada modal es una función `(state, ctx) => ({ title, body, className })`.
 * Tenerlos en una tabla evita la cadena de `if` sobre ids que había en el gestor de UI.
 */
export const MODALS = {
  alert: (state, { t }) => ({
    title: t('alert_sys_title'),
    className: 'modal--sm',
    body: `
      <p class="modal__message">${esc(state.alertMessage)}</p>
      <button class="btn btn-secondary" data-action="modal:close">${t('btn_close')}</button>
    `
  }),

  victory: (state, { t }) => ({
    title: t('victory_title'),
    className: 'modal--victory',
    body: `
      <p>${t('victory_desc')}</p>
      <p class="modal__loader">${t('next_level')}</p>
    `
  }),

  'game-over': (state, { t }) => ({
    title: t('game_over_title'),
    className: 'modal--danger',
    body: `
      <p>${t('game_over_desc')}</p>
      <button class="btn btn-danger" data-action="game:respawn">${t('btn_respawn')}</button>
      ${state.canRegenerate
        ? `<button class="btn btn-outline" data-action="game:regenerate">${t('btn_regenerate_map')}</button>`
        : ''}
    `
  }),

  pause: (state, { t }) => ({
    title: t('pause_title'),
    className: 'modal--sm',
    body: `
      <div class="modal__stack">
        <button class="btn btn-primary" data-action="game:resume">${t('btn_resume')}</button>
        <button class="btn btn-secondary" data-action="modal:open" data-modal="settings">
          ${icon('settings')} ${t('settings_title')}
        </button>
        <button class="btn btn-danger" data-action="room:leave">${t('btn_leave')}</button>
      </div>
    `
  }),

  verify: (state, { t, form }) => {
    const waiting = state.resendCooldown > 0;
    return {
      title: t('verify_title'),
      className: 'modal--sm',
      body: `
        <p class="modal__desc">${t('verify_desc')}</p>
        ${state.verifyDevCode
          ? `<p class="dev-pin">${t('verify_dev_code')} <strong>${esc(state.verifyDevCode)}</strong></p>`
          : ''}
        <form data-action="profile:verify" data-submit>
          <input type="text" class="pin-input" data-field="verifyPin" maxlength="6" inputmode="numeric"
                 placeholder="${t('placeholder_pin')}" value="${esc(form.get('verifyPin'))}">
          <p class="modal__error">${esc(state.verifyMessage)}</p>
          <button type="submit" class="btn btn-success btn-block">${t('btn_verify')}</button>
        </form>
        <button type="button" class="btn btn-outline btn-sm btn-block" data-action="profile:resend-pin" ${waiting ? 'disabled' : ''}>
          ${waiting ? t('btn_resend_pin_wait').replace('{0}', state.resendCooldown) : t('btn_resend_pin')}
        </button>
        <button type="button" class="btn btn-sm btn-danger btn-block" data-action="auth:logout">${t('btn_back_to_login')}</button>
      `
    };
  },

  'edit-profile': (state, { t, form }) => ({
    title: t('edit_profile_title'),
    className: 'modal--form',
    body: `
      <form class="form-grid" data-action="profile:save" data-submit>
        <label>${t('label_username')}</label>
        <input type="text" data-field="editUsername" maxlength="16" value="${esc(form.get('editUsername'))}">

        <div class="form-row">
          <div>
            <label>${t('placeholder_firstname')}</label>
            <input type="text" data-field="editFirstName" value="${esc(form.get('editFirstName'))}">
          </div>
          <div>
            <label>${t('placeholder_lastname')}</label>
            <input type="text" data-field="editLastName" value="${esc(form.get('editLastName'))}">
          </div>
        </div>

        <label>${t('label_email')}</label>
        <input type="email" data-field="editEmail" value="${esc(form.get('editEmail'))}">

        <p class="modal__error">${esc(state.profileMessage)}</p>
        <div class="modal__actions">
          <button type="submit" class="btn btn-primary">${t('btn_save')}</button>
          <button type="button" class="btn btn-secondary" data-action="modal:close">${t('btn_cancel')}</button>
        </div>
      </form>
    `
  }),

  /**
   * Ajustes gráficos.
   *
   * El motor ya escogía un preset por su cuenta según la GPU, pero esa decisión
   * era invisible e inapelable: quien tenga una máquina mal detectada no tenía
   * forma de subir ni bajar la calidad. Aquí se expone.
   */
  settings: (state, { t }) => ({
    title: t('settings_title'),
    className: 'modal--sm',
    body: `
      <div class="settings-group">
        <label>${t('settings_quality')}</label>
        <div class="segmented">
          ${state.qualityOptions
            .map(
              opt => `<button class="segmented__btn ${opt.level === state.quality ? 'is-active' : ''}"
                        data-action="app:quality" data-level="${opt.level}">${opt.label}</button>`
            )
            .join('')}
        </div>
        <p class="settings-hint">${t('settings_quality_hint')}</p>
      </div>

      <div class="settings-group">
        <label>${t('settings_audio')}</label>
        <button class="btn btn-secondary btn-block" data-action="app:audio">
          ${icon(state.audioMuted ? 'audioOff' : 'audioOn')} ${t('btn_audio')}
        </button>
      </div>

      <div class="settings-group">
        <label>${t('settings_language')}</label>
        <div class="segmented">
          <button class="segmented__btn ${state.lang === 'es' ? 'is-active' : ''}" data-action="app:lang" data-lang="es">ESPAÑOL</button>
          <button class="segmented__btn ${state.lang === 'en' ? 'is-active' : ''}" data-action="app:lang" data-lang="en">ENGLISH</button>
        </div>
      </div>

      ${controlsSection(state, t)}

      <button class="btn btn-secondary btn-block" data-action="modal:close">${t('btn_close')}</button>
    `
  }),

  tos: (state, { t }) => ({
    title: t('tos_title'),
    className: 'modal--doc',
    body: `
      <p>${t('tos_text')}</p>
      <div class="modal__fineprint">${t('tos_privacy_policy_full')}</div>
      <button class="btn btn-secondary" data-action="modal:close">${t('btn_close')}</button>
    `
  }),

  instructions: (state, { t }) => ({
    title: t('instructions_title'),
    className: 'modal--doc',
    body: `
      <ul class="modal__list">
        <li>${t('inst_movement')}</li>
        <li>${t('inst_camera')}</li>
        <li>${t('inst_objective')}</li>
        <li>${t('inst_door')}</li>
        <li>${t('inst_ghost')}</li>
      </ul>
      <button class="btn btn-secondary" data-action="modal:close">${t('btn_close')}</button>
    `
  })
};

/** Modales que no se pueden cerrar con Escape ni con clic fuera. */
export const BLOCKING_MODALS = new Set(['victory', 'game-over', 'verify']);
