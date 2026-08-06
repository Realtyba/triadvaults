import { pool, isPgConnected } from './pool.js';
import { readUsers, writeUsers, findUserKey } from './jsonStore.js';
import { DEFAULT_ACHIEVEMENTS, validateDefinition, sortCatalog } from '../../shared/achievements.js';

/**
 * Catálogo de logros y logros desbloqueados por agente.
 *
 * Mismo patrón de doble vía que el resto de repositorios: Postgres cuando hay
 * conexión, `server/data/users.json` cuando no. En el respaldo, los logros de cada
 * agente se guardan dentro de su propio registro (allí no hay relaciones) y el
 * catálogo es el de `DEFAULT_ACHIEVEMENTS`, porque tampoco hay dónde editarlo.
 */

const TABLE = 'triad_user_achievements';
const CATALOG_TABLE = 'triad_achievements';

/**
 * El catálogo se relee cada minuto en lugar de una sola vez al arrancar.
 *
 * Es el compromiso que hace útil tenerlo en base de datos: un logro nuevo entra en
 * juego sin reiniciar el servidor, y aun así no se consulta la tabla en cada nivel
 * completado —que es lo que pasaría sin caché, con tres agentes reportando a la vez.
 */
const CATALOG_TTL_MS = 60_000;

let cache = null;
let cachedAt = 0;

// ------------------------------------------------------------------- catálogo

/** Fila de Postgres → definición como la espera el motor de `shared/achievements.js`. */
function rowToDefinition(row) {
  return {
    key: row.key,
    icon: row.icon,
    title: { es: row.title_es, en: row.title_en },
    description: { es: row.description_es, en: row.description_en },
    // `jsonb` ya llega convertido a array; el `|| []` cubre una fila manipulada a mano.
    conditions: Array.isArray(row.conditions) ? row.conditions : [],
    steamApiName: row.steam_api_name || null,
    sortOrder: row.sort_order,
    enabled: row.enabled
  };
}

/**
 * Lee el catálogo comprobando cada fila.
 *
 * Las filas inválidas se descartan y se informa de cuál y por qué. Es el precio de
 * mover el catálogo a datos: una métrica mal escrita ya no la caza la revisión de
 * código, y sin este aviso el logro simplemente no se concedería nunca sin que nadie
 * lo notase.
 *
 * @returns {Promise<{catalog: object[], problems: {key: string, errors: string[]}[], source: string}>}
 */
export async function loadCatalogReport() {
  if (!isPgConnected()) {
    return {
      catalog: sortCatalog(DEFAULT_ACHIEVEMENTS),
      problems: [],
      warnings: [],
      source: 'defaults'
    };
  }

  const res = await pool.query(
    `SELECT key, icon, title_es, title_en, description_es, description_en,
            conditions, steam_api_name, sort_order, enabled
       FROM ${CATALOG_TABLE}
      ORDER BY sort_order, key`
  );

  const catalog = [];
  const problems = [];
  const warnings = [];

  for (const row of res.rows) {
    const definition = rowToDefinition(row);
    const { valid, errors, warnings: warns } = validateDefinition(definition);

    // Los avisos no impiden evaluar: la definición entra igual y solo se informa.
    if (warns.length > 0) warnings.push({ key: definition.key, warnings: warns });

    if (valid) catalog.push(definition);
    else problems.push({ key: definition.key, errors });
  }

  return { catalog, problems, warnings, source: 'postgres' };
}

/**
 * Catálogo vigente, con caché de {@link CATALOG_TTL_MS}.
 * @param {{force?: boolean}} [options]
 */
export async function getCatalog({ force = false } = {}) {
  if (!force && cache && Date.now() - cachedAt < CATALOG_TTL_MS) return cache;

  try {
    const { catalog, problems, warnings } = await loadCatalogReport();
    problems.forEach(p =>
      console.error(`[logros] la definición "${p.key}" se ignora: ${p.errors.join('; ')}`)
    );
    warnings.forEach(w => console.warn(`[logros] "${w.key}": ${w.warnings.join('; ')}`));

    // Un catálogo vacío en Postgres no se cachea como respuesta buena: significa
    // que la siembra no llegó a correr, y devolver una lista vacía durante un
    // minuto dejaría sin conceder logros que sí existen.
    cache = catalog.length > 0 ? catalog : sortCatalog(DEFAULT_ACHIEVEMENTS);
    cachedAt = Date.now();
    return cache;
  } catch (err) {
    console.error('[achievements.repo] getCatalog:', err.message);
    // Se sigue con lo último bueno que se leyó, y si no hubo, con los de salida:
    // quedarse sin catálogo dejaría de conceder logros silenciosamente.
    return cache || sortCatalog(DEFAULT_ACHIEVEMENTS);
  }
}

/** Fuerza la relectura en la siguiente consulta (tras sembrar o editar). */
export function invalidateCatalog() {
  cache = null;
  cachedAt = 0;
}

