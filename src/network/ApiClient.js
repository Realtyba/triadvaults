import { session } from './session.js';

export function resolveBaseUrl() {
  if (import.meta.env && import.meta.env.VITE_API_URL) return import.meta.env.VITE_API_URL;

  // Build empaquetada abierta desde el disco (Electron sin servidor de desarrollo).
  // Aquí `origin` es "file://", y pedirle nada solo produce errores de red en bucle:
  // sin `VITE_API_URL` en la compilación, el juego es de un solo jugador.
  if (window.location.protocol === 'file:') return null;

  const isLocal = ['localhost', '127.0.0.1'].includes(window.location.hostname);
  return isLocal ? 'http://localhost:3001' : window.location.origin;
}

const CONNECTION_ERROR = { success: false, error: 'Error de conexión con el servidor.' };

/** Cliente REST. Nunca lanza: siempre devuelve `{ success, ... }`. */
export class ApiClient {
  constructor(baseUrl = resolveBaseUrl()) {
    this.baseUrl = baseUrl;
  }

  /** Sin servidor al que apuntar no hay nada que pedir; ver `resolveBaseUrl`. */
  get isAvailable() {
    return this.baseUrl !== null;
  }

  async request(path, { method = 'GET', body, auth = false } = {}) {
    if (!this.isAvailable) return { ...CONNECTION_ERROR };

    const lang = localStorage.getItem('triad_lang') || 'es';
    const headers = { 
      'Content-Type': 'application/json',
      'Accept-Language': lang
    };
    if (auth) {
      const token = session.getToken();
      if (token) headers.Authorization = `Bearer ${token}`;
    }

    try {
      const res = await fetch(`${this.baseUrl}${path}`, {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined
      });
      return await res.json();
    } catch (err) {
      console.error(`[api] ${method} ${path}:`, err.message);
      return { ...CONNECTION_ERROR };
    }
  }

  register(firstName, lastName, username, email, password) {
    return this.request('/api/register', {
      method: 'POST',
      body: { firstName, lastName, username, email, password }
    });
  }

  login(identifier, password) {
    return this.request('/api/login', { method: 'POST', body: { identifier, password } });
  }

  verifyEmail(username, code) {
    return this.request('/api/verify', { method: 'POST', body: { username, code } });
  }

  resendVerification() {
    return this.request('/api/resend-verification', { method: 'POST', auth: true });
  }

  health() {
    return this.request('/api/health');
  }

  requestReset(email) {
    return this.request('/api/request-reset', { method: 'POST', body: { email } });
  }

  resetPassword(email, resetCode, newPassword) {
    return this.request('/api/reset-password', {
      method: 'POST',
      body: { email, resetCode, newPassword }
    });
  }

  updateProfile(firstName, lastName, newEmail, newUsername) {
    return this.request('/api/profile/update', {
      method: 'POST',
      auth: true,
      body: { firstName, lastName, newEmail, newUsername }
    });
  }

  getLeaderboard() {
    return this.request('/api/leaderboard');
  }

  /** Claves desbloqueadas por el agente conectado. */
  getAchievements() {
    return this.request('/api/profile/achievements', { auth: true });
  }

  /** Catálogo de logros: qué existe y cómo se llama. No requiere sesión. */
  getAchievementCatalog() {
    return this.request('/api/achievements');
  }

  /** Vuelca al servidor los niveles superados sin conexión. */
  syncProgress(runs) {
    return this.request('/api/profile/sync', { method: 'POST', auth: true, body: { runs } });
  }
}
