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
                 └───────┬──────────────────────┬───────────┘
                         │ REST                 │ WebSocket
                         │ (cuentas)            │ (partida)
        ┌────────────────┴──────────┐   ┌───────┴──────────────────────┐
        │  realtyba-api (Laravel)    │   │ Servidor de salas (Node + IO) │
        │                            │   │                              │
        │  cuentas, PIN, perfil      │   │  server/socket/  handlers     │
        │  progreso y logros         │   │  server/rooms/   salas        │
        │  catálogo + panel admin    │   │  server/services/apiClient.js │
        │  correo (servicio central) │   │                              │
        │                            │◄──┤  reporta el nivel completado  │
        │  BD `triadvaults`          │   │  (X-Internal-Secret, en lote) │
        └────────────────────────────┘   └──────────────────────────────┘
                                              sin base de datos:
                                              las salas viven en memoria
```

Dos servicios y **una sola variable por servicio**: `TRIADVAULTS_API_URL` para la API
y `VITE_SOCKET_URL` para el socket; las resuelve `src/network/endpoints.js`. Antes eran
el mismo proceso, y por eso `SocketClient.js` importaba la URL de `ApiClient.js`.

La de la API no lleva prefijo `VITE_` porque también la lee el servidor de salas, así
que al cliente llega horneada por `vite.config.js` como `__API_URL__`. Se inyecta esa
variable y solo esa, en vez de ampliar `envPrefix` a `TRIADVAULTS_`: con ese prefijo
`TRIADVAULTS_JWT_SECRET` y `TRIADVAULTS_INTERNAL_SECRET` acabarían publicados dentro
del bundle del cliente.

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

### Máquina de estados: `ghost/GhostBrain.js`

`TargetSelector` decide **a quién** persigue; `GhostBrain` decide **cómo**. Son tres
estados, y el reparto de si respeta o no la geometría va con ellos:

| estado | movimiento | velocidad | entra cuando |
|---|---|---|---|
| `STALK` (acecha) | ruta del `NavGrid`, **desliza contra muros** con `physics/collision.js` | 0,55× | por defecto, y al perderte de vista más de 2,5 s |
| `HUNT` (caza) | línea recta, **atraviesa la geometría** | 1× | te ve a menos de 12 unidades, o se le acaba la paciencia |
| `CHARGE` (embiste) | recta **congelada** al entrar, sin corregir | 1,7× durante 0,9 s y luego 0,7 s parado | te ve a menos de 4,5 unidades |

Antes atravesaba los muros **siempre**, con el argumento de que sin pathfinding una
aparición que respetase la geometría solo parecería un enemigo con la ruta rota. Es
cierto; también lo es que atravesando siempre la sala deja de significar nada, porque no
hay nada que hacer con un muro. Repartirlo por estado convierte el muro en una
herramienta —romper la línea de visión **funciona**— y hace que ser visto sea el momento
en el que todo cambia.

La embestida **no corrige** el rumbo durante su carga: es lo que la hace esquivable y por
tanto justa, y la recuperación posterior es la ventana para escapar.

### Lo que aporta el `NavGrid`

- `hasLineOfSight(ax, az, bx, bz)` — recorrido de vóxeles de Amanatides–Woo. **Simétrico
  por construcción**, que no es un detalle: con un Bresenham, A→B y B→A recorren celdas
  distintas cerca de un canto y el fantasma te vería a través de una pared por la que tú
  no lo ves.
- `computeFlowField(col, row)` — recorrido por anchura que devuelve las distancias hasta
  una celda. Campo de flujo y no A\*: la rejilla no pasa de 18×18 y **un campo sirve a
  todos los fantasmas que persigan a la misma presa**. Lo posee `LevelController`,
  cacheado por uid y recalculado solo al cambiar la presa de celda.

`npm run validate:ghost` comprueba sobre 240 trazados que todo lo alcanzable tiene ruta,
que descender por el campo termina, que ver es recíproco y que la máquina no vibra en el
límite de la visión.

### Red

Del fantasma viajan `{ position, targetUid, state }`. El estado es lo único que **no** se
deduce de la posición: la animación, el borde encendido y la disolución tienen que
coincidir en las tres pantallas. Los valores están en `shared/events.js` (`GHOST_STATES`)
y el servidor los sanea contra esa lista en `sanitizeGhostState`, con el mismo criterio
que ya aplicaba a `position`.

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

La interfaz **no se tocó** al mover las cuentas a Laravel: `src/network/ApiClient.js`
traduce el formato de la API al plano que estas vistas esperan (función `unwrap`), y la
firma de sus métodos no cambió.

---

## 7. Persistencia

**Este servidor no abre ninguna conexión a base de datos.** Las salas viven en memoria
—`server/rooms/`— y todo lo que hay que recordar de una partida a otra vive en
`realtyba-api`: cuentas, progreso, logros concedidos y el catálogo de logros.

### Reparto

| Qué | Dónde |
|---|---|
| Registro, login, PIN, perfil, recuperación | `realtyba-api`, prefijo `/api/triadvaults` |
| Progreso, logros y clasificación | `realtyba-api`, base `triadvaults` |
| Administración (suspender, auditar, editar el catálogo) | Módulo `triad-vaults` de `realtyba-front` |
| Salas, posiciones, daño, sincronía | Aquí, en memoria |

Desapareció con la migración: `server/db/`, `server/http/`, `server/mailer.js`,
`server/services/progression.js`, `migrations/` y el respaldo `server/data/users.json`.

### El modo degradado ya no existe

Antes, si Postgres no respondía, los repositorios caían a un fichero JSON local. Era un
modo degradado que se parecía demasiado a uno sano: las cuentas de Postgres no se veían
y el progreso no llegaba allí. Ya no hay respaldo — sin API no hay sesión, que es un
estado mucho más fácil de reconocer.

Lo que sí se conserva es el **modo sin conexión del cliente** (sección 12), que es otra
cosa: guarda lo jugado en la máquina del jugador y lo vuelca cuando vuelve la red.

### Cómo saber si el servidor puede guardar progreso

- El arranque avisa si faltan `TRIADVAULTS_API_URL` o `TRIADVAULTS_INTERNAL_SECRET`.
- `GET /health` devuelve `{ service, uptime, api }`, donde `api` dice si la integración
  está configurada. Sin ella se juega igual, pero nada se guarda — y desde fuera un
  servidor así sería indistinguible de uno sano.
- Sin `TRIADVAULTS_JWT_SECRET` el servidor **se niega a arrancar**: sin él no podría
  verificar ningún token.

### Puesta en marcha

```bash
npm run setup:env   # crea .env desde .env.example (lo hace también `npm run dev`)
```

Después hay que **copiar a mano** `TRIADVAULTS_JWT_SECRET` y
`TRIADVAULTS_INTERNAL_SECRET` desde el `.env` de `realtyba-api`. El script ya no los
inventa: son secretos compartidos, y uno generado aquí no coincidiría con el de allí.
El síntoma sería de los peores posibles —registro y login funcionando con normalidad, y
todas las conexiones de socket rechazadas— así que es mejor un hueco vacío que un valor
plausible y equivocado.

El esquema y su siembra están en `realtyba-api`; ver `docs/SECURITY_AND_DATABASE.md`.

### Verificación de correo

El registro deja la cuenta en `is_verified = false` y exige un PIN de 6 dígitos antes de
jugar. Lo emite y lo comprueba Laravel, y el correo sale por el servicio central (no por
un SMTP propio del juego, que era un segundo sitio donde configurar lo mismo).

Sin SMTP el PIN no puede llegar, así que con `TRIADVAULTS_DEV_ECHO_PIN=true` en
`realtyba-api` (nunca en producción) viaja en la respuesta como `devCode` y el modal lo
muestra. La decisión se toma **con el resultado real del envío**: unas credenciales de
relleno pasan por configuradas y fallan igual.

`POST /api/triadvaults/resend-verification` emite un código nuevo, con 120 s de espera
entre peticiones por cuenta. Es también el rescate de las cuentas antiguas, que no
tienen ningún código guardado y por tanto no podían verificarse con ningún valor.

---

## 8. Capa visual

El acabado de imagen vive en `src/engine/` y está gobernado por **un único sitio**:
`QualitySettings.js`. Sus presets (`bajo | movil | medio | alto | ultra`) deciden
postprocesado, sombras, `pixelRatio`, SMAA, partículas y luces de acento. Se detecta uno
inicial leyendo el renderer real de WebGL —`devicePixelRatio` alto no implica GPU
potente— y el jugador puede cambiarlo desde **Ajustes**, con efecto inmediato.

| Módulo | Qué aporta |
|---|---|
| `PostFX.js` | bloom, viñeta, aberración cromática, grano y destello de daño, en un solo pase de shader |
| `textures.js` | rejillas, ruido y relieve generados por canvas: las superficies no cargan ningún fichero |
| `environment.js` | entorno de reflejo por bioma, prefiltrado con PMREM. Dos fuentes según `envSource`: lienzo pintado o `RoomEnvironment` teñido |
| `Lighting.js` | clave rasante, contraluz y luces de acento que laten. El volumen de sombra sigue al agente (`setShadowFocus`) |
| `Particles.js` | motas de ambiente e impactos, con el pool reservado por adelantado |
| `CameraShake.js` | sacudida con decaimiento al cuadrado, muestreada de ondas continuas |
| `AmbientScene.js` | bóveda decorativa que orbita detrás del menú |
| `AssetLoader.js` | modelos `.glb`, con respaldo a la geometría primitiva |
| `PropLibrary.js` | atrezo importado, fusionado en una geometría por tipo e instanciado |
| `ghostMaterial.js` | borde de fresnel y disolución del fantasma, inyectados en un material estándar |
| `wallMaterial.js` | aristas y brillo de canto de los muros, por el mismo camino |
| `EdgeMarkersView.js` | flechas de borde para lo que queda fuera de encuadre (en `src/ui/views/`) |
| `Stats.js` | contador de fotogramas y llamadas de dibujo bajo `?stats=1` |

Decisiones que no son evidentes:

- El grano se atenúa en las sombras (`grainMask`). Aplicado plano, las zonas oscuras —que
  aquí son casi toda la pantalla— se llenaban de puntos y parecían ruido de vídeo.
- Las molduras de los muros van **metidas hacia dentro**. Con la cámara cenital lo que se
  ve de un muro es su cara superior, y una moldura del mismo tamaño la tapaba entera:
  todos los muros se leían como losas de neón macizas, sin volumen.
- **`scene.environment` no es un adorno.** El suelo y los muros se declaran con
  `metalness` entre 0,65 y 0,8, y en un modelo PBR eso traslada la respuesta al término
  especular: sin entorno que reflejar devolvían casi negro. El juego estuvo así mucho
  tiempo y era la causa principal de que la bóveda se viera plana pese a tener materiales
  físicos, iluminación por bioma y bloom.
- **El preset `movil` existe porque `bajo` apagaba el neón.** Todo el neón son materiales
  `emissive`, no `MeshBasicMaterial` brillante, así que sin bloom se lee como color plano
  — y `bajo`, que era lo que recibía cualquier teléfono, no tiene postprocesado. El
  presupuesto para encenderlo sale de instanciar los muros (de unas 66 llamadas de dibujo
  a 2) y de dejar una sola luz puntual de agente. Medido con `?stats=1`: 48 llamadas por
  fotograma en una sala del nivel 1.
- **Los muros son dos `InstancedMesh`**, uno de cuerpos y otro de molduras. Ya compartían
  geometría y material, que ahorra memoria pero no llamadas de dibujo: cada `Mesh` seguía
  siendo un envío propio. Las cajas de colisión salen de las mismas cifras que las
  matrices de instancia, no de la escena.
- **La cámara sigue al agente, y antes no lo hacía aunque lo pareciera.** `follow()`
  existía y se llamaba cada fotograma, pero un caso especial dentro de `clampToRoom`
  clavaba la mirada en el centro de la sala en cuanto ésta cabía en pantalla —o sea, casi
  siempre—. Para sostener ese encuadre, `applyAspect` gastaba hasta 70° de ángulo y 2,2×
  de distancia, y en un móvil de pie eso dejaba al agente como un punto. Ahora el recorte
  solo impide que la mirada **se salga de la bóveda**, y el encuadre garantiza una
  burbuja alrededor del jugador en vez de la sala entera, así que los topes bajan a 62° y
  1,5×. Lo cubre `npm run validate:movement`.
  - El recorte **no puede** ir contra la huella de suelo visible: la cámara mira en
    picado a 53° y su trapecio mide unas 68×40 unidades contra los 24,8 de la sala del
    nivel 1, así que "que la huella no se salga" centraría siempre. Ese vacío ya se veía
    antes; lo tapan el plano del vacío y la niebla.
- **El atrezo importado no colisiona.** Su cantidad sale del preset, o sea que cada
  jugador ve un número distinto de piezas; si además colisionaran, dos personas en la
  misma sala tendrían física distinta. La sala que se juega es la de `LayoutGen`.
- **El material del fantasma va por `onBeforeCompile`, no en un `ShaderMaterial`.** Uno
  en crudo empieza sin `skinning`, sin niebla, sin `envMap` y sin sombras: habría que
  reimplementar a mano justo lo que da el modelo con esqueleto. Su
  `customProgramCacheKey` **incluye el nivel** (`triad-ghost-full`), o cambiar de preset
  serviría el programa ya compilado del nivel anterior sin ningún error visible.
- **El entorno de `RoomEnvironment` se normaliza en la fuente.** `envMapIntensity` está
  calibrado por superficie en tres ficheros distintos (suelo 1,6, muros 0,55, cuerpos
  0,8); si el entorno nuevo fuese más luminoso habría que tocar los tres y la calibración
  quedaría partida. Se ajusta `ROOM_EMISSION_SCALE` en `environment.js` y nada más.

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

El catálogo vive en la tabla **`triad_achievements`**, en `realtyba-api`, y se edita desde
el módulo `triad-vaults` del panel con un constructor visual de reglas. Antes era una lista
fija en `shared/achievements.js` —había que publicar una versión del juego para añadir un
logro— y después una tabla que se editaba con SQL a mano.

Lo que queda en `shared/achievements.js` es el **motor**: las métricas que se pueden mirar,
los comparadores y el evaluador. Las condiciones son **datos**, no funciones:

```json
[{"metric": "timeSpent", "op": ">", "value": 0},
 {"metric": "timeSpent", "op": "<", "value": 60}]
