/**
 * Qué modelos usa el juego, de dónde salieron y cómo hay que montarlos.
 *
 * Lo comparten el cliente (`engine/AssetLoader.js`, `engine/PropLibrary.js`) y los
 * scripts (`scripts/fetch-assets.mjs`, `scripts/validate-assets.js`) para que no haya
 * dos listas que se desincronicen.
 *
 * ## Casi todo sale de un solo pack, y eso no es casualidad
 *
 * El **Ultimate Space Kit** de Quaternius trae 87 piezas que comparten **un único atlas
 * de 512×512, byte a byte idéntico** en todos los ficheros. Eso es lo que permite que
 * `PropLibrary` dibuje cualquier número de tipos de atrezo en **una** llamada: un solo
 * material puede pintar el kit entero. Elegir las piezas dentro de un mismo pack no es
 * comodidad, es la decisión de la que cuelga el presupuesto de fotograma.
 *
 * ## Estos ficheros no se descargan
 *
 * El pack se baja entero de su página, no pieza a pieza, así que las entradas que vienen
 * de él van marcadas `local: true` y **sin `url`**: `npm run assets` comprueba que estén
 * y avisa si falta alguna, pero no intenta traerlas. Los originales del kit, con su
 * nombre de origen, viven en `assets-src/ultimate-space-kit-glb/` —fuera de `public/`,
 * que se copia entera al build de Vite y al paquete de Electron—. El campo `origin` de
 * cada entrada dice de qué fichero del kit salió, y `CREDITS.md` lo publica como tabla.
 *
 * **El juego tiene que arrancar sin ellos.** `AssetLoader` cae a la geometría primitiva
 * si un fichero falta o falla, igual que el arranque sobrevive a que no esté
 * `steamworks.js`. Sin modelos se ven agentes de cilindro, el fantasma con su material
 * completo sobre la silueta de respaldo, los nodos de puzle procedurales y ninguna pieza
 * de atrezo. Es un estado válido, no un fallo.
 */

/** Altura a la que se normaliza cualquier modelo de agente, en unidades de mundo. */
export const PLAYER_HEIGHT = 1.7;

/** Altura a la que se normaliza el fantasma. Más alto que un agente a propósito. */
export const GHOST_HEIGHT = 2.1;

/**
 * Nombres de clip que busca el reproductor de animación, por estado.
 *
 * Se comparan **primero exactos y luego por contenido** (ver `AssetLoader.findClip`), y
 * sin distinguir mayúsculas: los clips de estos packs llegan como
 * `CharacterArmature|Walk`, con el nombre de la armadura por delante, y exigir el nombre
 * exacto del clip entero obligaría a que cualquier modelo que se ponga en su lugar use
 * la misma convención de Blender.
 */
export const CLIP_NAMES = {
  idle: ['idle', 'stand', 'float', 'hover'],
  walk: ['walk'],
  run: ['run', 'sprint'],
  death: ['death', 'die'],
  // `punch` va PRIMERO a propósito. Los modelos de este kit traen un clip `HitReact`
  // —el respingo de *recibir* un golpe— y `hit` lo cazaba antes que nada: el fantasma
  // embestía encogiéndose. `Punch` es el clip de dar, que es lo que embiste.
  // Solo lo usa el fantasma; quien no lo traiga se queda con `run`, que es lo que hace
  // `GhostEnemy.play` al no encontrar el clip.
  attack: ['punch', 'attack', 'lunge', 'hit']
};

/**
 * Lo que comparten todas las piezas del kit. Se expande sobre cada entrada para que el
 * autor, la licencia y el origen no se repitan doce veces y no puedan divergir.
 */
const SPACE_KIT = {
  pack: 'Ultimate Space Kit',
  author: 'Quaternius',
  license: 'CC0',
  source: 'https://poly.pizza/bundle/Ultimate-Space-Kit-YWh743lqGX',
  /** Clave del atlas compartido. La usa `PropLibrary` para agrupar por material. */
  atlas: 'space-kit',
  local: true
};

const fromKit = entry => ({ ...SPACE_KIT, ...entry });

