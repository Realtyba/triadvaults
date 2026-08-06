#!/usr/bin/env node
/**
 * Crea la base de datos del juego si no existe y aplica las migraciones.
 *
 * `CREATE DATABASE` no puede vivir en una migración: Postgres no lo permite dentro
 * de una transacción, y el ejecutor de migraciones envuelve cada fichero en una.
 * Por eso este paso va aparte y se conecta a la base `postgres` para crearla.
 *
 * Es idempotente: ejecutarlo dos veces no hace nada la segunda.
 */
import 'dotenv/config';
import pkg from 'pg';
import { execFileSync } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
import { buildPgConfig, describeTarget, DEFAULT_DATABASE } from '../server/db/config.js';

const { Client } = pkg;
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

const target = buildPgConfig();

/** El nombre de la base, venga de las variables sueltas o de DATABASE_URL. */
function targetDatabaseName() {
  if (!target.connectionString) return target.database;
  try {
    return new URL(target.connectionString).pathname.replace(/^\//, '') || DEFAULT_DATABASE;
  } catch {
    return DEFAULT_DATABASE;
  }
}

async function ensureDatabase(name) {
  // Para crearla hay que estar conectado a otra: `postgres` siempre existe.
  const admin = new Client(buildPgConfig({ database: 'postgres', connectionString: undefined }));

  await admin.connect();
  try {
    const existing = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [name]);
    if (existing.rowCount > 0) {
      console.log(`· La base "${name}" ya existe.`);
      return false;
    }

    // El nombre no puede ir como parámetro en un DDL; se cita como identificador.
    //
    // `TEMPLATE template0` a propósito: template1 arrastra lo que alguien haya
    // instalado en él, y en este clúster además tiene un desajuste de versión de
    // intercalación (la imagen de Docker se creó con otra glibc) que hace fallar
    // el CREATE DATABASE por defecto. template0 está congelado y no tiene ninguno
    // de los dos problemas.
    await admin.query(`CREATE DATABASE "${name.replace(/"/g, '""')}" TEMPLATE template0`);
    console.log(`✔ Base "${name}" creada.`);
    return true;
  } finally {
    await admin.end();
  }
}

async function main() {
  const name = targetDatabaseName();
  console.log(`🗄  Preparando ${describeTarget(target)}`);

  try {
    await ensureDatabase(name);
  } catch (err) {
    console.error(`✖ No se pudo preparar la base de datos: ${err.message}`);
    if (err.code === '28P01' || err.code === '28000') {
      console.error('  Credenciales rechazadas. Revisa DB_USERNAME / DB_PASSWORD en .env');
    }
    if (err.code === 'ECONNREFUSED') {
      console.error('  Postgres no responde. ¿Está levantado el contenedor "postgres-local"?');
    }
    process.exit(1);
  }

  console.log('\n📜 Aplicando migraciones...');
  execFileSync(process.execPath, [path.join(ROOT, 'migrations', 'migrate.js')], {
    stdio: 'inherit',
    cwd: ROOT
  });

  console.log('\nSiguiente paso (opcional): npm run db:import-legacy');
}

main();