```

Se acumulan con Y lógico, que es lo que permite expresar un intervalo. Guardar un `check`
como texto y ejecutarlo obligaría a `eval`, y eso convertiría una fila de la base de datos en
ejecución de código dentro del servidor.

Solo hace falta tocar código para mirar una métrica que aún no existe. Las disponibles son
`level`, `maxLevel`, `puzzlesSolved`, `totalTimePlayed`, `timeSpent`, `playersCount`,
`deaths`, `damageTaken` y `flawless` (1 o 0).

**El motor existe por duplicado**, y hay que tenerlo presente: el de PHP
(`AchievementEvaluator`) es el que concede, y el de JavaScript (`shared/achievements.js`)
lo usa el cliente para avisar en el modo sin conexión. Si divergen, un jugador ve
desbloquearse un logro sin red que luego el servidor le niega al sincronizar — no rompe
nada, simplemente miente. El seguro es un fichero de **vectores dorados** que consumen los
dos: `realtyba-api/tests/Fixtures/TriadVaults/achievement_vectors.json`, contra el test de
PHP y contra `npm run validate:achievements`.

Ampliar las métricas es tocar `METRICS` en **los dos** motores, y quien las calcula en
`ProgressionService` (PHP).

`DEFAULT_ACHIEVEMENTS` sigue en el cliente como catálogo del modo sin conexión; la siembra
inicial de la tabla la hace el seeder de `realtyba-api` —solo si está vacía, para no
resucitar lo que alguien retiró a conciencia desde el panel. El cliente recibe el catálogo
vivo por `GET /api/triadvaults/achievements`, **sin las condiciones**: no concede nada, así
que mandarle las reglas solo serviría para sugerir lo contrario. `steamApiName` sí viaja: lo
necesita el cliente de escritorio para decirle a Steam qué logro reflejar.

Un logro se retira con `enabled = FALSE`, nunca borrando la fila: quien ya lo tuviera conserva
su registro en `triad_user_achievements`, y sin definición la interfaz no sabría pintarlo.

**La evaluación es del servidor**, tanto en el handler de `LEVEL_COMPLETE` como al sincronizar
lo jugado sin conexión — ambos pasan por `recordLevelCompletion`. Los logros se ven en el
perfil y son públicos, así que dejar que el navegador decidiera cuáles se ha ganado sería
regalarlos a quien abriera la consola.

Los contadores que necesitan (`levelDamageTaken`, `levelDeaths`) viven en el estado de sala
y se reinician con cada nivel: "sin recibir un golpe" y "tras caer tres veces" no se pueden
deducir del estado final. La concesión usa `ON CONFLICT DO NOTHING` y devuelve solo lo que
insertó de verdad, de modo que tres clientes reportando el mismo nivel a la vez no producen
ni duplicados ni avisos repetidos.

Mover el catálogo a datos quitó de en medio la revisión de código que cazaba las
definiciones rotas. Lo sustituyen tres redes: el repositorio descarta al cargar las filas que
no se pueden evaluar **diciendo cuál y por qué**, una restricción de la tabla rechaza un
`conditions` que no sea un array no vacío, y `npm run validate:achievements` comprueba además
que las condiciones no se contradigan (`timeSpent > 60` junto a `timeSpent < 10` es una
definición válida que nadie desbloquearía jamás).

---

## 11. Controles

`src/engine/Bindings.js` guarda la asignación en `localStorage`; las teclas estaban escritas
dentro de `Input.js` y quien jugara en AZERTY —que mueve con ZQSD— no tenía forma de
cambiarlas. Se usa `KeyboardEvent.code` y no `key` porque describe la **posición física**: la
tecla que está donde la W del QWERTY reporta `KeyW` en cualquier distribución.

Cada acción tiene dos huecos, principal y alternativa. Asignar una tecla que ya servía para
otra cosa se la quita a esa otra, y si la deja sin ninguna, hereda el hueco que se acaba de
liberar: una acción sin tecla es una acción que no se puede ejecutar. `Escape`, `F5`, `F11`,
`F12` y `Tab` no son asignables.

Teclado y mando se leen en coordenadas de **pantalla** y se convierten a mundo en un solo
sitio (`ISO`, un giro de 45°). Antes cada tecla sumaba a mano su par de componentes
isométricas, y esa conversión repetida cinco veces no dejaba sitio para un stick analógico. El
módulo del vector se conserva por debajo de 1, así que a medio recorrido el agente anda
despacio.

El mando (`src/engine/Gamepad.js`) usa zona muerta **radial** sobre el módulo, no por eje:
con umbral por eje una diagonal suave se corta en escalones. El tramo útil se reescala a 0..1
para que no arranque de golpe a un cuarto de velocidad. Mientras no haya mando conectado no se
llama a `navigator.getGamepads()`: esa llamada construye una instantánea nueva cada vez y
hacerla sesenta veces por segundo para descubrir que no hay ninguno costaba tasa de refresco.

---

## 12. Modo sin conexión

Un juego de escritorio no puede depender de que un servidor esté vivo. `OfflineStore`
(`src/network/OfflineStore.js`) guarda el progreso en `localStorage` y encadena niveles sin
socket: el botón está siempre visible en el menú, con y sin sesión.

Cada nivel superado se apunta en dos sitios: el resumen local —lo que se enseña mientras no
hay red— y una **cola de partidas pendientes**. Al recuperar el enlace se manda la cola a
`POST /api/triadvaults/profile/sync`, y es el servidor quien la vuelve a evaluar. El resumen local no se
manda nunca: vive en `localStorage` y editarlo es trivial. `playersCount` se fuerza a 1 por lo
mismo, o quien lo pusiera a 3 se regalaría el logro de escuadrón completo.

El volcado es de entrega **al menos una vez**: el cliente no borra un nivel de su cola hasta
que el servidor confirma, así que un acuse perdido provoca un reenvío. Cada nivel lleva el
instante en que terminó y `triad_game_users.last_offline_sync_at` guarda el
más reciente ya aplicado; lo que no lo supere se descarta. Sin esa marca, un corte de red
justo después de escribir contaría el mismo nivel dos veces.

La respuesta dice cuántos niveles aceptó para que el cliente borre exactamente esos: vaciar la
cola entera perdería lo jugado mientras la petición viajaba.

---

## 13. Empaquetado de escritorio y Steam

> El procedimiento completo —qué comando produce qué, cómo se sube a Steam y qué falta
> antes de publicar— está en **[DISTRIBUTION.md](DISTRIBUTION.md)**. Aquí solo las
> decisiones de diseño.

`electron-builder.yml` produce NSIS para Windows, AppImage + deb para Linux y dmg + zip para
macOS. La lista de ficheros es **blanca**, con una sola excepción: electron-builder añade
siempre las `dependencies` de `package.json`, así que hace falta un `!node_modules/**/*` para
que no viajen `express` ni `socket.io` —código de servidor que el jugador no ejecuta—
y detrás una reinclusión explícita de `steamworks.js`, que sí se necesita.

El servidor no se empaqueta. El juego de escritorio es el cliente: en solitario corre entero
en local, y para jugar acompañado apunta al servidor que indique `TRIADVAULTS_API_URL` al construir.
Sin esa variable, una build abierta desde el disco detecta el protocolo `file:` y se queda en
un solo jugador en vez de reintentar contra `file://` para siempre.

