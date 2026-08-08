import { EVENTS, GHOST_STATES } from '../../../shared/events.js';
import { sanitizeVec3 } from '../../rooms/roomState.js';
import { createHandlerContext } from './context.js';

/** Sincronización de alta frecuencia: se reenvía tal cual, sin difundir de vuelta al emisor. */
export function registerSyncHandlers(io, socket, roomManager) {
  const { uid, authorize } = createHandlerContext(socket, roomManager);

  socket.on(EVENTS.PLAYER_MOVE, (payload = {}) => {
    // Antes solo se comprobaba que la sala existiera, y la pertenencia se dejaba
    // implícita en que `updatePlayerTransform` devolviese null. Con `authorize` es
    // explícita, igual que en el resto de eventos.
    const room = authorize(payload.roomCode);
    if (!room) return;

    const player = roomManager.updatePlayerTransform(room, uid, payload.position, payload.rotationY);
    if (!player) return;

    socket.to(room.code).emit(EVENTS.PLAYER_MOVED, {
      uid,
      position: player.position,
      rotationY: player.rotationY
    });
  });

  socket.on(EVENTS.GHOST_STATE, (payload = {}) => {
    const room = authorize(payload.roomCode, { hostOnly: true });
    if (!room) return;

    // Se reenviaba `payload.position` literal, sin mirarlo: un host manipulado
    // podía mandar NaN —que deja la malla del fantasma fuera de la escena en todos
    // los demás clientes— o un objeto arbitrariamente grande.
    const ghosts = sanitizeGhostList(payload.ghosts);
    if (ghosts.length === 0) return;

    socket.to(room.code).emit(EVENTS.GHOST_SYNCED, { ghosts });
  });
}

/** Máximo de fantasmas admitidos en un paquete: uno por agente. */
const MAX_GHOSTS = 3;

/**
 * El estado se comprueba contra la lista, no se reenvía como venga.
 *
 * Es el mismo criterio que ya se aplica a `position`: lo que manda el host es el
 * cliente de alguien, y un índice fuera de rango en los demás clientes se traduce en una
 * animación inexistente o un uniforme sin sentido. Ante la duda, acecha —el estado más
 * inofensivo de los tres—.
 */
function sanitizeGhostState(value) {
  const state = Number(value);
  return state === GHOST_STATES.HUNT || state === GHOST_STATES.CHARGE ? state : GHOST_STATES.STALK;
}

function sanitizeGhostList(list) {
  if (!Array.isArray(list)) return [];

  const ghosts = [];
  for (const entry of list.slice(0, MAX_GHOSTS)) {
    if (!entry || typeof entry !== 'object') continue;

    const position = sanitizeVec3(entry.position);
    if (!position) continue;

    const id = Number(entry.id);
    ghosts.push({
      id: Number.isFinite(id) ? id : ghosts.length,
      position,
      targetUid: entry.targetUid ? String(entry.targetUid) : null,
      state: sanitizeGhostState(entry.state)
    });
  }
  return ghosts;
}