/**
 * Modelos de agente, uno por índice de jugador.
 *
 * Tres siluetas distintas y no una repintada tres veces: en una vista cenital, con los
 * tres agentes moviéndose a la vez, el color del anillo de suelo no siempre basta para
 * saber quién es quién —y menos en el bioma cuyo acento coincide con el de un agente—.
 *
 * `drop` quita la pistola antes de medir y de montar. Por dos razones: es una llamada de
 * dibujo por agente, y un arma en la mano promete un verbo de combate que este juego no
 * tiene.
 */
export const PLAYER_MODELS = [
  fromKit({ file: 'agent-1.glb', origin: 'Astronaut.glb', bytes: 701328, drop: ['Pistol'] }),
  fromKit({ file: 'agent-2.glb', origin: 'Astronaut-0D54W8yfrA.glb', bytes: 733432, drop: ['Pistol'] }),
  fromKit({ file: 'agent-3.glb', origin: 'Astronaut-OgeSH89Nmx.glb', bytes: 755356, drop: ['Pistol'] })
];

/**
 * Modelo del fantasma.
 *
 * `GhostEnemy.attachModel` le **impone** su propio material —borde de fresnel y
 * disolución— en vez de teñir el que trae, así que del fichero solo importan la silueta
 * y el esqueleto. Lo que se busca es alto, ancho de hombros y con clips que encajen en
 * `CLIP_NAMES`; el atlas del pack no se llega a usar.
 */
export const GHOST_MODEL = fromKit({
  file: 'ghost.glb',
  origin: 'Enemy Large.glb',
  bytes: 439768
});

/**
 * Atrezo de la bóveda.
 *
 * `fit` es a cuánto se lleva su **dimensión mayor**, en unidades de mundo. No es la
 * altura: en este kit hay vigas de 6×0,14 y plataformas de 1,7×1,1, y normalizarlas
 * todas por el eje Y convierte la plataforma en una losa de varios metros. Ver
 * `AssetLoader.normalize`.
 *
 * `weight` es la frecuencia relativa en el reparto. Sin pesos, con ocho tipos y doce
 * piezas sale una de cada: un bazar, no una estación. Las cajas se repiten y las piezas
 * grandes aparecen sueltas.
 *
 * Qué buscar si se amplía:
 *
 *  - **CC0 y de baja densidad.** Un kit realista de 50 000 triángulos con texturas de 2K
 *    no cabe en el presupuesto del preset `movil` y además chocaría con los agentes.
 *  - **Del mismo pack, mejor.** Compartir atlas es lo que mantiene el atrezo en una sola
 *    llamada. Una pieza de otro sitio no rompe nada —`PropLibrary` abre un segundo cubo
 *    de material— pero cuesta una llamada más y un choque de dirección artística.
 *  - **Sin esqueleto**: son decorado inmóvil y se fusionan en una sola geometría, así que
 *    una armadura solo añadiría peso que no se usa.
 *  - **Que aguante cualquier giro.** `PropScatter` reparte con `rotY` libre. Una escalera
 *    o una viga en ángulo arbitrario contra un muro se lee como un fallo, no como
 *    decorado. Cajas, bidones y paneles sí aguantan.
 *  - **Modelada a ras de suelo.** Media docena de piezas del kit (antenas, radares) están
 *    modeladas *sobre un tejado*, con su origen a cuatro metros. `normalize` las vuelve a
 *    sentar en y=0 correctamente, pero siguen leyéndose como muebles de azotea.
 */