El icono se genera por código (`npm run icon`, `scripts/make-icon.js`) en lugar de guardar un
binario en el repositorio: así se puede leer y cambiar de color en una línea.

### Steam

`steamworks.js` es un módulo **nativo**, así que vive en el proceso principal
([electron/steam.js](../electron/steam.js)) y nunca en el de render: la ventana corre con
`sandbox: true` y `nodeIntegration: false`, y no puede —ni debe poder— cargar binarios. El
render llega por IPC a través de tres funciones enumeradas a mano en `preload.cjs`; exponer
`ipcRenderer` entero le devolvería a la página acceso a cualquier canal del principal.

Dos consecuencias en el empaquetado, y las dos fallan **solo en la build empaquetada**, que
es lo que las hace peligrosas: el `.node` tiene que quedar fuera del asar (`asarUnpack`,
porque el sistema necesita un fichero real en disco para enlazarlo), y el módulo tiene que
sobrevivir a la exclusión de `node_modules`.

**Los logros de Steam son un espejo, no la autoridad.** Los concede nuestro servidor y viven
en la base de datos; el reflejo en Steam se envía después y sin esperarlo. Si Steam no está
—el navegador, la build suelta, el cliente cerrado— el puente devuelve un objeto inerte, lo
dice una vez, y no hay ninguna otra diferencia. Es el camino que va a recorrer la mayoría de
las partidas, así que es el que tiene que ser aburrido.

