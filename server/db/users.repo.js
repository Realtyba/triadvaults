import { pool, isPgConnected } from './pool.js';
import { readUsers, writeUsers, findUserKey } from './jsonStore.js';
import { hashPassword, verifyPassword, generatePin } from './passwords.js';

const DEFAULT_FIRST = 'Agente';
const DEFAULT_LAST = 'Desconocido';

function mapPgUser(row) {
  return {
    id: row.id,
    firstName: row.first_name || DEFAULT_FIRST,
    lastName: row.last_name || DEFAULT_LAST,
    username: row.username,
    email: row.email,
    isVerified: row.is_verified,
    maxLevelReached: row.max_level_reached || 1,
    totalPuzzlesSolved: row.total_puzzles_solved || 0,
    totalTimePlayed: row.total_time_played || 0
  };
}

function mapJsonUser(key, user) {
  return {
    id: key,
    firstName: user.firstName || DEFAULT_FIRST,
    lastName: user.lastName || DEFAULT_LAST,
    username: user.username,
    email: user.email,
    isVerified: user.isVerified || false,
    maxLevelReached: user.maxLevelReached || 1,
    totalPuzzlesSolved: user.totalPuzzlesSolved || 0,
    totalTimePlayed: user.totalTimePlayed || 0
  };
}

/**
 * Cuentas creadas antes del hashing guardaban la contraseña en claro.
 * Se aceptan una última vez y se reescriben ya hasheadas.
 */
function matchesLegacyPlaintext(password, stored) {
  return typeof stored === 'string' && !stored.includes(':') && stored === password;
}

export async function registerUser(firstName, lastName, username, email, password) {
  const cleanUser = String(username).trim();
  const cleanEmail = String(email).trim().toLowerCase();
  const cleanFirst = firstName ? String(firstName).trim() : DEFAULT_FIRST;
  const cleanLast = lastName ? String(lastName).trim() : DEFAULT_LAST;
  const secureHash = hashPassword(password);
  const verificationCode = generatePin();

  if (isPgConnected()) {
    try {
      const res = await pool.query(
        `INSERT INTO triad_game_users
           (first_name, last_name, username, email, password, is_verified, verification_code, max_level_reached, total_puzzles_solved)
         VALUES ($1, $2, $3, $4, $5, FALSE, $6, 1, 0)
         RETURNING *`,
        [cleanFirst, cleanLast, cleanUser, cleanEmail, secureHash, verificationCode]
      );
      return { success: true, user: mapPgUser(res.rows[0]), verificationCode };
    } catch (err) {
      if (err.code === '23505') {
        const isEmail = err.detail && err.detail.includes('email');
        return {
          success: false,
          error: isEmail
            ? 'El correo electrónico ya está registrado en otra cuenta.'
            : 'El nombre de usuario ya está ocupado por otro agente.'
        };
      }
      console.error('[users.repo] registerUser:', err.message);
      return { success: false, error: 'Error al registrar usuario en la base de datos.' };
    }
  }

  const users = readUsers();
  const taken = Object.values(users).find(
    u => String(u.username).toLowerCase() === cleanUser.toLowerCase() || u.email === cleanEmail
  );
  if (taken) return { success: false, error: 'El usuario o correo electrónico ya existe.' };

  const key = cleanUser.toLowerCase();
  users[key] = {
    firstName: cleanFirst,
    lastName: cleanLast,
    username: cleanUser,
    email: cleanEmail,
    password: secureHash,
    isVerified: false,
    verificationCode,
    maxLevelReached: 1,
    totalPuzzlesSolved: 0,
    totalTimePlayed: 0,
    resetCode: null
  };
  writeUsers(users);

  return { success: true, user: mapJsonUser(key, users[key]), verificationCode };
}

