import { I18nManager } from '../i18n/I18nManager.js';
import { renderUI } from './Templates.js';

export class UIManager {
  constructor(socketClient, onStartGameCallback, soundEngine) {
    this.socketClient = socketClient;
    this.onStartGameCallback = onStartGameCallback;
    this.soundEngine = soundEngine;
    this.i18n = new I18nManager();

    this.uiLayer = document.getElementById('ui-layer');

    this.state = {
      currentView: 'main',
      activeModal: null,
      alertMsg: '',
      authMode: 'login', // 'login', 'register', 'recover'
      authMsg: '',
      authUsername: 'AgenteCyber',
      authEmail: 'agente@cyber.com',
      authPassword: '123', // Development default
      recoverEmail: '',
      recoverPin: '',
      recoverNewPassword: '',
      recoverPinRequested: false,
      tosChecked: false,
      roomCodeInput: '',
      userProfile: this.socketClient.authenticatedUser,
      publicRooms: [],
      lobbyRoomCode: '----',
      lobbyPlayers: [],
      isHost: false,
      level: '1',
      seed: '#0000',
      roomCode: '----',
      playersCount: '1 / 3',
      puzzleSolved: false,
      puzzleProgress: 0,
      health: 100,
      objectiveTitle: '',
      showRegenerateBtn: false,
      audioMuted: this.soundEngine ? this.soundEngine.isMuted : false,
      lang: this.i18n.currentLang
    };

    this.setupNetworkCallbacks();
    this.initEvents();
    this.render();
    
    // Automatically load public rooms if already authenticated
    if (this.state.userProfile) {
      this.socketClient.getPublicRooms((rooms) => {
        this.updateState({ publicRooms: rooms || [] });
      });
    }
  }

  render() {
    if (!this.uiLayer) return;
    this.uiLayer.innerHTML = renderUI((key) => this.i18n.t(key), this.state);
  }

  updateState(newState) {
    this.state = { ...this.state, ...newState };
    this.render();
  }

  setupNetworkCallbacks() {
    this.socketClient.onPublicRoomsUpdated((rooms) => {
      this.updateState({ publicRooms: rooms || [] });
    });
    this.socketClient.onUserProgressUpdated((stats) => {
      if (this.state.userProfile) {
        this.updateState({
          userProfile: {
            ...this.state.userProfile,
            maxLevelReached: stats.maxLevelReached,
            totalPuzzlesSolved: stats.totalPuzzlesSolved
          }
        });
      }
    });
  }

