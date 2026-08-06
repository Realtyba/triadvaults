import { EVENTS, GHOST_DAMAGE } from '../../../shared/events.js';
import { recordLevelCompletion } from '../../services/progression.js';
import { broadcastAll } from '../broadcast.js';

export function registerGameHandlers(io, socket, roomManager) {
  const { id: uid, username } = socket.user;

  /** Sala del emisor, verificando además que sea el host cuando se exige autoridad. */
  const authorize = (roomCode, { hostOnly = false } = {}) => {
    const room = roomManager.getRoom(roomCode);
    if (!room) return null;
    if (!roomManager.findPlayer(room, uid)) return null;
    if (hostOnly && !roomManager.isHost(room, uid)) return null;
    return room;
  };

  // Lo dispara quien llegue a la salida, no necesariamente el host: con 2 o 3
  // agentes la compuerta se abre en grupo y cualquiera puede cruzarla primero.
  socket.on(EVENTS.LEVEL_COMPLETE, async (payload = {}) => {
    const room = authorize(payload.roomCode);
    if (!room || room.completingLevel) return;
    room.completingLevel = true;

    const completedLevel = room.currentLevel;
    const timeSpent = Math.max(0, Math.min(60 * 60, Number(payload.timeSpent) || 0));
    const playersCount = room.players.length;

    // Los contadores del nivel se copian ANTES de avanzar: `advanceLevel` los
    // reinicia, y son justo lo que necesitan los logros del nivel recién superado.
    const participants = room.players.map(p => ({
      uid: p.uid,
      name: p.name,
      socketId: p.socketId,
      damageTaken: p.levelDamageTaken,
      deaths: p.levelDeaths
    }));

    roomManager.advanceLevel(room);
    room.completingLevel = false;
    io.to(room.code).emit(EVENTS.LOAD_NEXT_LEVEL, {
      level: room.currentLevel,
      seed: room.seed,
      seedOffset: room.seedOffset,
      playersCount: room.players.length
    });
    broadcastAll(io, roomManager, room);

    // El progreso se guarda con el nivel recién superado, no con el siguiente.
    // Se identifica al agente por `uid`: el nombre puede haber cambiado desde el
    // perfil a mitad de partida y entonces la escritura no encontraría su fila.
    for (const participant of participants) {
      const identity = { uid: participant.uid, name: participant.name };
      const result = await recordLevelCompletion(identity, {
        level: completedLevel,
        timeSpent,
        playersCount,
        damageTaken: participant.damageTaken,
        deaths: participant.deaths
      });
      if (!result) continue;

      io.to(participant.socketId).emit(EVENTS.USER_PROGRESS_UPDATED, result.stats);
      if (result.unlocked.length > 0) {
        io.to(participant.socketId).emit(EVENTS.ACHIEVEMENT_UNLOCKED, { keys: result.unlocked });
      }
    }
  });

  socket.on(EVENTS.REGENERATE_LEVEL, (payload = {}) => {
    const room = authorize(payload.roomCode, { hostOnly: true });
    if (!room) return;

    roomManager.regenerateLevel(room);
    room.players.forEach(p => roomManager.respawnPlayer(room, p.uid));

    io.to(room.code).emit(EVENTS.LEVEL_REGENERATED, {
      level: room.currentLevel,
      seed: room.seed,
      seedOffset: room.seedOffset
    });
    console.log(`[Nivel] ${username} regeneró ${room.code} (variante ${room.seedOffset})`);
  });

  // El host arbitra los impactos; el servidor arbitra la vida resultante.
  socket.on(EVENTS.GHOST_HIT, (payload = {}) => {
    const room = authorize(payload.roomCode, { hostOnly: true });
    if (!room) return;

    const amount = Math.min(GHOST_DAMAGE, Math.max(0, Number(payload.amount) || GHOST_DAMAGE));
    const player = roomManager.applyDamage(room, payload.targetUid, amount);
    if (!player) return;

    io.to(room.code).emit(EVENTS.PLAYER_HEALTH_CHANGED, {
      uid: player.uid,
      health: player.health,
      alive: player.alive
    });

    if (!player.alive) {
      io.to(room.code).emit(EVENTS.PLAYER_DIED, { uid: player.uid, name: player.name });
    }
  });

  socket.on(EVENTS.REQUEST_RESPAWN, (payload = {}) => {
    const room = authorize(payload.roomCode);
    if (!room) return;

    const player = roomManager.respawnPlayer(room, uid);
    if (!player) return;

    // El `spawnIndex` desplaza la celda elegida en el cliente, así no se reaparece
    // siempre en el mismo punto ni encima de otro agente.
    player.respawnCount += 1;
    io.to(room.code).emit(EVENTS.PLAYER_RESPAWNED, {
      uid: player.uid,
      health: player.health,
      spawnIndex: player.index + player.respawnCount * 3,
      // El cliente lo usa solo para avisar de que hay escudo; quien decide si el
      // daño entra sigue siendo el servidor.
      shieldMs: Math.max(0, player.shieldedUntil - Date.now())
    });
  });
}
