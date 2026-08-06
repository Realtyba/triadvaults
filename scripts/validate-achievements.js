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
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  DEFAULT_ACHIEVEMENTS,
  METRICS,
  validateDefinition,
  evaluateAchievements
} from '../shared/achievements.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Vectores dorados compartidos con el servidor.
 *
 * El fichero vive en realtyba-api y lo consumen los dos motores: el de PHP
 * (AchievementEvaluatorTest) y el de aquí. Es lo que impide que se separen — y esa
 * divergencia es la peor de las posibles, porque no rompe nada: el jugador ve
 * desbloquearse un logro sin conexion y al sincronizar el servidor no se lo da.
 */
const VECTORS_FILE = path.join(
  ROOT,
  '..',
  'realtyba-api',
  'tests',
  'Fixtures',
  'TriadVaults',
  'achievement_vectors.json'
);

/** Catálogo de la API de cuentas, si está levantada. Ver checkLiveCatalog(). */
const API_URL = (process.env.TRIADVAULTS_API_URL || '').replace(/\/+$/, '');

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

/**
 * Los mismos vectores que corre el motor de PHP, contra el motor de JavaScript.
 *
 * Si este bloque falla, los dos evaluadores han dejado de coincidir y hay que mirar
 * cuál de los dos se movió antes de publicar nada.
 */
function checkGoldenVectors() {
  console.log('▸ vectores dorados (paridad con el motor de PHP)');

  if (!fs.existsSync(VECTORS_FILE)) {
    console.log(`  ⚠ no se encontró ${VECTORS_FILE}: no se ha comprobado la paridad.`);
    return;
  }

  const before = failures;
  const { vectors } = JSON.parse(fs.readFileSync(VECTORS_FILE, 'utf-8'));

  for (const vector of vectors) {
    const got = evaluateAchievements(vector.context, DEFAULT_ACHIEVEMENTS, vector.owned).sort();
    const want = [...vector.expected].sort();

    if (got.join(',') !== want.join(',')) {
      fail(`"${vector.name}": se esperaba [${want}] y se obtuvo [${got}]`);
    }
  }

  if (failures === before) {
    console.log(`  ✓ los ${vectors.length} vectores coinciden con lo que espera el servidor`);
  }
}

/**
 * Catálogo vivo, leído de la API de cuentas.
 *
 * Solo se puede comprobar lo que el endpoint público expone: claves, iconos y
 * nombres de Steam. Las CONDICIONES no viajan al cliente a propósito, así que la
 * comprobación de que se pueden cumplir ya no se hace aquí — la hace Laravel al
 * escribir, en AchievementAdminController, que es un sitio mejor: allí es
 * imposible guardar una definición rota, en lugar de descubrirlo al correr esto.
 */
async function checkLiveCatalog() {
  console.log('▸ catálogo vivo en la API de cuentas');

  if (!API_URL) {
    console.log('  ⚠ sin TRIADVAULTS_API_URL: solo se ha comprobado el catálogo de salida.');
    return;
  }

  let catalog;
  try {
    const res = await fetch(`${API_URL}/triadvaults/achievements`, {
      signal: AbortSignal.timeout(5000)
    });
    if (!res.ok) throw new Error(`respondió ${res.status}`);
    ({ catalog } = await res.json());
  } catch (err) {
    console.log(`  ⚠ no se pudo consultar (${err.message}): solo se ha comprobado el catálogo de salida.`);
    return;
  }

  const before = failures;

  if (!Array.isArray(catalog) || catalog.length === 0) {
    fail('el catálogo vivo está vacío: nadie podría desbloquear nada');
    return;
  }

  const seen = new Set();
  for (const definition of catalog) {
    if (seen.has(definition.key)) fail(`"${definition.key}": clave duplicada en el catálogo vivo`);
    seen.add(definition.key);

    // Se valida sin `conditions`, que no viajan: solo lo que sí llega.
    const { warnings } = validateDefinition({ ...definition, conditions: [{ metric: 'level', op: '>=', value: 1 }] });
    warnings.forEach(w => fail(`"${definition.key}" (vivo): ${w}`));
  }

  if (failures === before) {
    console.log(`  ✓ las ${catalog.length} definiciones vivas se pueden pintar y reflejar en Steam`);
  }
}

checkGoldenVectors();
console.log('');

await checkLiveCatalog();

console.log('');
console.log(failures === 0 ? '✓ Catálogo de logros correcto.' : `✗ ${failures} problema(s).`);
process.exit(failures === 0 ? 0 : 1);
