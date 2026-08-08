#!/usr/bin/env node
/**
 * Baja los modelos 3D a `public/models/`.
 *
 * Los `.glb` no viven en el repositorio: se declaran en `src/assets/manifest.js` y se
 * traen con esto. El porqué está en la cabecera de ese fichero.
 *
 * **El juego funciona sin ejecutar este script**: `AssetLoader` cae a la geometría
 * primitiva de siempre. Esto es una mejora del aspecto, no un requisito para arrancar,
 * y por eso no está enganchado a `predev` ni a `prebuild` — nadie debería quedarse sin
 * poder ejecutar el juego porque su red esté caída.
 *
 * Uso:
 *   node scripts/fetch-assets.mjs          descarga lo que falte
 *   node scripts/fetch-assets.mjs --force  vuelve a bajarlo todo
 */
import { createWriteStream } from 'node:fs';
import { mkdir, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

import { PLAYER_MODELS } from '../src/assets/manifest.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const TARGET = join(ROOT, 'public', 'models');

const force = process.argv.includes('--force');

/** Margen sobre el tamaño esperado. La fuente puede recomprimir sin cambiar el modelo. */
const SIZE_TOLERANCE = 0.15;

/** Los ocho primeros bytes de un GLB: la palabra `glTF` y la versión 2. */
const GLB_MAGIC = 0x46546c67;

async function alreadyThere(path, expectedBytes) {
  try {
    const info = await stat(path);
    // Un fichero cortado a media descarga existe pero no sirve; se vuelve a bajar.
    return Math.abs(info.size - expectedBytes) <= expectedBytes * SIZE_TOLERANCE;
  } catch {
    return false;
  }
}

/**
 * Comprueba que lo bajado es un GLB y no una página de error.
 *
 * Merece la pena porque el fallo típico —un 404 o un portal cautivo de wifi— devuelve
 * un 200 con HTML dentro. Sin esta comprobación, el fichero se guarda tan tranquilo y
 * el error aparece mucho después, en el navegador, como un mensaje del cargador de glTF
 * que no menciona la descarga por ninguna parte.
 */
async function verify(path) {
  const { open } = await import('node:fs/promises');
  const handle = await open(path, 'r');
  try {
    const buffer = Buffer.alloc(8);
    await handle.read(buffer, 0, 8, 0);
    if (buffer.readUInt32LE(0) !== GLB_MAGIC) throw new Error('no es un fichero GLB');
    if (buffer.readUInt32LE(4) !== 2) throw new Error('GLB de una versión que no es la 2');
  } finally {
    await handle.close();
  }
}

async function download(model) {
  const path = join(TARGET, model.file);

  if (!force && (await alreadyThere(path, model.bytes))) {
    console.log(`  · ${model.file} ya estaba`);
    return;
  }

  const response = await fetch(model.url, { redirect: 'follow' });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);

  await pipeline(Readable.fromWeb(response.body), createWriteStream(path));

  try {
    await verify(path);
  } catch (err) {
    // Un GLB corrupto en disco es peor que ninguno: el cargador falla en el navegador
    // en vez de caer al fallback, así que se borra y el juego usa las primitivas.
    await rm(path, { force: true });
    throw err;
  }

  const { size } = await stat(path);
  console.log(`  ✓ ${model.file} (${(size / 1024).toFixed(0)} KB)`);
}

/** Deja por escrito de dónde salió cada cosa. CC0 no lo exige; la trazabilidad sí. */
async function writeCredits() {
  const rows = PLAYER_MODELS.map(
    m => `| \`${m.file}\` | ${m.author} | ${m.license} | ${m.source} |`
  ).join('\n');

  const body = `# Créditos de los modelos

Generado por \`scripts/fetch-assets.mjs\`. **No se edita a mano**: la lista buena está en
\`src/assets/manifest.js\`.

Todo lo de aquí es **CC0** (dominio público): se puede usar en proyectos personales,
educativos y comerciales, y no obliga a atribuir. Esta tabla existe igualmente para que
dentro de dos años se sepa de dónde salió cada fichero y bajo qué condiciones, que es
justo lo que no se puede reconstruir mirando un binario.

| Fichero | Autor | Licencia | Origen |
|---|---|---|---|
${rows}

## Si hace falta que pesen menos

Los modelos vienen con once animaciones y el juego usa cuatro (idle, andar, correr,
morir). Podar las otras siete es lo que más recorta, y se hace sin añadir ninguna
dependencia al proyecto:

\`\`\`bash
npx --yes @gltf-transform/cli optimize public/models/agent-1.glb public/models/agent-1.glb
\`\`\`

No está automatizado a propósito: es una herramienta externa que se descargaría en cada
ejecución, y hoy el tamaño no es el cuello de botella.
`;

  await writeFile(join(TARGET, 'CREDITS.md'), body);
}

console.log('\nModelos 3D → public/models/\n');

await mkdir(TARGET, { recursive: true });

let failures = 0;
for (const model of PLAYER_MODELS) {
  try {
    await download(model);
  } catch (err) {
    console.error(`  ✗ ${model.file}: ${err.message}`);
    failures++;
  }
}

await writeCredits();

if (failures > 0) {
  console.error(
    `\n⚠️  ${failures} modelo(s) sin bajar. El juego arranca igual, con los agentes de` +
      ' geometría primitiva.\n'
  );
  process.exit(1);
}

console.log('\n✅ Modelos listos.\n');