export async function loginUser(identifier, password) {
  const cleanId = String(identifier).trim().toLowerCase();

  if (isPgConnected()) {
    try {
      const res = await pool.query(
        'SELECT * FROM triad_game_users WHERE LOWER(username) = $1 OR LOWER(email) = $1',
        [cleanId]
      );
      if (res.rows.length === 0) {
        return { success: false, error: 'Usuario o Correo no encontrado. Regístrate primero.' };
      }

      const row = res.rows[0];
      const legacy = matchesLegacyPlaintext(password, row.password);
      if (!verifyPassword(password, row.password) && !legacy) {
        return { success: false, error: 'Contraseña incorrecta.' };
      }
      if (legacy) {
        await pool.query('UPDATE triad_game_users SET password = $1 WHERE id = $2', [
          hashPassword(password),
          row.id
        ]);
      }

      await pool.query('UPDATE triad_game_users SET is_online = TRUE WHERE id = $1', [row.id]);
      return { success: true, user: mapPgUser(row) };
    } catch (err) {
      console.error('[users.repo] loginUser:', err.message);
      return { success: false, error: 'Error de autenticación.' };
    }
  }

  const users = readUsers();
  const key = findUserKey(users, cleanId);
  if (!key) return { success: false, error: 'Usuario o Correo no encontrado.' };

  const user = users[key];
  const legacy = matchesLegacyPlaintext(password, user.password);
  if (!verifyPassword(password, user.password) && !legacy) {
    return { success: false, error: 'Contraseña incorrecta.' };
  }
  if (legacy) {
    user.password = hashPassword(password);
    writeUsers(users);
  }

  return { success: true, user: mapJsonUser(key, user) };
}

/** Nivel máximo alcanzado. Es la fuente de verdad al crear sala: nunca confiar en el cliente. */
export async function getMaxLevel(username) {
  if (!username) return 1;
  const cleanUser = String(username).trim().toLowerCase();

  if (isPgConnected()) {
    try {
      const res = await pool.query(
        'SELECT max_level_reached FROM triad_game_users WHERE LOWER(username) = $1',
        [cleanUser]
      );
      if (res.rows.length > 0) return res.rows[0].max_level_reached || 1;
    } catch (err) {
      console.error('[users.repo] getMaxLevel:', err.message);
    }
    return 1;
  }

  const users = readUsers();
  const key = findUserKey(users, cleanUser);
  return key ? users[key].maxLevelReached || 1 : 1;
}

const NO_ACTIVE_CODE =
  'No hay ningún código activo para esta cuenta. Pulsa "Reenviar código" para recibir uno nuevo.';

/**
 * Valida el PIN de verificación.
 *
 * El caso sin código guardado se distingue del PIN equivocado a propósito: las
 * cuentas anteriores al flujo de verificación no tienen `verification_code`, y
 * antes se comparaba contra `undefined`, así que respondían "Código inválido" a
 * cualquier cosa y quedaban encerradas sin salida posible.
 */
export async function verifyEmail(username, code) {
  const cleanUser = String(username).trim().toLowerCase();
  const cleanCode = String(code).trim();

  if (isPgConnected()) {
    try {
      const res = await pool.query(
        'SELECT id, verification_code, is_verified FROM triad_game_users WHERE LOWER(username) = $1',
        [cleanUser]
      );
      if (res.rows.length === 0) return { success: false, error: 'Usuario no encontrado.' };

      const row = res.rows[0];
      if (row.is_verified) return { success: true, alreadyVerified: true };
      if (!row.verification_code) return { success: false, error: NO_ACTIVE_CODE, needsNewCode: true };
      if (row.verification_code !== cleanCode) return { success: false, error: 'Código inválido.' };

      await pool.query(
        'UPDATE triad_game_users SET is_verified = TRUE, verification_code = NULL WHERE id = $1',
        [row.id]
      );
      return { success: true };
    } catch (err) {
      console.error('[users.repo] verifyEmail:', err.message);
      return { success: false, error: 'Error al verificar correo.' };
    }
  }

  const users = readUsers();
  const key = findUserKey(users, cleanUser);
  if (!key) return { success: false, error: 'Usuario no encontrado.' };

  const user = users[key];
  if (user.isVerified) return { success: true, alreadyVerified: true };
  if (!user.verificationCode) return { success: false, error: NO_ACTIVE_CODE, needsNewCode: true };
  if (user.verificationCode !== cleanCode) return { success: false, error: 'Código inválido.' };

  user.isVerified = true;
  user.verificationCode = null;
  writeUsers(users);
  return { success: true };
}

/**
 * Emite un PIN nuevo y lo guarda. Es la salida del callejón sin salida: sirve
 * tanto si el código caducó como si la cuenta nunca llegó a tener uno.
 */
