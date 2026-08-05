export const renderUI = (t, state) => {
  return `
    <!-- Top Header Language Switcher -->
    <div class="top-header-bar" style="display: flex; justify-content: space-between; padding: 10px 20px; gap: 15px;">
      <div class="audio-controls">
        <button id="btn-toggle-audio" class="btn-sm btn-secondary" style="font-size: 16px;">
          ${state.audioMuted ? '🔇' : '🔊'}
        </button>
      </div>
      <div class="lang-picker">
        <button class="lang-selector-btn ${state.lang === 'es' ? 'active' : ''}" data-lang="es">ES 🇪🇸</button>
        <button class="lang-selector-btn ${state.lang === 'en' ? 'active' : ''}" data-lang="en">EN 🇬🇧</button>
      </div>
    </div>

    <!-- Main Menu Overlay -->
    <div id="main-menu" class="glass-panel ${state.currentView === 'main' ? '' : 'hidden'}">
      <div class="brand">
        <h1 class="glitch-title">${t('title')}</h1>
        <p class="subtitle">${t('subtitle')}</p>
      </div>

      <!-- Auth Section -->
      ${!state.userProfile ? `
      <div id="auth-box" class="auth-section">
        <div class="auth-tabs">
          <button id="tab-login" class="tab-btn ${state.authMode === 'login' ? 'active' : ''}">${t('tab_login')}</button>
          <button id="tab-register" class="tab-btn ${state.authMode === 'register' ? 'active' : ''}">${t('tab_register')}</button>
          <button id="tab-recover" class="tab-btn ${state.authMode === 'recover' ? 'active' : ''}">${t('tab_recover')}</button>
        </div>

        <!-- Form 1: Login & Register Inputs -->
        <div id="form-auth" class="auth-inputs ${state.authMode !== 'recover' ? '' : 'hidden'}">
          <input type="text" id="auth-firstname" class="${state.authMode === 'register' ? '' : 'hidden'}" placeholder="Nombre" maxlength="30" value="${state.authFirstName}">
          <input type="text" id="auth-lastname" class="${state.authMode === 'register' ? '' : 'hidden'}" placeholder="Apellido" maxlength="30" value="${state.authLastName}">
          <input type="text" id="auth-username" placeholder="${t('user_placeholder')}" maxlength="16" value="${state.authUsername}">
          <input type="text" id="auth-email" class="${state.authMode === 'register' ? '' : 'hidden'}" placeholder="${t('email_placeholder')}" value="${state.authEmail}">
          <input type="password" id="auth-password" placeholder="${t('pass_placeholder')}" value="${state.authPassword}">
          
          <!-- TOS Privacy Checkbox -->
          <div id="tos-checkbox-container" class="tos-container ${state.authMode === 'register' ? '' : 'hidden'}">
            <label class="tos-label">
              <input type="checkbox" id="tos-checkbox" ${state.tosChecked ? 'checked' : ''}>
              <span>${t('tos_agree')}</span>
            </label>
          </div>

          <button id="btn-auth-submit" class="btn btn-primary">${state.authMode === 'register' ? t('btn_register') : t('btn_login')}</button>
        </div>

        <!-- Form 2: Password Reset Inputs -->
        <div id="form-recover" class="auth-inputs ${state.authMode === 'recover' ? '' : 'hidden'}">
          <div id="recover-step-1" class="${state.recoverPinRequested ? 'hidden' : ''}">
            <p class="form-desc">Ingresa tu correo para generar tu PIN de recuperación:</p>
            <input type="text" id="recover-email" placeholder="Correo registrado (ej: agente@cyber.com)" value="${state.recoverEmail}">
            <button id="btn-request-pin" class="btn btn-secondary" style="margin-top: 10px;">SOLICITAR PIN DE VERIFICACIÓN</button>
          </div>

          <div id="recover-step-2" class="${state.recoverPinRequested ? '' : 'hidden'}">
            <p class="form-desc">Introduce el PIN de 6 dígitos y tu nueva contraseña:</p>
            <input type="text" id="recover-pin" placeholder="PIN de 6 dígitos" maxlength="6" value="${state.recoverPin}">
            <input type="password" id="recover-new-password" placeholder="Nueva Contraseña" value="${state.recoverNewPassword}">
            <button id="btn-reset-password" class="btn btn-success" style="margin-top: 10px;">CAMBIAR CONTRASEÑA</button>
          </div>
        </div>

        <div id="auth-msg" class="auth-feedback">${state.authMsg}</div>
      </div>
      ` : `
      <!-- Profile Info -->
      <div id="user-profile" class="user-card">
        <div class="profile-header">
          <span>AGENTE: <strong>${state.userProfile.firstName} ${state.userProfile.lastName}</strong> <span style="font-size: 0.8rem; color: #8a99ad;">(@${state.userProfile.username})</span></span>
          <button id="btn-logout" class="btn-sm">SALIR</button>
        </div>
        <div class="profile-stats">
          <span>NIVEL MÁXIMO: <strong>${state.userProfile.maxLevelReached}</strong></span>
          <span>ACERTIJOS: <strong>${state.userProfile.totalPuzzlesSolved}</strong></span>
        </div>
      </div>

      <!-- Lobby / Room Box -->
      <div class="menu-box">
        <div class="actions">
          <button id="btn-create-room" class="btn btn-primary">
            <span class="icon">⚡</span> <span>${t('btn_create_room')}</span> (NIVEL ${state.userProfile.maxLevelReached})
          </button>
          
          <div class="divider"><span>Ó</span></div>
          
          <div class="join-group">
            <input type="text" id="room-code-input" placeholder="${t('code')}" maxlength="6" value="${state.roomCodeInput}">
            <button id="btn-join-room" class="btn btn-secondary">${t('btn_join_room')}</button>
          </div>
        </div>
      </div>

      <!-- Public Rooms Browser -->
      <div class="menu-box" style="margin-top: 15px;">
        <h3 style="margin-bottom: 10px; font-size: 14px; color: var(--neon-cyan);">${t('public_rooms_title')}</h3>
        <div id="public-rooms-list" style="max-height: 120px; overflow-y: auto; background: rgba(0,0,0,0.4); padding: 10px; border-radius: 6px; display: flex; flex-direction: column; gap: 8px;">
          ${state.publicRooms.length === 0 
            ? `<p style="color: #666; font-size: 12px; text-align: center;">${t('no_public_rooms')}</p>`
            : state.publicRooms.map(r => `
                <div class="room-item glass-panel" style="display: flex; justify-content: space-between; align-items: center; padding: 8px;">
                  <div>
                    <strong style="color: var(--neon-cyan)">[${r.code}]</strong> Nivel ${r.currentLevel}
                    <span style="font-size: 0.8rem; color: #aaa;">(${r.playersCount}/3 Agentes)</span>
                  </div>
                  <button class="btn-join-public btn-sm btn-secondary" data-code="${r.code}">${t('btn_join_room')}</button>
                </div>
              `).join('')
          }
        </div>
      </div>

      <!-- Leaderboard -->
      <div class="menu-box" style="margin-top: 15px;">
        <h3 style="margin-bottom: 10px; font-size: 14px; color: var(--neon-cyan);">RANKING GLOBAL (TOP 10)</h3>
        <div id="leaderboard-list" style="background: rgba(0,0,0,0.4); padding: 10px; border-radius: 6px;">
          <table style="width: 100%; text-align: left; font-size: 0.8rem; border-collapse: collapse;">
            <thead>
              <tr style="color: var(--neon-pink); border-bottom: 1px solid rgba(255,255,255,0.1);">
                <th style="padding: 5px;">Rango</th>
                <th style="padding: 5px;">Agente</th>
                <th style="padding: 5px; text-align: center;">Nivel</th>
                <th style="padding: 5px; text-align: center;">Acertijos</th>
              </tr>
            </thead>
            <tbody>
              ${state.leaderboard.length === 0 ? `<tr><td colspan="4" style="text-align: center; padding: 10px; color: #666;">Cargando ranking...</td></tr>` : 
                state.leaderboard.map((u, i) => `
                <tr style="border-bottom: 1px solid rgba(255,255,255,0.05); ${u.username === state.userProfile.username ? 'background: rgba(0,243,255,0.1); font-weight: bold;' : ''}">
                  <td style="padding: 5px; color: ${i === 0 ? '#ffd700' : i === 1 ? '#c0c0c0' : i === 2 ? '#cd7f32' : 'inherit'};">#${i + 1}</td>
                  <td style="padding: 5px;">${u.firstName} ${u.lastName} <span style="opacity:0.5">(@${u.username})</span></td>
                  <td style="padding: 5px; text-align: center;">${u.maxLevelReached}</td>
                  <td style="padding: 5px; text-align: center;">${u.totalPuzzlesSolved}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </div>
      `}

      <div class="lore-footer">
        <p>${t('lore_footer')}</p>
        <div style="margin-top: 10px;">
          <a href="#" id="btn-show-tos" class="tos-link" style="margin-right: 15px;">${t('btn_show_tos')}</a>
          <a href="#" id="btn-show-instructions" class="tos-link">${t('btn_show_instructions')}</a>
        </div>
      </div>
    </div>

    <!-- Lobby Overlay -->
    <div id="lobby-panel" class="glass-panel ${state.currentView === 'lobby' ? '' : 'hidden'}">
      <h2>SALA EN ESPERA: <span class="highlight">${state.lobbyRoomCode}</span></h2>
      <p class="lobby-subtitle">Agentes conectados (<span id="lobby-player-count">${state.lobbyPlayers.length}</span>/3) - Acertijo adaptado en tiempo real</p>

      <div id="player-list" class="player-grid">
        ${state.lobbyPlayers.map(p => `
          <div class="player-card">
            <div class="player-avatar">🤖</div>
            <div class="player-name">${p.name} ${p.isHost ? '(Host)' : ''}</div>
          </div>
        `).join('')}
      </div>

      <div class="lobby-controls">
        <button id="btn-start-game" class="btn btn-success" ${(!state.isHost) ? 'disabled' : ''}>
          ${t('btn_start_game')}
        </button>
        <button id="btn-leave-lobby" class="btn btn-danger">${t('btn_leave')}</button>
      </div>
    </div>

    <!-- HUD Overlay (In Game) -->
    <div id="hud" class="${state.currentView === 'hud' ? '' : 'hidden'}">
      <!-- Header Bar -->
      <div class="hud-header glass-bar">
        <div class="hud-item">
          <span class="hud-label">${t('level')}</span>
          <span class="hud-value">${state.level}</span>
        </div>
        <div class="hud-item">
          <span class="hud-label">${t('seed')}</span>
          <span class="hud-value">${state.seed}</span>
        </div>
        <div class="hud-item">
          <span class="hud-label">${t('code')}</span>
          <span class="hud-value">${state.roomCode}</span>
        </div>
        <div class="hud-item">
          <span class="hud-label">${t('active_agents')}</span>
          <span class="hud-value">${state.playersCount}</span>
        </div>
        <div class="hud-item">
          <span class="hud-label">${t('puzzle_status')}</span>
          <span class="hud-value ${state.puzzleSolved ? 'status-done' : 'status-pending'}">
            ${state.puzzleSolved ? t('solved') : t('pending')}
          </span>
        </div>
        <button id="btn-hud-pause" class="btn btn-sm btn-secondary" style="padding: 6px 12px;">${t('btn_pause')}</button>
      </div>

      <!-- Health & Shield Energy Bar -->
      <div class="health-hud glass-panel">
        <div class="health-label"><span>${t('health')}</span>: <span>${state.health}</span>%</div>
        <div class="health-bar-container">
          <div class="health-bar-fill" style="width: ${state.health}%; background: ${state.health > 50 ? 'var(--neon-cyan)' : state.health > 20 ? 'orange' : 'red'};"></div>
        </div>
      </div>

      <!-- Puzzle Instructions / Objectives Banner -->
      <div id="puzzle-objective" class="objective-card glass-panel">
        <div class="card-tag">${t('objective_title')}</div>
        <div class="card-desc">${state.objectiveTitle || 'Cargando protocolo...'}</div>
        <div class="progress-container">
          <div class="progress-fill" style="width: ${state.puzzleProgress}%"></div>
        </div>
        <div class="camera-hint">${t('camera_hint')}</div>
      </div>
    </div>

    <!-- Pause Menu Overlay -->
    <div id="pause-menu" class="glass-panel modal ${state.activeModal === 'pause' ? '' : 'hidden'}" style="z-index: 9999;">
      <h2 class="victory-text" style="color: var(--neon-cyan); text-shadow: 0 0 10px var(--neon-cyan);">${t('pause_title')}</h2>
      <div class="pause-actions" style="display: flex; flex-direction: column; gap: 12px; margin-top: 20px;">
        <button id="btn-resume-game" class="btn btn-primary">${t('btn_resume')}</button>
        <div class="lang-picker" style="justify-content: center; margin: 5px 0;">
          <button class="lang-selector-btn ${state.lang === 'es' ? 'active' : ''}" data-lang="es">ES 🇪🇸</button>
          <button class="lang-selector-btn ${state.lang === 'en' ? 'active' : ''}" data-lang="en">EN 🇬🇧</button>
        </div>
        <button id="btn-toggle-audio-pause" class="btn btn-secondary">${t('btn_audio')} ${state.audioMuted ? '🔇' : '🔊'}</button>
        <button id="btn-quit-game" class="btn btn-danger">${t('btn_leave')}</button>
      </div>
    </div>

    <!-- Level Victory Overlay -->
    <div id="level-complete-modal" class="glass-panel modal ${state.activeModal === 'victory' ? '' : 'hidden'}">
      <h2 class="victory-text">${t('victory_title')}</h2>
      <p>${t('victory_desc')}</p>
      <div class="next-level-loader">${t('next_level')}</div>
    </div>

    <!-- Game Over Overlay -->
    <div id="game-over-modal" class="glass-panel modal danger-modal ${state.activeModal === 'game-over' ? '' : 'hidden'}">
      <h2 class="danger-text">${t('game_over_title')}</h2>
      <p>${t('game_over_desc')}</p>
      <button id="btn-respawn" class="btn btn-danger" style="margin-top: 15px;">${t('btn_respawn')}</button>
      <button id="btn-regenerate-map" class="btn btn-secondary ${state.showRegenerateBtn ? '' : 'hidden'}" style="margin-top: 10px; border-color: #ffaa00; color: #ffaa00;">${t('btn_regenerate_map')}</button>
    </div>

    <!-- TOS & Privacy Policy Modal -->
    <div id="tos-modal" class="glass-panel modal ${state.activeModal === 'tos' ? '' : 'hidden'}" style="width: 520px; text-align: left; max-height: 80vh; overflow-y: auto;">
      <h3 style="margin-bottom: 15px; text-align: center;">${t('tos_title')}</h3>
      <p style="margin: 10px 0; font-size: 0.9rem; line-height: 1.5; color: var(--text-muted);">
        ${t('tos_text')}
      </p>
      <div style="margin: 15px 0; font-size: 0.85rem; line-height: 1.4; color: #a0aec0;">
        ${t('tos_privacy_policy_full')}
      </div>
      <div style="text-align: center; margin-top: 20px;">
        <button id="btn-close-modal" class="btn btn-secondary">${t('btn_close')}</button>
      </div>
    </div>

    <!-- Instructions Modal -->
    <div id="instructions-modal" class="glass-panel modal ${state.activeModal === 'instructions' ? '' : 'hidden'}" style="width: 520px; text-align: left; max-height: 80vh; overflow-y: auto;">
      <h3 style="margin-bottom: 15px; text-align: center; color: var(--neon-cyan);">${t('instructions_title')}</h3>
      <ul style="font-size: 0.9rem; line-height: 1.6; color: #a0aec0; padding-left: 20px;">
        <li>${t('inst_movement')}</li>
        <li>${t('inst_camera')}</li>
        <li>${t('inst_objective')}</li>
        <li>${t('inst_door')}</li>
        <li>${t('inst_ghost')}</li>
      </ul>
      <div style="text-align: center; margin-top: 20px;">
        <button id="btn-close-modal" class="btn btn-secondary">${t('btn_close')}</button>
      </div>
    </div>

    <!-- Generic Alert Modal -->
    <div id="alert-modal" class="glass-panel modal ${state.activeModal === 'alert' ? '' : 'hidden'}" style="width: 400px; text-align: center; z-index: 10000;">
      <h3 style="color: var(--neon-cyan); margin-bottom: 15px;">${t('alert_sys_title')}</h3>
      <p style="color: var(--text-main); margin-bottom: 20px; font-weight: bold;">${state.alertMsg}</p>
      <button id="btn-close-modal" class="btn btn-secondary">${t('btn_close')}</button>
    </div>
  `;
};
