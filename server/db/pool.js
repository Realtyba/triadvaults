import pkg from 'pg';
import { buildPgConfig, describeTarget, databaseIsRequired } from './config.js';

const { Pool } = pkg;

const pgConfig = buildPgConfig({
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000
});

export const pool = new Pool(pgConfig);

// Un error del pool en reposo (la base se reinicia, se cae la red) llega como
// evento suelto; sin este listener tumba el proceso entero.
pool.on('error', err => {
  console.error('[db] error en el pool:', err.message);
});

let pgConnected = false;
let poolClosed = false;

/** El resto de repositorios consulta esto para decidir Postgres vs. respaldo JSON. */
export const isPgConnected = () => pgConnected;

/** Qué almacén está sirviendo de verdad. Se expone en `GET /api/health`. */
export const activeStorage = () => (pgConnected ? 'postgres' : 'json');

const CREATE_USERS_TABLE = `
  CREATE TABLE IF NOT EXISTS triad_game_users (
    id SERIAL PRIMARY KEY,
    username VARCHAR(50) UNIQUE NOT NULL,
    email VARCHAR(100) UNIQUE NOT NULL,
    password VARCHAR(255) NOT NULL,
    first_name VARCHAR(50),
    last_name VARCHAR(50),
    reset_code VARCHAR(10),
    is_verified BOOLEAN DEFAULT FALSE,
    verification_code VARCHAR(10),
    max_level_reached INTEGER DEFAULT 1,
    total_puzzles_solved INTEGER DEFAULT 0,
    total_time_played INTEGER DEFAULT 0,
    is_online BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
  );
`;

// Columnas añadidas después de la tabla original; se aplican de forma idempotente.
const BACKFILL_COLUMNS = [
  'ADD COLUMN IF NOT EXISTS first_name VARCHAR(50)',
  'ADD COLUMN IF NOT EXISTS last_name VARCHAR(50)',
  'ADD COLUMN IF NOT EXISTS is_verified BOOLEAN DEFAULT FALSE',
  'ADD COLUMN IF NOT EXISTS verification_code VARCHAR(10)',
  'ADD COLUMN IF NOT EXISTS total_time_played INTEGER DEFAULT 0'
];

/** Pista accionable según el código de error de `pg`. */
function diagnose(err) {
  switch (err.code) {
    case '3D000':
      return 'La base de datos no existe. Ejecuta:  npm run db:setup';
    case '28P01':
    case '28000':
      return 'Credenciales rechazadas. Revisa DB_USERNAME / DB_PASSWORD en .env';
    case 'ECONNREFUSED':
      return 'Postgres no responde. ¿Está levantado el contenedor "postgres-local"?';
    case 'ETIMEDOUT':
      return 'Tiempo de espera agotado al conectar. Revisa DB_HOST / DB_PORT.';
    default:
      return 'Revisa la configuración de base de datos en .env';
  }
}

/**
 * El fallo de conexión solía imprimir un `console.warn` de dos líneas y el juego
 * seguía contra `server/data/users.json` como si nada. El síntoma era desconcertante:
 * las cuentas registradas existían, pero al iniciar sesión no aparecían. De ahí que
 * ahora el aviso sea imposible de pasar por alto, y que en producción se aborte.
 */
function reportFailure(err) {
  const required = databaseIsRequired();
  const line = '─'.repeat(68);

  console.error(`\n┌${line}`);
  console.error('│ POSTGRESQL NO DISPONIBLE');
  console.error(`│ Destino   : ${describeTarget(pgConfig)}`);
  console.error(`│ Motivo    : ${err.message}`);
  console.error(`│ Qué hacer : ${diagnose(err)}`);
  console.error('│');

  if (required) {
    console.error('│ DB_REQUIRED está activo: el servidor NO va a arrancar.');
    console.error(`└${line}\n`);
    process.exit(1);
  }

  console.error('│ Se usará el respaldo local server/data/users.json. Las cuentas que');
  console.error('│ vivan en Postgres NO se verán, y el progreso no se guardará allí.');
  console.error(`└${line}\n`);
}

export async function initDatabase() {
  let client;
  try {
    client = await pool.connect();
    pgConnected = true;

    await client.query(CREATE_USERS_TABLE);
    for (const clause of BACKFILL_COLUMNS) {
      await client.query(`ALTER TABLE triad_game_users ${clause}`);
    }

    console.log(`✅ PostgreSQL conectado — ${describeTarget(pgConfig)}`);
  } catch (err) {
    pgConnected = false;
    reportFailure(err);
  } finally {
    if (client) client.release();
  }
  return pgConnected;
}

/** Cierra el pool al apagar el servidor, para no dejar conexiones colgando. */
export async function closeDatabase() {
  if (poolClosed) return;
  poolClosed = true;
  await pool.end().catch(err => console.error('[db] al cerrar el pool:', err.message));
}
