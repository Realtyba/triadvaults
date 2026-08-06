# Triad Vaults — Distribución de escritorio

Cómo se construye el juego para escritorio, qué hace falta para publicarlo en Steam y
qué falta todavía.

Este documento **no** cubre el servidor. Eso está en [DEPLOYMENT.md](DEPLOYMENT.md)
(VPS, Docker, Nginx, SSL), y son cosas distintas: el servidor da el multijugador, el
ranking y los logros; el escritorio es el cliente que se instala el jugador.

> Sustituye al antiguo `STEAM_DEPLOYMENT.md`, que había quedado obsoleto: mandaba
> instalar electron-builder sin fijar versión y meter la configuración en
> `package.json`, cuando hoy vive en [`electron-builder.yml`](../electron-builder.yml)
> con la versión clavada.

---

## 1. La respuesta corta

**Con los ejecutables no está listo para publicar.** Lo que hay es un juego que
compila y arranca en las tres plataformas. Lo que falta son datos y trámites, no
código: appid de Steamworks, certificados de firma, y rellenar los marcadores. Está
todo en la [lista del final](#7-lista-de-lo-que-falta-antes-de-publicar).

Para **Steam** falta menos de lo que parece, porque Steam no necesita instaladores
ni firma. Para distribuir **fuera de Steam** falta más.

---

## 2. Qué produce cada comando

| Comando | Sale | Tamaño medido |
|---|---|---|
| `npm run build` | `dist/` — el cliente web empaquetado por Vite | ~750 kB |
| `npm run dist:linux` | `release/linux-unpacked/`, AppImage y `.deb` | 260 MB · 103 MB · 81 MB |
| `npm run dist:win` | `release/win-unpacked/` y el instalador NSIS | 259 MB · (instalador solo con `wine`) |
| `npm run dist:mac` | `release/mac/`, `.dmg` y `.zip` | sin probar (necesita macOS) |
| `npm run icon` | `build/icon.png`, generado por código | 42 kB |

Los tres `dist:*` vacían `release/` antes de empezar, corren `npm run icon` y
`npm run build`, y luego empaquetan.

**Lo grande es Electron**, no el juego: el cliente son 750 kB y el resto es Chromium.
Es el precio de la plataforma y no hay nada que recortar ahí.

### Compilar para otro sistema

- **Linux → Linux**: completo.
- **Linux → Windows**: el directorio `win-unpacked/` sale entero y funciona. Lo único
  que necesita `wine` instalado es comprimirlo en el instalador NSIS. **Para Steam no
  hace falta**, ver más abajo.
- **Cualquiera → macOS**: solo desde macOS. La cadena de herramientas de Apple no
  existe en otros sistemas. La configuración está escrita y **sin probar**.

---

## 3. La decisión que hay que tomar antes de compilar

**`VITE_API_URL` se cuece dentro del paquete.** No es una opción que el jugador cambie
después: se resuelve al compilar el cliente.

```bash
# Juego completo, contra tu servidor
VITE_API_URL=https://tu-servidor.example npm run dist:linux

# Sin la variable: un solo jugador
npm run dist:linux
```

Sin ella, la build abierta desde disco detecta el protocolo `file:`
([src/network/ApiClient.js](../src/network/ApiClient.js)) y se queda en modo local: se
juega, se progresa y se desbloquean logros, pero no hay salas, ni ranking, ni cuenta.

Es una elección con consecuencias, no un descuido: publicar con multijugador significa
mantener un servidor vivo mientras haya gente jugando. Un juego de un solo jugador no
se cae nunca.

El modo sin conexión guarda el progreso en local y lo vuelca al servidor cuando hay
enlace; el detalle está en [ARCHITECTURE.md](ARCHITECTURE.md), sección 12.

---

## 4. Steam

### 4.1 Lo que hay que entender primero

**Steam no distribuye instaladores. Distribuye directorios.**

Es el malentendido que hace perder más tiempo. SteamPipe sube una carpeta de
contenido; el cliente de Steam se encarga de instalar, actualizar y parchear. Por eso:

- El instalador NSIS y el AppImage **sobran para Steam**. Sirven para vender fuera.
- Lo que se sube es `release/win-unpacked/` y `release/linux-unpacked/`.
- No hace falta `wine` para publicar en Steam desde Linux.
- Tampoco hace falta firmar el código: Steam distribuye por su cuenta.
- Subir un AppImage sería además contraproducente: es un fichero único de 100 MB, así
  que cualquier parche obligaría a bajarlo entero. Con el directorio, SteamPipe manda
  solo lo que cambió.

### 4.2 Lo que hay que conseguir en Steamworks

1. Cuenta de Steamworks (Valve cobra una tasa por aplicación, reembolsable con ventas).
2. Un **appid** para el juego.
3. Un **depot** por plataforma.

Los tres son datos de tu cuenta y por eso **no están en el repositorio**.

### 4.3 Subir una build

Las plantillas están en [`steam/`](../steam/), con los números como marcadores:

- `app_build.vdf` — la build: appid, descripción y qué depots la componen.
- `depot_win.vdf` / `depot_linux.vdf` — qué directorio va en cada depot.

```bash
npm run dist:linux
npm run dist:win          # el error de NSIS al final no impide que win-unpacked/ esté

steamcmd +login <usuario> +run_app_build /ruta/absoluta/steam/app_build.vdf +quit
```

`setlive` está vacío a propósito: la build sube pero **no se publica sola**. Pasarla a
vivo es una decisión que se toma a mano desde Steamworks.

### 4.4 Probar sin lanzar desde Steam

Crea `steam_appid.txt` en la raíz con tu appid dentro (está en `.gitignore`). Con el
cliente de Steam abierto y sesión iniciada, `npm start` conectará.

---

## 5. Logros en Steam

Los logros del juego los concede **nuestro servidor** y viven en la base de datos.
Steam es un **espejo**: si falla, el jugador conserva su logro en el perfil del juego.
Esto no cambia con la integración, y es deliberado — la lógica de concesión no puede
depender de que Steam esté delante, porque la mayoría de partidas no lo tendrán.

### Cómo se casan

1. En Steamworks, das de alta cada logro con su **API Name** (mayúsculas, dígitos y
   guion bajo).
2. En la base de datos, pones ese nombre en `triad_achievements.steam_api_name`:

```sql
UPDATE triad_achievements SET steam_api_name = 'FIRST_ESCAPE' WHERE key = 'first_escape';
```

Los nueve de salida ya vienen mapeados con la clave en mayúsculas (`FIRST_ESCAPE`,
`LEVEL_10`, …), así que en Steamworks basta con darlos de alta con esos nombres.

**La columna va en la misma fila que el logro** para conservar lo que se consiguió al
mover el catálogo a la base de datos: añadir un logro sigue siendo un `INSERT`, ahora
incluido su reflejo en Steam. Un logro con `steam_api_name` nulo funciona con
normalidad y simplemente no aparece en Steam.

### Comprobarlo

`npm run validate:achievements` avisa de un API Name mal formado. **No puede
comprobar que exista en Steamworks**: un nombre que no exista allí lo descarta Steam
en silencio, sin error. Eso hay que verlo una vez con Steam abierto.

### Cómo funciona por dentro

- [`electron/steam.js`](../electron/steam.js) — proceso principal. Si Steam no está,
  devuelve un objeto inerte y lo dice **una vez**. Nada lanza nunca.
- [`electron/preload.cjs`](../electron/preload.cjs) — expone tres funciones concretas.
  No se expone `ipcRenderer`: eso le daría a la página acceso a cualquier canal.
- [`src/network/SteamBridge.js`](../src/network/SteamBridge.js) — traduce clave →
  API Name. En el navegador `window.triad` no existe y todo se salta.

Va en el proceso principal porque `steamworks.js` es un módulo **nativo** y la ventana
corre con `sandbox: true` y `nodeIntegration: false`. La página no puede cargar
binarios, y no queremos que pueda.

Al arrancar se reconcilia: se le envía a Steam lo que el agente ya tenía y Steam no.
Sin eso, quien jugó en el navegador o en otra máquina no vería nunca esos logros.

### El overlay

Apagado por defecto. Se enciende con `STEAM_OVERLAY=true`, y **hay que saber lo que
cuesta**: para funcionar sobre Electron necesita el conmutador `in-process-gpu`, que
mete el proceso de GPU dentro del principal y con ello se lleva por delante su
aislamiento. Es un intercambio real, y por eso no está activado sin pedirlo.

---

## 6. Fuera de Steam (itch.io, descarga directa)

Aquí sí hacen falta los instaladores, y aquí sí duele no firmar:

| Sistema | Sin firmar, el jugador ve… |
|---|---|
| Windows | SmartScreen: "Windows protegió su PC", con el editor como desconocido |
| macOS | Gatekeeper se **niega** a abrirlo; hay que ir a Preferencias a autorizarlo |
| Linux | Nada. AppImage y `.deb` se instalan sin ceremonia |

La firma está preparada y apagada en `electron-builder.yml`. Cuando tengas
certificados, electron-builder los toma del entorno sin tocar la configuración:
`CSC_LINK` y `CSC_KEY_PASSWORD` en Windows; `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`
y `APPLE_TEAM_ID` para notarizar en macOS.

---

## 7. Lista de lo que falta antes de publicar

- [ ] **Marcadores `.invalid`**: `homepage` en `package.json` y `linux.maintainer` en
      `electron-builder.yml`. El `.deb` los exige; están sobre un dominio reservado
      que nunca resuelve, precisamente para que se vean.
- [ ] **`VITE_API_URL`**: decidir si el juego publicado tiene multijugador (sección 3).
- [ ] **Appid y depots** de Steamworks en las plantillas de `steam/`.
- [ ] **Logros dados de alta** en Steamworks con los API Names de la sección 5.
- [ ] **Versión**: `package.json` se sube a mano. Da nombre a los instalables.
- [ ] **Firma**, solo si distribuyes fuera de Steam (sección 6).
- [ ] **macOS**: la configuración está escrita pero nunca se ha compilado.
- [ ] **Probar con Steam de verdad**: que un logro llegue, y decidir sobre el overlay.
      Nada de esto se ha podido verificar sin un appid real.

---

## 8. Trampas conocidas

**Un `.exe` de 233 kB no es un instalador.** Si `dist:win` falla por falta de `wine`,
deja en `release/` un `Triad Vaults Setup 1.0.0.exe` de unos 233 kB. Es el arranque del
instalador; su contenido está aparte, en un `.nsis.7z` de 74 MB. `file` lo reconoce
como ejecutable de Windows válido, así que **parece terminado y no lo está**. El
instalador de verdad pesa lo que pesa el juego.

Los `dist:*` vacían `release/` antes de empezar precisamente por esto, pero si
interrumpes una compilación a mano, revisa los tamaños antes de subir nada.

**El módulo nativo tiene que quedar fuera del asar.** Un `.node` no se puede cargar
desde dentro del archivo: el sistema necesita un fichero real en disco. Lo resuelve
`asarUnpack` en `electron-builder.yml`. Si alguna vez se toca esa lista, el síntoma es
que Steam deja de funcionar **solo en la build empaquetada**, nunca en desarrollo.

Para comprobarlo:

```bash
ls release/linux-unpacked/resources/app.asar.unpacked/node_modules/steamworks.js/dist/
```

**`files` es una lista blanca con una excepción.** electron-builder añade siempre las
`dependencies` de `package.json`, así que hay un `!node_modules/**/*` para que no se
cuelen `pg`, `express` ni `nodemailer` —40 MB de código de servidor que el jugador no
ejecuta— y detrás una reinclusión explícita de `steamworks.js`. El orden importa.

Para comprobar que no se ha colado nada:

```bash
npx asar list release/linux-unpacked/resources/app.asar | grep '^/node_modules'
# solo debe salir steamworks.js
```