  initEvents() {
    // Input syncing
    this.uiLayer.addEventListener('input', (e) => {
      if (e.target.id === 'auth-username') this.state.authUsername = e.target.value;
      else if (e.target.id === 'auth-email') this.state.authEmail = e.target.value;
      else if (e.target.id === 'auth-password') this.state.authPassword = e.target.value;
      else if (e.target.id === 'room-code-input') this.state.roomCodeInput = e.target.value;
      else if (e.target.id === 'recover-email') this.state.recoverEmail = e.target.value;
      else if (e.target.id === 'recover-pin') this.state.recoverPin = e.target.value;
      else if (e.target.id === 'recover-new-password') this.state.recoverNewPassword = e.target.value;
    });

    this.uiLayer.addEventListener('change', (e) => {
      if (e.target.id === 'tos-checkbox') this.state.tosChecked = e.target.checked;
    });

    // Click Delegation
    this.uiLayer.addEventListener('click', async (e) => {
      const target = e.target;
      
      if (target.closest('a')) e.preventDefault();
      
      // Auth Tabs
      if (target.closest('#tab-login')) this.updateState({ authMode: 'login', authMsg: '' });
      else if (target.closest('#tab-register')) this.updateState({ authMode: 'register', authMsg: '' });
      else if (target.closest('#tab-recover')) this.updateState({ authMode: 'recover', authMsg: '', recoverPinRequested: false });
      
      // Auth Submit
      else if (target.closest('#btn-auth-submit')) {
        const { authUsername: user, authEmail: email, authPassword: pass, authMode } = this.state;
        this.updateState({ authMsg: 'Conectando con el Servidor Central...' });
        
        if (authMode === 'register') {
          if (!user || !email || !pass) return this.updateState({ authMsg: this.i18n.t('error_missing_fields_reg') });
          if (!this.state.tosChecked) return this.updateState({ authMsg: this.i18n.t('error_accept_tos') });
          const res = await this.socketClient.register(user, email, pass);
          if (res.success) {
            this.updateState({ authMsg: this.i18n.t('success_reg') });
            setTimeout(() => this.showProfile(res.user), 1500);
          } else {
            this.updateState({ authMsg: res.error });
          }
        } else {
          if ((!user && !email) || !pass) return this.updateState({ authMsg: this.i18n.t('error_missing_fields_login') });
          const identifier = user || email;
          const res = await this.socketClient.login(identifier, pass);
          if (res.success) {
            this.updateState({ authMsg: this.i18n.t('success_login') });
            setTimeout(() => this.showProfile(res.user), 1500);
          } else {
            this.updateState({ authMsg: res.error });
          }
        }
      }
      
      // Recover Password Actions
      else if (target.closest('#btn-request-pin')) {
        const email = this.state.recoverEmail.trim();
        if (!email) return this.updateState({ authMsg: this.i18n.t('error_missing_email') });
        this.updateState({ authMsg: 'Solicitando PIN...' });
        const res = await this.socketClient.requestReset(email);
        if (res.success) {
          const msg = this.i18n.t('pin_generated').replace('{0}', res.username);
          this.updateState({ authMsg: msg, recoverPinRequested: true });
        } else {
          this.updateState({ authMsg: res.error });
        }
      }
      else if (target.closest('#btn-reset-password')) {
        const email = this.state.recoverEmail.trim();
        const pin = this.state.recoverPin.trim();
        const newPass = this.state.recoverNewPassword.trim();
        if (!email || !pin || !newPass) return this.updateState({ authMsg: this.i18n.t('error_missing_pin') });
        this.updateState({ authMsg: 'Actualizando contraseña...' });
        const res = await this.socketClient.resetPassword(email, pin, newPass);
        if (res.success) {
          this.updateState({ authMsg: res.message, authMode: 'login', recoverPinRequested: false });
        } else {
          this.updateState({ authMsg: res.error });
        }
      }
      
      // Logout
      else if (target.closest('#btn-logout')) {
        this.socketClient.authenticatedUser = null;
        localStorage.removeItem('triad_vaults_user');
        this.updateState({ userProfile: null, authMsg: '', authPassword: '' });
      }
      
      // Modals
      else if (target.closest('#btn-show-tos')) this.updateState({ activeModal: 'tos' });
      else if (target.closest('#btn-show-instructions')) this.updateState({ activeModal: 'instructions' });
      else if (target.closest('#btn-close-modal') || target.closest('#btn-close-alert')) this.updateState({ activeModal: null });
      
      // Rooms
      else if (target.closest('#btn-create-room')) {
        const level = this.state.userProfile ? this.state.userProfile.maxLevelReached : 1;
        this.socketClient.createRoom(this.state.authUsername, level, (res) => {
          if (res.success) this.showLobby(res.room);
          else this.showAlert(res.error || 'Error al crear sala');
        });
      }
      else if (target.closest('#btn-join-room')) {
        const code = this.state.roomCodeInput.trim().toUpperCase();
        if (code.length !== 4) return this.showAlert(this.i18n.t('error_invalid_room_code'));
        this.socketClient.joinRoom(code, this.state.authUsername, (res) => {
          if (res.success) this.showLobby(res.room);
          else this.showAlert(res.error || 'No se pudo unir a la sala');
        });
      }
      else if (target.closest('.btn-join-public')) {
        const btn = target.closest('.btn-join-public');
        const code = btn.getAttribute('data-code');
        this.socketClient.joinRoom(code, this.state.authUsername, (res) => {
          if (res.success) this.showLobby(res.room);
          else this.showAlert(res.error || 'No se pudo unir a la sala');
        });
      }
      else if (target.closest('#btn-leave-lobby') || target.closest('#btn-quit-game')) {
        this.socketClient.leaveRoom();
        if (window.stopGameLoop) window.stopGameLoop();
        this.updateState({ currentView: 'main', activeModal: null, isPaused: false });
      }
      else if (target.closest('#btn-start-game')) {
        this.socketClient.startGame();
      }
      
      // In Game Actions
      else if (target.closest('#btn-hud-pause')) {
        this.togglePause();
      }
      else if (target.closest('#btn-resume-game')) {
        this.togglePause(false);
      }
      else if (target.closest('#btn-respawn')) {
        this.updateState({ activeModal: null });
        if (this.onRespawnCallback) this.onRespawnCallback();
      }
      else if (target.closest('#btn-regenerate-map')) {
        this.updateState({ activeModal: null, showRegenerateBtn: false });
        if (window.regenerateMap) window.regenerateMap();
      }
      
      // Audio & Lang
      else if (target.closest('#btn-toggle-audio') || target.closest('#btn-toggle-audio-pause')) {
        if (this.soundEngine) {
          const isMuted = this.soundEngine.toggleMute();
          this.updateState({ audioMuted: isMuted });
        }
      }
      else if (target.closest('.lang-selector-btn')) {
        const btn = target.closest('.lang-selector-btn');
        const lang = btn.getAttribute('data-lang');
        this.i18n.setLanguage(lang);
        this.updateState({ lang });
      }
    });

    // Pause with ESC
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.state.currentView === 'hud' && this.state.health > 0) {
        this.togglePause();
      }
    });
  }

  showProfile(user) {
    this.updateState({ userProfile: user });
    this.socketClient.getPublicRooms((rooms) => {
      this.updateState({ publicRooms: rooms || [] });
    });
  }

  showLobby(room) {
    this.updateState({
      currentView: 'lobby',
      lobbyRoomCode: room.code,
      lobbyPlayers: room.players,
      isHost: room.hostId === this.socketClient.socket.id
    });
    
    this.socketClient.onRoomUpdated((updatedRoom) => {
      this.updateState({
        lobbyPlayers: updatedRoom.players,
        isHost: updatedRoom.hostId === this.socketClient.socket.id
      });
    });

    this.socketClient.onGameStarted(({ level, playersCount }) => {
      if (this.onStartGameCallback) this.onStartGameCallback(level, playersCount);
    });
  }

  showHUD(level, playersCount) {
    this.updateState({
      currentView: 'hud',
      activeModal: null,
      level,
      playersCount: `${playersCount} / 3`,
      health: 100,
      puzzleSolved: false,
      puzzleProgress: 0
    });
  }

  updateHealth(health) {
    const newHealth = Math.max(0, health);
    this.updateState({ health: newHealth });
    if (newHealth <= 0 && this.state.activeModal !== 'game-over') {
      this.updateState({ activeModal: 'game-over' });
    }
  }

  updateObjective(text, progressPercent, isSolved) {
    this.updateState({
      objectiveTitle: text,
      puzzleProgress: progressPercent,
      puzzleSolved: isSolved
    });
  }

  updateSeed(seed, themeName) {
    const levelStr = `${this.i18n.t('level')} ${this.socketClient.currentRoom ? this.socketClient.currentRoom.currentLevel : 1} - ${themeName}`;
    this.updateState({ 
      seed, 
      level: levelStr,
      roomCode: this.state.lobbyRoomCode || 'LOCAL' 
    });
  }

  showAlert(msg) {
    this.updateState({ activeModal: 'alert', alertMsg: msg });
  }

  showLevelCompleteModal() {
    this.updateState({ activeModal: 'victory' });
  }

  showRegenerateButton() {
    this.updateState({ showRegenerateBtn: true });
  }

  togglePause(forceState = null) {
    const newState = forceState !== null ? forceState : !this.state.isPaused;
    this.updateState({ 
      isPaused: newState,
      activeModal: newState ? 'pause' : null
    });
  }
}
