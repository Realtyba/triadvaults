/**
 * Dónde vive cada cosa.
 *
 * El juego habla ahora con DOS servicios distintos: realtyba-api sirve todo lo que
 * es cuenta (registro, sesión, perfil, clasificación, logros) y el servidor de
 * salas sirve el socket de las partidas. Antes eran el mismo proceso y por eso
 * `SocketClient.js` importaba la URL de `ApiClient.js`; con dos servicios eso deja
 * de valer, y separarlo aquí evita que una configuración a medias apunte los dos al
 * mismo sitio sin que se note.
 *
 * Hay una variable por servicio y ninguna más: `TRIADVAULTS_API_URL` para la API y
 * `VITE_SOCKET_URL` para el socket. Hubo un tiempo en que la API tenía además un
 * `VITE_API_URL` propio para el cliente; se quitó porque en la práctica siempre
 * repetía el mismo valor y lo único que produjo fue un `.env` con las dos mitades
 * apuntando a sitios distintos.
 */

/** Prefijo de todas las rutas del juego en Laravel. */
export const API_PREFIX = '/api/triadvaults';

function envVar(name) {
  return import.meta.env && import.meta.env[name] ? import.meta.env[name] : null;
}

/**
 * `TRIADVAULTS_API_URL` tal y como la horneó `vite.config.js`.
 *
 * El `typeof` no sobra: fuera de un build de Vite —un test que importe este módulo
 * con node a secas— la constante no existe y leerla sin más sería un ReferenceError
 * en la carga del módulo.
 */
function bakedApiUrl() {
  return typeof __API_URL__ === 'string' && __API_URL__ ? __API_URL__ : null;
}

/**
 * Base de la API de cuentas (realtyba-api).
 *
 * `null` significa "sin servidor": el juego se queda en un solo jugador con el
 * progreso guardado en local. Pasa en la build empaquetada abierta desde el disco
 * sin `TRIADVAULTS_API_URL` en la compilación, donde `origin` es "file://" y pedirle
 * algo solo produce errores de red en bucle.
 */
export function apiBaseUrl() {
  const configured = bakedApiUrl();
  if (configured) return configured;

  if (window.location.protocol === 'file:') return null;

  // En desarrollo, Vite sirve el cliente en :3000 y Laravel escucha en :8000. No
  // se puede caer a `window.location.origin` como antes, porque ese era el mismo
  // servidor que servía la API y ahora no lo es.
  const isLocal = ['localhost', '127.0.0.1'].includes(window.location.hostname);
  return isLocal ? 'http://localhost:8000' : window.location.origin;
}

/**
 * Base del servidor de salas (el socket).
 *
 * Este sí sigue siendo un `VITE_` normal: el socket lo sirve este repositorio y su
 * URL solo la necesita el cliente, así que no hay nada que compartir con el proceso
 * de Node.
 */
export function socketBaseUrl() {
  const configured = envVar('VITE_SOCKET_URL');
  if (configured) return configured.replace(/\/+$/, '');

  if (window.location.protocol === 'file:') return null;

  const isLocal = ['localhost', '127.0.0.1'].includes(window.location.hostname);
  return isLocal ? 'http://localhost:3001' : window.location.origin;
}
