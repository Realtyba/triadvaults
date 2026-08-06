# Triad Vaults — Cuentas, seguridad y persistencia

**Este servidor ya no tiene base de datos.** Las cuentas, el progreso, los logros y
el correo viven en `realtyba-api` (Laravel). Aquí solo se coordinan salas co-op en
memoria.

Si buscas el esquema, las migraciones o el flujo de registro, están en el otro
repositorio; este documento explica el reparto y dónde mirar cada cosa.

---

## Reparto

| Qué | Dónde | Por qué |
|---|---|---|
| Registro, login, PIN, perfil, recuperación | `realtyba-api` | Ya tenía auth, correo, permisos y panel; el juego los reimplementaba a mano |
| Progreso y logros concedidos | `realtyba-api` (BD `triadvaults`) | Es lo que hay que administrar y auditar |
| Catálogo de logros | `realtyba-api` + panel en `realtyba-front` | Añadir un logro era editar SQL a mano |
| Salas, posiciones, daño, sincronía | Este servidor, **en memoria** | Una partida que nadie juega no tiene por qué sobrevivir a un reinicio |

Lo que desapareció de aquí: `server/db/`, `server/http/`, `server/mailer.js`,
`server/services/progression.js`, `migrations/` y el respaldo `server/data/users.json`
(el modo degradado sin Postgres ya no existe: si la API no responde, no hay sesión).

---

## Contraseñas

El juego guardaba `salt:hash` con un PBKDF2-SHA512 artesanal (10 000 iteraciones,
64 bytes → **128 caracteres hexadecimales**), y antes de eso las guardaba en claro.

Esas cuentas siguen funcionando. Laravel las verifica en
`app/Services/V1/TriadVaults/LegacyPasswordHasher.php` y **las reescribe con bcrypt
en el primer inicio de sesión correcto**, que es el único momento en que se conoce
la contraseña original.

El orden de detección importa y está documentado en ese fichero: bcrypt primero,
`salt:hash` después, texto plano al final. Comprobar antes «¿contiene `:`?» —que es
lo que hacía el código JavaScript— mandaría los hashes bcrypt a la rama de texto
plano, donde no coincidirían nunca.

---

## Token de jugador

Un JWT **HS256** que emite Laravel al iniciar sesión y que sirve para dos cosas: las
llamadas REST y el handshake del socket de este servidor.

Se verifica **sin red** en `server/socket/authMiddleware.js`. Es deliberado:
`src/network/SocketClient.js` reintenta la conexión hasta 12 veces, y consultar a
Laravel en cada intento haría que una caída suya echase de la partida a gente que
está jugando entre ellos.

El precio de verificar sin consultar es que revocar no es inmediato. Por eso el token
lleva el claim `tv` (`token_version`): suspender una cuenta lo incrementa en la fila,
y `socket/index.js` lo contrasta al conectar contra lo que dice la API.

Claims: `{sub, username, tv, iss: 'realtyba-api', aud: 'triadvaults', iat, exp}`.
Vida: 7 días (el juego no tiene flujo de refresco).

`TRIADVAULTS_JWT_SECRET` tiene que valer **lo mismo** en los dos `.env`, y medir al
menos 32 bytes: `firebase/php-jwt` rechaza al firmar cualquier clave más corta que el
digest de HS256. Sin él, este servidor **se niega a arrancar** — antes avisaba y
seguía con una clave de desarrollo conocida, que cualquiera podía leer del repositorio
para firmarse un token válido.

---

## Reportar progreso

Cuando una sala completa un nivel, este servidor llama a
`POST /api/triadvaults/internal/progress` **con todos los participantes en una sola
petición**, autenticándose con la cabecera `X-Internal-Secret`.

No con el token del jugador: quien reporta es el servidor, y es él quien sabe lo que
pasó de verdad en la sala. Un cliente con el token de su cuenta no podría reportar por
los otros dos agentes.

La llamada tiene 2 s de tope y **no reintenta**. Va en el camino caliente del cambio
de nivel, con los tres jugadores mirando la pantalla de carga: antes que hacerles
esperar por una API lenta, se pierde el registro de ese nivel —que es exactamente lo
que ya pasaba cuando el guardado fallaba.

---

## Esquema y migraciones

Están en `realtyba-api`:

- Migraciones: `database/migrations/TriadVaults/`
- Seeder del catálogo de logros: `database/seeders/TriadVaults/AchievementCatalogSeeder.php`
- Conexión: bloque `triadvaults` de `config/database.php`

```bash
# Desde realtyba-api
php artisan migrate --database=triadvaults --path="database/migrations/TriadVaults"
php artisan db:seed --database=triadvaults \
  --class="Database\Seeders\TriadVaults\AchievementCatalogSeeder"
```

La migración baseline es **idempotente**: replica el estado final de las siete
migraciones SQL que traía el juego, con guardas `hasTable`/`hasColumn`. Sirve tanto
para la base de desarrollo que ya existe —creada por el runner del juego, que llevaba
su propio registro en `triad_schema_migrations`— como para levantar un entorno desde
cero.

El seeder siembra **solo si la tabla está vacía**. No es un `upsert` por fila a
propósito: eso resucitaría en cada arranque cualquier logro que un administrador
hubiera retirado desde el panel.

---

## Privacidad

La clasificación pública (`GET /api/triadvaults/leaderboard`) expone nombre de agente,
nombre y apellido, nivel, acertijos y tiempo jugado. **No** expone el correo, y
**oculta a los jugadores suspendidos** —dejarlos ocupando el podio es precisamente lo
que buscaba quien hizo trampas para llegar ahí.

El panel de administración sí los ve, marcados, junto con el correo y el recuento de
logros: quien revisa una sospecha necesita ver justo lo que la pública esconde.
