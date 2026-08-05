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
        first_name VARCHAR(50),
        last_name VARCHAR(50),
        reset_code VARCHAR(10),
        is_verified BOOLEAN DEFAULT FALSE,
        verification_code VARCHAR(10),
        max_level_reached INTEGER DEFAULT 1,
        total_puzzles_solved INTEGER DEFAULT 0,
        is_online BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `;
    await client.query(createTableQuery);

    try {
      await client.query('ALTER TABLE triad_game_users ADD COLUMN first_name VARCHAR(50)');
      await client.query('ALTER TABLE triad_game_users ADD COLUMN last_name VARCHAR(50)');
    } catch (e) { /* Column already exists */ }

    try {
      await client.query('ALTER TABLE triad_game_users ADD COLUMN is_verified BOOLEAN DEFAULT FALSE');
      await client.query('ALTER TABLE triad_game_users ADD COLUMN verification_code VARCHAR(10)');
    } catch (e) { /* Column already exists */ }

    client.release();
  } catch (err) {
    console.warn('⚠️ No se pudo conectar a PostgreSQL, usando almacenamiento local de respaldo.');
    isPgConnected = false;
  }
}

initPgTables();

export class DatabaseManager {
  // 1. REGISTER USER
  static async registerUser(firstName, lastName, username, email, password) {
    const cleanUser = username.trim();
    const cleanEmail = email.trim().toLowerCase();
    const cleanFirst = firstName ? firstName.trim() : 'Agente';
    const cleanLast = lastName ? lastName.trim() : 'Desconocido';
    const secureHash = hashPassword(password);
    const verificationCode = Math.floor(100000 + Math.random() * 900000).toString();

    if (isPgConnected) {
      try {
        const query = `
          INSERT INTO triad_game_users (first_name, last_name, username, email, password, is_verified, verification_code, max_level_reached, total_puzzles_solved)
          VALUES ($1, $2, $3, $4, $5, FALSE, $6, 1, 0)
          RETURNING id, first_name, last_name, username, email, is_verified, max_level_reached, total_puzzles_solved;
        `;
        const res = await pool.query(query, [cleanFirst, cleanLast, cleanUser, cleanEmail, secureHash, verificationCode]);
        const u = res.rows[0];
        return {
          success: true,
          user: {
            id: u.id,
            firstName: u.first_name,
            lastName: u.last_name,
            username: u.username,
            email: u.email,
            isVerified: u.is_verified,
            maxLevelReached: u.max_level_reached,
            totalPuzzlesSolved: u.total_puzzles_solved
          },
          verificationCode: verificationCode // passed back to trigger email in index.js
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
        firstName: cleanFirst,
        lastName: cleanLast,
        username: cleanUser,
        email: cleanEmail,
        password: secureHash,
        isVerified: false,
        verificationCode: verificationCode,
        maxLevelReached: 1,
        totalPuzzlesSolved: 0,
        resetCode: null
      };

      fs.writeFileSync(JSON_DB_FILE, JSON.stringify(users, null, 2));
      return { success: true, user: users[cleanUser.toLowerCase()], verificationCode };
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
            firstName: user.first_name || 'Agente',
            lastName: user.last_name || 'Desconocido',
            username: user.username,
            email: user.email,
            isVerified: user.is_verified,
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

      if (!user.firstName) user.firstName = 'Agente';
      if (!user.lastName) user.lastName = 'Desconocido';

      return { success: true, user };
    }
  }

  // 2b. GET USER DATA
  static async getUserData(username) {
    const cleanUser = username.trim().toLowerCase();
    if (isPgConnected) {
      try {
        const res = await pool.query('SELECT max_level_reached FROM triad_game_users WHERE LOWER(username) = $1', [cleanUser]);
        if (res.rows.length > 0) return res.rows[0].max_level_reached;
      } catch (e) {
        return 1;
      }
    } else {
      const users = JSON.parse(fs.readFileSync(JSON_DB_FILE, 'utf-8') || '{}');
      const userKey = Object.keys(users).find(k => k.toLowerCase() === cleanUser);
      if (userKey && users[userKey]) return users[userKey].maxLevelReached || 1;
    }
    return 1;
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

  // 6. VERIFY EMAIL
  static async verifyEmail(username, code) {
    const cleanUser = username.trim().toLowerCase();
    const cleanCode = code.trim();

    if (isPgConnected) {
      try {
        const res = await pool.query(
          'SELECT * FROM triad_game_users WHERE LOWER(username) = $1 AND verification_code = $2',
          [cleanUser, cleanCode]
        );
        if (res.rows.length === 0) return { success: false, error: 'Código inválido.' };

        await pool.query('UPDATE triad_game_users SET is_verified = TRUE, verification_code = NULL WHERE LOWER(username) = $1', [cleanUser]);
        return { success: true };
      } catch (err) {
        return { success: false, error: 'Error al verificar correo.' };
      }
    } else {
      const users = JSON.parse(fs.readFileSync(JSON_DB_FILE, 'utf-8') || '{}');
      const key = Object.keys(users).find(k => k.toLowerCase() === cleanUser);
      if (!key || users[key].verificationCode !== cleanCode) return { success: false, error: 'Código inválido.' };
      
      users[key].isVerified = true;
      users[key].verificationCode = null;
      fs.writeFileSync(JSON_DB_FILE, JSON.stringify(users, null, 2));
      return { success: true };
    }
  }

  // 7. UPDATE PROFILE
  static async updateProfile(userId, firstName, lastName, newEmail) {
    const cleanFirst = firstName ? firstName.trim() : 'Agente';
    const cleanLast = lastName ? lastName.trim() : 'Desconocido';
    const cleanEmail = newEmail.trim().toLowerCase();
    const newCode = Math.floor(100000 + Math.random() * 900000).toString();

    if (isPgConnected) {
      try {
        // First check if email is taken by someone else
        const emailCheck = await pool.query('SELECT id, email FROM triad_game_users WHERE LOWER(email) = $1 AND id != $2', [cleanEmail, userId]);
        if (emailCheck.rows.length > 0) return { success: false, error: 'Este correo ya está en uso por otro agente.' };

        // Fetch current user
        const curr = await pool.query('SELECT email FROM triad_game_users WHERE id = $1', [userId]);
        if (curr.rows.length === 0) return { success: false, error: 'Usuario no encontrado.' };

        const emailChanged = curr.rows[0].email !== cleanEmail;
        
        if (emailChanged) {
          await pool.query(
            'UPDATE triad_game_users SET first_name = $1, last_name = $2, email = $3, is_verified = FALSE, verification_code = $4 WHERE id = $5',
            [cleanFirst, cleanLast, cleanEmail, newCode, userId]
          );
        } else {
          await pool.query(
            'UPDATE triad_game_users SET first_name = $1, last_name = $2 WHERE id = $3',
            [cleanFirst, cleanLast, userId]
          );
        }
        return { success: true, emailChanged, newCode };
      } catch (err) {
        return { success: false, error: 'Error al actualizar perfil.' };
      }
    } else {
      const users = JSON.parse(fs.readFileSync(JSON_DB_FILE, 'utf-8') || '{}');
      // No id in json DB, assume userId is username
      const userKey = Object.keys(users).find(k => k.toLowerCase() === userId.toLowerCase());
      if (!userKey) return { success: false, error: 'Usuario no encontrado.' };

      // check email taken
      const emailTaken = Object.keys(users).find(k => k !== userKey && users[k].email === cleanEmail);
      if (emailTaken) return { success: false, error: 'Este correo ya está en uso por otro agente.' };

      const emailChanged = users[userKey].email !== cleanEmail;
      users[userKey].firstName = cleanFirst;
      users[userKey].lastName = cleanLast;

      if (emailChanged) {
        users[userKey].email = cleanEmail;
        users[userKey].isVerified = false;
        users[userKey].verificationCode = newCode;
      }

      fs.writeFileSync(JSON_DB_FILE, JSON.stringify(users, null, 2));
      return { success: true, emailChanged, newCode };
    }
  }

  // 8. GET LEADERBOARD
  static async getLeaderboard() {
    if (isPgConnected) {
      try {
        const query = `
          SELECT username, first_name, last_name, max_level_reached, total_puzzles_solved
          FROM triad_game_users
          ORDER BY max_level_reached DESC, total_puzzles_solved DESC
          LIMIT 10;
        `;
        const res = await pool.query(query);
        return res.rows.map(u => ({
          username: u.username,
          firstName: u.first_name || 'Agente',
          lastName: u.last_name || 'Desconocido',
          maxLevelReached: u.max_level_reached,
          totalPuzzlesSolved: u.total_puzzles_solved
        }));
      } catch (err) {
        console.error('Error fetching leaderboard in Postgres:', err.message);
        return [];
      }
    } else {
      const users = JSON.parse(fs.readFileSync(JSON_DB_FILE, 'utf-8') || '{}');
      const list = Object.values(users).map(u => ({
        username: u.username,
        firstName: u.firstName || 'Agente',
        lastName: u.lastName || 'Desconocido',
        maxLevelReached: u.maxLevelReached || 1,
        totalPuzzlesSolved: u.totalPuzzlesSolved || 0
      }));
      list.sort((a, b) => {
        if (b.maxLevelReached !== a.maxLevelReached) {
          return b.maxLevelReached - a.maxLevelReached;
        }
        return b.totalPuzzlesSolved - a.totalPuzzlesSolved;
      });
      return list.slice(0, 10);
    }
  }
}
