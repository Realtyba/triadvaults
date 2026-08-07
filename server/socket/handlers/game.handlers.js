import { EVENTS, GHOST_DAMAGE } from '../../../shared/events.js';
import { reportLevelCompletion } from '../../services/apiClient.js';
import { broadcastAll } from '../broadcast.js';
import { createHandlerContext } from './context.js';

export function registerGameHandlers(io, socket, roomManager) {
  const { uid, username, authorize } = createHandlerContext(socket, roomManager);

  // Lo dispara quien llegue a la salida, no necesariamente el host: con 2 o 3
  // agentes la compuerta se abre en grupo y cualquiera puede cruzarla primero.
  //
  // Por eso mismo llegan VARIOS avisos del mismo nivel, uno por agente, en turnos
  // distintos del bucle de eventos. La guarda anterior no servía: se liberaba
  // antes del `await`, así que los tres pasaban y el nivel subía de tres en tres,
  // se emitían tres `LOAD_NEXT_LEVEL` y se escribía tres veces el progreso en
  // Laravel. Ahora la referencia es el propio número de nivel —si el que anuncia
  // el cliente ya no es el que la sala está jugando, el aviso llega tarde y se
  // descarta— y el pestillo se suelta en un `finally`, ya pasada la espera.
  socket.on(EVENTS.LEVEL_COMPLETE, async (payload = {}) => {
    const room = authorize(payload.roomCode);
    if (!room || room.completingLevel) return;

    const completedLevel = room.currentLevel;

    // El cliente dice qué nivel cree haber superado. Si no coincide, es un aviso
    // duplicado o rezagado de un nivel que ya se cerró.
    const announced = Number(payload.level);
    if (Number.isFinite(announced) && announced !== completedLevel) return;

    room.completingLevel = true;

    try {
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
      io.to(room.code).emit(EVENTS.LOAD_NEXT_LEVEL, {
        level: room.currentLevel,
        seed: room.seed,
        seedOffset: room.seedOffset,
        playersCount: room.players.length
      });
      broadcastAll(io, roomManager, room);

      await reportProgress({ io, socket, uid, completedLevel, timeSpent, playersCount, participants });
    } finally {
      room.completingLevel = false;
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

/**
 * Reporta el nivel superado a Laravel y reparte los resultados.
 *
 * Separado del manejador porque es la parte lenta —una petición HTTP— y así se ve
 * de un vistazo qué queda dentro del pestillo de reentrada y qué no.
 */
async function reportProgress({ io, socket, uid, completedLevel, timeSpent, playersCount, participants }) {
  // El progreso se guarda con el nivel recién superado, no con el siguiente.
  // Se identifica al agente por `uid` —el id de su cuenta en Laravel— y no por
  // nombre: el perfil permite renombrarse a mitad de partida, y entonces la
  // escritura no encontraría su fila.
  //
  // Los tres van en UNA petición. Antes era un `await` por participante, y ahora
  // que cada uno sería un viaje HTTP eso serían tres esperas encadenadas justo
  // donde los jugadores miran la pantalla de carga del nivel siguiente.
  const results = await reportLevelCompletion({
    level: completedLevel,
    timeSpent,
    playersCount,
    participants: participants.map(p => ({
      playerId: Number(p.uid),
      damageTaken: p.damageTaken,
      deaths: p.deaths
    }))
  });

  // A quién mandar cada resultado. La API responde por playerId y el socket al
  // que hay que emitir lo sabe solo este proceso.
  const socketByPlayerId = new Map(participants.map(p => [Number(p.uid), p.socketId]));

  for (const result of results) {
    const socketId = socketByPlayerId.get(Number(result.playerId));
    if (!socketId) continue;

    // El nivel máximo se refresca aquí para que la siguiente sala que cree este
    // jugador arranque donde toca, sin volver a preguntar a la API.
    if (Number(result.playerId) === Number(uid) && result.stats) {
      socket.user.maxLevel = result.stats.maxLevelReached;
    }

    io.to(socketId).emit(EVENTS.USER_PROGRESS_UPDATED, result.stats);
    if (result.unlocked.length > 0) {
      io.to(socketId).emit(EVENTS.ACHIEVEMENT_UNLOCKED, { keys: result.unlocked });
    }
  }
}
