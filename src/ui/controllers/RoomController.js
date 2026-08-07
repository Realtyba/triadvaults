import { CODE_LENGTH } from '../../../shared/constants.js';

/** Crear, unirse, abandonar y arrancar salas. */
export class RoomController {
  constructor({ socket, store, form, t, ui }) {
    this.socket = socket;
    this.store = store;
    this.form = form;
    this.t = t;
    this.ui = ui;
  }

  /** Mensaje de error del servidor, o el genérico de la clave i18n indicada. */
  errorFrom(res, fallbackKey) {
    return (res && res.error) || this.t(fallbackKey);
  }

  create() {
    if (!this.ui.requireVerifiedAccount()) return;

    this.socket.createRoom(res => {
      if (res && res.success) this.enterLobby(res.room);
      else this.ui.alert(this.errorFrom(res, 'error_create_room'));
    });
  }

  joinByCode() {
    // La verificación la comprueba `join`, que es donde acaba este camino: hacerlo
    // aquí también abriría dos veces el mismo modal.
    const code = this.form.get('roomCode').trim().toUpperCase();
    if (code.length !== CODE_LENGTH) return this.ui.alert(this.t('error_invalid_room_code'));
    this.join(code);
  }

  join(code) {
    if (!this.ui.requireVerifiedAccount()) return;

    this.socket.joinRoom(code, res => {
      if (!res || !res.success) {
        return this.ui.alert(this.errorFrom(res, 'error_join_room'));
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
      connection: 'online',
      offline: false
    });
    this.refresh();
  }

  /**
   * Se comprueba también aquí, aunque al lobby solo se llegue por `create` o `join`:
   * cambiar el correo desde el perfil devuelve la cuenta a "sin verificar" sin
   * echar a nadie de la sala en la que ya estaba.
   */
  start() {
    if (!this.ui.requireVerifiedAccount()) return;
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

}
