# Triad Vaults — Despliegue en Coolify

Este servidor solo coordina salas en tiempo real. Las cuentas, el progreso y los logros
los sirve `realtyba-api` (Laravel), que es quien habla con PostgreSQL. Aquí no hay base
de datos que crear ni migraciones que correr para el juego en sí.

El recurso en Coolify es de tipo **Dockerfile** (no "Docker Compose"): Coolify construye
directo desde el [`Dockerfile`](../Dockerfile) del repo y la red/dominio se configuran
por su UI. El [`docker-compose.yml`](../docker-compose.yml) del repo existe para `docker
compose up` en local o para un futuro recurso tipo Docker Compose, pero **este recurso
de Coolify lo ignora por completo** — nada de lo que digas ahí (`expose`, variables,
logging) aplica al despliegue. Toda la config real vive en las pestañas de Coolify que
describen las secciones 2 a 4.

---

## Índice

1. [DNS de triadvaults.com](#1-dns-de-triadvaultscom)
2. [Configuración General del recurso](#2-configuración-general-del-recurso)
3. [Network: el puerto](#3-network-el-puerto)
4. [Variables de entorno](#4-variables-de-entorno)
5. [Deploy y verificación](#5-deploy-y-verificación)
6. [Actualizar el juego](#6-actualizar-el-juego)
7. [Troubleshooting](#7-troubleshooting)

---

## 1. DNS de triadvaults.com

En el panel DNS de `triadvaults.com`, un registro **A** apuntando a la IP del VPS
(apex `@` o `www`, según lo que hayas puesto en el paso 2):

```
Tipo: A
Nombre: @  (o www)
Valor: TU_IP_DEL_VPS
TTL:   300
```

```bash
dig triadvaults.com +short
# Debe devolver la IP del VPS
```

---

## 2. Configuración General del recurso

Pestaña **Configuration → General**:

| Campo | Valor |
|---|---|
| Build Pack | `Dockerfile` |
| Domains | `https://www.triadvaults.com` (o el dominio que hayas apuntado) |
| Direction | `Allow www & non-www` (o la que prefieras — Coolify redirige según esta opción) |
| Base Directory | `/` |
| Dockerfile Location | `/Dockerfile` |

Coolify genera solo los labels de Traefik (routers, entrypoints, redirect a HTTPS) a
partir del dominio que pongas aquí — no hay que tocarlos a mano.

---

## 3. Network: el puerto

Misma pestaña, sección **Network**:

| Campo | Valor | Por qué |
|---|---|---|
| Ports Exposes | `3001` | el puerto real donde escucha el servidor (`EXPOSE 3001` en el `Dockerfile`, `PORT=3001`) |
| Port Mappings | *(vacío)* | no publiques el puerto directo al host — Traefik es el único que debe entrar, igual que con SSL |

**Este es el campo que más falla por descuido.** Coolify trae `3000` como placeholder
en "Ports Exposes"; si lo dejas así, el build sale en verde pero Traefik enruta a un
puerto donde no hay nada escuchando y el sitio no responde. Cambialo a `3001` antes del
primer deploy.

---

## 4. Variables de entorno

Pestaña **Environment Variables**, una a una — no se sube ningún `.env` al VPS.

| Variable | Valor | Build-time |
|---|---|---|
| `PORT` | `3001` | no |
| `NODE_ENV` | `production` | no |
| `TRIADVAULTS_API_URL` | URL pública de `realtyba-api` (ej. `https://api.triadvaults.com`), **sin** sufijo de ruta | **sí** |
| `TRIADVAULTS_INTERNAL_SECRET` | igual que en el `.env` de `realtyba-api` | no |
| `TRIADVAULTS_JWT_SECRET` | igual que en el `.env` de `realtyba-api` | no |
| `VITE_SOCKET_URL` | `https://triadvaults.com` (el dominio del propio juego) | **sí** |

Las dos marcadas **"sí"** hay que activarlas con el toggle de build-time de esa
variable. El build de Vite las hornea en el bundle del cliente en el momento de
construir la imagen (`vite.config.js` las lee de un `.env` físico en el contexto de
build); si solo quedan inyectadas en el contenedor ya arrancado, el bundle sale con esas
URLs vacías y el healthcheck sigue en verde mientras nadie puede jugar.

`TRIADVAULTS_INTERNAL_SECRET` y `TRIADVAULTS_JWT_SECRET` son **secretos compartidos**:
tienen que valer exactamente lo mismo que en el `.env` de `realtyba-api`. No los generes
aquí por tu cuenta — copia los que ya tiene la API (o genera el par una vez con
`openssl rand -hex 32` y pon el mismo valor en los dos sitios).

Para que el módulo de administración del juego aparezca en el panel de `realtyba-front`,
en el tenant correspondiente (esto se corre en `realtyba-api`, no aquí):

```bash
php artisan db:seed --class="Database\Seeders\Generic\Basic\ModulesTableSeeder"
php artisan db:seed --class="Database\Seeders\Generic\Basic\ModuleControllersTableSeeder"
php artisan db:seed --class="Database\Seeders\Generic\Basic\RoleModuleTableSeeder"
```

Son idempotentes y resuelven los módulos por nombre, así que se pueden correr más de
una vez sin riesgo.

---

## 5. Deploy y verificación

Botón **Deploy** del panel. Cuando termine:

```bash
curl https://triadvaults.com/health
# {"success":true,"service":"triadvaults-rooms","uptime":...,"api":true}
```

Si da timeout o 502 con el build en verde, revisa primero el paso 3 (Ports Exposes).

Abre `https://triadvaults.com` en el navegador y comprueba:

- [ ] La escena 3D se renderiza
- [ ] El indicador de servidor muestra "SERVIDOR EN LÍNEA" (punto verde)
- [ ] Puedes registrar una cuenta e iniciar sesión
- [ ] Puedes crear una sala y empezar a jugar (WebSocket funciona)
- [ ] Al terminar un nivel, el progreso se guarda (revisa en el panel de admin)

---

## 6. Actualizar el juego

No hace falta `git pull` ni nada a mano en el VPS. Conecta el webhook del repo
(pestaña **Webhooks** del recurso) para que cada push a la rama seguida dispare un
redeploy automático, o usa el botón **Redeploy** del panel.

---

## 7. Troubleshooting

### El build sale en verde pero el sitio no responde (timeout / 502)

**Causa casi segura:** "Ports Exposes" se quedó en el `3000` por defecto en vez de
`3001` (paso 3). Traefik enruta al puerto donde no escucha nada.

### El healthcheck está en verde pero nadie puede jugar

**Síntoma:** `/health` responde bien, pero en las DevTools del navegador el socket
intenta conectar a `localhost` o a una URL vacía, y las llamadas a la API fallan.

**Causa:** `TRIADVAULTS_API_URL` y/o `VITE_SOCKET_URL` no están marcadas como
build-time (paso 4). **Solución:** márcalas y vuelve a desplegar — no basta con
reiniciar el contenedor, hay que reconstruir la imagen.

### El contenedor no alcanza la API de cuentas

`api: true` en el healthcheck solo dice que la variable está puesta, no que la API
responda. Compruébalo desde la terminal del recurso en Coolify:

```bash
wget -qO- $TRIADVAULTS_API_URL/api/triadvaults/health
```

El valor de `TRIADVAULTS_API_URL` tiene que ser alcanzable **tanto por el contenedor
como por el navegador** — en producción, el dominio público de `realtyba-api`. No pongas
ahí una IP interna de Docker: esa variable también es la que se hornea en el cliente, y
una dirección que solo existe dentro del contenedor deja al navegador sin API.

### El registro funciona pero el socket rechaza a todo el mundo

**Síntoma:** el jugador se registra y entra sin problema, pero al crear o unirse a una
sala se queda en "Conectando..." o "Autenticación denegada: Token inválido".

**Causa:** `TRIADVAULTS_JWT_SECRET` no coincide con el de `realtyba-api`. El REST lo
sirve Laravel (firma con su secreto, por eso funciona) y el socket lo verifica este
servidor con el suyo. **Solución:** compara los dos valores, tienen que ser idénticos.

### El servidor reporta 401 al guardar el progreso

**Causa:** `TRIADVAULTS_INTERNAL_SECRET` no coincide con el de la API. Si en cambio ves
un 503, es que en la API está vacío — sin secreto configurado, la API cierra la puerta
en lugar de abrirla.