export async function regenerateVerificationCode(userId) {
  const code = generatePin();

  if (isPgConnected()) {
    try {
      const res = await pool.query(
        `UPDATE triad_game_users SET verification_code = $1
          WHERE id = $2 AND is_verified = FALSE
      RETURNING username, email`,
        [code, userId]
      );
      if (res.rows.length === 0) {
        return { success: false, error: 'La cuenta no existe o ya está verificada.' };
      }
      return { success: true, code, username: res.rows[0].username, email: res.rows[0].email };
    } catch (err) {
      console.error('[users.repo] regenerateVerificationCode:', err.message);
      return { success: false, error: 'No se pudo generar un código nuevo.' };
    }
  }

  const users = readUsers();
  const key = findUserKey(users, userId);
  if (!key) return { success: false, error: 'La cuenta no existe.' };
  if (users[key].isVerified) return { success: false, error: 'La cuenta ya está verificada.' };

  users[key].verificationCode = code;
  writeUsers(users);
  return { success: true, code, username: users[key].username, email: users[key].email };
}

export async function updateProfile(userId, firstName, lastName, newEmail, newUsername) {
  const cleanFirst = firstName ? String(firstName).trim() : DEFAULT_FIRST;
  const cleanLast = lastName ? String(lastName).trim() : DEFAULT_LAST;
  const cleanEmail = String(newEmail).trim().toLowerCase();
  const cleanUsername = newUsername ? String(newUsername).trim() : null;
  const newCode = generatePin();

  if (isPgConnected()) {
    try {
      const curr = await pool.query('SELECT email, username FROM triad_game_users WHERE id = $1', [userId]);
      if (curr.rows.length === 0) return { success: false, error: 'Usuario no encontrado.' };

      const emailTaken = await pool.query(
        'SELECT id FROM triad_game_users WHERE LOWER(email) = $1 AND id != $2',
        [cleanEmail, userId]
      );
      if (emailTaken.rows.length > 0) {
        return { success: false, error: 'Este correo ya está en uso por otro agente.' };
      }

      if (cleanUsername && cleanUsername.toLowerCase() !== curr.rows[0].username.toLowerCase()) {
        const userTaken = await pool.query(
          'SELECT id FROM triad_game_users WHERE LOWER(username) = $1 AND id != $2',
          [cleanUsername.toLowerCase(), userId]
        );
        if (userTaken.rows.length > 0) {
          return { success: false, error: 'Este usuario ya está en uso por otro agente.' };
        }
      }

      const emailChanged = curr.rows[0].email !== cleanEmail;
      const targetUsername = cleanUsername || curr.rows[0].username;

      if (emailChanged) {
        await pool.query(
          `UPDATE triad_game_users
             SET first_name = $1, last_name = $2, email = $3, username = $4,
                 is_verified = FALSE, verification_code = $5
           WHERE id = $6`,
          [cleanFirst, cleanLast, cleanEmail, targetUsername, newCode, userId]
        );
      } else {
        await pool.query(
          'UPDATE triad_game_users SET first_name = $1, last_name = $2, username = $3 WHERE id = $4',
          [cleanFirst, cleanLast, targetUsername, userId]
        );
      }
      return { success: true, emailChanged, newCode, username: targetUsername };
    } catch (err) {
      console.error('[users.repo] updateProfile:', err.message);
      return { success: false, error: 'Error al actualizar perfil.' };
    }
  }

  const users = readUsers();
  const key = findUserKey(users, userId);
  if (!key) return { success: false, error: 'Usuario no encontrado.' };

  const emailTaken = Object.keys(users).find(k => k !== key && users[k].email === cleanEmail);
  if (emailTaken) return { success: false, error: 'Este correo ya está en uso por otro agente.' };

  const targetUsername = cleanUsername || users[key].username;
  if (cleanUsername && cleanUsername.toLowerCase() !== String(users[key].username).toLowerCase()) {
    const userTaken = Object.keys(users).find(
      k => k !== key && String(users[k].username).toLowerCase() === cleanUsername.toLowerCase()
    );
    if (userTaken) return { success: false, error: 'Este usuario ya está en uso por otro agente.' };
  }

  const emailChanged = users[key].email !== cleanEmail;
  const record = { ...users[key], firstName: cleanFirst, lastName: cleanLast, username: targetUsername };
  if (emailChanged) {
    record.email = cleanEmail;
    record.isVerified = false;
    record.verificationCode = newCode;
  }

  // La clave del respaldo es el username, así que un cambio de usuario mueve el registro.
  delete users[key];
  users[targetUsername.toLowerCase()] = record;
  writeUsers(users);

  return { success: true, emailChanged, newCode, username: targetUsername };
}
