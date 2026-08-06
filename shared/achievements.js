/**
 * Motor de logros: reglas declarativas y su evaluador, compartidos por servidor y
 * cliente.
 *
 * Antes el catálogo era una lista fija en este fichero con un `check(ctx)` por
 * logro. Funcionaba, pero añadir un logro obligaba a publicar una versión nueva del
 * juego. Ahora el catálogo vive en la tabla `triad_achievements` y lo que queda aquí
 * es el **motor**: las métricas que se pueden mirar, los comparadores y el
 * evaluador. Añadir un logro es un `INSERT`; solo hace falta tocar código cuando se
 * quiere mirar una métrica que todavía no existe.
 *
 * Las condiciones son datos, no funciones. Guardar un `check` como texto y
 * ejecutarlo obligaría a `eval`, y eso convertiría una fila de la base de datos en
 * ejecución de código arbitraria dentro del servidor.
 *
 * Se conserva `DEFAULT_ACHIEVEMENTS` con dos usos: sembrar la tabla la primera vez y
 * servir de catálogo cuando se está corriendo sobre el respaldo JSON sin Postgres.
 *
 * @typedef {object} AchievementContext
 * @property {number} level          nivel recién superado
 * @property {number} maxLevel       nivel máximo alcanzado tras guardar
 * @property {number} puzzlesSolved  total acumulado de acertijos
 * @property {number} totalTimePlayed segundos jugados en total
 * @property {number} timeSpent      segundos empleados en este nivel
 * @property {number} playersCount   agentes en la sala
 * @property {number} deaths         caídas en este nivel
 * @property {number} damageTaken    daño recibido en este nivel
 * @property {boolean} flawless      superado sin recibir un solo golpe
 *
 * @typedef {object} AchievementCondition
 * @property {string} metric  clave de {@link METRICS}
 * @property {string} op      clave de {@link COMPARATORS}
 * @property {number} value   umbral
 *
 * @typedef {object} AchievementDefinition
 * @property {string} key
 * @property {string} icon
 * @property {{es: string, en: string}} title
 * @property {{es: string, en: string}} description
 * @property {AchievementCondition[]} conditions
 * @property {string} [steamApiName] logro equivalente en Steamworks, si lo hay
 * @property {number} [sortOrder]
 * @property {boolean} [enabled]
 */

/**
 * Métricas que una condición puede mirar.
 *
 * Es la lista que limita lo que se puede expresar desde la base de datos, y por eso
 * es la que hay que ampliar —junto con quien la calcula, en el manejador de nivel
 * completado— para desbloquear tipos de logro nuevos.
 */
export const METRICS = {
  level: 'nivel recién superado',
  maxLevel: 'nivel máximo alcanzado',
  puzzlesSolved: 'acertijos resueltos en total',
  totalTimePlayed: 'segundos jugados en total',
  timeSpent: 'segundos en este nivel',
  playersCount: 'agentes en la sala',
  deaths: 'caídas en este nivel',
  damageTaken: 'daño recibido en este nivel',
  // Los booleanos entran como 1 o 0, así que se comparan igual que el resto:
  // `flawless >= 1`. Un solo tipo de condición evita tener dos evaluadores.
  flawless: 'superado sin recibir daño (1 o 0)'
};

export const COMPARATORS = {
  '>=': (a, b) => a >= b,
  '<=': (a, b) => a <= b,
  '>': (a, b) => a > b,
  '<': (a, b) => a < b,
  '==': (a, b) => a === b
};

/** Iconos que la interfaz sabe dibujar para un logro. Ver `src/ui/icons.js`. */
export const ACHIEVEMENT_ICONS = ['bolt', 'trophy', 'shield', 'user', 'hint', 'doc'];

/** Icono de reserva: una fila con un icono desconocido se pinta, no desaparece. */
export const FALLBACK_ICON = 'trophy';

const MAX_KEY_LENGTH = 50;
const KEY_PATTERN = /^[a-z0-9_]+$/;

/**
 * Formato del "API Name" de un logro en Steamworks: mayúsculas, dígitos y guion bajo.
 * Steam no valida nada al recibirlo —un nombre que no exista allí se descarta en
 * silencio— así que el formato se comprueba aquí o no se comprueba en ningún sitio.
 */
const STEAM_NAME_PATTERN = /^[A-Z0-9_]{1,64}$/;

/**
 * Catálogo inicial. Siembra la tabla la primera vez y hace de catálogo cuando no
 * hay Postgres. A partir de la siembra, la fuente de verdad es la base de datos.
 */
