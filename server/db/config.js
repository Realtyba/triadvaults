/**
 * Única fuente de la configuración de conexión a Postgres.
 *
 * La comparten el servidor (`pool.js`), el ejecutor de migraciones y los scripts
 * de `scripts/`. Antes cada uno la construía por su cuenta y acabaron apuntando a
 * bases de datos distintas: el migrador creaba las tablas en un sitio y el
 * servidor las buscaba en otro, así que los usuarios registrados eran invisibles
 * al iniciar sesión.
 */

/** Base por defecto del juego. Se crea con `npm run db:setup`. */
export const DEFAULT_DATABASE = 'triadvaults';

/**
 * @param {object} [overrides] p. ej. `{ database: 'postgres' }` para tareas
 *   administrativas que no pueden conectarse a la base que van a crear.
 */
export function buildPgConfig(overrides = {}) {
  const url = process.env.DATABASE_URL || process.env.POSTGRES_URL;

  // Con `DATABASE_URL` mandan la cadena y nada más: mezclarla con las variables
  // sueltas produce configuraciones a medias imposibles de depurar.
  const base = url
    ? { connectionString: url }
    : {
        user: process.env.DB_USERNAME || process.env.DB_USER || 'postgres',
        password: process.env.DB_PASSWORD || '',
        host: process.env.DB_HOST || '127.0.0.1',
        port: parseInt(process.env.DB_PORT || '5432', 10),
        database: process.env.DB_DATABASE || process.env.DB_NAME || DEFAULT_DATABASE
      };

  return { ...base, ...overrides };
}

/** Cómo describir la conexión en un log, sin filtrar la contraseña. */
export function describeTarget(config = buildPgConfig()) {
  if (config.connectionString) {
    try {
      const url = new URL(config.connectionString);
      return `${url.hostname}:${url.port || 5432}/${url.pathname.replace(/^\//, '')}`;
    } catch {
      return 'DATABASE_URL (no interpretable)';
    }
  }
  return `${config.host}:${config.port}/${config.database}`;
}

/** ¿Puede el servidor seguir adelante sin base de datos? */
export function databaseIsRequired() {
  if (process.env.DB_REQUIRED !== undefined) return process.env.DB_REQUIRED === 'true';
  return process.env.NODE_ENV === 'production';
}
