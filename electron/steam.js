import { createRequire } from 'module';

/**
 * Puente con Steamworks. Vive en el proceso principal, nunca en el de render.
 *
 * `steamworks.js` es un módulo **nativo**, y la ventana corre con
 * `contextIsolation: true`, `nodeIntegration: false` y `sandbox: true`: la página no
 * puede cargar binarios, y no queremos que pueda. El render pide las cosas por IPC a
 * través de la superficie enumerada a mano en `preload.cjs`.
 *
 * Todo aquí está construido alrededor de una idea: **la mayoría de las partidas van a
 * ocurrir sin Steam delante** —en el navegador, en la build suelta, o con el cliente
 * de Steam cerrado— y ninguna de ellas puede notar que este fichero existe. Por eso
 * nada lanza: si algo falla, se dice una vez y el juego sigue exactamente igual.
 */

// `require` de verdad: el módulo es CommonJS con un `.node` detrás, y este proyecto
// es ESM. Un `import()` normal no resuelve el binario.
const require = createRequire(import.meta.url);

/** Estado del puente. `reason` solo se usa para explicarse una vez por consola. */
const state = {
  client: null,
  available: false,
  reason: null,
  announced: false,
  attempted: false
};

/**
 * El appid es un dato de la cuenta de Steamworks de quien publica, así que no puede
 * estar en el repositorio. Sale del entorno, o del `steam_appid.txt` que la propia
 * librería busca en el directorio de trabajo cuando no se le pasa ninguno.
 */
function resolveAppId() {
  const raw = process.env.STEAM_APP_ID;
  if (!raw) return undefined;
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : undefined;
}

function announce() {
  if (state.announced) return;
  state.announced = true;

  if (state.available) console.log(`[steam] conectado (appid ${state.client.utils.getAppId()})`);
  else console.log(`[steam] no disponible: ${state.reason}. El juego funciona igual.`);
}

/**
 * Intenta conectar con Steam una sola vez.
 *
 * El guardián mira si ya se intentó, no si hay cliente: con lo segundo, cada llamada
 * posterior repetiría el intento fallido, y la librería nativa vuelca por consola
 * cuatro líneas suyas cada vez que no encuentra Steam.
 *
 * @returns {boolean} si hay cliente utilizable
 */
export function initSteam() {
  if (state.attempted) return state.available;
  state.attempted = true;

  let steamworks;
  try {
    steamworks = require('steamworks.js');
  } catch (err) {
    // Es una dependencia opcional: puede no haberse instalado su binario, o la
    // plataforma no estar soportada. Ninguna de las dos cosas impide jugar.
    state.reason = `no se pudo cargar steamworks.js (${err.message})`;
    announce();
    return false;
  }

  try {
    // Sin appid, la librería busca `steam_appid.txt` en el directorio de trabajo;
    // es lo que permite probar sin lanzar desde Steam.
    state.client = steamworks.init(resolveAppId());
    state.available = true;
  } catch (err) {
    // Lo normal aquí es que el cliente de Steam no esté abierto, o que el appid no
    // pertenezca a esta cuenta. No es un error del juego.
    state.reason = err.message;
  }

  announce();
  return state.available;
}

export const steamIsAvailable = () => state.available;

/**
 * Marca un logro como conseguido.
 *
 * `store()` después de `activate()` a propósito: sin él Steam no envía el cambio
 * hasta que lo decide por su cuenta, y el jugador no ve saltar el aviso en el momento
 * —que es justo la gracia de tenerlos en Steam—.
 *
 * @param {string} apiName nombre del logro en el portal de Steamworks
 * @returns {boolean} si se dio por conseguido ahora
 */
export function unlockAchievement(apiName) {
  if (!state.available || !apiName) return false;

  try {
    const activated = state.client.achievement.activate(apiName);
    if (activated) state.client.stats.store();
    return activated;
  } catch (err) {
    // Un nombre que no exista en el portal llega hasta aquí. Se avisa, porque es un
    // fallo de configuración que de otro modo no daría ninguna señal.
    console.error(`[steam] no se pudo conceder "${apiName}": ${err.message}`);
    return false;
  }
}

/** @returns {boolean} si Steam ya lo tenía por conseguido */
export function achievementIsUnlocked(apiName) {
  if (!state.available || !apiName) return false;

  try {
    return state.client.achievement.isActivated(apiName);
  } catch {
    return false;
  }
}

/**
 * Enciende el overlay de Steam.
 *
 * Deliberadamente **detrás de `STEAM_OVERLAY=true`**, apagado por defecto: para
 * funcionar sobre Electron necesita el conmutador `in-process-gpu`, que mete el
 * proceso de GPU dentro del principal y con ello se lleva por delante su aislamiento.
 * Es un intercambio real —una comodidad a cambio de un límite de seguridad— y no
 * puede hacerse a espaldas de quien compila.
 *
 * Hay que llamarlo **antes** de que la aplicación esté lista: los conmutadores de
 * línea de órdenes ya no se leen después.
 */
export function enableSteamOverlay() {
  if (process.env.STEAM_OVERLAY !== 'true') return false;

  try {
    require('steamworks.js').electronEnableSteamOverlay();
    console.log('[steam] overlay activado (con in-process-gpu: el proceso de GPU deja de estar aislado)');
    return true;
  } catch (err) {
    console.error(`[steam] no se pudo activar el overlay: ${err.message}`);
    return false;
  }
}
