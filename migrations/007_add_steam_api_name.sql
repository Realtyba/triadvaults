-- Migración 007: nombre del logro equivalente en Steam.
--
-- Los logros de Steam se dan de alta en el portal de Steamworks con un identificador
-- propio (su "API Name"), independiente de nuestra clave. Hace falta saber cuál
-- corresponde a cuál para poder reflejarlos en el perfil del jugador.
--
-- La correspondencia va en la MISMA fila que el logro, y no en una tabla aparte ni
-- en código, para conservar lo que consiguió la migración 005: añadir un logro es un
-- `INSERT`. Si el nombre de Steam viviera en el código, cada logro nuevo volvería a
-- exigir publicar una versión del juego, que es justo de lo que veníamos.
--
-- Nula por defecto: un logro sin nombre de Steam sencillamente no se le envía. Es lo
-- que permite tener logros que solo existan en el juego, y añadir uno hoy y darlo de
-- alta en el portal la semana que viene.

ALTER TABLE triad_achievements
    ADD COLUMN IF NOT EXISTS steam_api_name VARCHAR(64);

COMMENT ON COLUMN triad_achievements.steam_api_name IS
    'API Name del logro equivalente en Steamworks; NULL = no se refleja en Steam';

-- Los nueve logros de salida. Se actualizan solo si la fila existe y aún no tiene
-- nombre asignado: quien ya lo hubiera puesto a mano manda sobre esto.
UPDATE triad_achievements SET steam_api_name = UPPER(key)
 WHERE steam_api_name IS NULL
   AND key IN ('first_escape', 'level_10', 'level_25', 'level_50', 'flawless',
               'speedrun', 'full_squad', 'centurion', 'survivor');
