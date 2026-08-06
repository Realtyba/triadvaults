/** Crear, unirse, abandonar y arrancar salas. */
export class RoomController {
  constructor({ socket, store, form, t, ui }) {
    this.socket = socket;
    this.store = store;
    this.form = form;
    this.t = t;
    this.ui = ui;
  }

  create() {
    if (!this.checkVerification()) return;

    this.socket.createRoom(res => {
      if (res && res.success) this.enterLobby(res.room);
      else this.ui.alert((res && res.error) || this.t('error_create_room'));
    });
  }

  joinByCode() {
    if (!this.checkVerification()) return;

    const code = this.form.get('roomCode').trim().toUpperCase();
    if (code.length !== 4) return this.ui.alert(this.t('error_invalid_room_code'));
    this.join(code);
  }

  join(code) {
    if (!this.checkVerification()) return;

    this.socket.joinRoom(code, res => {
      if (!res || !res.success) {
        return this.ui.alert((res && res.error) || this.t('error_join_room'));
      }

      this.form.clear('roomCode');

      // Sala con partida en curso: se construye el nivel actual y se entra directo,
      // sin pasar por el lobby (y con la misma semilla que el resto de agentes).
      if (res.inGame) this.ui.joinRunningLevel(res.room);
      else this.enterLobby(res.room);
    });
  }

  enterLobby(room) {
    this.store.patch({ room, view: 'lobby', modal: null, roomCode: room.code });
  }

  leave() {
    this.socket.leaveRoom();
    this.ui.stopGame();
    this.store.patch({
      view: 'main',
      modal: null,
      paused: false,
      room: null,
      roomCode: '----',
      connection: 'online'
    });
    this.refresh();
  }

  start() {
    this.socket.startGame();
  }

  setFilter(filter) {
    this.store.patch({ roomFilter: filter });
  }

  refresh() {
    this.socket.fetchRooms(rooms => this.store.patch({ rooms }));
  }

  async copyCode() {
    const room = this.store.get().room;
    if (!room || !navigator.clipboard) return;
    try {
      await navigator.clipboard.writeText(room.code);
      this.ui.alert(this.t('code_copied').replace('{0}', room.code));
    } catch {
      // Sin permiso de portapapeles no pasa nada: el código está visible en pantalla.
    }
  }

  checkVerification() {
    const user = this.store.get().user;
    if (user && user.isVerified === false) {
      this.store.patch({ modal: 'verify' });
      return false;
    }
    return true;
  }
}
