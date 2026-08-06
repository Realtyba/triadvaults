#!/usr/bin/env node
/**
 * Genera `.env` a partir de `.env.example` la primera vez.
 *
 * Se ejecuta solo en `npm run dev`, así que arrancar en una máquina limpia es un
 * único comando. Nunca sobrescribe un `.env` existente.
 *
 * Antes inventaba el `JWT_SECRET` al azar. Ya no puede: ese secreto lo COMPARTE
 * con realtyba-api, que es quien emite los tokens, y este servidor solo los
 * verifica. Uno generado aquí no coincidiría con el de allí, y el síntoma sería de
 * los peores posibles — el registro y el login funcionando con normalidad, y todas
 * las conexiones de socket rechazadas con "token inválido". Así que se dejan
 * vacíos y se dice en voz alta qué hay que copiar.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const ENV_FILE = path.join(ROOT, '.env');
const EXAMPLE_FILE = path.join(ROOT, '.env.example');

/** Variables que deben valer LO MISMO que en el .env de realtyba-api. */
const SHARED_WITH_API = ['TRIADVAULTS_JWT_SECRET', 'TRIADVAULTS_INTERNAL_SECRET'];

function main() {
  if (fs.existsSync(ENV_FILE)) {
    console.log('· .env ya existe, no se toca.');
    return;
  }
  if (!fs.existsSync(EXAMPLE_FILE)) {
    console.error('✖ No se encontró .env.example; no se puede generar .env.');
    process.exitCode = 1;
    return;
  }

  fs.writeFileSync(ENV_FILE, fs.readFileSync(EXAMPLE_FILE, 'utf-8'), { mode: 0o600 });

  console.log('✔ .env creado a partir de .env.example.');
  console.log('');
  console.log('  Antes de arrancar, copia estos valores DESDE el .env de realtyba-api:');
  SHARED_WITH_API.forEach(key => console.log(`    · ${key}`));
  console.log('');
  console.log('  Si no existen todavía allí, genéralos con `openssl rand -hex 32`');
  console.log('  y pon el MISMO valor en los dos ficheros.');
  console.log('');
  console.log('  Comprueba también que TRIADVAULTS_API_URL apunta a tu realtyba-api');
  console.log('  (por defecto http://localhost:8000). Es la única: de ahí la leen');
  console.log('  tanto este servidor como el cliente.');
}

main();
