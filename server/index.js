import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { createServer } from 'http';
import { Server } from 'socket.io';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

import { registerSocketLayer } from './socket/index.js';
import { apiIsConfigured } from './services/apiClient.js';
import { recordIncident } from './services/incidentLog.js';
import { registerAdminRoutes } from './admin/routes.js';

/**
 * Servidor de salas de Triad Vaults.
 *
 * Coordina las partidas co-op en tiempo real y nada más: las cuentas, el progreso,
 * los logros y el correo viven en realtyba-api. Este proceso no abre ninguna
 * conexión a base de datos ni guarda nada en disco — las salas son efímeras y viven
 * en memoria, porque una partida que nadie está jugando no tiene por qué sobrevivir
 * a un reinicio.
 */

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3001;

const app = express();
app.use(cors());
app.use(express.json());

/**
 * Salud del servidor de salas.
 *
 * `api` dice si la integración con realtyba-api está configurada. Sin ella se juega
 * igual, pero el progreso no se guarda en ningún sitio, y desde fuera un servidor
 * así sería indistinguible de uno sano.
 */
app.get('/health', (req, res) =>
  res.json({
    success: true,
    service: 'triadvaults-rooms',
    uptime: process.uptime(),
    api: apiIsConfigured()
  })
);

// Build de producción del cliente
app.use(express.static(join(__dirname, '../dist')));

const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: { origin: '*', methods: ['GET', 'POST'] },
  pingTimeout: 20000,
  pingInterval: 10000,

  // Un paquete de juego son unos cientos de bytes: una posición, un ángulo, un
  // uid. El límite por defecto de socket.io es de 1 MB, tres órdenes de magnitud
  // por encima de lo que este protocolo necesita, y en un servidor pequeño ese
  // margen es exactamente el que permite que un cliente cualquiera reserve
  // memoria a su antojo. 64 KB deja sitio de sobra para el mayor evento real.
  maxHttpBufferSize: 64 * 1024
});

if (!apiIsConfigured()) {
  console.warn(
    'TRIADVAULTS_API_URL o TRIADVAULTS_INTERNAL_SECRET no están definidos: ' +
      'se podrá jugar, pero el progreso y los logros no se guardarán.'
  );
}

const roomManager = registerSocketLayer(io);
registerAdminRoutes(app, io, roomManager);

// Red de seguridad de última instancia: sin esto, una excepción fuera de un
// handler de socket (que ya atrapa las suyas) tira el proceso entero —y con él,
// todas las salas en memoria— sin dejar ningún rastro más que el stack en stdout.
process.on('uncaughtException', err => {
  console.error('[uncaughtException]', err);
  recordIncident('uncaught_exception', err.message);
});
process.on('unhandledRejection', reason => {
  console.error('[unhandledRejection]', reason);
  recordIncident('unhandled_rejection', reason instanceof Error ? reason.message : String(reason));
});

httpServer.listen(PORT, () => {
  console.log(`⚡ Triad Vaults — servidor de salas en http://localhost:${PORT}`);
});

/** Apagado ordenado: avisar a los clientes antes de cerrar. */
let shuttingDown = false;
function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`\n${signal} recibido, cerrando...`);

  roomManager.stopSweeper();
  io.close();
  httpServer.close();
  process.exit(0);
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