La correspondencia vive en `triad_achievements.steam_api_name`, en la misma fila que el
logro, para conservar lo de la sección 10: añadir un logro sigue siendo un `INSERT`.

El overlay queda tras `STEAM_OVERLAY=true` y **apagado por defecto**: necesita el conmutador
`in-process-gpu`, que mete el proceso de GPU dentro del principal y se lleva por delante su
aislamiento. Una comodidad a cambio de un límite de seguridad no se activa a espaldas de
quien compila.

---

## 14. Comprobaciones

| Comando | Qué valida |
|---|---|
| `npm run validate` | las tres validaciones de abajo |
| `npm run validate:levels` | trazados jugables, y que cada arquetipo reciba los nodos que pide |
| `npm run validate:puzzles` | que cada arquetipo **se pueda resolver**, y que su restricción no se pueda saltar |
| `npm run validate:achievements` | que las definiciones —las del paquete y las de la base de datos— se puedan evaluar, cumplir y reflejarse en Steam |
| `npm run test:e2e` | juego real en Chrome: solo, dúo y reconexión (requiere `npm run dev`) |
| `npm run build` | que el grafo de módulos del cliente resuelve |
| `npm run dist:linux` / `dist:win` / `dist:mac` | paquete de escritorio, ver [DISTRIBUTION.md](DISTRIBUTION.md) |
| `curl localhost:3001/health` | que el servidor de salas responde y tiene la API configurada |

`validate:levels` verifica el trazado; `validate:puzzles` verifica la **regla**. Hacen falta
las dos: un arquetipo cuya condición de victoria nunca se cumpla dejaría al jugador
encerrado en una sala perfectamente jugable, que es el peor fallo posible — no hay error, no
hay aviso, simplemente no se puede salir.

`validate:achievements` distingue dos gravedades y falla con ambas, aunque el servidor no:
una definición que **no se puede evaluar** se descarta al cargar, mientras que un icono
desconocido o un nombre de Steam mal formado solo se avisan —el logro funciona igual y
tirarlo entero le quitaría al jugador algo que sí sirve—. En la máquina de quien mantiene el
catálogo las dos cosas son erratas que hay que corregir.

Lo que **ninguna comprobación puede hacer** es confirmar que un API Name existe de verdad en
Steamworks: Steam descarta en silencio un nombre que no conoce. Eso hay que verlo una vez con
el cliente de Steam abierto y un appid real.
