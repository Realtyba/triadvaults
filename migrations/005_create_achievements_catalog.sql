-- Migración 005: catálogo de logros en base de datos.
--
-- Sustituye lo que decía la 004: la definición de los logros ya no vive solo en
-- código. Estaba en `shared/achievements.js` y eso obligaba a publicar una versión
-- nueva del juego para añadir un logro. Aquí la definición es una fila, y el código
-- se queda con el motor que la interpreta.
--
-- `conditions` es un array JSON de `{metric, op, value}` que se acumulan con Y
-- lógico, y NO una función serializada: ejecutar texto guardado en una tabla
-- convertiría cualquier escritura en la base de datos en ejecución de código dentro
-- del servidor.
--
-- La restricción de aquí es deliberadamente estructural (que sea un array y no esté
-- vacío). Comprobar además que cada `metric` exista obligaría a mantener la lista de
-- métricas dentro del esquema, que es justo el acoplamiento que esta migración viene
-- a quitar: las métricas las calcula el servidor, así que su lista vive con él. Esa
-- comprobación la hace el repositorio al cargar —informando por consola de la fila
-- concreta— y `npm run validate:achievements` sobre el catálogo vivo.

CREATE TABLE IF NOT EXISTS triad_achievements (
    key VARCHAR(50) PRIMARY KEY,
    icon VARCHAR(30) NOT NULL DEFAULT 'trophy',
    title_es TEXT NOT NULL,
    title_en TEXT NOT NULL,
    description_es TEXT NOT NULL,
    description_en TEXT NOT NULL,
    conditions JSONB NOT NULL,
    sort_order INTEGER NOT NULL DEFAULT 100,
    enabled BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT triad_achievements_conditions_shape
        CHECK (jsonb_typeof(conditions) = 'array' AND jsonb_array_length(conditions) > 0)
);

-- El catálogo se lee entero y ordenado en cada refresco de caché.
CREATE INDEX IF NOT EXISTS idx_triad_achievements_order
    ON triad_achievements(enabled, sort_order);

-- Un logro retirado se marca `enabled = FALSE` en lugar de borrarse: quien ya lo
-- tuviera conserva su fila en `triad_user_achievements`, y borrar la definición
-- dejaría esas filas apuntando a un logro sin nombre que la interfaz no sabría
-- pintar.
COMMENT ON COLUMN triad_achievements.enabled IS
    'FALSE retira el logro de las evaluaciones futuras sin quitárselo a quien ya lo tenga';

-- La siembra inicial no va aquí: los nueve logros de salida están en
-- `DEFAULT_ACHIEVEMENTS` (shared/achievements.js) y el servidor los inserta al
-- arrancar **solo si la tabla está vacía**. Duplicarlos en SQL sería el mismo
-- problema de dos sitios que mantener sincronizados, y sembrar en cada arranque
-- resucitaría los que alguien hubiera borrado a propósito.
