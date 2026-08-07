# Triad Vaults — Despliegue en Coolify

Este servidor solo coordina salas en tiempo real. Las cuentas, el progreso y los logros
los sirve `realtyba-api` (Laravel), que es quien habla con PostgreSQL. Aquí no hay base
de datos que crear ni migraciones que correr para el juego en sí.

El `Dockerfile` y el `docker-compose.yml` del repo ya están preparados para desplegarse
como recurso **"Docker Compose"** de Coolify: sin `ports:` publicado al host, sin
`container_name` fijo y sin `env_file` — Coolify inyecta las variables desde su panel y
enruta por su Traefik interno. No hay que tocar ninguno de los dos ficheros.

---

## Índice

1. [DNS de triadvaults.com](#1-dns-de-triadvaultscom)
2. [Crear el recurso en Coolify](#2-crear-el-recurso-en-coolify)
3. [Variables de entorno](#3-variables-de-entorno)
4. [Dominio y SSL](#4-dominio-y-ssl)
5. [Deploy y verificación](#5-deploy-y-verificación)
6. [Actualizar el juego](#6-actualizar-el-juego)
7. [Troubleshooting](#7-troubleshooting)

---

## 1. DNS de triadvaults.com

En el panel DNS de `triadvaults.com`, apunta el dominio (o el subdominio que vayas a
usar) a la IP del VPS con un registro **A**:

```
Tipo: A
Nombre: @              (apex: triadvaults.com)  — o "www" si prefieres www.triadvaults.com
Valor: TU_IP_DEL_VPS
TTL:   300
```

Comprueba que propagó antes de seguir:

```bash
dig triadvaults.com +short
# Debe devolver la IP del VPS
```

---

## 2. Crear el recurso en Coolify

En el panel de Coolify: **New Resource → Docker Compose**, apuntando al repo de `game`
(GitHub/GitLab, con deploy key si es privado) y a la rama a desplegar (normalmente
`main`). Coolify lee el `docker-compose.yml` de la raíz directamente — no hace falta
clonar nada a mano en el VPS.

---

## 3. Variables de entorno

Se cargan en la pestaña **Environment Variables** del recurso, una a una. No se sube
ningún `.env` al VPS.

| Variable | Valor | Build-time |
|---|---|---|
| `PORT` | `3001` | no |
| `NODE_ENV` | `production` | no |
| `TRIADVAULTS_API_URL` | URL pública de `realtyba-api` (ej. `https://api.triadvaults.com`), **sin** sufijo de ruta | **sí** |
| `TRIADVAULTS_INTERNAL_SECRET` | igual que en el `.env` de `realtyba-api` | no |
| `TRIADVAULTS_JWT_SECRET` | igual que en el `.env` de `realtyba-api` | no |
| `VITE_SOCKET_URL` | `https://triadvaults.com` (el dominio del propio juego) | **sí** |

Las dos marcadas **"sí"** hay que activarlas con el checkbox *"Available at
Buildtime"* junto a cada variable. El build de Vite las hornea en el bundle del cliente
en el momento de construir la imagen (`vite.config.js` las lee de un `.env` físico en el
contexto de build); si solo quedan inyectadas en el contenedor ya arrancado, el bundle
sale con esas URLs vacías y el healthcheck sigue en verde mientras nadie puede jugar.

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

## 4. Dominio y SSL

En la pestaña **Domains** del servicio `app`, escribe `triadvaults.com` (o
`www.triadvaults.com`, lo que hayas apuntado en el paso 1) y el puerto `3001`. Coolify
pide el certificado Let's Encrypt automáticamente en el primer deploy — el DNS tiene que
haber propagado ya — y lo renueva solo. Su Traefik ya escucha en los puertos 80 y 443
del VPS.

---

## 5. Deploy y verificación

Dispara el primer deploy con el botón **Deploy** del panel. Cuando termine:

```bash
curl https://triadvaults.com/health
# {"success":true,"service":"triadvaults-rooms","uptime":...,"api":true}
```

Abre `https://triadvaults.com` en el navegador y comprueba:

- [ ] La escena 3D se renderiza
- [ ] El indicador de servidor muestra "SERVIDOR EN LÍNEA" (punto verde)
- [ ] Puedes registrar una cuenta e iniciar sesión
- [ ] Puedes crear una sala y empezar a jugar (WebSocket funciona)
- [ ] Al terminar un nivel, el progreso se guarda (revisa en el panel de admin)

---

## 6. Actualizar el juego

No hace falta `git pull` ni `docker compose` a mano en el VPS. Conecta el webhook del
repo (pestaña **Webhooks** del recurso) para que cada push a la rama seguida dispare un
redeploy automático, o usa el botón **Redeploy** del panel para hacerlo manualmente.

---

## 7. Troubleshooting

### El healthcheck está en verde pero nadie puede jugar

**Síntoma:** `/health` responde bien, pero en las DevTools del navegador el socket
intenta conectar a `localhost` o a una URL vacía, y las llamadas a la API fallan.

**Causa:** `TRIADVAULTS_API_URL` y/o `VITE_SOCKET_URL` no están marcadas como
*"Available at Buildtime"* (paso 3). **Solución:** márcalas y vuelve a desplegar — no
basta con reiniciar el contenedor, hay que reconstruir la imagen.

### El contenedor no alcanza la API de cuentas

`api: true` en el healthcheck solo dice que la variable está puesta, no que la API
responda. Compruébalo desde dentro del contenedor (en Coolify, terminal del recurso):

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
