import pkg from 'pg';
const { Pool } = pkg;
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { sendRecoveryPin } from './mailer.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Helper for Secure Password Hashing with Salt
function hashPassword(password, salt = null) {
  if (!salt) salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.pbkdf2Sync(password, salt, 10000, 64, 'sha512').toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(password, storedHash) {
  if (!storedHash || !storedHash.includes(':')) return false;
  const [salt, originalHash] = storedHash.split(':');
  const hash = crypto.pbkdf2Sync(password, salt, 10000, 64, 'sha512').toString('hex');
  return hash === originalHash;
}

// PostgreSQL Connection Pool Config
const pgConfig = {
  user: process.env.DB_USERNAME || 'postgres',
  password: process.env.DB_PASSWORD || 'Qwerty1234ll.',
  host: process.env.DB_HOST || '127.0.0.1',
  port: parseInt(process.env.DB_PORT || '5432'),
  database: process.env.DB_DATABASE || 'tenant_realtyba',
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000
};

const pool = new Pool(pgConfig);
let isPgConnected = false;

// Fallback JSON DB file
const DATA_DIR = path.join(__dirname, 'data');
const JSON_DB_FILE = path.join(DATA_DIR, 'users.json');

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(JSON_DB_FILE)) fs.writeFileSync(JSON_DB_FILE, JSON.stringify({}, null, 2));

// Initialize PostgreSQL Tables
async function initPgTables() {
  try {
    const client = await pool.connect();
    isPgConnected = true;
    console.log('✅ Conectado exitosamente a la Base de Datos PostgreSQL local!');

    const createTableQuery = `
      CREATE TABLE IF NOT EXISTS triad_game_users (
        id SERIAL PRIMARY KEY,
        username VARCHAR(50) UNIQUE NOT NULL,
        email VARCHAR(100) UNIQUE NOT NULL,
        password VARCHAR(255) NOT NULL,
        reset_code VARCHAR(10),
        max_level_reached INTEGER DEFAULT 1,
        total_puzzles_solved INTEGER DEFAULT 0,
        is_online BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `;
    await client.query(createTableQuery);
    client.release();
  } catch (err) {
    console.warn('⚠️ No se pudo conectar a PostgreSQL, usando almacenamiento local de respaldo.');
    isPgConnected = false;
  }
}

initPgTables();

export class DatabaseManager {
  // 1. REGISTER USER
  static async registerUser(username, email, password) {
    const cleanUser = username.trim();
    const cleanEmail = email.trim().toLowerCase();
    const secureHash = hashPassword(password);

    if (isPgConnected) {
      try {
        const query = `
          INSERT INTO triad_game_users (username, email, password, max_level_reached, total_puzzles_solved)
          VALUES ($1, $2, $3, 1, 0)
          RETURNING id, username, email, max_level_reached, total_puzzles_solved;
        `;
        const res = await pool.query(query, [cleanUser, cleanEmail, secureHash]);
        const u = res.rows[0];
        return {
          success: true,
          user: {
            id: u.id,
            username: u.username,
            email: u.email,
            maxLevelReached: u.max_level_reached,
            totalPuzzlesSolved: u.total_puzzles_solved
          }
        };
      } catch (err) {
        if (err.code === '23505') {
          if (err.detail && err.detail.includes('email')) {
            return { success: false, error: 'El correo electrónico ya está registrado en otra cuenta.' };
          }
          return { success: false, error: 'El nombre de usuario ya está ocupado por otro agente.' };
        }
        return { success: false, error: 'Error al registrar usuario en la base de datos.' };
      }
    } else {
      const users = JSON.parse(fs.readFileSync(JSON_DB_FILE, 'utf-8') || '{}');
      const existingUser = Object.values(users).find(
        u => u.username.toLowerCase() === cleanUser.toLowerCase() || u.email === cleanEmail
      );
      if (existingUser) {
        return { success: false, error: 'El usuario o correo electrónico ya existe.' };
      }

      users[cleanUser.toLowerCase()] = {
        username: cleanUser,
        email: cleanEmail,
        password: secureHash,
        maxLevelReached: 1,
        totalPuzzlesSolved: 0,
        resetCode: null
      };

      fs.writeFileSync(JSON_DB_FILE, JSON.stringify(users, null, 2));
      return { success: true, user: users[cleanUser.toLowerCase()] };
    }
  }

  // 2. LOGIN USER
  static async loginUser(identifier, password) {
    const cleanId = identifier.trim().toLowerCase();

    if (isPgConnected) {
      try {
        const query = `
          SELECT * FROM triad_game_users 
          WHERE LOWER(username) = $1 OR LOWER(email) = $1;
        `;
        const res = await pool.query(query, [cleanId]);
        if (res.rows.length === 0) {
          return { success: false, error: 'Usuario o Correo no encontrado. Regístrate primero.' };
        }

        const user = res.rows[0];
        const isMatch = verifyPassword(password, user.password) || user.password === password;
        if (!isMatch) {
          return { success: false, error: 'Contraseña incorrecta.' };
        }

        await pool.query('UPDATE triad_game_users SET is_online = TRUE WHERE id = $1', [user.id]);

        return {
          success: true,
          user: {
            id: user.id,
            username: user.username,
            email: user.email,
            maxLevelReached: user.max_level_reached,
            totalPuzzlesSolved: user.total_puzzles_solved
          }
        };
      } catch (err) {
        return { success: false, error: 'Error de autenticación.' };
      }
    } else {
      const users = JSON.parse(fs.readFileSync(JSON_DB_FILE, 'utf-8') || '{}');
      const userKey = Object.keys(users).find(
        k => k === cleanId || users[k].email === cleanId
      );

      if (!userKey || !users[userKey]) {
        return { success: false, error: 'Usuario o Correo no encontrado.' };
      }

      const user = users[userKey];
      const isMatch = verifyPassword(password, user.password) || user.password === password;
      if (!isMatch) {
        return { success: false, error: 'Contraseña incorrecta.' };
      }

      return { success: true, user };
    }
  }