export const DEFAULT_ACHIEVEMENTS = [
  {
    key: 'first_escape',
    steamApiName: 'FIRST_ESCAPE',
    icon: 'bolt',
    sortOrder: 10,
    title: { es: 'Primera Fuga', en: 'First Escape' },
    description: { es: 'Supera tu primera bóveda.', en: 'Clear your first vault.' },
    conditions: [{ metric: 'puzzlesSolved', op: '>=', value: 1 }]
  },
  {
    key: 'level_10',
    steamApiName: 'LEVEL_10',
    icon: 'trophy',
    sortOrder: 20,
    title: { es: 'Agente de Campo', en: 'Field Agent' },
    description: { es: 'Alcanza el nivel 10.', en: 'Reach level 10.' },
    conditions: [{ metric: 'maxLevel', op: '>=', value: 10 }]
  },
  {
    key: 'level_25',
    steamApiName: 'LEVEL_25',
    icon: 'trophy',
    sortOrder: 30,
    title: { es: 'Operativo Veterano', en: 'Veteran Operative' },
    description: { es: 'Alcanza el nivel 25.', en: 'Reach level 25.' },
    conditions: [{ metric: 'maxLevel', op: '>=', value: 25 }]
  },
  {
    key: 'level_50',
    steamApiName: 'LEVEL_50',
    icon: 'trophy',
    sortOrder: 40,
    title: { es: 'Leyenda de la Bóveda', en: 'Vault Legend' },
    description: { es: 'Alcanza el nivel 50.', en: 'Reach level 50.' },
    conditions: [{ metric: 'maxLevel', op: '>=', value: 50 }]
  },
  {
    key: 'flawless',
    steamApiName: 'FLAWLESS',
    icon: 'shield',
    sortOrder: 50,
    title: { es: 'Intachable', en: 'Untouched' },
    description: {
      es: 'Supera una bóveda sin recibir un solo golpe.',
      en: 'Clear a vault without taking a single hit.'
    },
    conditions: [{ metric: 'flawless', op: '>=', value: 1 }]
  },
  {
    key: 'speedrun',
    steamApiName: 'SPEEDRUN',
    icon: 'bolt',
    sortOrder: 60,
    title: { es: 'Contrarreloj', en: 'Against the Clock' },
    description: {
      es: 'Supera una bóveda en menos de 60 segundos.',
      en: 'Clear a vault in under 60 seconds.'
    },
    // El `> 0` descarta el cronómetro que no llegó a arrancar. Las condiciones se
    // acumulan con Y lógico, que es lo que permite expresar un intervalo.
    conditions: [
      { metric: 'timeSpent', op: '>', value: 0 },
      { metric: 'timeSpent', op: '<', value: 60 }
    ]
  },
  {
    key: 'full_squad',
    steamApiName: 'FULL_SQUAD',
    icon: 'user',
    sortOrder: 70,
    title: { es: 'Escuadrón Completo', en: 'Full Squad' },
    description: {
      es: 'Supera una bóveda con los 3 agentes.',
      en: 'Clear a vault with all 3 agents.'
    },
    conditions: [{ metric: 'playersCount', op: '>=', value: 3 }]
  },
  {
    key: 'centurion',
    steamApiName: 'CENTURION',
    icon: 'trophy',
    sortOrder: 80,
    title: { es: 'Centurión', en: 'Centurion' },
    description: { es: 'Resuelve 100 acertijos.', en: 'Solve 100 puzzles.' },
    conditions: [{ metric: 'puzzlesSolved', op: '>=', value: 100 }]
  },
  {
    key: 'survivor',
    steamApiName: 'SURVIVOR',
    icon: 'shield',
    sortOrder: 90,
    title: { es: 'Superviviente', en: 'Survivor' },
    description: {
      es: 'Supera una bóveda tras caer al menos 3 veces en ella.',
      en: 'Clear a vault after falling at least 3 times in it.'
    },
    conditions: [{ metric: 'deaths', op: '>=', value: 3 }]
  }
];

// ------------------------------------------------------------------ validación

/**
 * Comprueba una definición del catálogo.
 *
 * Es la red que sustituye a la revisión de código que había cuando el catálogo era
 * un fichero. Una fila con una métrica mal escrita no fallaría al insertarse: el
 * logro simplemente no se concedería nunca y nadie se enteraría.
 *
 * Se distinguen dos gravedades, y la diferencia importa:
 *
 * - **`errors`** impiden evaluar el logro. El repositorio descarta esas filas al
 *   cargar, porque un logro que no se puede evaluar no puede conceder nada.
 * - **`warnings`** no tocan la evaluación: un icono desconocido se dibuja con el de
 *   reserva, y un nombre de Steam mal formado solo rompe el reflejo en Steam. Tirar
 *   el logro entero por eso sería quitarle al jugador algo que sí funciona.
 *
 * `npm run validate:achievements` falla con las dos: en la máquina de quien lo
 * mantiene, ambas son erratas que hay que corregir.
 *
 * @param {AchievementDefinition} definition
 * @returns {{valid: boolean, errors: string[], warnings: string[]}}
 */