export const PROP_MODELS = [
  fromKit({ file: 'prop-container.glb', origin: 'Pickup Crate.glb', bytes: 75296, fit: 1.1, weight: 3 }),
  fromKit({ file: 'prop-canister.glb', origin: 'Pickup Jar.glb', bytes: 21396, fit: 1.0, weight: 3 }),
  fromKit({ file: 'prop-ammo.glb', origin: 'Bullets Pickup.glb', bytes: 32004, fit: 0.8, weight: 2 }),
  fromKit({ file: 'prop-medkit.glb', origin: 'Pickup Health.glb', bytes: 42508, fit: 0.85, weight: 2 }),
  fromKit({ file: 'prop-panel.glb', origin: 'Solar Panel Ground.glb', bytes: 23556, fit: 1.8, weight: 1 }),
  fromKit({ file: 'prop-strut.glb', origin: 'Metal Support.glb', bytes: 29032, fit: 2.2, weight: 1 }),
  // ---------------------------------------------------------------------------------
  // Aquí había dos piezas más —una caja industrial y una consola— que vestían la bóveda
  // mejor que ninguna pieza espacial. **Se han retirado, y no por su aspecto.**
  //
  // No eran del kit y su procedencia no estaba registrada: aparecieron sueltas en
  // `public/models/` y no hay forma de reconstruirla mirando el binario, que es
  // exactamente lo que `CREDITS.md` existe para evitar. El estilo apuntaba a otro pack de
  // Quaternius, pero apuntar no es saber, y este juego se distribuye por Steam: un
  // fichero del que no se puede afirmar bajo qué licencia está no puede viajar dentro.
  //
  // No se han borrado. Están en `assets-src/unverified/`, fuera de `public/` —que Vite
  // copia entera al build y Electron al paquete—, así que ya no se distribuyen pero
  // siguen ahí por si aparece su fuente. Para recuperarlas basta con documentar autor y
  // licencia, devolverlas a `public/models/` y volver a declararlas aquí.
  //
  // Efecto colateral bueno: eran las únicas sin atlas, así que el atrezo pasó de dos
  // llamadas de dibujo a una. Ver `PropLibrary`.
  // ---------------------------------------------------------------------------------
];

/**
 * Piezas del puzle.
 *
 * Son **decoración sobre una mecánica que ya se lee sin ellas**: el estado de un nodo
 * vive en el color y el hundido de su placa (`puzzles/paint.js`), y el de una compuerta
 * en su campo de fuerza. Si un fichero falta, no aparece el modelo y se juega igual, con
 * la geometría procedural de siempre. Misma regla que el atrezo.
 */
export const PUZZLE_MODELS = {
  /** Flota y gira sobre cada nodo. Uno solo: todos los nodos se instancian juntos. */
  node: fromKit({ file: 'puzzle-core.glb', origin: 'Pickup Thunder.glb', bytes: 16120, fit: 0.7 }),
  /**
   * Marco de la compuerta. El kit no trae "puerta": trae un tramo de pasillo, que es
   * mejor —se atraviesa— siempre que se oriente hacia donde está el jugador. Ver
   * `PuzzleArchetype.buildExitGates`.
   */
  gate: fromKit({ file: 'puzzle-gate.glb', origin: 'Connector.glb', bytes: 28060, fit: 4.0 })
};

/** Carpeta pública desde la que se sirven. Relativa a la raíz del sitio. */
const MODEL_PATH = 'models/';

/** Todo lo que hay que tener y acreditar. Una sola lista, para que no diverjan. */
export function allModels() {
  return [
    ...PLAYER_MODELS,
    ...PROP_MODELS,
    ...(GHOST_MODEL ? [GHOST_MODEL] : []),
    ...Object.values(PUZZLE_MODELS).filter(Boolean)
  ];
}

/** @returns {string|null} ruta pública de una entrada del manifest */
export function modelUrl(model) {
  return model ? `${MODEL_PATH}${model.file}` : null;
}

/** @returns {object|null} entrada de agente que le toca a un índice de jugador */
export function playerModel(index = 0) {
  return PLAYER_MODELS[index % PLAYER_MODELS.length] || null;
}

/** @returns {string} ruta del modelo que le toca a un índice de agente */
export function playerModelUrl(index = 0) {
  return modelUrl(playerModel(index));
}

/**
 * @returns {object|null} entrada de atrezo por índice, o `null` si no hay ninguna
 *   declarada. `index % 0` es `NaN`: sin esta guarda, vaciar la lista reventaría aquí en
 *   vez de dejar la sala sin atrezo, que es el estado de respaldo.
 */
export function propModel(index = 0) {
  if (PROP_MODELS.length === 0) return null;
  return PROP_MODELS[index % PROP_MODELS.length];
}

/**
 * Pesos del reparto, en el mismo orden que `PROP_MODELS`. Lo consume `scatterProps`.
 *
 * Salen del manifest y no de una semilla, así que los tres clientes reparten igual: es
 * lo que permite decir "la caja del rincón" y que el otro sepa cuál es.
 */
export function propWeights() {
  return PROP_MODELS.map(model => model.weight ?? 1);
}

/** @returns {string|null} ruta del modelo del fantasma, o `null` si no hay */
export function ghostModelUrl() {
  return modelUrl(GHOST_MODEL);
}
