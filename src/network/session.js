const USER_KEY = 'triad_vaults_user';
const TOKEN_KEY = 'triad_vaults_token';

/**
 * Sesión persistida. Usuario y token se guardan y se borran siempre juntos:
 * tener uno sin el otro dejaba la UI creyendo que había sesión sin poder conectar.
 */
export const session = {
  getToken() {
    return localStorage.getItem(TOKEN_KEY);
  },

  getUser() {
    const raw = localStorage.getItem(USER_KEY);
    if (!raw) return null;
    try {
      return JSON.parse(raw);
    } catch {
      localStorage.removeItem(USER_KEY);
      return null;
    }
  },

  save(user, token) {
    if (user) localStorage.setItem(USER_KEY, JSON.stringify(user));
    if (token) localStorage.setItem(TOKEN_KEY, token);
  },

  patchUser(patch) {
    const user = this.getUser();
    if (!user) return null;
    const merged = { ...user, ...patch };
    localStorage.setItem(USER_KEY, JSON.stringify(merged));
    return merged;
  },

  clear() {
    localStorage.removeItem(USER_KEY);
    localStorage.removeItem(TOKEN_KEY);
  },

  /** Una sesión solo es válida si tiene token y usuario. */
  isValid() {
    return !!this.getToken() && !!this.getUser();
  }
};
