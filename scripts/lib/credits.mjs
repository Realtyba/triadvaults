import { allModels } from '../../src/assets/manifest.js';

/**
 * El texto de `public/models/CREDITS.md`, generado desde el manifest.
 *
 * Vive aparte de `fetch-assets.mjs` porque lo necesitan dos: el script que lo escribe y
 * `validate-assets.js`, que comprueba que lo escrito siga coincidiendo con el manifest.
 * Duplicar la plantilla sería garantizar que un día dejen de decir lo mismo.
 *
 * **Esta tabla es el documento de correspondencia** entre el nombre que usa el juego y la
 * pieza original del pack. No hay un `.md` mantenido a mano en paralelo: lo que se edita
 * es el campo `origin` del manifest, y esto se regenera.
 */
const UNKNOWN = '*sin registrar*';

const cell = value => (value ? String(value) : UNKNOWN);

export function creditsBody() {
  const rows = allModels()
    .map(model => [
      `\`${model.file}\``,
      model.origin ? `\`${model.origin}\`` : UNKNOWN,
      cell(model.pack),
      cell(model.author),
      cell(model.license),
      cell(model.source)
    ].join(' | '))
    .map(row => `| ${row} |`)
    .join('\n');

  const unverified = allModels().filter(model => model.unverified);
  const warning = unverified.length === 0
    ? ''
    : `
> ⚠️ **${unverified.length} fichero(s) sin procedencia registrada**: ` +
      unverified.map(m => `\`${m.file}\``).join(', ') +
      `.
> Aparecieron en \`public/models/\` sin dejar rastro de su origen, y eso no se puede
> reconstruir mirando un binario. Mientras siga así, lo honesto es no afirmar bajo qué
> licencia están: o se localiza la fuente y se anota en el manifest, o se sustituyen por
> piezas de un pack conocido.
`;

  return `# Créditos de los modelos

Generado por \`scripts/fetch-assets.mjs\`. **No se edita a mano**: la lista buena está en
\`src/assets/manifest.js\`, y \`npm run validate:assets\` falla si esto se queda atrás.

Casi todo sale del mismo pack, y no es casualidad: sus 81 piezas comparten **un único
atlas de 512×512 byte a byte idéntico**, y eso es lo que permite dibujar todo el atrezo de
una sala en una sola llamada. Ver \`src/engine/mergedModel.js\`.

Lo marcado como **CC0** es dominio público: se puede usar en proyectos personales,
educativos y comerciales, y no obliga a atribuir. Esta tabla existe igualmente para que
dentro de dos años se sepa de dónde salió cada fichero y bajo qué condiciones, que es
justo lo que no se puede reconstruir mirando un binario.
${warning}
| Fichero | Pieza original | Pack | Autor | Licencia | Origen |
|---|---|---|---|---|---|
${rows}

## Estos ficheros no se descargan

El pack se baja entero de su página, no pieza a pieza, así que sus entradas van marcadas
\`local: true\` y sin \`url\`: \`npm run assets\` comprueba que estén y avisa si falta
alguna, pero no intenta traerlas. Los originales, con su nombre de origen, están en
\`assets-src/ultimate-space-kit-glb/\` —fuera de \`public/\`, que se copia entera al build
de Vite y al paquete de Electron—.

Si falta un fichero, el mensaje de error trae el \`cp\` exacto que lo repone.

## Si hace falta que pesen menos

Los agentes traen dieciocho animaciones y el juego usa cuatro (idle, andar, correr, morir);
el fantasma trae catorce y usa tres. Podar el resto es lo que más recorta, y se hace sin
añadir ninguna dependencia al proyecto:

\`\`\`bash
npx --yes @gltf-transform/cli optimize public/models/agent-1.glb public/models/agent-1.glb
\`\`\`

Si además el fotograma se resiente en un móvil, la palanca es la densidad de malla y no el
número de modelos: un agente ocupa unos veinte píxeles de alto y llega con 8 400 triángulos.

\`\`\`bash
npx --yes @gltf-transform/cli optimize public/models/agent-1.glb public/models/agent-1.glb \\
  --simplify-error 0.002
\`\`\`

No está automatizado a propósito: es una herramienta externa que se descargaría en cada
ejecución, y hoy el tamaño no es el cuello de botella. Ojo con una cosa: como estos
ficheros no se vuelven a descargar, **podar es irreversible** salvo volviendo a copiar el
original desde \`assets-src/\`.
`;
}
