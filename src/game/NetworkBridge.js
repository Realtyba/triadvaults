import { EVENTS } from '../../shared/events.js';

/**
 * Único punto donde se suscriben los eventos de socket.
 *
 * Antes se registraban dentro de `showLobby()`, que se llamaba en cada entrada a
 * sala: los handlers se acumulaban y un mismo evento se procesaba N veces.
 */
export class NetworkBridge {
  constructor({ socket, game, ui }) {
    this.socket = socket;
    this.game = game;
    this.ui = ui;
  }

  register() {
    this.registerConnectionEvents();
    this.registerRoomEvents();
    this.registerGameEvents();
  }

  registerConnectionEvents() {
    const raw = this.socket.socket;

    raw.on('connect', () => this.ui.onConnected());
    raw.on('disconnect', reason => {
      // Una desconexión pedida por el cliente no es una caída: no hay que reconectar.
      if (reason === 'io client disconnect') return;
      this.ui.onDisconnected(this.socket.roomCode);
    });
    raw.io.on('reconnect_attempt', attempt => this.ui.onReconnectAttempt(attempt));
    raw.io.on('reconnect_failed', () => this.ui.onReconnectFailed());
    raw.on('connect_error', err => this.ui.onConnectionError(err.message));
  }

  registerRoomEvents() {
    this.socket.on(EVENTS.ROOMS_UPDATED, rooms => this.ui.setRooms(rooms));

    this.socket.on(EVENTS.ROOM_UPDATED, room => {
      this.ui.setRoom(room);
      this.game.syncRoomPlayers(room);
    });

    this.socket.on(EVENTS.RECONNECTED_TO_ROOM, ({ room }) => {
      this.ui.onReconnectedToRoom(room);
      if (room.inGame) {
        // Se reconstruye con la semilla de la sala: la mazmorra vuelve idéntica.
        this.game.startLevel({
          level: room.currentLevel,
          seed: room.seed,
          seedOffset: room.seedOffset,
          playersCount: room.players.length
        });
      }
    });

    this.socket.on(EVENTS.GAME_STARTED, ({ level, seed, seedOffset, players }) => {
      this.ui.onGameStarted();
      this.game.startLevel({
        level,
        seed,
        seedOffset,
        playersCount: players ? players.length : undefined
      });
    });
  }

  registerGameEvents() {
    this.socket.on(EVENTS.PLAYER_MOVED, ({ uid, position, rotationY }) => {
      this.game.applyRemoteTransform(uid, position, rotationY);
    });

    this.socket.on(EVENTS.GHOST_SYNCED, ({ position, targetUid }) => {
      this.game.applyGhostState(position, targetUid);
    });

    this.socket.on(EVENTS.PLAYER_HEALTH_CHANGED, ({ uid, health, alive }) => {
      this.game.applyHealth(uid, health, alive);
    });

    this.socket.on(EVENTS.PLAYER_RESPAWNED, ({ uid, health, spawnIndex, shieldMs }) => {
      this.game.respawn(uid, health, spawnIndex, shieldMs);
    });

    this.socket.on(EVENTS.LOAD_NEXT_LEVEL, ({ level, seed, seedOffset, playersCount }) => {
      this.ui.showVictory();
      setTimeout(() => this.game.startLevel({ level, seed, seedOffset, playersCount }), 2000);
    });

    this.socket.on(EVENTS.LEVEL_REGENERATED, ({ level, seed, seedOffset }) => {
      this.ui.closeModal();
      this.game.regenerateLevel({ level, seed, seedOffset });
    });

    this.socket.on(EVENTS.USER_PROGRESS_UPDATED, stats => this.ui.onProgressUpdated(stats));

    this.socket.on(EVENTS.ACHIEVEMENT_UNLOCKED, ({ keys }) => this.ui.onAchievementsUnlocked(keys));
  }
}
