import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { createServer } from 'http';
import { Server } from 'socket.io';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

import { initDatabase, closeDatabase, activeStorage, DatabaseManager } from './db/index.js';
import { authRouter } from './http/routes/auth.routes.js';
import { profileRouter } from './http/routes/profile.routes.js';
import { leaderboardRouter } from './http/routes/leaderboard.routes.js';
import { achievementsRouter } from './http/routes/achievements.routes.js';
import { registerSocketLayer } from './socket/index.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3001;

const app = express();
app.use(cors());
app.use(express.json());

app.use('/api', authRouter);
app.use('/api/profile', profileRouter);
app.use('/api/leaderboard', leaderboardRouter);
app.use('/api/achievements', achievementsRouter);

// `storage` dice si se está sirviendo desde Postgres o desde el respaldo JSON.
// Sin ese dato, un servidor degradado es indistinguible de uno sano desde fuera.
app.get('/api/health', (req, res) =>
  res.json({ success: true, uptime: process.uptime(), storage: activeStorage() })
);

// Build de producción del cliente
app.use(express.static(join(__dirname, '../dist')));

const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: { origin: '*', methods: ['GET', 'POST'] },
  pingTimeout: 20000,
  pingInterval: 10000
});

// La base de datos primero: si falla y es obligatoria, aquí se aborta. Aceptar
// sockets antes de saberlo dejaba entrar a jugadores a un servidor sin persistencia.
await initDatabase();

// Primer arranque tras migrar: la tabla del catálogo existe pero está vacía. Se
// siembra con los logros de salida; si ya hay filas, no se toca nada.
await DatabaseManager.seedAchievementCatalog();

registerSocketLayer(io);

httpServer.listen(PORT, () => {
  console.log(`⚡ Triad Vaults — servidor multijugador en http://localhost:${PORT}`);
});

/** Apagado ordenado: avisar a los clientes y soltar las conexiones de Postgres. */
let shuttingDown = false;
async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`\n${signal} recibido, cerrando...`);

  io.close();
  httpServer.close();
  await closeDatabase();
  process.exit(0);
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
