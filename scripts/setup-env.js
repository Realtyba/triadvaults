#!/usr/bin/env node
/**
 * Genera `.env` a partir de `.env.example` la primera vez.
 *
 * Existe porque las variables que el servidor necesita ya no tienen un valor por
 * defecto utilizable: sin `.env` el juego apuntaba a una base de datos inexistente
 * y firmaba los JWT con una clave de desarrollo conocida. Se ejecuta solo en
 * `npm run dev`, así que arrancar en una máquina limpia es un único comando.
 *
 * Nunca sobrescribe un `.env` existente: si ya lo tienes configurado, no se toca.
 */
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';
import { fileURLToPath } from 'url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const ENV_FILE = path.join(ROOT, '.env');
const EXAMPLE_FILE = path.join(ROOT, '.env.example');

/** Contenedor de Postgres del que se intentan deducir credenciales. */
const PG_CONTAINER = 'postgres-local';

function generateSecret() {
  return crypto.randomBytes(48).toString('hex');
}

/**
 * Lee `POSTGRES_PASSWORD` del contenedor local, si hay uno corriendo.
 * Docker puede no estar instalado o el contenedor no existir: en ese caso se
 * devuelve null y el `.env` queda con el marcador del ejemplo para rellenar a mano.
 */
function detectContainerPassword() {
  try {
    const raw = execFileSync(
      'docker',
      ['inspect', '--format', '{{range .Config.Env}}{{println .}}{{end}}', PG_CONTAINER],
      { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 5000 }
    );
    const line = raw.split('\n').find(l => l.startsWith('POSTGRES_PASSWORD='));
    return line ? line.slice('POSTGRES_PASSWORD='.length).trim() : null;
  } catch {
    return null;
  }
}

/** Sustituye el valor de una clave conservando comentarios y orden del ejemplo. */
function setValue(content, key, value) {
  const pattern = new RegExp(`^${key}=.*$`, 'm');
  const line = `${key}=${value}`;
  return pattern.test(content) ? content.replace(pattern, line) : `${content}\n${line}\n`;
}

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

  let content = fs.readFileSync(EXAMPLE_FILE, 'utf-8');
  content = setValue(content, 'JWT_SECRET', generateSecret());

  const password = detectContainerPassword();
  if (password) {
    content = setValue(content, 'DB_PASSWORD', password);
  }

  fs.writeFileSync(ENV_FILE, content, { mode: 0o600 });

  console.log('✔ .env creado a partir de .env.example.');
  console.log('  · JWT_SECRET generado al azar.');
  console.log(
    password
      ? `  · DB_PASSWORD tomada del contenedor "${PG_CONTAINER}".`
      : `  · DB_PASSWORD sin detectar (¿está corriendo "${PG_CONTAINER}"?): rellénala a mano.`
  );
  console.log('  Siguiente paso: npm run db:setup');
}

main();
