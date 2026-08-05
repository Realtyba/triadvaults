import pkg from 'pg';
const { Pool } = pkg;
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Read Database Connection from Environment or Default Local Postgres
const pgConfig = {
  connectionString: process.env.DATABASE_URL || process.env.POSTGRES_URL,
  user: process.env.DB_USERNAME || 'postgres',
  password: process.env.DB_PASSWORD || 'Qwerty1234ll.',
  host: process.env.DB_HOST || '127.0.0.1',
  port: parseInt(process.env.DB_PORT || '5432'),
  database: process.env.DB_DATABASE || 'tenant_realtyba'
};

const pool = new Pool(pgConfig);

async function runMigrations() {
  console.log('🚀 Iniciando ejecutor de migraciones PostgreSQL para Triad Vaults...');
  let client;

  try {
    client = await pool.connect();
    console.log(`✅ Conectado a PostgreSQL en host: ${pgConfig.host}:${pgConfig.port}, base de datos: ${pgConfig.database}`);

    // Create migrations history table
    await client.query(`
      CREATE TABLE IF NOT EXISTS triad_schema_migrations (
        id SERIAL PRIMARY KEY,
        filename VARCHAR(255) UNIQUE NOT NULL,
        executed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Get list of already executed migrations
    const executedRes = await client.query('SELECT filename FROM triad_schema_migrations;');
    const executedFiles = new Set(executedRes.rows.map(r => r.filename));

    // Get all SQL files in migrations folder sorted by name
    const files = fs.readdirSync(__dirname)
      .filter(f => f.endsWith('.sql'))
      .sort();

    let count = 0;
    for (const file of files) {
      if (!executedFiles.has(file)) {
        console.log(`⚡ Ejecutando migración: ${file}...`);
        const filePath = path.join(__dirname, file);
        const sql = fs.readFileSync(filePath, 'utf-8');

        await client.query('BEGIN');
        await client.query(sql);
        await client.query('INSERT INTO triad_schema_migrations (filename) VALUES ($1);', [file]);
        await client.query('COMMIT');

        console.log(`  └─ ▶ ¡Migración ${file} aplicada con éxito!`);
        count++;
      } else {
        console.log(`  └─ 🗹 Migración ${file} ya aplicada previamente.`);
      }
    }

    console.log(`\n🎉 Resumen: ${count} migraciones ejecutadas exitosamente.`);
  } catch (err) {
    if (client) await client.query('ROLLBACK');
    console.error('❌ Error ejecutando migraciones PostgreSQL:', err);
    process.exit(1);
  } finally {
    if (client) client.release();
    await pool.end();
  }
}

runMigrations();
