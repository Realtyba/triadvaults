#!/usr/bin/env node
/**
 * Ejecutor de migraciones. Aplica en orden los `.sql` de esta carpeta que aún no
 * consten en `triad_schema_migrations`.
 *
 * La conexión sale de `server/db/config.js`, la misma que usa el servidor: cuando
 * cada uno tenía la suya, el migrador creaba las tablas en `tenant_realtyba` y el
 * servidor las buscaba en otra base, de modo que los usuarios existían pero no
 * podían iniciar sesión.
 */
import 'dotenv/config';
import pkg from 'pg';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { buildPgConfig, describeTarget } from '../server/db/config.js';

const { Pool } = pkg;
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const pgConfig = buildPgConfig();
const pool = new Pool(pgConfig);

async function runMigrations() {
  console.log('🚀 Migraciones de Triad Vaults');
  let client;

  try {
    client = await pool.connect();
    console.log(`✅ Conectado a ${describeTarget(pgConfig)}`);

    await client.query(`
      CREATE TABLE IF NOT EXISTS triad_schema_migrations (
        id SERIAL PRIMARY KEY,
        filename VARCHAR(255) UNIQUE NOT NULL,
        executed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    const executedRes = await client.query('SELECT filename FROM triad_schema_migrations;');
    const executedFiles = new Set(executedRes.rows.map(r => r.filename));

    const files = fs
      .readdirSync(__dirname)
      .filter(f => f.endsWith('.sql'))
      .sort();

    let count = 0;
    for (const file of files) {
      if (executedFiles.has(file)) {
        console.log(`  └─ 🗹 ${file} ya aplicada.`);
        continue;
      }

      console.log(`⚡ Ejecutando ${file}...`);
      const sql = fs.readFileSync(path.join(__dirname, file), 'utf-8');

      await client.query('BEGIN');
      await client.query(sql);
      await client.query('INSERT INTO triad_schema_migrations (filename) VALUES ($1);', [file]);
      await client.query('COMMIT');

      console.log(`  └─ ▶ ${file} aplicada.`);
      count++;
    }

    console.log(`\n🎉 ${count} migraciones ejecutadas.`);
  } catch (err) {
    if (client) await client.query('ROLLBACK').catch(() => {});
    console.error('❌ Error ejecutando migraciones:', err.message);
    if (err.code === '3D000') {
      console.error('   La base de datos no existe. Ejecuta antes: npm run db:setup');
    }
    if (err.code === '28P01' || err.code === '28000') {
      console.error('   Credenciales rechazadas. Revisa DB_USERNAME / DB_PASSWORD en .env');
    }
    process.exit(1);
  } finally {
    if (client) client.release();
    await pool.end();
  }
}

runMigrations();