  // 3. REQUEST PASSWORD RESET CODE
  static async requestPasswordReset(email) {
    const cleanEmail = email.trim().toLowerCase();
    const resetCode = Math.floor(100000 + Math.random() * 900000).toString();

    if (isPgConnected) {
      try {
        const res = await pool.query(
          'UPDATE triad_game_users SET reset_code = $1 WHERE LOWER(email) = $2 RETURNING username',
          [resetCode, cleanEmail]
        );
        if (res.rows.length === 0) {
          return { success: false, error: 'No existe ninguna cuenta registrada con este correo.' };
        }
        const username = res.rows[0].username;
        await sendRecoveryPin(cleanEmail, resetCode, username);
        return { success: true, username };
      } catch (err) {
        return { success: false, error: 'Error al solicitar el PIN de recuperación.' };
      }
    } else {
      const users = JSON.parse(fs.readFileSync(JSON_DB_FILE, 'utf-8') || '{}');
      const userKey = Object.keys(users).find(k => users[k].email === cleanEmail);
      if (!userKey) {
        return { success: false, error: 'No existe ninguna cuenta registrada con este correo.' };
      }
      users[userKey].resetCode = resetCode;
      fs.writeFileSync(JSON_DB_FILE, JSON.stringify(users, null, 2));
      const username = users[userKey].username;
      await sendRecoveryPin(cleanEmail, resetCode, username);
      return { success: true, username };
    }
  }

  // 4. RESET PASSWORD WITH PIN CODE
  static async resetPassword(email, resetCode, newPassword) {
    const cleanEmail = email.trim().toLowerCase();
    const cleanPin = resetCode.trim();
    const newSecureHash = hashPassword(newPassword);

    if (isPgConnected) {
      try {
        const res = await pool.query(
          'SELECT * FROM triad_game_users WHERE LOWER(email) = $1 AND reset_code = $2',
          [cleanEmail, cleanPin]
        );

        if (res.rows.length === 0) {
          return { success: false, error: 'PIN de recuperación inválido o caducado.' };
        }

        await pool.query(
          'UPDATE triad_game_users SET password = $1, reset_code = NULL WHERE LOWER(email) = $2',
          [newSecureHash, cleanEmail]
        );
        return { success: true, message: '¡Contraseña actualizada con éxito!' };
      } catch (err) {
        return { success: false, error: 'Error al actualizar la contraseña.' };
      }
    } else {
      const users = JSON.parse(fs.readFileSync(JSON_DB_FILE, 'utf-8') || '{}');
      const userKey = Object.keys(users).find(
        k => users[k].email === cleanEmail && users[k].resetCode === cleanPin
      );

      if (!userKey) {
        return { success: false, error: 'PIN de recuperación inválido o caducado.' };
      }

      users[userKey].password = newSecureHash;
      users[userKey].resetCode = null;
      fs.writeFileSync(JSON_DB_FILE, JSON.stringify(users, null, 2));
      return { success: true, message: '¡Contraseña actualizada con éxito!' };
    }
  }

  // 5. SAVE LEVEL PROGRESS & RETURN UPDATED STATS
  static async saveProgress(username, levelReached) {
    if (!username) return null;
    const cleanUser = username.trim();

    if (isPgConnected) {
      try {
        const res = await pool.query(
          `UPDATE triad_game_users 
           SET max_level_reached = GREATEST(max_level_reached, $1),
               total_puzzles_solved = total_puzzles_solved + 1
           WHERE LOWER(username) = LOWER($2)
           RETURNING username, email, max_level_reached, total_puzzles_solved;`,
          [levelReached, cleanUser]
        );
        if (res.rows.length > 0) {
          const u = res.rows[0];
          return {
            username: u.username,
            email: u.email,
            maxLevelReached: u.max_level_reached,
            totalPuzzlesSolved: u.total_puzzles_solved
          };
        }
      } catch (err) {
        console.error('Error saving progress in Postgres:', err.message);
      }
    } else {
      const users = JSON.parse(fs.readFileSync(JSON_DB_FILE, 'utf-8') || '{}');
      const key = Object.keys(users).find(k => k.toLowerCase() === cleanUser.toLowerCase());
      if (key && users[key]) {
        users[key].maxLevelReached = Math.max(users[key].maxLevelReached || 1, levelReached);
        users[key].totalPuzzlesSolved = (users[key].totalPuzzlesSolved || 0) + 1;
        fs.writeFileSync(JSON_DB_FILE, JSON.stringify(users, null, 2));
        return {
          username: users[key].username,
          email: users[key].email,
          maxLevelReached: users[key].maxLevelReached,
          totalPuzzlesSolved: users[key].totalPuzzlesSolved
        };
      }
    }
    return null;
  }
}
