# Triad Vaults — Despliegue en VPS (Docker + Coolify)

Guía paso a paso para montar Triad Vaults en un VPS con Ubuntu. La aplicación
corre dentro de un contenedor Docker, aislada del resto de servicios del servidor.
Este servidor solo coordina salas: las cuentas, el progreso y los logros los sirve
`realtyba-api`, que es quien habla con PostgreSQL.

> **Coolify es la ruta principal de esta guía.** El `Dockerfile` y el
> `docker-compose.yml` del repo ya están preparados para desplegarse como recurso
> "Docker Compose" de Coolify: sin `ports:` publicado al host, sin `container_name`
> fijo y sin `env_file`, porque Coolify inyecta las variables y enruta por la red
> interna de Docker con su propio Traefik. Si en cambio vas a montarlo a mano con
> Nginx + Certbot (sin Coolify), la sección 8 trae al final las dos líneas que hay
> que devolver al `docker-compose.yml` para ese caso.

---

## Índice

1. [Requisitos](#1-requisitos)
2. [Preparar el subdominio](#2-preparar-el-subdominio)
3. [Clonar el proyecto](#3-clonar-el-proyecto)
4. [Configurar las variables de producción](#4-configurar-las-variables-de-producción)
5. [Base de datos](#5-base-de-datos)
6. [Dockerfile y docker-compose](#6-dockerfile-y-docker-compose)
7. [Construir y levantar el contenedor](#7-construir-y-levantar-el-contenedor)
8. [Dominio y SSL](#8-dominio-y-ssl)
9. [Verificar que todo funciona](#9-verificar-que-todo-funciona)
10. [Mantenimiento](#10-mantenimiento)
11. [Actualizar el juego](#11-actualizar-el-juego)
12. [Backups](#12-backups)
13. [Troubleshooting](#13-troubleshooting)

---

## 1. Requisitos

En el VPS (Ubuntu 22.04 o 24.04):

| Software | Versión mínima | Instalación |
|---|---|---|
| Docker + Docker Compose | 24+ | `sudo apt install docker.io docker-compose-v2` |
| Nginx | cualquiera | `sudo apt install nginx` |
| Certbot | cualquiera | `sudo apt install certbot python3-certbot-nginx` |
| PostgreSQL | 15+ | Ya instalado (central). Lo usa `realtyba-api`, no este servidor |
| Git | cualquiera | `sudo apt install git` |

> **Nota:** Si Docker no está instalado, sigue la [guía oficial](https://docs.docker.com/engine/install/ubuntu/).

Asegúrate de que tu usuario puede ejecutar Docker:

```bash
sudo usermod -aG docker $USER
# Cierra la sesión y vuelve a entrar para que el grupo surta efecto
```

---

## 2. Preparar el subdominio

En el panel DNS de tu dominio principal, crea un registro **A** apuntando al IP
del VPS:

```
Tipo: A
Nombre: game     (o el subdominio que quieras, p. ej. vault, triad, etc.)
Valor: TU_IP_DEL_VPS
TTL:   300
```

Resultado: `game.tudominio.com` → IP del VPS.

Espera a que propague (5-15 minutos). Comprueba con:

```bash
dig game.tudominio.com +short
# Debe devolver la IP del VPS
```

---

## 3. Clonar el proyecto

```bash
# Elige dónde vivirá el código en el VPS
sudo mkdir -p /opt/apps
cd /opt/apps
git clone <URL_DE_TU_REPOSITORIO> triad-vaults
cd triad-vaults
```

---

## 4. Configurar las variables de producción

**Con Coolify no se sube ni se edita ningún `.env` al VPS.** Las variables se
cargan una a una en la pestaña *Environment Variables* del recurso, en el panel
de Coolify. La lista de abajo es la misma en ambos casos; solo cambia dónde vive.

Además, marca `TRIADVAULTS_API_URL` y `VITE_SOCKET_URL` como **"Available at
Buildtime" / "Build Variable"** en Coolify (checkbox junto a cada variable). El
build de Vite (`pnpm exec vite build`, dentro del `Dockerfile`) lee estas dos de
un `.env` físico en el momento de construir la imagen —vía `loadEnv()` en
[`vite.config.js`](../vite.config.js)—, no del entorno del contenedor ya
arrancado. Si no las marcas como build-time, la imagen se construye con la URL
de la API y la del socket **vacías**: el healthcheck sigue en verde y nadie
puede jugar, con la misma pinta engañosa que el aviso del final de esta sección.

> Si en vez de Coolify vas a levantar el contenedor a mano (ver alternativa al
> final de la sección 8), sí necesitas un `.env` real en la raíz del proyecto:

```bash
cp .env.example .env
nano .env
```

Contenido recomendado para producción:

```env
# --- Servidor de salas ---
PORT=3001
NODE_ENV=production

# --- Integración con realtyba-api ---
# Este servidor ya no tiene base de datos ni SMTP: las cuentas, el progreso, los
# logros y el correo viven en realtyba-api.
TRIADVAULTS_API_URL=https://api.tudominio.com

# Los DOS son secretos COMPARTIDOS: tienen que valer exactamente lo mismo que en
# el .env de realtyba-api. No los generes aquí por tu cuenta.
TRIADVAULTS_INTERNAL_SECRET=el_mismo_valor_que_en_realtyba-api
TRIADVAULTS_JWT_SECRET=el_mismo_valor_que_en_realtyba-api

# --- Cliente (Vite) ---
# Solo el socket, que es lo único que sirve este proceso. La URL de la API no se
# repite aquí: el cliente la recibe de TRIADVAULTS_API_URL, horneada al construir.
VITE_SOCKET_URL=https://game.tudominio.com
```

> **Si `TRIADVAULTS_JWT_SECRET` no coincide con el de la API**, el fallo es de los
> engañosos: el registro y el inicio de sesión funcionan con normalidad —los sirve
> Laravel— y en cambio *todas* las conexiones de socket se rechazan con «token
> inválido». Si ves ese cuadro, compara los dos ficheros antes que ninguna otra cosa.

> Sin `TRIADVAULTS_JWT_SECRET`, este servidor **se niega a arrancar**. Es a
> propósito: antes avisaba y seguía con una clave de desarrollo conocida.

Para generar el par de secretos la primera vez (y copiarlos a los dos `.env`):

```bash
openssl rand -hex 32   # TRIADVAULTS_JWT_SECRET
openssl rand -hex 32   # TRIADVAULTS_INTERNAL_SECRET
```

---

## 5. Base de datos

**No hay ninguna que crear aquí.** El esquema del juego vive en `realtyba-api`, en la
conexión `triadvaults`, y su `docker-entrypoint.sh` aplica las migraciones y siembra el
catálogo de logros en cada arranque.

Si despliegas la API por tu cuenta:

```bash
# Desde realtyba-api
php artisan migrate --database=triadvaults --path="database/migrations/TriadVaults" --force
php artisan db:seed --database=triadvaults \
  --class="Database\Seeders\TriadVaults\AchievementCatalogSeeder" --force
```

Y para que el módulo de administración aparezca en el panel, en cada tenant que deba
tenerlo:

```bash
php artisan db:seed --class="Database\Seeders\Generic\Basic\ModulesTableSeeder"
php artisan db:seed --class="Database\Seeders\Generic\Basic\ModuleControllersTableSeeder"
php artisan db:seed --class="Database\Seeders\Generic\Basic\RoleModuleTableSeeder"
```

Los tres son idempotentes y resuelven los módulos del juego **por nombre**, no por id
fijo: los ids ya divergieron entre tenants, y con ids fijos el `insertOrIgnore` chocaría
con filas existentes y saltaría las nuevas en silencio.

---

## 6. Dockerfile y docker-compose

**Ambos ya existen en la raíz del proyecto — no hay que crearlos.** Esta sección
documenta lo que hace cada uno, para no tocarlos a ciegas.

[`Dockerfile`](../Dockerfile): build en dos etapas con pnpm (no npm — el repo
instala con pnpm, ver `pnpm-lock.yaml`). La imagen final **no** copia el `.env`
ni la carpeta `migrations`: el esquema del juego se mudó a `realtyba-api` en la
migración de TriadVaults, y hornear secretos dentro de una capa de la imagen es
un riesgo si esa imagen llega a subirse a un registry. Las variables de
producción entran por el entorno del contenedor (ver sección 4), y las de
build-time (`TRIADVAULTS_API_URL`, `VITE_SOCKET_URL`) por un `.env` en el
contexto de build — a mano si despliegas manual, o vía Coolify si lo marcas
"build variable".

[`docker-compose.yml`](../docker-compose.yml): preparado para Coolify —

```yaml
services:
  app:
    build: .
    restart: unless-stopped
    expose:
      - "3001"
    extra_hosts:
      - "host.docker.internal:host-gateway"
    environment:
      - NODE_ENV=production
    logging:
      driver: json-file
      options:
        max-size: "10m"
        max-file: "3"
```

- Sin `ports:` publicado al host: Coolify enruta al contenedor por la red
  interna de Docker a través de su Traefik. Publicar 3001 directo al host
  expondría el juego sin pasar por su SSL.
- Sin `container_name:` fijo: Coolify gestiona el nombre del contenedor en cada
  redeploy; uno fijo puede chocar con eso.
- Sin `env_file:`: las variables las inyecta Coolify desde su panel (sección 4),
  no un fichero en el VPS.

**Si vas a desplegar sin Coolify** (docker compose a mano + Nginx, alternativa
al final de la sección 8), este compose no te sirve tal cual: necesitas volver a
publicar el puerto y cargar el `.env`:

```yaml
    ports:
      - "3001:3001"
    env_file:
      - .env
```

`.dockerignore` ya existe también y no incluye `pnpm-lock.yaml` ni
`pnpm-workspace.yaml` — ambos hacen falta en el contexto de build para que
`pnpm install --frozen-lockfile` funcione; excluirlos rompería la imagen.

---

## 7. Construir y levantar el contenedor

### Con Coolify

En el panel: *New Resource → Docker Compose*, apuntando al repo de `game` (por
GitHub/GitLab con deploy key, o URL pública) y a la rama a desplegar. Coolify
lee el `docker-compose.yml` de la raíz del repo directamente — no hace falta
clonar nada a mano en el VPS ni correr `docker compose build`. El build y el
arranque los dispara el botón *Deploy* (o el webhook de la sección 11).

### Sin Coolify (docker compose a mano)

Con el `.env` de la sección 4 y las dos líneas (`ports`, `env_file`) devueltas
al `docker-compose.yml` como se indica en la sección 6:

```bash
cd /opt/apps/triad-vaults

# Construir la imagen
docker compose build

# Levantar el contenedor en segundo plano
docker compose up -d

# Verificar que está corriendo
docker compose ps
docker compose logs -f --tail 50
```

Deberías ver:

```
⚡ Triad Vaults — servidor de salas en http://localhost:3001
```

Si además aparece un aviso sobre `TRIADVAULTS_API_URL` o `TRIADVAULTS_INTERNAL_SECRET`,
se podrá jugar pero **nada se guardará**. Corrígelo antes de abrir al público.

Comprueba el health check:

```bash
curl http://localhost:3001/health
# {"success":true,"service":"triadvaults-rooms","uptime":...,"api":true}
```

---

## 8. Dominio y SSL

### Con Coolify

En la pestaña *Domains* del servicio `app`, escribe `game.tudominio.com` y el
puerto `3001`. Coolify pide el certificado Let's Encrypt automáticamente en el
primer deploy (el DNS del paso 2 tiene que haber propagado ya) y lo renueva
solo. Su Traefik ya escucha en los puertos 80 y 443 del VPS — no instales Nginx
ni Certbot para esta app, competirían por esos mismos puertos.

### Alternativa sin Coolify: Nginx + Certbot

Solo si el VPS **no** tiene Coolify. Primero, en el `docker-compose.yml`, añade
de vuelta lo que se quitó en la sección 6:

```yaml
    ports:
      - "3001:3001"
    env_file:
      - .env
```

Crea el archivo de configuración de Nginx:

```bash
sudo nano /etc/nginx/sites-available/triad-vaults
```

Contenido:

```nginx
server {
    listen 80;
    server_name game.tudominio.com;

    # Redirigir a HTTPS (se activará con Certbot)
    location / {
        return 301 https://$host$request_uri;
    }
}

server {
    listen 443 ssl http2;
    server_name game.tudominio.com;

    # Los certificados los pone Certbot aquí (se crean más abajo)
    # ssl_certificate /etc/letsencrypt/live/game.tudominio.com/fullchain.pem;
    # ssl_certificate_key /etc/letsencrypt/live/game.tudominio.com/privkey.pem;

    # Cabeceras de seguridad
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-XSS-Protection "1; mode=block" always;
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;

    # Proxy al contenedor de Triad Vaults
    location / {
        proxy_pass http://127.0.0.1:3001;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # WebSocket (Socket.IO necesita upgrade)
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";

        # Timeouts para WebSocket (las conexiones duran toda la partida)
        proxy_read_timeout 3600s;
        proxy_send_timeout 3600s;
    }

    # Cache agresiva para los assets estáticos del build
    location /assets/ {
        proxy_pass http://127.0.0.1:3001;
        proxy_cache_valid 200 30d;
        add_header Cache-Control "public, max-age=2592000, immutable";
    }

    # Limitar el body de las peticiones API
    client_max_body_size 1m;
}
```

Activa el sitio:

```bash
sudo ln -sf /etc/nginx/sites-available/triad-vaults /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
```

Y el certificado:

```bash
sudo certbot --nginx -d game.tudominio.com
```

Certbot:
1. Verificará que el DNS apunta al VPS
2. Generará el certificado
3. Editará la configuración de Nginx para activar SSL
4. Configurará la renovación automática

Verifica la renovación automática:

```bash
sudo certbot renew --dry-run
```

---

## 9. Verificar que todo funciona

```bash
# Health check por HTTPS
curl https://game.tudominio.com/health

# Debería devolver:
# {"success":true,"service":"triadvaults-rooms","uptime":...,"api":true}
```

Abre `https://game.tudominio.com` en el navegador. Deberías ver el menú principal
de Triad Vaults con la escena 3D de fondo.

Comprobaciones:
- [ ] La escena 3D se renderiza
- [ ] El indicador de servidor muestra "SERVIDOR EN LÍNEA" (punto verde)
- [ ] Puedes registrar una cuenta (y recibir el PIN por correo con Zoho)
- [ ] Puedes crear una sala y empezar a jugar
- [ ] El WebSocket funciona (el juego multijugador responde)

---

## 10. Mantenimiento

Con Coolify, todo esto también está en su UI (pestaña *Logs*, *Terminal*, uso de
recursos por recurso); los comandos de abajo son la vía directa por SSH cuando
hace falta más detalle.

### Logs del contenedor

```bash
# Logs en tiempo real
docker compose logs -f app

# Últimas 100 líneas
docker compose logs --tail 100 app
```

### Reiniciar el contenedor

```bash
docker compose restart app
```

### Estado del sistema

```bash
# Estado de Docker
docker compose ps

# Uso de recursos
docker stats triad-vaults

# Estado de Nginx
sudo systemctl status nginx

# Estado de PostgreSQL
sudo systemctl status postgresql

# Espacio en disco
df -h
```

### Renovación de certificados SSL

Certbot lo hace automáticamente con un cron/systemd timer. Para forzar:

```bash
sudo certbot renew
sudo systemctl reload nginx
```

---

## 11. Actualizar el juego

### Con Coolify

No hace falta `git pull` ni `docker compose` a mano en el VPS. Conecta el
webhook de tu repo (GitHub/GitLab) en la pestaña *Webhooks* del recurso para que
cada push a la rama seguida dispare un redeploy automático, o usa el botón
*Redeploy* del panel para hacerlo a mano. El resto de esta sección (`deploy.sh`,
`docker compose` directo) es solo para el despliegue manual sin Coolify.

### Sin Coolify

Cuando hagas cambios en el código y quieras desplegar la nueva versión:

```bash
cd /opt/apps/triad-vaults

# Traer los cambios
git pull origin main

# Reconstruir la imagen (incluye el nuevo build de Vite)
docker compose build

# Reemplazar el contenedor con la imagen nueva (0-downtime con --force-recreate)
docker compose up -d --force-recreate

# Verificar
docker compose logs -f --tail 20 app
curl https://game.tudominio.com/health
```

### Script de despliegue rápido

Crea `deploy.sh` en la raíz del proyecto:

```bash
cat > deploy.sh << 'DEPLOY'
#!/bin/bash
set -e

echo "📦 Pulling latest code..."
git pull origin main

echo "🐳 Building Docker image..."
docker compose build

echo "🗃️  Running migrations..."

echo "🚀 Deploying..."
docker compose up -d --force-recreate

echo "⏳ Waiting for health check..."
sleep 5
curl -sf https://game.tudominio.com/health && echo " ✅ Deployed!" || echo " ❌ Health check failed"
DEPLOY

chmod +x deploy.sh
```

Uso:

```bash
./deploy.sh
```

---

## 12. Backups

### Base de datos (PostgreSQL)

La base del juego **la respalda `realtyba-api`**, no este servidor: aquí no hay nada
persistente que salvar, las salas viven en memoria y se pierden en cada despliegue (que
es lo correcto: una partida que nadie está jugando no tiene por qué sobrevivir).

Aun así, la base `triadvaults` existe y hay que respaldarla desde donde vive. Si es el
mismo VPS, un cron diario:

```bash
sudo mkdir -p /opt/backups/triadvaults

cat > /opt/backups/triadvaults/backup.sh << 'BACKUP'
#!/bin/bash
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_DIR=/opt/backups/triadvaults
KEEP_DAYS=14

sudo -u postgres pg_dump triadvaults | gzip > "${BACKUP_DIR}/triadvaults_${TIMESTAMP}.sql.gz"

# Borrar respaldos de más de $KEEP_DAYS días
find "$BACKUP_DIR" -name "*.sql.gz" -mtime +$KEEP_DAYS -delete

echo "Backup completado: triadvaults_${TIMESTAMP}.sql.gz"
BACKUP

chmod +x /opt/backups/triadvaults/backup.sh

# Programar a las 3:00 AM cada día
(crontab -l 2>/dev/null; echo "0 3 * * * /opt/backups/triadvaults/backup.sh >> /opt/backups/triadvaults/backup.log 2>&1") | crontab -
```

### Restaurar un backup

```bash
gunzip -c /opt/backups/triadvaults/triadvaults_XXXXXXXX_XXXXXX.sql.gz | sudo -u postgres psql triadvaults
```

---

## 13. Troubleshooting

### El cliente no encuentra la API ni el socket, aunque el healthcheck esté en verde

**Síntoma:** con Coolify, `/health` responde bien pero en las DevTools del
navegador el socket intenta conectar a `localhost` o a una URL vacía, y las
llamadas a la API fallan con un dominio que no existe.

**Causa:** `TRIADVAULTS_API_URL` y/o `VITE_SOCKET_URL` no están marcadas como
*"Available at Buildtime"* en el panel de Coolify (sección 4). El build de Vite
las hornea en el bundle del cliente en el momento de construir la imagen; si
Coolify solo las inyecta en el contenedor ya arrancado, el bundle sale con esas
URLs vacías y no hay forma de arreglarlo sin reconstruir la imagen.

**Solución:** marca las dos como build-time en Coolify y vuelve a desplegar
(no basta con reiniciar el contenedor — hay que reconstruir la imagen).

### El contenedor no alcanza la API de cuentas

**Síntoma:** el health check devuelve `"api": true` pero nadie puede iniciar sesión, o
el progreso no se guarda aunque la partida vaya bien.

`api: true` solo dice que las variables están **puestas**, no que la API responda. Para
saberlo, prueba desde dentro del contenedor:

```bash
docker compose exec app wget -qO- $TRIADVAULTS_API_URL/api/triadvaults/health
```

Si no resuelve y la API vive en el mismo host, comprueba que `host.docker.internal`
funciona; en Ubuntu < 24.04 `host-gateway` puede fallar.

**No lo arregles poniendo la IP del bridge** (`172.17.0.1`) en `TRIADVAULTS_API_URL`.
Esa variable es ahora la única de la API y de ella sale también la URL que se hornea
en el cliente ([Dockerfile](../Dockerfile) copia el `.env` y compila con él), así que
una dirección que solo existe dentro del contenedor deja al navegador sin API: el
síntoma se cambia por otro peor, con el servidor contento y nadie capaz de entrar.

El valor tiene que ser **alcanzable desde los dos lados**, contenedor y navegador —
en un despliegue normal, el dominio público de la API. Si el contenedor no llega a
ese dominio, el problema es de red del host (DNS interno, split-horizon, firewall
saliente) y se arregla ahí, no en el `.env`.

### El registro funciona pero el socket rechaza a todo el mundo

**Síntoma:** el jugador se registra y entra sin problema, y al crear o unirse a una sala
el cliente se queda en «Conectando...» o dice «Autenticación denegada: Token inválido».

**Causa casi segura:** `TRIADVAULTS_JWT_SECRET` no coincide entre el `.env` del juego y
el de `realtyba-api`. El REST lo sirve Laravel —que firma con *su* secreto y por eso
funciona— y el socket lo verifica este servidor con el suyo.

**Solución:** compara los dos ficheros. El valor tiene que ser idéntico y de al menos
32 bytes.

### El servidor reporta 401 al guardar el progreso

**Síntoma:** en los logs, `[api] POST /progress respondió 401`. Se juega bien pero nada
se guarda.

**Causa:** `TRIADVAULTS_INTERNAL_SECRET` no coincide con el de la API. Si en cambio ves
un **503**, es que en la API está vacío: sin secreto configurado, la API cierra la
puerta en lugar de abrirla.

### WebSocket no conecta (el juego se queda en "Conectando...")

**Causa:** Nginx no está pasando los headers de WebSocket.

**Solución:** Verifica que la configuración de Nginx tiene las líneas:

```nginx
proxy_set_header Upgrade $http_upgrade;
proxy_set_header Connection "upgrade";
proxy_read_timeout 3600s;
```

### Certbot falla al verificar el dominio

**Causa:** El DNS no apunta al VPS o el puerto 80 está bloqueado.

**Solución:**

```bash
# Verificar DNS
dig game.tudominio.com +short

# Verificar que el puerto 80 está abierto
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
```

### El juego va lento o se cuelga con muchas conexiones

**Solución:** Ajusta los límites de Node.js:

```yaml
# En docker-compose.yml, dentro de environment:
environment:
  - NODE_ENV=production
  - UV_THREADPOOL_SIZE=8
```

### Ver qué está consumiendo recursos

```bash
# Sin container_name fijo (Coolify lo asigna), busca el id primero:
docker stats $(docker compose ps -q app)
htop
```

---

## Resumen de puertos

**Con Coolify** (por defecto en este repo):

| Puerto | Servicio | Acceso |
|---|---|---|
| 80 | Traefik de Coolify (redirige a 443) | Público |
| 443 | Traefik de Coolify (SSL → red interna) | Público |
| 3001 | Triad Vaults (Docker, solo `expose`) | Solo red interna de Docker |
| 5432 | PostgreSQL (host) | Solo localhost + Docker bridge |

**Sin Coolify** (Nginx manual, sección 8):

| Puerto | Servicio | Acceso |
|---|---|---|
| 80 | Nginx (redirige a 443) | Público |
| 443 | Nginx (SSL → proxy a 3001) | Público |
| 3001 | Triad Vaults (Docker, publicado al host) | Solo localhost |
| 5432 | PostgreSQL (host) | Solo localhost + Docker bridge |

---

## Arquitectura en producción

Con Coolify:

```
                Internet
                    │
            ┌───────┴───────┐
            │  Traefik :443 │  ← SSL automático (Coolify)
            │  (Coolify)    │
            └───────┬───────┘
                    │ red interna de Docker
          ┌─────────┴──────────┐
          │  Docker Container  │
          │  app:3001 (expose) │
          │  (Node.js + static)│
          └─────────┬──────────┘
                    │ host.docker.internal, o red interna
                    │ de Docker si realtyba-api también
                    │ corre en el mismo Coolify
          ┌─────────┴──────────┐
          │   PostgreSQL :5432 │  ← Central; la usa realtyba-api
          │   (base: triadvaults)│
          └────────────────────┘
```

Sin Coolify (Nginx + Certbot manual), el diagrama es el mismo cambiando el
bloque de Traefik por `Nginx :443 (reverse proxy, proxy_pass a 127.0.0.1:3001)`.
