import { session } from './session.js';
import { apiBaseUrl, API_PREFIX } from './endpoints.js';

/**
 * Cliente REST contra la API de cuentas (realtyba-api).
 *
 * Nunca lanza: siempre devuelve `{ success, ... }` en la forma plana que espera la
 * interfaz del juego. Traducir el formato de Laravel es trabajo de `unwrap()`, y
 * está concentrado ahí a propósito para que la carpeta `src/ui/` no se haya tenido
 * que enterar de la migración.
 */

const CONNECTION_ERROR = { success: false, error: 'Error de conexión con el servidor.' };

/**
 * Traduce la respuesta de Laravel a lo que espera la interfaz.
 *
 * Los controladores del juego en Laravel ya responden plano —`{success, error,
 * user, token, ...}`— porque el envelope `{success, result}` del resto de la API
 * habría obligado a tocar todas las pantallas sin ganar nada. Lo que sí llega en
 * otro formato son los errores que NO produce el controlador sino el manejador de
 * excepciones, y son dos formas distintas:
 *
 *   · 422 de validación   → `{success: false, message: 'validation_error', errors: {...}}`
 *   · 401/403/429/500     → `{status: 'error', code, message, result: null}`
 *
 * Sin esta traducción, un fallo de validación llegaría a la interfaz como un objeto
 * sin `error` y la pantalla se quedaría muda: ni avanza ni dice por qué.
 */
function unwrap(payload, retryAfterHeader = null) {
  if (!payload || typeof payload !== 'object') return { ...CONNECTION_ERROR };

  // El throttle de rutas de Laravel manda la espera en la cabecera `Retry-After`,
  // no en el cuerpo. Sin recogerla, la interfaz enseñaría "demasiados intentos"
  // pero dejaría el botón de reenviar activo y sin cuenta atrás, invitando a
  // pulsarlo otra vez para recibir el mismo error.
  const fromHeader = Number(retryAfterHeader);
  if (Number.isFinite(fromHeader) && fromHeader > 0 && payload.retryAfter === undefined) {
    payload = { ...payload, retryAfter: fromHeader };
  }

  // Validación: se muestra el primer mensaje. La interfaz del juego tiene un solo
  // hueco para el error, así que enumerarlos todos no cabría.
  if (payload.errors && typeof payload.errors === 'object') {
    const first = Object.values(payload.errors).flat()[0];
    return { success: false, error: first || 'Datos inválidos.' };
  }

  // Errores del manejador de excepciones.
  if (payload.status === 'error') {
    return {
      success: false,
      error: payload.message || 'Error del servidor.',
      // El throttle de Laravel responde 429 sin cuerpo propio; el cliente ya sabe
      // interpretar `retryAfter` para pintar la cuenta atrás del reenvío de PIN.
      ...(payload.retryAfter !== undefined ? { retryAfter: payload.retryAfter } : {})
    };
  }

  // Respuesta del controlador, ya plana. Los 503 internos traen `error` como
  // objeto `{code, message}`; se aplana para que la interfaz siempre lea texto.
  if (payload.error && typeof payload.error === 'object') {
    return { ...payload, error: payload.error.message || 'Error del servidor.' };
  }

  return payload;
}

/** Cliente REST. Nunca lanza: siempre devuelve `{ success, ... }`. */
export class ApiClient {
  constructor(baseUrl = apiBaseUrl()) {
    this.baseUrl = baseUrl;
  }

  /** Sin servidor al que apuntar no hay nada que pedir; ver `apiBaseUrl`. */
  get isAvailable() {
    return this.baseUrl !== null;
  }

  async request(path, { method = 'GET', body, auth = false } = {}) {
    if (!this.isAvailable) return { ...CONNECTION_ERROR };

    const lang = localStorage.getItem('triad_lang') || 'es';
    const headers = {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'Accept-Language': lang
    };
    if (auth) {
      const token = session.getToken();
      if (token) headers.Authorization = `Bearer ${token}`;
    }

    try {
      const res = await fetch(`${this.baseUrl}${API_PREFIX}${path}`, {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined
      });

      // Un 500 sin cuerpo JSON, o un proxy que devuelve HTML, harían que .json()
      // lanzase y el jugador viese "Error de conexión" sin más. Es engañoso, pero
      // es lo que ya hacía y lo que la interfaz sabe pintar.
      return unwrap(await res.json(), res.headers.get('Retry-After'));
    } catch (err) {
      console.error(`[api] ${method} ${path}:`, err.message);
      return { ...CONNECTION_ERROR };
    }
  }

  register(firstName, lastName, username, email, password) {
    return this.request('/register', {
      method: 'POST',
      body: { firstName, lastName, username, email, password }
    });
  }

  login(identifier, password) {
    return this.request('/login', { method: 'POST', body: { identifier, password } });
  }

  verifyEmail(username, code) {
    return this.request('/verify', { method: 'POST', body: { username, code } });
  }

  resendVerification() {
    return this.request('/resend-verification', { method: 'POST', auth: true });
  }

  health() {
    return this.request('/health');
  }

  requestReset(email) {
    return this.request('/request-reset', { method: 'POST', body: { email } });
  }

  /**
   * La contraseña nueva viaja como `password` y no como `newPassword`.
   *
   * TrimStrings de Laravel recorta todos los campos de texto salvo una lista corta
   * (`password`, `current_password`, `password_confirmation`). Con `newPassword`,
   * una contraseña que empezara o acabara en espacio se guardaría recortada y no
   * volvería a servir para entrar. La firma del método no cambia: quien llama sigue
   * hablando de `newPassword`.
   */
  resetPassword(email, resetCode, newPassword) {
    return this.request('/reset-password', {
      method: 'POST',
      body: { email, resetCode, password: newPassword }
    });
  }

  updateProfile(firstName, lastName, newEmail, newUsername) {
    return this.request('/profile/update', {
      method: 'POST',
      auth: true,
      body: { firstName, lastName, newEmail, newUsername }
    });
  }

  getLeaderboard() {
    return this.request('/leaderboard');
  }

  /** Claves desbloqueadas por el agente conectado. */
  getAchievements() {
    return this.request('/profile/achievements', { auth: true });
  }

  /** Catálogo de logros: qué existe y cómo se llama. No requiere sesión. */
  getAchievementCatalog() {
    return this.request('/achievements');
  }

  /** Vuelca al servidor los niveles superados sin conexión. */
  syncProgress(runs) {
    return this.request('/profile/sync', { method: 'POST', auth: true, body: { runs } });
  }
}
