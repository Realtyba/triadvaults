#!/usr/bin/env node
/**
 * Comprueba que las definiciones de logros se pueden evaluar y se pueden cumplir.
 *
 * Mover el catálogo a la base de datos quitó de en medio la revisión de código que
 * antes cazaba estos fallos. Una fila con la métrica mal escrita, o con condiciones
 * que se contradicen, se inserta sin protestar y el logro no se concede nunca: no
 * hay error, no hay aviso, simplemente nadie lo desbloquea jamás. Este script es lo
 * que sustituye a esa revisión.
 *
 * Se valida el catálogo de salida siempre, y el vivo en Postgres cuando hay conexión.
 *
 * Uso: node scripts/validate-achievements.js
 */
import 'dotenv/config';
import {
  DEFAULT_ACHIEVEMENTS,
  METRICS,
  validateDefinition
} from '../shared/achievements.js';
import { initDatabase, closeDatabase } from '../server/db/pool.js';
import { loadCatalogReport } from '../server/db/achievements.repo.js';

let failures = 0;

function fail(message) {
  console.error(`  ✗ ${message}`);
  failures++;
}

/**
 * ¿Existe algún valor que cumpla todas las condiciones sobre una misma métrica?
 *
 * Se resuelve con el intervalo que dejan las condiciones: `timeSpent > 60` junto a
 * `timeSpent < 10` no lo cumple ningún número, y sin esta comprobación sería un
 * logro perfectamente válido para el evaluador que nunca se concedería.
 */
function isSatisfiable(conditions) {
  const byMetric = new Map();
  for (const c of conditions) {
    if (!byMetric.has(c.metric)) byMetric.set(c.metric, []);
    byMetric.get(c.metric).push(c);
  }

  for (const [metric, list] of byMetric) {
    let low = -Infinity;
    let lowOpen = false;
    let high = Infinity;
    let highOpen = false;
    let equals = null;

    for (const { op, value } of list) {
      const v = Number(value);
      if (op === '>=' && v > low) [low, lowOpen] = [v, false];
      else if (op === '>' && v >= low) [low, lowOpen] = [v, true];
      else if (op === '<=' && v < high) [high, highOpen] = [v, false];
      else if (op === '<' && v <= high) [high, highOpen] = [v, true];
      else if (op === '==') {
        if (equals !== null && equals !== v) return { ok: false, metric };
        equals = v;
      }
    }

    if (equals !== null) {
      const inLow = lowOpen ? equals > low : equals >= low;
      const inHigh = highOpen ? equals < high : equals <= high;
      if (!inLow || !inHigh) return { ok: false, metric };
      continue;
    }

    if (low > high) return { ok: false, metric };
    // Con los dos extremos abiertos y pegados no queda hueco (`>5` y `<5`), y con
    // uno abierto e iguales tampoco (`>5` y `<=5`).
    if (low === high && (lowOpen || highOpen)) return { ok: false, metric };
  }

  return { ok: true };
}

function checkCatalog(label, catalog) {
  console.log(`▸ ${label} (${catalog.length} definiciones)`);

  if (catalog.length === 0) {
    fail('el catálogo está vacío: nadie podría desbloquear nada');
    return;
  }

  // Se cuentan los fallos de ESTE catálogo. Con el contador global, el segundo
  // bloque no habría dicho nunca "correcto" en cuanto el primero fallara una vez.
  const before = failures;

  const seen = new Set();
  for (const definition of catalog) {
    const { valid, errors, warnings } = validateDefinition(definition);

    // El servidor sigue adelante con un aviso —el logro se puede evaluar igual—,
    // pero aquí cuenta como fallo: esto lo ejecuta quien mantiene el catálogo, y un
    // nombre de Steam mal escrito no da ninguna otra señal de que está mal.
    warnings.forEach(w => fail(`"${definition.key}": ${w}`));

    if (!valid) {
      fail(`"${definition.key}": ${errors.join('; ')}`);
      continue;
    }

    if (seen.has(definition.key)) fail(`"${definition.key}": clave duplicada`);
    seen.add(definition.key);

    const satisfiable = isSatisfiable(definition.conditions);
    if (!satisfiable.ok) {
      fail(`"${definition.key}": las condiciones sobre "${satisfiable.metric}" se contradicen`);
    }
  }

  if (failures === before) console.log('  ✓ todas se pueden evaluar, cumplir y reflejarse en Steam');
}

console.log('Catálogo de logros\n');
console.log(`Métricas disponibles: ${Object.keys(METRICS).join(', ')}\n`);

checkCatalog('catálogo de salida (paquete del juego)', DEFAULT_ACHIEVEMENTS);
console.log('');

// El catálogo vivo solo se puede comprobar si hay base de datos. Sin ella el script
// no falla —`npm run validate` tiene que poder correr en una máquina sin Postgres—
// pero lo dice, para que nadie lo lea como un visto bueno del catálogo real.
const connected = await initDatabase();
if (connected) {
  const { catalog, problems, source } = await loadCatalogReport();
  problems.forEach(p => fail(`"${p.key}" (en ${source}): ${p.errors.join('; ')}`));
  checkCatalog('catálogo vivo en Postgres', catalog);
  await closeDatabase();
} else {
  console.log('▸ catálogo vivo en Postgres');
  console.log('  ⚠ sin conexión: solo se ha comprobado el catálogo de salida.');
}

console.log('');
console.log(failures === 0 ? '✓ Catálogo de logros correcto.' : `✗ ${failures} problema(s).`);
process.exit(failures === 0 ? 0 : 1);
