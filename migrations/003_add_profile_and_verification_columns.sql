-- Migración 003: columnas de perfil, verificación de correo y tiempo jugado.
--
-- Estas columnas se venían creando solo desde `server/db/pool.js` al arrancar el
-- servidor, así que el esquema que dejaban las migraciones estaba incompleto: una
-- base recién creada con `npm run db:setup` no servía hasta levantar el juego una
-- vez, y cualquier script que insertara directamente fallaba.

ALTER TABLE triad_game_users
  ADD COLUMN IF NOT EXISTS first_name VARCHAR(50),
  ADD COLUMN IF NOT EXISTS last_name VARCHAR(50),
  ADD COLUMN IF NOT EXISTS is_verified BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS verification_code VARCHAR(10),
  ADD COLUMN IF NOT EXISTS total_time_played INTEGER DEFAULT 0;

-- El PIN de verificación se consulta junto al nombre de usuario al validarlo.
CREATE INDEX IF NOT EXISTS idx_triad_users_verification_code
  ON triad_game_users(verification_code)
  WHERE verification_code IS NOT NULL;