/**
 * Siembra el catálogo con los logros de salida **solo si la tabla está vacía**.
 *
 * No es `ON CONFLICT DO NOTHING` sobre cada fila a propósito: eso resucitaría en el
 * siguiente arranque cualquier logro que se hubiera borrado a conciencia. Vacío
 * significa "recién migrado"; a partir de ahí manda la base de datos.
 *
 * @returns {Promise<number>} filas insertadas
 */
export async function seedCatalog() {
  if (!isPgConnected()) return 0;

  try {
    const count = await pool.query(`SELECT COUNT(*)::int AS n FROM ${CATALOG_TABLE}`);
    if (count.rows[0].n > 0) return 0;

    for (const def of DEFAULT_ACHIEVEMENTS) {
      await pool.query(
        `INSERT INTO ${CATALOG_TABLE}
           (key, icon, title_es, title_en, description_es, description_en, conditions,
            steam_api_name, sort_order)
         VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9)
         ON CONFLICT (key) DO NOTHING`,
        [
          def.key,
          def.icon,
          def.title.es,
          def.title.en,
          def.description.es,
          def.description.en,
          JSON.stringify(def.conditions),
          def.steamApiName || null,
          def.sortOrder ?? 100
        ]
      );
    }

    invalidateCatalog();
    console.log(`[logros] catálogo sembrado con ${DEFAULT_ACHIEVEMENTS.length} definiciones.`);
    return DEFAULT_ACHIEVEMENTS.length;
  } catch (err) {
    // La tabla puede no existir todavía si alguien arranca sin migrar. No es
    // motivo para tumbar el servidor: se juega igual, sin conceder logros nuevos.
    console.error('[achievements.repo] seedCatalog:', err.message);
    return 0;
  }
}

// ----------------------------------------------------------- logros por agente

/** Clave del agente en el respaldo JSON, donde no existen ids numéricos. */
function jsonKeyFor(users, { uid, name }) {
  return findUserKey(users, name) || findUserKey(users, uid);
}

/**
 * Claves ya desbloqueadas.
 * @returns {Promise<string[]>}
 */
export async function listAchievements({ uid, name } = {}) {
  if (uid === undefined && !name) return [];

  if (isPgConnected()) {
    try {
      const res = await pool.query(
        `SELECT a.achievement_key
           FROM ${TABLE} a
           JOIN triad_game_users u ON u.id = a.user_id
          WHERE ($1::int IS NOT NULL AND u.id = $1::int)
             OR ($1::int IS NULL AND LOWER(u.username) = $2)
       ORDER BY a.unlocked_at`,
        [Number.isFinite(Number(uid)) ? Number(uid) : null, name ? String(name).toLowerCase() : null]
      );
      return res.rows.map(r => r.achievement_key);
    } catch (err) {
      console.error('[achievements.repo] listAchievements:', err.message);
      return [];
    }
  }

  const users = readUsers();
  const key = jsonKeyFor(users, { uid, name });
  return key && Array.isArray(users[key].achievements) ? users[key].achievements : [];
}

/**
 * Concede logros. Idempotente: repetir una clave no la duplica ni falla.
 *
 * @returns {Promise<string[]>} las claves realmente concedidas ahora
 */
export async function grantAchievements({ uid, name }, keys = []) {
  if (keys.length === 0) return [];

  if (isPgConnected()) {
    try {
      // Se resuelve el id primero: la inserción necesita la clave ajena, y con
      // tres clientes reportando el mismo nivel a la vez `ON CONFLICT` es lo que
      // evita tanto duplicados como excepciones.
      const owner = await pool.query(
        `SELECT id FROM triad_game_users
          WHERE ($1::int IS NOT NULL AND id = $1::int)
             OR ($1::int IS NULL AND LOWER(username) = $2)`,
        [Number.isFinite(Number(uid)) ? Number(uid) : null, name ? String(name).toLowerCase() : null]
      );
      if (owner.rows.length === 0) return [];

      const res = await pool.query(
        `INSERT INTO ${TABLE} (user_id, achievement_key)
         SELECT $1, UNNEST($2::varchar[])
         ON CONFLICT (user_id, achievement_key) DO NOTHING
         RETURNING achievement_key`,
        [owner.rows[0].id, keys]
      );
      return res.rows.map(r => r.achievement_key);
    } catch (err) {
      console.error('[achievements.repo] grantAchievements:', err.message);
      return [];
    }
  }

  try {
    const users = readUsers();
    const key = jsonKeyFor(users, { uid, name });
    if (!key) return [];

    const owned = new Set(users[key].achievements || []);
    const granted = keys.filter(k => !owned.has(k));
    if (granted.length === 0) return [];

    users[key].achievements = [...owned, ...granted];
    writeUsers(users);
    return granted;
  } catch (err) {
    console.error('[achievements.repo] grantAchievements (json):', err.message);
    return [];
  }
}
