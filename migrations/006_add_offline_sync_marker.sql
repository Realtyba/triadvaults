-- Migración 006: marca de agua de la última sincronización sin conexión.
--
-- El volcado de lo jugado sin red es de entrega "al menos una vez": el cliente no
-- borra un nivel de su cola hasta que el servidor confirma, así que si la respuesta
-- se pierde por el camino —red que se corta justo después de escribir— lo reenvía.
-- Sin nada que lo distinga, el servidor lo aplicaría por segunda vez y el jugador
-- vería su tiempo y sus acertijos contados dos veces.
--
-- Cada nivel jugado sin conexión lleva el instante en que se terminó. Aquí se guarda
-- el más reciente ya aplicado, y todo lo que no lo supere se descarta. Es una sola
-- columna en lugar de una tabla de niveles vistos: el orden de la cola es cronológico
-- y no hay forma de que llegue un nivel más antiguo que otro ya aplicado.

ALTER TABLE triad_game_users
    ADD COLUMN IF NOT EXISTS last_offline_sync_at BIGINT NOT NULL DEFAULT 0;

COMMENT ON COLUMN triad_game_users.last_offline_sync_at IS
    'Marca temporal (ms) del último nivel sin conexión aplicado; descarta los reenvíos';
