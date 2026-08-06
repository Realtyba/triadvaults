# Triad Vaults — Arquitectura

Visión técnica del motor 3D, la generación procedural, el multijugador y la capa de interfaz.

---

## 1. Panorama

```
                 ┌──────────────────────────────────────────┐
                 │   Cliente (navegador / Electron Steam)    │
                 │                                          │
                 │  src/game/      bucle y estado de juego   │
                 │  src/engine/    render, cámara, luz, input│
                 │  src/entities/  jugador, fantasma, puzle  │
                 │  src/procedural/trazado y navegación      │
                 │  src/ui/        store + vistas + modales   │
                 │  src/network/   REST + socket              │
                 └────────────────────┬─────────────────────┘
                                      │  WebSocket / HTTP
                 ┌────────────────────┴─────────────────────┐
                 │        Servidor Node (Express + IO)       │
                 │                                          │
                 │  server/http/    rutas y middleware JWT   │
                 │  server/socket/  handlers por dominio     │
                 │  server/rooms/   estado de salas          │
                 │  server/db/      repositorios             │
                 └────────────────────┬─────────────────────┘
                                      │
                 ┌────────────────────┴─────────────────────┐
                 │  PostgreSQL  (respaldo: server/data/*.json)│
                 └──────────────────────────────────────────┘
```

`shared/events.js` define los nombres de evento y lo importan **ambos** lados: un
typo en una cadena no puede romper el multijugador en silencio.

---

## 2. Modelo de autoridad

Tres niveles, y conviene no mezclarlos:

| Qué | Quién decide | Por qué |
|---|---|---|
| Vida, muerte, reaparición, nivel, semilla | **servidor** | es el único estado que no se puede falsear desde el cliente |
| Posición del fantasma y a quién golpea | **host** (un cliente) | evita simular la IA en el servidor; el host solo *reporta* el impacto |
| Posición y rotación de cada agente | **su propio cliente** | movimiento responsivo sin esperar al servidor |

El host reporta `ghost_hit { targetUid }`; el servidor calcula la vida resultante y
la difunde con `player_health_changed`. Así el daño va siempre al agente correcto.

### Identidad

Un jugador **es** su `uid` (el id de usuario del JWT). El `socketId` es un dato
mutable dentro del jugador, nunca su clave. Ese es el detalle que hace que una
reconexión conserve el personaje, el color, la vida y la autoridad de host.

---

## 3. Ciclo de sala y reconexión

1. `create_room` / `join_room` → el servidor devuelve `room` (con `seed`, `currentLevel`, `players`).
2. `start_game` → todos reciben la misma semilla y construyen la **misma** bóveda.
3. Al desconectar: el jugador se marca `connected: false` de inmediato (la sala lo ve),
   y la autoridad de host pasa a otro conectado si hacía falta. Hay 15 s de gracia
   antes de expulsarlo.
4. Al reconectar: si sigue en la sala y no la abandonó a propósito, el servidor emite
   `reconnected_to_room` con la semilla original y el cliente reconstruye el nivel idéntico.
5. Si el reenganche **no** llega en 2,5 s (p. ej. el servidor se reinició y perdió las
   salas), el cliente descarta la sala fantasma, vuelve al menú y avisa al jugador.

Mientras no hay enlace, el bucle no simula: el personaje se congela en vez de
desincronizarse en silencio.

`leave_room` marca la salida como intencionada, de modo que el reenganche automático
no arrastre de vuelta a alguien que ya se fue — era la causa de que otros agentes no
pudieran unirse a una sala.

---

## 4. Generación procedural

Separada en dos capas para poder validarla sin navegador:

- **`LayoutGen.js`** (datos puros, sin Three.js) — decide dónde va todo:
  - PRNG sembrado (`rng.js`, mulberry32) en lugar de `Math.sin(seed + i)`, que producía
    secuencias correlacionadas y muros amontonados.
  - Los muros se colocan en celdas y se rechazan si tocan otro muro o las zonas de
    aparición/salida: nunca se fusionan en bloques amorfos.
  - **Flood fill** desde el punto de aparición: si la salida o alguna placa quedan
    aisladas, el trazado se descarta y se reintenta con la semilla siguiente.
- **`DungeonGen.js`** — construye la geometría a partir de ese trazado ya validado.
- **`NavGrid.js`** — rejilla de ocupación. Además de la conectividad, resuelve los
  puntos de aparición: reúne varias celdas libres cercanas y elige por `variant`, de
  forma que dos agentes no se apilen y reaparecer no devuelva siempre al mismo sitio.

`npm run validate:levels` comprueba cientos de trazados sin cabeza gráfica.

---

## 5. IA del fantasma

`TargetSelector.js` puntúa a cada agente **vivo** por cercanía, vida baja, si está
pisando una placa (interrumpe el puzle) y fatiga de persecución. Cambia de objetivo
solo si el rival supera al actual por un margen y ha pasado un tiempo mínimo: sin esa
histéresis el objetivo oscilaría cada frame.

