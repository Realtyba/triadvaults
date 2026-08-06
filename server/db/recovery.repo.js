import { pool, isPgConnected } from './pool.js';
import { readUsers, writeUsers } from './jsonStore.js';
import { hashPassword, generatePin } from './passwords.js';
import { sendRecoveryPin } from '../mailer.js';

export async function requestPasswordReset(email) {
  const cleanEmail = String(email).trim().toLowerCase();
  const resetCode = generatePin();

  if (isPgConnected()) {
    try {
      const res = await pool.query(
        'UPDATE triad_game_users SET reset_code = $1 WHERE LOWER(email) = $2 RETURNING username',
        [resetCode, cleanEmail]
      );
      if (res.rows.length === 0) {
        return { success: false, error: 'No existe ninguna cuenta registrada con este correo.' };
      }
      const { username } = res.rows[0];
      await sendRecoveryPin(cleanEmail, resetCode, username);
      return { success: true, username };
    } catch (err) {
      console.error('[recovery.repo] requestPasswordReset:', err.message);
      return { success: false, error: 'Error al solicitar el PIN de recuperación.' };
    }
  }

  const users = readUsers();
  const key = Object.keys(users).find(k => String(users[k].email).toLowerCase() === cleanEmail);
  if (!key) return { success: false, error: 'No existe ninguna cuenta registrada con este correo.' };

  users[key].resetCode = resetCode;
  writeUsers(users);
  await sendRecoveryPin(cleanEmail, resetCode, users[key].username);
  return { success: true, username: users[key].username };
}

export async function resetPassword(email, resetCode, newPassword) {
  const cleanEmail = String(email).trim().toLowerCase();
  const cleanPin = String(resetCode).trim();
  const newHash = hashPassword(newPassword);

  if (isPgConnected()) {
    try {
      const res = await pool.query(
        'SELECT id FROM triad_game_users WHERE LOWER(email) = $1 AND reset_code = $2',
        [cleanEmail, cleanPin]
      );
      if (res.rows.length === 0) {
        return { success: false, error: 'PIN de recuperación inválido o caducado.' };
      }
      await pool.query(
        'UPDATE triad_game_users SET password = $1, reset_code = NULL WHERE id = $2',
        [newHash, res.rows[0].id]
      );
      return { success: true, message: '¡Contraseña actualizada con éxito!' };
    } catch (err) {
      console.error('[recovery.repo] resetPassword:', err.message);
      return { success: false, error: 'Error al actualizar la contraseña.' };
    }
  }

  const users = readUsers();
  const key = Object.keys(users).find(
    k => String(users[k].email).toLowerCase() === cleanEmail && users[k].resetCode === cleanPin
  );
  if (!key) return { success: false, error: 'PIN de recuperación inválido o caducado.' };

  users[key].password = newHash;
  users[key].resetCode = null;
  writeUsers(users);
  return { success: true, message: '¡Contraseña actualizada con éxito!' };
}
