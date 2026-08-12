import { Router } from 'express';
import crypto from 'crypto';
import { EVENTS } from '../../shared/events.js';
import { broadcastRoomList } from '../socket/broadcast.js';
import { getIncidents } from '../services/incidentLog.js';

/**
 * Superficie HTTP para el panel admin de realtyba-front (vía Laravel, nunca
 * llamada directamente desde el navegador).
 *
 * Reutiliza el mismo secreto compartido que ya usa `apiClient.js` en sentido
 * contrario (`TRIADVAULTS_INTERNAL_SECRET`), no uno nuevo: es el mismo criterio de
 * "un secreto por canal de confianza" que ya rige el JWT y el reporte de progreso,
 * y no "una variable por cada endpoint que se añada".
 */

function timingSafeEqualStr(a, b) {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

function requireAdminSecret(req, res, next) {
  const expected = process.env.TRIADVAULTS_INTERNAL_SECRET || '';

  // Sin secreto configurado se cierra la puerta, igual que en
  // ValidateInternalSecret.php: comparar contra '' con este mismo método
  // dejaría la superficie abierta a cualquiera que no mande cabecera.
  if (!expected) {
    return res.status(503).json({
      success: false,
      error: { code: 'TRIADVAULTS_NOT_CONFIGURED', message: 'TRIADVAULTS_INTERNAL_SECRET no está definido.' }
    });
  }

  const provided = req.header('X-Internal-Secret') || '';
  if (!timingSafeEqualStr(expected, provided)) {
    return res.status(401).json({
      success: false,
      error: { code: 'INVALID_INTERNAL_SECRET', message: 'No autorizado.' }
    });
  }

  next();
}

export function registerAdminRoutes(app, io, roomManager) {
  const router = Router();
  router.use(requireAdminSecret);

  router.get('/rooms', (req, res) => {
    res.json({ success: true, result: roomManager.listRooms() });
  });

  /**
   * Cierre forzoso de una sala.
   *
   * Avisa a los clientes ANTES de sacarlos del canal de socket.io: al revés, el
   * `emit` a la room ya vacía no llegaría a nadie.
   */
  router.delete('/rooms/:code', (req, res) => {
    const code = String(req.params.code || '').toUpperCase().trim();
    const reason = typeof req.body?.reason === 'string' ? req.body.reason.slice(0, 200) : null;

    const room = roomManager.forceCloseRoom(code);
    if (!room) {
      return res.status(404).json({
        success: false,
        error: { code: 'ROOM_NOT_FOUND', message: 'La sala no existe.' }
      });
    }

    io.to(room.code).emit(EVENTS.ROOM_CLOSED_BY_ADMIN, { reason });
    io.in(room.code).socketsLeave(room.code);
    broadcastRoomList(io, roomManager);

    res.json({ success: true, result: { code: room.code } });
  });

  router.get('/incidents', (req, res) => {
    res.json({ success: true, result: getIncidents() });
  });

  app.use('/admin', router);
}