El fantasma usa el mismo `physics/collision.js` que el jugador, así que desliza contra
los muros en vez de atravesarlos.

---

## 6. Capa de interfaz

`src/ui/state/Store.js` guarda el estado y **notifica por claves**: cada vista declara
de qué depende y solo se repinta cuando alguna cambia.

Dos reglas que sostienen el rendimiento:

- **El HUD no reconstruye HTML.** `HudView` monta su esqueleto una vez, cachea las
  referencias y en el bucle solo asigna `textContent` y `style.width`. Antes el bucle
  de render llamaba a `updateObjective()`, que reescribía el `innerHTML` de toda la
  interfaz 60 veces por segundo.
- **Los campos de formulario no viven en el store** (`FormState`). Si lo hicieran, cada
  tecla provocaría un repintado y el input perdería el foco a mitad de escritura.

Los eventos se resuelven por delegación con `data-action`, y todo dato escrito por un
usuario pasa por `esc()` antes de interpolarse.

Estructura:

```
src/ui/
  UIManager.js        orquestador: monta, suscribe y despacha acciones
  state/              Store + estado inicial + FormState
  views/              MainMenu, Auth, Profile, RoomBrowser, Leaderboard, Lobby, Hud, Reconnecting
  modals/             definiciones declarativas + host
  components/         RoomCard, PlayerCard, LeaderboardTable
  controllers/        AuthController, RoomController
```

---

## 7. Persistencia

`server/db/` está partido por repositorio (`users`, `recovery`, `progress`,
`leaderboard`) sobre un `pool` común, con `DatabaseManager` como fachada estable.

### Dónde vive la base de datos

| | |
|---|---|
| Motor | PostgreSQL en el contenedor Docker **`postgres-local`** (compartido con el resto del workspace) |
| Base | **`triadvaults`** — propia del juego, no la del CRM |
| Tabla | `triad_game_users` (más `triad_schema_migrations`, historial de migraciones) |
| Configuración | `server/db/config.js`, leída de `.env`; la comparten servidor, migrador y scripts |

Hubo un periodo en que el ejecutor de migraciones apuntaba a `tenant_realtyba` y el
servidor a otra base: las cuentas se creaban en un sitio y se buscaban en otro, así que
el acceso fallaba con credenciales correctas. Por eso **la configuración de conexión es
un único módulo** y nadie la reconstruye por su cuenta.

### Respaldo JSON y cómo saber cuál está activo

Si Postgres no responde, los repositorios caen a `server/data/users.json` para poder
jugar en local sin contenedor. Ese respaldo es un modo degradado, no un equivalente:
las cuentas de Postgres no se ven y el progreso no llega allí.

Para no confundir un servidor degradado con uno sano:

- El arranque imprime **`✅ PostgreSQL conectado`** o un recuadro de error con la causa
  y el comando que la arregla.
- `GET /api/health` devuelve `storage: "postgres" | "json"`.
- Con `DB_REQUIRED=true` (automático si `NODE_ENV=production`) el servidor **se niega a
  arrancar** en vez de degradarse.

### Puesta en marcha

```bash
npm run setup:env        # crea .env con un JWT_SECRET aleatorio (lo hace también `npm run dev`)
npm run db:setup         # crea la base "triadvaults" y aplica las migraciones
npm run db:import-legacy # opcional: trae cuentas de otra base
npm run db:import-legacy -- --from-json   # ...o del respaldo server/data/users.json
```

### Verificación de correo

El registro deja la cuenta en `is_verified = false` y exige un PIN de 6 dígitos antes de
jugar. Sin SMTP configurado el PIN no puede llegar por correo, así que con
`AUTH_DEV_ECHO_PIN=true` (nunca en producción) viaja en la respuesta como `devCode` y el
modal lo muestra en pantalla. La decisión se toma **con el resultado real del envío**:
unas credenciales de relleno pasan por configuradas y fallan igual.

`POST /api/resend-verification` emite un código nuevo, con 60 s de espera entre
peticiones. Es también el rescate de las cuentas antiguas, que no tienen ningún código
guardado y por tanto no podían verificarse con ningún valor.

---

## 8. Capa visual

El acabado de imagen vive en `src/engine/` y está gobernado por **un único sitio**:
`QualitySettings.js`. Sus presets (`bajo | medio | alto | ultra`) deciden postprocesado,
sombras, `pixelRatio`, SMAA, partículas y luces de acento. Se detecta uno inicial leyendo
el renderer real de WebGL —`devicePixelRatio` alto no implica GPU potente— y el jugador
puede cambiarlo desde **Ajustes**, con efecto inmediato.

| Módulo | Qué aporta |
|---|---|
| `PostFX.js` | bloom, viñeta, aberración cromática, grano y destello de daño, en un solo pase de shader |
| `textures.js` | rejillas y ruido generados por canvas: ningún fichero de imagen en el paquete |
| `Lighting.js` | clave rasante, contraluz y luces de acento que laten |
| `Particles.js` | motas de ambiente e impactos, con el pool reservado por adelantado |
| `CameraShake.js` | sacudida con decaimiento al cuadrado, muestreada de ondas continuas |
| `AmbientScene.js` | bóveda decorativa que orbita detrás del menú |

