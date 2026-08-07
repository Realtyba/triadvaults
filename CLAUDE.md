# game — TriadVaults

Juego co-op procedural para 3 jugadores (cyberpunk puzzle/escape). Node + Vite en
desarrollo, Electron para distribuir, Three.js para el render y socket.io para el
tiempo real. El paquete se llama `triad-vaults`.

**Este repo solo tiene las salas en tiempo real.** Las cuentas, el progreso y los logros
viven en `realtyba-api` (Laravel), y el panel de administración es el módulo `triad-vaults`
de `realtyba-front`. Si buscas dónde se guarda un usuario o un logro, no está aquí.

## Contrato con realtyba-api

Dos secretos compartidos, y **deben valer lo mismo en el `.env` de los dos repos**:

- `TRIADVAULTS_JWT_SECRET` — Laravel emite el JWT del jugador (HS256); este Node solo lo
  **verifica en el handshake del socket**, sin llamadas de red (`server/socket/authMiddleware.js`).
- `TRIADVAULTS_INTERNAL_SECRET` — este Node reporta el nivel completado a
  `/api/triadvaults/internal/*` (`server/services/apiClient.js`).

**Síntoma clásico si el JWT no coincide:** el registro y el login funcionan con
normalidad y *solo* falla el socket. No busques el fallo en el flujo de auth.

Otras variables: `TRIADVAULTS_API_URL`, `API_URL`, `APP_URL`, `SOCKET_URL`, `PORT`,
`STEAM_APP_ID`, `STEAM_OVERLAY`. `npm run setup:env` (o el `predev`) las prepara a partir
de `.env.example`.

## Antes de explorar código

- **El grafo primero:** `graphify query "<pregunta>"` desde este repo — hay un grafo por
  repo (`graphify-out/`) y se resuelve relativo al directorio actual. Usa nombres reales
  de fichero/función; con términos genéricos el resultado es ruido. Tras tocar código,
  `graphify update .`. Si diera `command not found`, el binario vive en el venv del
  workspace: usa `../scripts/graphify` (detalle en `.agents/rules/graphify.md` de la raíz).
- `docs/` cubre lo que no se deduce del código: `ARCHITECTURE.md`, `SECURITY_AND_DATABASE.md`
  (el contrato con Laravel), `DEPLOYMENT.md`, `DISTRIBUTION.md` (Electron/Steam) y
  `MANUAL.md`.

## Estructura

- `server/` — autoritativo. `rooms/RoomManager.js` es el estado de las salas **en memoria**
  (crear/unirse/reconectar, host, daño, avance de nivel); `socket/handlers/` separa los
  eventos en room / game / sync; `broadcast.js` centraliza los envíos.
- `src/` — cliente: `engine/`, `entities/`, `physics/`, `procedural/` (generación de
  niveles y puzzles), `ui/` (vistas y componentes DOM propios, sin framework), `network/`.
- `shared/events.js` — los nombres de evento del socket, compartidos cliente/servidor.
  Si tocas un evento, tócalo aquí y no en cadenas sueltas.
- `electron/`, `steam/` — empaquetado de escritorio; `steamworks.js` es una dependencia
  **opcional** (el juego debe arrancar sin ella).

## Comandos

```bash
npm run dev        # vite + servidor de sockets a la vez
npm run server     # solo el servidor
npm run validate   # niveles + puzzles + logros (correr tras tocar sus JSON)
npm run test:e2e   # e2e por CDP
npm run dist       # build de Electron (dist:win / dist:linux / dist:mac)
```

`npm run validate` es la red de seguridad barata de este repo: los niveles, puzzles y
logros son JSON y un fallo ahí no lo detecta ningún test.
