<div align="center">

# 🔺 Triad Vaults

**Escape procedural cooperativo para 3 jugadores, en clave cyberpunk/synthwave.**

Node · Three.js · Socket.IO · Electron

[Manual de juego](docs/MANUAL.md) ·
[Arquitectura](docs/ARCHITECTURE.md) ·
[Despliegue](docs/DEPLOYMENT.md) ·
[Distribución de escritorio](docs/DISTRIBUTION.md)

</div>

---

## Qué es

Tú y hasta dos agentes más quedáis encerrados en una bóveda generada por
procedimientos. Hay que pisar placas de presión para desbloquear la salida
mientras un fantasma corrupto persigue al jugador más cercano — y cada nivel
que superáis, se mueve más rápido.

Cada partida genera un laberinto distinto a partir de una semilla compartida,
así que los tres agentes ven **exactamente el mismo trazado**. El juego se
puede jugar solo, en el navegador o en un cliente de escritorio (Electron),
con o sin conexión.

## Características

- 🧩 **4 arquetipos de puzle** — placas simultáneas, secuencia por color,
  contrarreloj y un modo `relay` que exige coordinación (2-3 jugadores).
- 👻 **IA con objetivo dinámico** — el fantasma persigue a quien puntúa más
  alto por cercanía, vida baja y si está resolviendo un puzle.
- 🌐 **Multijugador en tiempo real** — salas por socket, con reconexión (15 s
  de gracia) que conserva personaje, vida y autoridad de host.
- 📴 **Modo sin conexión** — se juega igual sin red; el progreso se sincroniza
  solo cuando vuelve el enlace.
- 🏆 **Logros configurables** — catálogo editable desde un panel de admin,
  sin publicar versión nueva del juego.
- 🎮 **Mando y teclado remapeables**, con zona muerta radial y QWERTY/AZERTY.
- 🖥️ **Un solo cliente para todo** — navegador, Electron de escritorio y
  Steam (logros reflejados, overlay opcional).

## Cómo encaja con el resto

Este repo **solo tiene las salas en tiempo real** — no hay base de datos ni
lógica de cuentas aquí dentro.

```
┌─────────────────────────┐        ┌───────────────────────────┐
│   realtyba-api (Laravel) │        │  Servidor de salas (aquí)  │
│   cuentas · progreso      │◄──────┤  socket.io · sin BD        │
│   logros · panel admin    │       │  reporta niveles completados│
└─────────────────────────┘        └───────────────────────────┘
```

- **Cuentas, progreso, logros, correo** → `realtyba-api`, prefijo
  `/api/triadvaults`.
- **Panel de administración** (suspender, editar logros) → módulo
  `triad-vaults` de `realtyba-front`.
- **Salas, posiciones, daño, sincronía** → este servidor, en memoria.

Dos secretos deben coincidir byte a byte con el `.env` de `realtyba-api`:
`TRIADVAULTS_JWT_SECRET` (firma el token del jugador) y
`TRIADVAULTS_INTERNAL_SECRET` (reporta el progreso). Si no coinciden, el
síntoma es engañoso — registro y login funcionan, y solo falla el socket.
Detalle completo en [ARCHITECTURE.md](docs/ARCHITECTURE.md#7-persistencia).

## Empezar en local

```bash
npm install
npm run dev     # vite + servidor de sockets a la vez
```

`predev` corre `scripts/setup-env.js` y crea `.env` desde `.env.example` si no
existe. Después hay que **copiar a mano** `TRIADVAULTS_JWT_SECRET` y
`TRIADVAULTS_INTERNAL_SECRET` desde el `.env` de `realtyba-api` — no se
generan aquí, son secretos compartidos.

Abre `http://localhost:5173` (cliente) — el servidor de salas escucha en
`http://localhost:3001`.

## Comandos

| Comando | Qué hace |
|---|---|
| `npm run dev` | cliente (Vite) + servidor de sockets, juntos |
| `npm run server` | solo el servidor de salas |
| `npm run build` | build de producción del cliente |
| `npm run validate` | valida niveles, puzles, logros, salas y fugas de memoria |
| `npm run test:e2e` | partida real en Chrome por CDP (solo/dúo/reconexión) |
| `npm run dist:linux` / `dist:win` / `dist:mac` | empaquetado de escritorio (Electron) |
| `npm run icon` | genera el icono de la app por código |

`npm run validate` es la red de seguridad barata del repo: niveles, puzles y
logros son JSON, y un fallo ahí no lo detecta ningún test unitario.

## Estructura

```
server/            autoritativo — vida, nivel, semilla y salas en memoria
  rooms/             RoomManager: crear/unirse/reconectar
  socket/handlers/   eventos separados en room / game / sync
  services/          apiClient.js — reporta progreso a realtyba-api

src/                cliente
  engine/            render, cámara, luz, input (Three.js)
  entities/          jugador, fantasma, puzle
  procedural/        generación de niveles y puzles (LayoutGen, DungeonGen, NavGrid)
  ui/                store + vistas + modales, sin framework
  network/           REST (ApiClient) + socket (SocketClient)

shared/events.js   nombres de evento del socket — únicos, cliente y servidor
electron/          empaquetado de escritorio
steam/             plantillas de subida a Steamworks (appid/depots)
docs/              lo que no se deduce del código (ver enlaces abajo)
```

## Documentación

| Documento | Cubre |
|---|---|
| [MANUAL.md](docs/MANUAL.md) | Cómo se juega — controles, mecánicas, multijugador |
| [ARCHITECTURE.md](docs/ARCHITECTURE.md) | Motor 3D, generación procedural, autoridad de red, logros |
| [DEPLOYMENT.md](docs/DEPLOYMENT.md) | Desplegar el servidor de salas en Coolify |
| [DISTRIBUTION.md](docs/DISTRIBUTION.md) | Build de escritorio y publicación en Steam |
| [SECURITY_AND_DATABASE.md](docs/SECURITY_AND_DATABASE.md) | El contrato de datos y secretos con `realtyba-api` |

## Stack

Three.js (render) · Socket.IO (tiempo real) · Express (servidor mínimo) ·
Vite (build del cliente) · Electron (escritorio) · `steamworks.js` (Steam,
opcional) — sin framework de UI: vistas propias sobre DOM.