Dos decisiones que no son evidentes:

- El grano se atenúa en las sombras (`grainMask`). Aplicado plano, las zonas oscuras —que
  aquí son casi toda la pantalla— se llenaban de puntos y parecían ruido de vídeo.
- Las molduras de los muros van **metidas hacia dentro**. Con la cámara cenital lo que se
  ve de un muro es su cara superior, y una moldura del mismo tamaño la tapaba entera:
  todos los muros se leían como losas de neón macizas, sin volumen.

En la interfaz, `--accent` lo reescribe `UIManager.applyThemeAccent()` con el color del
bioma, así que el HUD acompaña al nivel. Los iconos son SVG en `src/ui/icons.js`: los
emoji anteriores salían como cuadros vacíos en Linux.

---

## 9. Arquetipos de puzle

`src/procedural/puzzles/` contiene cuatro reglas distintas bajo una interfaz común
(`PuzzleArchetype`). `PuzzleGen` dejó de *ser* el puzle y pasó a elegir cuál toca.

| Clave | Regla | Agentes |
|---|---|---|
| `plates` | todas las placas pisadas a la vez | 1-3 |
| `sequence` | pisarlas en el orden que marca su color; fallar reinicia | 1-3 |
| `timed` | cada placa se apaga sola; activarlas todas antes de que expire la primera | 1-3 |
| `relay` | uno sostiene el ancla mientras los demás cierran terminales | **2-3** |

Tres decisiones que sostienen esto:

- **La elección es determinista.** Sale del PRNG sembrado con la semilla del servidor
  (`selectPuzzleType`), nunca de `Math.random`. Si dos agentes de la misma sala eligieran
  distinto, uno vería placas y el otro una secuencia: la partida sería injugable **sin
  ningún error visible**. `validate:puzzles` comprueba explícitamente el determinismo.
- **El arquetipo se elige antes de trazar la sala**, porque cada uno necesita un número
  distinto de nodos y las celdas hay que reservarlas al generar el trazado.
- **Los niveles 1-3 son siempre `plates`**: enseñan el juego antes de complicarlo.

`relay` no se ofrece en solitario porque sin un segundo agente *no tiene solución* — no es
que sea difícil. `supports(playersCount)` es lo que lo impide, y la validación falla si
alguna vez se selecciona para un solo agente.

### Dificultad del fantasma

La velocidad crece asintóticamente hacia 7,5 (el jugador va a 8,5), no en rampa recta: la
curva anterior pegaba un estirón entre los niveles 5 y 15 y luego se quedaba plana.
Alcanzado el techo, lo que sube es la **agresividad** del `TargetSelector` — reacciona
antes y se ceba con quien está sobre un nodo. Subir más la velocidad bruta haría el juego
imposible, no más interesante.

---

## 10. Logros

Catálogo en `shared/achievements.js`, que importan **servidor y cliente** igual que
`events.js`. En Postgres solo se guarda qué ha desbloqueado cada agente
(`triad_user_achievements`), no la definición: una tabla de catálogo sería un segundo sitio
que mantener sincronizado con el código, sin ganar nada.

**La evaluación es del servidor**, en el handler de `LEVEL_COMPLETE`. Los logros se ven en
el perfil y son públicos, así que dejar que el navegador decidiera cuáles se ha ganado sería
regalarlos a quien abriera la consola.

Los contadores que necesitan (`levelDamageTaken`, `levelDeaths`) viven en el estado de sala
y se reinician con cada nivel: "sin recibir un golpe" y "tras caer tres veces" no se pueden
deducir del estado final. La concesión usa `ON CONFLICT DO NOTHING` y devuelve solo lo que
insertó de verdad, de modo que tres clientes reportando el mismo nivel a la vez no producen
ni duplicados ni avisos repetidos.

---

## 11. Comprobaciones

| Comando | Qué valida |
|---|---|
| `npm run validate` | ambas validaciones de abajo |
| `npm run validate:levels` | trazados jugables, y que cada arquetipo reciba los nodos que pide |
| `npm run validate:puzzles` | que cada arquetipo **se pueda resolver**, y que su restricción no se pueda saltar |
| `npm run test:e2e` | juego real en Chrome: solo, dúo y reconexión (requiere `npm run dev`) |
| `npm run build` | que el grafo de módulos del cliente resuelve |
| `curl localhost:3001/api/health` | que el servidor sirve desde Postgres y no desde el respaldo |

`validate:levels` verifica el trazado; `validate:puzzles` verifica la **regla**. Hacen falta
las dos: un arquetipo cuya condición de victoria nunca se cumpla dejaría al jugador
encerrado en una sala perfectamente jugable, que es el peor fallo posible — no hay error, no
hay aviso, simplemente no se puede salir.
