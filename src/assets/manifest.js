/**
 * Qué modelos usa el juego y de dónde salen.
 *
 * Lo comparten el cliente (`engine/AssetLoader.js`) y el script de descarga
 * (`scripts/fetch-assets.mjs`) para que no haya dos listas que se desincronicen: si
 * alguien añade un modelo aquí, el script sabe traerlo y el juego sabe pedirlo.
 *
 * ## Los ficheros no están en el repositorio
 *
 * Los `.glb` los baja `npm run assets`. Van en `.gitignore` por lo de siempre con los
 * binarios —cada versión se guarda entera y el historial engorda para siempre— y
 * porque su fuente es externa y con licencia propia: es más honesto apuntar a ella que
 * copiarla sin rastro.
 *
 * **El juego tiene que arrancar sin ellos.** `AssetLoader` cae a la geometría primitiva
 * de siempre si un fichero falta o falla, igual que el arranque sobrevive a que no esté
 * `steamworks.js`. Quien clone el repositorio y ejecute `npm run dev` sin más debe poder
 * jugar; lo que verá son los agentes de cilindro y cubo.
 */

/** Altura a la que se normaliza cualquier modelo de agente, en unidades de mundo. */
export const PLAYER_HEIGHT = 1.7;

/**
 * Nombres de clip que busca el reproductor de animación, por estado.
 *
 * Se comparan sin distinguir mayúsculas y **por contenido**, no por igualdad: los
 * clips de estos packs llegan como `HumanArmature|Man_Walk`, con el nombre de la
 * armadura por delante, y exigir el nombre exacto obligaría a que cualquier modelo que
 * se ponga en su lugar use la misma convención de Blender.
 */
export const CLIP_NAMES = {
  idle: ['idle', 'stand', 'float', 'hover'],
  walk: ['walk'],
  run: ['run', 'sprint'],
  death: ['death', 'die'],
  // Solo lo usa el fantasma, en su estado de embestida. Un modelo que no lo traiga se
  // queda con `run`, que es lo que hace `GhostEnemy.play` al no encontrar el clip.
  attack: ['attack', 'lunge', 'hit']
};

/**
 * Modelos de agente, uno por índice de jugador.
 *
 * Tres siluetas distintas y no una repintada tres veces: en una vista cenital, con los
 * tres agentes moviéndose a la vez, el color del anillo de suelo no siempre basta para
 * saber quién es quién —y menos en el bioma cuyo acento coincide con el de un agente—.
 *
 * `bytes` es el tamaño esperado. No es una firma criptográfica y no pretende serlo: lo
 * que detecta es la descarga cortada a medias, que es el fallo real de bajar ficheros
 * por una red móvil y deja un `.glb` que revienta el cargador sin explicar por qué.
 */
export const PLAYER_MODELS = [
  {
    file: 'agent-1.glb',
    url: 'https://static.poly.pizza/e6019b9f-aed0-400c-8df4-ce5b648e9b82.glb',
    bytes: 503988,
    source: 'https://poly.pizza/m/DLptRuewTn',
    author: 'Quaternius',
    license: 'CC0'
  },
  {
    file: 'agent-2.glb',
    url: 'https://static.poly.pizza/3746be88-6799-4817-929b-6bc067c47caa.glb',
    bytes: 493196,
    source: 'https://poly.pizza/m/HMnuH5geEG',
    author: 'Quaternius',
    license: 'CC0'
  },
  {
    file: 'agent-3.glb',
    url: 'https://static.poly.pizza/985eacbf-9dde-44b7-9270-4e35c8400b13.glb',
    bytes: 498160,
    source: 'https://poly.pizza/m/fjHyMd5Wxw',
    author: 'Quaternius',
    license: 'CC0'
  }
];

/** Altura a la que se normaliza el fantasma. Más alto que un agente a propósito. */
export const GHOST_HEIGHT = 2.1;

/**
 * Modelo del fantasma.
 *
 * `null` mientras no se elija uno: el juego funciona igual, con la silueta procedural
 * de siempre y el material nuevo encima (ver `GhostEnemy.attachModel`). No es un hueco
 * a medio hacer, es el mismo respaldo que tienen los agentes elevado a la categoría de
 * estado normal.
 *
 * Para ponerle modelo basta con rellenar esto con la misma forma que `PLAYER_MODELS`
 * —`{ file, url, bytes, source, author, license }`— y ejecutar `npm run assets`. Lo que
 * se busca es una silueta **alta y estrecha**, con esqueleto y con clips que encajen en
 * `CLIP_NAMES`; el material le pone el resto.
 */
export const GHOST_MODEL = null;

/**
 * Atrezo de la bóveda: cajas, bidones, consolas.
 *
 * Vacío mientras no se elijan piezas. Sin entradas aquí no se monta atrezo y la sala es
 * la de siempre, que es un estado válido y no un fallo —ver `engine/PropLibrary.js`—.
 *
 * Qué buscar, si se amplía:
 *
 *  - **CC0 y de baja densidad**, en la línea de los agentes que ya están (Quaternius,
 *    Kenney). Un kit realista de 50 000 triángulos con texturas de 2K no cabe en el
 *    presupuesto de fotograma del preset `movil` y además chocaría con los agentes.
 *  - **Tres tipos como mucho.** Cada tipo es una llamada de dibujo más, y el techo que
 *    se ha fijado es de tres.
 *  - **Sin esqueleto**: son decorado inmóvil y se fusionan en una sola geometría, así
 *    que una armadura solo añadiría peso que no se usa.
 *
 * `bytes` se anota tras la primera descarga: no es una firma, sino la forma de detectar
 * una descarga cortada a medias. La tolerancia de `fetch-assets.mjs` hace el resto.
 */
export const PROP_MODELS = [];

/** Carpeta pública desde la que se sirven. Relativa a la raíz del sitio. */
export const MODEL_PATH = 'models/';

/** Todo lo que `npm run assets` tiene que traer. Una sola lista, para que no diverjan. */
export function allModels() {
  return [...PLAYER_MODELS, ...PROP_MODELS, ...(GHOST_MODEL ? [GHOST_MODEL] : [])];
}

/** @returns {string} ruta del modelo que le toca a un índice de agente */
export function playerModelUrl(index = 0) {
  const model = PLAYER_MODELS[index % PLAYER_MODELS.length];
  return `${MODEL_PATH}${model.file}`;
}

/**
 * @returns {string|null} ruta de una pieza de atrezo por índice, o `null` si no hay
 *   ninguna declarada. La lista nace vacía, y `index % 0` es `NaN`: sin esta guarda el
 *   estado normal del repositorio reventaría aquí en vez de no montar atrezo.
 */
export function propModelUrl(index = 0) {
  if (PROP_MODELS.length === 0) return null;
  return `${MODEL_PATH}${PROP_MODELS[index % PROP_MODELS.length].file}`;
}

/** @returns {string|null} ruta del modelo del fantasma, o `null` si no hay */
export function ghostModelUrl() {
  return GHOST_MODEL ? `${MODEL_PATH}${GHOST_MODEL.file}` : null;
}
