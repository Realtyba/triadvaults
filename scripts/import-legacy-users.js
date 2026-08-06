#!/usr/bin/env node
/**
 * Rescata cuentas que quedaron fuera de la base de datos del juego.
 *
 * Contexto: durante un tiempo el ejecutor de migraciones apuntaba a
 * `tenant_realtyba` mientras el servidor buscaba en `triadvaults`, y además el
 * servidor caía en silencio al respaldo `server/data/users.json` cuando no podía
 * conectar. El resultado es que las cuentas acabaron repartidas en tres sitios.
 * Este script las trae al sitio bueno.
 *
 * Dos orígenes:
 *   node scripts/import-legacy-users.js                    # otra base de datos
 *   node scripts/import-legacy-users.js --from-json        # server/data/users.json
 *
 * Opciones: [--from <base>] [--dry-run]
 *
 * No borra nada del origen: si algo sale mal, los datos siguen donde estaban.
 */
import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import pkg from 'pg';
import { fileURLToPath } from 'url';
import { buildPgConfig, describeTarget } from '../server/db/config.js';

const { Client } = pkg;

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const JSON_STORE = path.join(ROOT, 'server', 'data', 'users.json');

const DEFAULT_SOURCE = 'tenant_realtyba';
const TABLE = 'triad_game_users';

const COLUMNS = [
  'id',
  'username',
  'email',
  'password',
  'first_name',
  'last_name',
  'is_verified',
  'max_level_reached',
  'total_puzzles_solved',
  'total_time_played'
];

function parseArgs(argv) {
  const args = { from: DEFAULT_SOURCE, dryRun: false, fromJson: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--from') args.from = argv[++i];
    else if (argv[i] === '--dry-run') args.dryRun = true;
    else if (argv[i] === '--from-json') args.fromJson = true;
  }
  return args;
}

/**
 * Normaliza un registro del respaldo JSON a la forma de una fila de Postgres.
 * El respaldo es anterior al correo obligatorio, así que puede no traerlo; en la
 * tabla la columna es NOT NULL y única, y se rellena con un marcador que el
 * jugador puede corregir desde su perfil.
 */
function jsonRecordToRow(key, user) {
  const username = user.username || key;
  return {
    id: null, // el respaldo no tiene ids numéricos: los asigna la secuencia
    username,
    email: user.email || `${String(username).toLowerCase()}@sin-correo.local`,
    password: user.password,
    first_name: user.firstName || null,
    last_name: user.lastName || null,
    max_level_reached: user.maxLevelReached || 1,
    total_puzzles_solved: user.totalPuzzlesSolved || 0,
    total_time_played: user.totalTimePlayed || 0
  };
}

function readJsonUsers() {
  if (!fs.existsSync(JSON_STORE)) return [];
  try {
    const raw = JSON.parse(fs.readFileSync(JSON_STORE, 'utf-8') || '{}');
    return Object.entries(raw)
      .filter(([, user]) => user && user.password)
      .map(([key, user]) => jsonRecordToRow(key, user));
  } catch (err) {
    console.error(`✖ No se pudo leer ${JSON_STORE}: ${err.message}`);
    return [];
  }
}

async function tableExists(client, table) {
  const res = await client.query('SELECT to_regclass($1) AS oid', [`public.${table}`]);
  return res.rows[0].oid !== null;
}

/** Filas a importar, ya normalizadas, vengan de donde vengan. */
async function collectRows({ fromJson, from }) {
  if (fromJson) {
    const rows = readJsonUsers();
    console.log(`📦 ${JSON_STORE} → destino`);
    return { rows, close: async () => {} };
  }

  const source = new Client(buildPgConfig({ database: from, connectionString: undefined }));
  try {
    await source.connect();
  } catch (err) {
    console.error(`✖ No se pudo abrir el origen "${from}": ${err.message}`);
    if (err.code === '3D000') console.error('  Esa base no existe; no hay nada que importar.');
    process.exit(1);
  }

  console.log(`📦 ${from} → destino`);
  const close = () => source.end();

  if (!(await tableExists(source, TABLE))) {
    console.log(`· "${from}" no tiene tabla ${TABLE}.`);
    return { rows: [], close };
  }

  const res = await source.query(`SELECT ${COLUMNS.join(', ')} FROM ${TABLE} ORDER BY id`);
  return { rows: res.rows, close };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  const targetConfig = buildPgConfig();
  const target = new Client(targetConfig);
  await target.connect();

  const { rows, close } = await collectRows(args);
  console.log(`   destino: ${describeTarget(targetConfig)}`);

  try {
    if (rows.length === 0) {
      console.log('· No hay cuentas que importar.');
      return;
    }

    console.log(`· ${rows.length} cuenta(s) en el origen.`);
    let imported = 0;
    let skipped = 0;
    let keptIds = false;

    for (const row of rows) {
      // Un mismo agente puede existir ya en destino con otro id; el nombre y el
      // correo son únicos, así que se comprueban los dos.
      const clash = await target.query(
        `SELECT id FROM ${TABLE}
          WHERE (($1::int IS NOT NULL) AND id = $1::int)
             OR LOWER(username) = LOWER($2)
             OR LOWER(email) = LOWER($3)`,
        [row.id, row.username, row.email]
      );
      if (clash.rowCount > 0) {
        console.log(`  ↷ ${row.username} ya existe en destino, se omite.`);
        skipped++;
        continue;
      }

      if (args.dryRun) {
        console.log(`  · [dry-run] importaría ${row.username} (nivel ${row.max_level_reached})`);
        imported++;
        continue;
      }

      // Se marcan como verificadas: son cuentas anteriores al flujo de PIN, y
      // nunca se les emitió un código, así que exigirlo las dejaría bloqueadas.
      // El id se conserva cuando el origen lo tenía; si no, lo pone la secuencia.
      const columns = ['username', 'email', 'password', 'first_name', 'last_name',
        'is_verified', 'verification_code', 'max_level_reached', 'total_puzzles_solved', 'total_time_played'];
      const values = [row.username, row.email, row.password, row.first_name, row.last_name,
        true, null, row.max_level_reached || 1, row.total_puzzles_solved || 0, row.total_time_played || 0];

      if (row.id !== null && row.id !== undefined) {
        columns.unshift('id');
        values.unshift(row.id);
        keptIds = true;
      }

      const placeholders = values.map((_, i) => `$${i + 1}`).join(', ');
      await target.query(
        `INSERT INTO ${TABLE} (${columns.join(', ')}) VALUES (${placeholders})`,
        values
      );
      console.log(`  ✔ ${row.username} (nivel ${row.max_level_reached}) importado y verificado.`);
      imported++;
    }

    if (!args.dryRun && keptIds) {
      // Al conservar los ids del origen, la secuencia se quedó atrás y el próximo
      // registro chocaría con una clave existente.
      await target.query(
        `SELECT setval(pg_get_serial_sequence('${TABLE}', 'id'), COALESCE((SELECT MAX(id) FROM ${TABLE}), 1))`
      );
      console.log('· Secuencia de ids reajustada.');
    }

    console.log(`\n🎉 ${imported} importada(s), ${skipped} omitida(s).`);
  } catch (err) {
    console.error(`✖ Error importando: ${err.message}`);
    process.exitCode = 1;
  } finally {
    await close();
    await target.end();
  }
}

main();
