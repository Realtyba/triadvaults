-- Migración 004: logros desbloqueados por agente.
--
-- Solo se guarda QUÉ ha desbloqueado cada uno. La definición de los logros vive en
-- `shared/achievements.js`, que importan servidor y cliente: una tabla de catálogo
-- añadiría un segundo sitio que mantener sincronizado con el código, sin ganar nada.

CREATE TABLE IF NOT EXISTS triad_user_achievements (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES triad_game_users(id) ON DELETE CASCADE,
    achievement_key VARCHAR(50) NOT NULL,
    unlocked_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Un logro se concede una sola vez por agente. La restricción es lo que permite
-- insertar con ON CONFLICT DO NOTHING y despreocuparse de las condiciones de
-- carrera cuando tres clientes reportan el mismo nivel completado a la vez.
CREATE UNIQUE INDEX IF NOT EXISTS idx_triad_user_achievement_unique
    ON triad_user_achievements(user_id, achievement_key);

-- La consulta habitual es "todos los logros de este agente".
CREATE INDEX IF NOT EXISTS idx_triad_user_achievements_user
    ON triad_user_achievements(user_id);
