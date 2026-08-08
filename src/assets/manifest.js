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
  idle: ['idle', 'stand'],
  walk: ['walk'],
  run: ['run', 'sprint'],
  death: ['death', 'die']
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

/** Carpeta pública desde la que se sirven. Relativa a la raíz del sitio. */
export const MODEL_PATH = 'models/';

/** @returns {string} ruta del modelo que le toca a un índice de agente */
export function playerModelUrl(index = 0) {
  const model = PLAYER_MODELS[index % PLAYER_MODELS.length];
  return `${MODEL_PATH}${model.file}`;
}
