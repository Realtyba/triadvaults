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
      authFirstName: '',
      authLastName: '',
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
      leaderboard: [],
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
      editFirstName: undefined,
      editLastName: undefined,
      editEmail: undefined,
      editUsername: undefined,
      editProfileMsg: '',
      tosChecked: false,
      audioMuted: localStorage.getItem('triad_audio_muted') === 'true',
      lang: this.i18n.currentLang
    };

    this.setupNetworkCallbacks();
    this.initEvents();
    this.render();
    
    const storedToken = localStorage.getItem('triad_vaults_token');
    if (this.state.userProfile && !storedToken) {
      this.state.userProfile = null;
      this.socketClient.authenticatedUser = null;
      localStorage.removeItem('triad_vaults_user');
    }

    // Automatically load public rooms if already authenticated
    if (this.state.userProfile) {
      this.socketClient.getPublicRooms((rooms) => {
        this.updateState({ publicRooms: rooms || [] });
      });
      this.fetchLeaderboard();
    }
  }

  async fetchLeaderboard() {
    const res = await this.socketClient.getLeaderboard();
    if (res.success) {
      this.updateState({ leaderboard: res.leaderboard || [] });
    }
  }

  render() {
    if (!this.uiLayer) return;
    this.uiLayer.innerHTML = renderUI((key) => this.i18n.t(key), this.state);
    this.bindDirectEvents();
  }

  bindDirectEvents() {
    const btnLogout = document.getElementById('btn-logout');
    if (btnLogout) btnLogout.onclick = (e) => {
      e.stopPropagation();
      this.socketClient.authenticatedUser = null;
      localStorage.removeItem('triad_vaults_user');
      localStorage.removeItem('triad_vaults_token');
      this.updateState({ userProfile: null, authMsg: '', authPassword: '' });
    };

    const btnCreateRoom = document.getElementById('btn-create-room');
    if (btnCreateRoom) btnCreateRoom.onclick = (e) => {
      e.stopPropagation();
      const level = this.state.userProfile ? this.state.userProfile.maxLevelReached : 1;
      this.socketClient.createRoom(level, (res) => {
        if (res.success) this.showLobby(res.room);
        else this.showAlert(res.error || 'Error al crear sala');
      });
    };

    const btnJoinRoom = document.getElementById('btn-join-room');
    if (btnJoinRoom) btnJoinRoom.onclick = (e) => {
      e.stopPropagation();
      const code = this.state.roomCodeInput.trim().toUpperCase();
      if (code.length !== 4) return this.showAlert(this.i18n.t('error_invalid_room_code'));
      this.socketClient.joinRoom(code, (res) => {
        if (res.success) this.showLobby(res.room);
        else this.showAlert(res.error || 'No se pudo unir a la sala');
      });
    };
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

    this.socketClient.onReconnectedToRoom(({ room, inGame }) => {
      this.socketClient.currentRoom = room;
      if (inGame) {
        if (this.onStartGameCallback) this.onStartGameCallback(room.currentLevel, room.players.length);
        this.showHUD(room.currentLevel, room.players.length);
      } else {
        this.showLobby(room);
      }
    });
  }

  initEvents() {
    // Input syncing
    this.uiLayer.addEventListener('input', (e) => {
      if (e.target.id === 'auth-firstname') this.state.authFirstName = e.target.value;
      else if (e.target.id === 'auth-lastname') this.state.authLastName = e.target.value;
      else if (e.target.id === 'auth-username') this.state.authUsername = e.target.value;
      else if (e.target.id === 'auth-email') this.state.authEmail = e.target.value;
      else if (e.target.id === 'auth-password') this.state.authPassword = e.target.value;
      else if (e.target.id === 'room-code-input') this.state.roomCodeInput = e.target.value;
      else if (e.target.id === 'recover-email') this.state.recoverEmail = e.target.value;
      else if (e.target.id === 'recover-pin') this.state.recoverPin = e.target.value;
      else if (e.target.id === 'recover-new-password') this.state.recoverNewPassword = e.target.value;
      else if (e.target.id === 'verify-pin') this.state.verifyPin = e.target.value;
      else if (e.target.id === 'edit-firstname') this.state.editFirstName = e.target.value;
      else if (e.target.id === 'edit-lastname') this.state.editLastName = e.target.value;
      else if (e.target.id === 'edit-email') this.state.editEmail = e.target.value;
      else if (e.target.id === 'edit-username') this.state.editUsername = e.target.value;
    });

    this.uiLayer.addEventListener('change', (e) => {
      if (e.target.id === 'tos-checkbox') this.state.tosChecked = e.target.checked;
    });

    // Click Delegation
    this.uiLayer.addEventListener('click', async (e) => {
      try {
        const target = e.target;
        if (!target || !target.closest) return;
      
      if (target.closest('a')) e.preventDefault();
      
      // Auth Tabs
      if (target.closest('#tab-login')) this.updateState({ authMode: 'login', authMsg: '' });
      else if (target.closest('#tab-register')) this.updateState({ authMode: 'register', authMsg: '' });
      else if (target.closest('#tab-recover')) this.updateState({ authMode: 'recover', authMsg: '', recoverPinRequested: false });
      
      // Auth Submit
      else if (target.closest('#btn-auth-submit')) {
        const { authFirstName: fName, authLastName: lName, authUsername: user, authEmail: email, authPassword: pass, authMode } = this.state;
        this.updateState({ authMsg: 'Conectando con el Servidor Central...' });
        
        if (authMode === 'register') {
          if (!user || !email || !pass) return this.updateState({ authMsg: this.i18n.t('error_missing_fields_reg') });
          if (!this.state.tosChecked) return this.updateState({ authMsg: this.i18n.t('error_accept_tos') });
          const res = await this.socketClient.register(fName, lName, user, email, pass);
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
        localStorage.removeItem('triad_vaults_token');
        this.updateState({ userProfile: null, authMsg: '', authPassword: '' });
      }
      
      // Modals
      else if (target.closest('#btn-show-tos')) this.updateState({ activeModal: 'tos' });
      else if (target.closest('#btn-show-instructions')) this.updateState({ activeModal: 'instructions' });
      else if (target.closest('#btn-close-modal') || target.closest('#btn-close-alert')) this.updateState({ activeModal: null });
      
      // Edit Profile
      else if (target.closest('#btn-edit-profile')) {
        this.updateState({ 
          activeModal: 'edit-profile', 
          editFirstName: this.state.userProfile.firstName,
          editLastName: this.state.userProfile.lastName,
          editEmail: this.state.userProfile.email,
          editUsername: this.state.userProfile.username,
          editProfileMsg: ''
        });
      }
      else if (target.closest('#btn-cancel-edit')) {
        this.updateState({ activeModal: null });
      }
      else if (target.closest('#btn-save-profile')) {
        const { editFirstName, editLastName, editEmail, editUsername } = this.state;
        if (!editFirstName || !editLastName || !editEmail || !editUsername) return this.updateState({ editProfileMsg: 'Todos los campos son obligatorios.' });
        
        this.updateState({ editProfileMsg: 'Guardando...' });
        try {
          const res = await this.socketClient.updateProfile(editFirstName, editLastName, editEmail, editUsername);
          if (res.success) {
            const user = { ...this.state.userProfile, firstName: editFirstName, lastName: editLastName, email: editEmail, username: res.username };
            if (res.emailChanged) {
              user.isVerified = false;
              this.updateState({ activeModal: 'verify', verifyMsg: 'Se ha enviado un nuevo código a tu correo.', userProfile: user });
            } else {
              this.updateState({ activeModal: null, userProfile: user });
            }
            localStorage.setItem('triad_vaults_user', JSON.stringify(user));
          } else {
            this.updateState({ editProfileMsg: res.error });
          }
        } catch (err) {
          this.showAlert("Error interno detectado: " + err.message);
          console.error(err);
        }
      }

      // Verify Profile
      else if (target.closest('#btn-submit-verify')) {
        const pin = this.state.verifyPin;
        if (!pin || pin.length !== 6) return this.updateState({ verifyMsg: 'Ingresa el PIN de 6 dígitos.' });
        
        this.updateState({ verifyMsg: 'Verificando...' });
        const res = await this.socketClient.verifyEmail(this.state.userProfile.username, pin);
        if (res.success) {
          const user = { ...this.state.userProfile, isVerified: true };
          localStorage.setItem('triad_vaults_user', JSON.stringify(user));
          this.showProfile(user);
        } else {
          this.updateState({ verifyMsg: res.error });
        }
      }
      else if (target.closest('#btn-cancel-verify')) {
        this.socketClient.authenticatedUser = null;
        localStorage.removeItem('triad_vaults_user');
        localStorage.removeItem('triad_vaults_token');
        this.updateState({ userProfile: null, activeModal: null, authMsg: '', authPassword: '' });
      }
      
      // Rooms
      else if (target.closest('#btn-create-room')) {
        const level = this.state.userProfile ? this.state.userProfile.maxLevelReached : 1;
        this.socketClient.createRoom(level, (res) => {
          if (res.success) this.showLobby(res.room);
          else this.showAlert(res.error || 'Error al crear sala');
        });
      }
      else if (target.closest('#btn-join-room')) {
        const code = this.state.roomCodeInput.trim().toUpperCase();
        if (code.length !== 4) return this.showAlert(this.i18n.t('error_invalid_room_code'));
        this.socketClient.joinRoom(code, (res) => {
          if (res.success) this.showLobby(res.room);
          else this.showAlert(res.error || 'No se pudo unir a la sala');
        });
      }
      else if (target.closest('.btn-join-public')) {
        const btn = target.closest('.btn-join-public');
        const code = btn.getAttribute('data-code');
        this.socketClient.joinRoom(code, (res) => {
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
          localStorage.setItem('triad_audio_muted', isMuted);
        }
      }
      else if (target.closest('.lang-selector-btn')) {
        const btn = target.closest('.lang-selector-btn');
        const lang = btn.getAttribute('data-lang');
        this.i18n.setLanguage(lang);
        this.updateState({ lang });
      }
      } catch (err) {
        this.showAlert("Error interno detectado: " + err.message);
        console.error(err);
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
    
    if (user.isVerified === false) {
      this.updateState({ activeModal: 'verify', verifyMsg: '', verifyPin: '' });
      return;
    }
    
    // Clear any active modal (in case they verified successfully)
    if (this.state.activeModal === 'verify') {
      this.updateState({ activeModal: null });
    }
    
    this.socketClient.getPublicRooms((rooms) => {
      this.updateState({ publicRooms: rooms || [] });
    });
    this.fetchLeaderboard();
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
    if (this.state.health <= 0) return; // Prevent pausing when dead
    const newState = forceState !== null ? forceState : !this.state.isPaused;
    this.updateState({ 
      isPaused: newState,
      activeModal: newState ? 'pause' : null
    });
  }
}
