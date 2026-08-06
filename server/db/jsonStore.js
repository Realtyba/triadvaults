import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const DATA_DIR = path.join(__dirname, '..', 'data');
const USERS_FILE = path.join(DATA_DIR, 'users.json');

function ensureFile() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(USERS_FILE)) fs.writeFileSync(USERS_FILE, '{}');
}

ensureFile();

/** Lee el respaldo JSON. Nunca lanza: un fichero corrupto degrada a `{}`. */
export function readUsers() {
  try {
    ensureFile();
    return JSON.parse(fs.readFileSync(USERS_FILE, 'utf-8') || '{}');
  } catch (err) {
    console.error('[jsonStore] users.json ilegible, se parte de vacío:', err.message);
    return {};
  }
}

export function writeUsers(users) {
  try {
    ensureFile();
    fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
    return true;
  } catch (err) {
    console.error('[jsonStore] No se pudo escribir users.json:', err.message);
    return false;
  }
}

/** Las claves del respaldo son el username en minúsculas. */
export function findUserKey(users, identifier) {
  if (!identifier) return null;
  const needle = String(identifier).trim().toLowerCase();
  return (
    Object.keys(users).find(
      k => k.toLowerCase() === needle || String(users[k].email || '').toLowerCase() === needle
    ) || null
  );
}