export function validateDefinition(definition) {
  const errors = [];
  const warnings = [];
  const def = definition || {};

  if (typeof def.key !== 'string' || !KEY_PATTERN.test(def.key)) {
    errors.push('la clave debe ser texto en minúsculas, dígitos o guion bajo');
  } else if (def.key.length > MAX_KEY_LENGTH) {
    errors.push(`la clave supera los ${MAX_KEY_LENGTH} caracteres`);
  }

  if (!def.title || !def.title.es) errors.push('falta el título en español');
  if (!def.description || !def.description.es) errors.push('falta la descripción en español');

  if (def.icon && !ACHIEVEMENT_ICONS.includes(def.icon)) {
    warnings.push(`icono "${def.icon}" desconocido: se dibujará "${FALLBACK_ICON}"`);
  }

  if (def.steamApiName && !STEAM_NAME_PATTERN.test(def.steamApiName)) {
    warnings.push(
      `nombre de Steam "${def.steamApiName}" mal formado (mayúsculas, dígitos y _): ` +
        'el logro funciona, pero no se reflejará en Steam'
    );
  }

  if (!Array.isArray(def.conditions) || def.conditions.length === 0) {
    errors.push('hacen falta una o más condiciones');
  } else {
    def.conditions.forEach((condition, index) => {
      const where = `condición ${index + 1}`;
      if (!condition || !Object.hasOwn(METRICS, condition.metric)) {
        errors.push(`${where}: métrica "${condition?.metric}" desconocida`);
      }
      if (!condition || !Object.hasOwn(COMPARATORS, condition.op)) {
        errors.push(`${where}: comparador "${condition?.op}" desconocido`);
      }
      if (!Number.isFinite(Number(condition?.value))) {
        errors.push(`${where}: el umbral debe ser numérico`);
      }
    });
  }

  return { valid: errors.length === 0, errors, warnings };
}

// ------------------------------------------------------------------ evaluación

/** Valor numérico de una métrica en el contexto. Los booleanos entran como 1 o 0. */
function readMetric(context, metric) {
  const raw = context[metric];
  if (typeof raw === 'boolean') return raw ? 1 : 0;
  const num = Number(raw);
  return Number.isFinite(num) ? num : 0;
}

/**
 * ¿Se cumplen todas las condiciones de un logro?
 * @param {AchievementDefinition} definition
 * @param {AchievementContext} context
 */
export function matchesConditions(definition, context) {
  const conditions = definition?.conditions;
  // Sin condiciones se devolvería `true` por vacuidad y el logro se regalaría a
  // todo el mundo en el primer nivel. Una fila rota no puede conceder nada.
  if (!Array.isArray(conditions) || conditions.length === 0) return false;

  return conditions.every(condition => {
    const compare = COMPARATORS[condition.op];
    if (!compare || !Object.hasOwn(METRICS, condition.metric)) return false;
    return compare(readMetric(context, condition.metric), Number(condition.value));
  });
}

/**
 * Logros que este contexto desbloquea y que el agente aún no tenía.
 *
 * El catálogo se recibe como parámetro en lugar de leerse de una variable de módulo:
 * viene de la base de datos y cambia sin reiniciar, y así la función sigue siendo
 * pura y comprobable sin montar nada.
 *
 * @param {AchievementContext} context
 * @param {AchievementDefinition[]} catalog
 * @param {Set<string>|string[]} owned claves ya desbloqueadas
 * @returns {string[]} claves nuevas
 */
export function evaluateAchievements(context, catalog = DEFAULT_ACHIEVEMENTS, owned = []) {
  const already = owned instanceof Set ? owned : new Set(owned);

  return catalog
    .filter(definition => {
      if (definition.enabled === false) return false;
      if (already.has(definition.key)) return false;
      try {
        return matchesConditions(definition, context);
      } catch {
        // Un logro mal definido no debe impedir que se concedan los demás ni
        // tumbar el guardado de progreso que lo invoca.
        return false;
      }
    })
    .map(definition => definition.key);
}

// -------------------------------------------------------------------- lectura

/** Texto e icono de un logro en el idioma pedido, con respaldo en español. */
export function achievementText(definition, lang = 'es') {
  if (!definition) return null;

  return {
    key: definition.key,
    icon: ACHIEVEMENT_ICONS.includes(definition.icon) ? definition.icon : FALLBACK_ICON,
    title: definition.title?.[lang] || definition.title?.es || definition.key,
    description: definition.description?.[lang] || definition.description?.es || ''
  };
}

/** Orden de presentación: `sortOrder` y, a igualdad, la clave. */
export function sortCatalog(catalog = []) {
  return [...catalog].sort(
    (a, b) => (a.sortOrder ?? 100) - (b.sortOrder ?? 100) || a.key.localeCompare(b.key)
  );
}
