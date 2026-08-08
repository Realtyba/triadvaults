#!/usr/bin/env node
/**
 * Comprueba que el manifest de modelos es coherente y que `CREDITS.md` está al día.
 *
 * No existía, y el manifest ha pasado de tres entradas de una sola forma a catorce con
 * media docena de campos opcionales. Nada más lo mira: `fetch-assets.mjs` valida la
 * *descarga* —cabecera GLB, tamaño— pero no que lo declarado tenga sentido, y un `fit`
 * olvidado o un `file` que no existe se manifiestan como una pieza deformada o ausente en
 * mitad de una partida, que es el peor sitio para enterarse.
 *
 * Corre dentro de `npm run validate`, sin navegador y sin red.
 */
import { readFile, readdir } from 'node:fs/promises';
import { stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  PLAYER_MODELS,
  PROP_MODELS,
  PUZZLE_MODELS,
  GHOST_MODEL,
  allModels
} from '../src/assets/manifest.js';
import { creditsBody } from './lib/credits.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const TARGET = join(ROOT, 'public', 'models');

/** El mismo margen que usa `fetch-assets.mjs`. La fuente puede recomprimir sin cambiar el modelo. */
const SIZE_TOLERANCE = 0.15;

const errors = [];
const warnings = [];

const fail = message => errors.push(message);
const warn = message => warnings.push(message);

// ------------------------------------------------------------------ el manifest

const seen = new Set();

for (const model of allModels()) {
  const name = model.file || '(sin `file`)';

  if (!model.file) fail('hay una entrada sin `file`');
  else if (seen.has(model.file)) fail(`${name}: declarado dos veces`);
  seen.add(model.file);

  // O se puede bajar, o se declara que no hay de dónde. La tercera opción —`file` y
  // `bytes` sin `url`— parecía funcionar y era la trampa: `alreadyThere` la deja pasar
  // mientras el tamaño cuadre, y el día que no cuadra intenta `fetch(undefined)` y aborta
  // la ejecución entera con un `Failed to parse URL` que no menciona el modelo.
  if (!model.local && !model.url) {
    fail(`${name}: sin \`url\` y sin \`local: true\`; no hay forma de conseguirlo`);
  }
  if (!model.local && !model.bytes) {
    fail(`${name}: con \`url\` pero sin \`bytes\`; no se puede detectar una descarga cortada`);
  }

  if (model.unverified) {
    warn(`${name}: procedencia sin registrar. No se puede afirmar bajo qué licencia está.`);
  } else if (!model.author || !model.license || !model.source) {
    fail(`${name}: falta autor, licencia u origen (o márcalo \`unverified: true\`)`);
  }

  if (model.drop && !Array.isArray(model.drop)) fail(`${name}: \`drop\` debe ser una lista`);
}

// `fit` sólo tiene sentido en lo que no es un personaje: los agentes y el fantasma se
// normalizan por su altura, que es la medida que tiene que casar con el juego.
for (const model of [...PROP_MODELS, ...Object.values(PUZZLE_MODELS).filter(Boolean)]) {
  if (typeof model.fit !== 'number' || !(model.fit > 0)) {
    fail(`${model.file}: \`fit\` debe ser un número positivo (tamaño de su dimensión mayor)`);
  }
}

for (const model of PROP_MODELS) {
  if (model.weight !== undefined && (typeof model.weight !== 'number' || model.weight < 0)) {
    fail(`${model.file}: \`weight\` debe ser un número >= 0`);
  }
}

if (PLAYER_MODELS.length === 0) fail('`PLAYER_MODELS` está vacío: no habría agentes');
if (GHOST_MODEL && !GHOST_MODEL.file) fail('`GHOST_MODEL` sin `file`');

// ------------------------------------------------------------------- los ficheros

// Un clon recién hecho legítimamente no tiene ninguno: toda la arquitectura está montada
// sobre que el juego arranque sin ellos. Sólo se comprueba si hay alguno.
let present = [];
try {
  present = (await readdir(TARGET)).filter(file => file.endsWith('.glb'));
} catch {
  present = [];
}

if (present.length === 0) {
  warn('no hay ningún `.glb` en `public/models/`: el juego arrancará con geometría primitiva');
} else {
  for (const model of allModels()) {
    const path = join(TARGET, model.file);
    let info = null;
    try {
      info = await stat(path);
    } catch {
      const from = model.origin
        ? `assets-src/ultimate-space-kit-glb/${model.origin}`
        : '<el original que le corresponda>';
      fail(`${model.file}: declarado pero no está. Repónlo con:\n      cp "${from}" public/models/${model.file}`);
      continue;
    }

    if (model.bytes && Math.abs(info.size - model.bytes) > model.bytes * SIZE_TOLERANCE) {
      fail(
        `${model.file}: pesa ${info.size} B y el manifest dice ${model.bytes} B ` +
          '(fuera del margen del 15 %: o está cortado, o hay que actualizar `bytes`)'
      );
    }
  }

  const declared = new Set(allModels().map(model => model.file));
  for (const file of present) {
    if (!declared.has(file)) warn(`${file}: está en \`public/models/\` pero no lo usa nadie`);
  }
}

// -------------------------------------------------------------------- los créditos

try {
  const onDisk = await readFile(join(TARGET, 'CREDITS.md'), 'utf8');
  if (onDisk !== creditsBody()) {
    fail('`CREDITS.md` no coincide con el manifest. Ejecuta `npm run assets`.');
  }
} catch {
  fail('falta `public/models/CREDITS.md`. Ejecuta `npm run assets`.');
}

// ------------------------------------------------------------------------ informe

console.log(`\nModelos declarados: ${allModels().length}`);
console.log(`Ficheros en disco : ${present.length}\n`);

warnings.forEach(message => console.warn(`  ⚠️  ${message}`));
errors.forEach(message => console.error(`  ✗ ${message}`));

if (errors.length > 0) {
  console.error(`\n✗ ${errors.length} problema(s) en el manifest de modelos.\n`);
  process.exit(1);
}

console.log(warnings.length > 0 ? '\n✓ Manifest coherente (con avisos).\n' : '\n✓ Manifest coherente.\n');
