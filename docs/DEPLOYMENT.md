# Triad Vaults — Despliegue en VPS (Docker + Nginx + SSL)

Guía paso a paso para montar Triad Vaults en un VPS con Ubuntu. La aplicación
corre dentro de un contenedor Docker, aislada del resto de servicios del servidor.
La base de datos PostgreSQL es central (compartida con otros proyectos del VPS).

---

## Índice

1. [Requisitos](#1-requisitos)
2. [Preparar el subdominio](#2-preparar-el-subdominio)
3. [Clonar el proyecto](#3-clonar-el-proyecto)
4. [Configurar `.env` de producción](#4-configurar-env-de-producción)
5. [Crear la base de datos](#5-crear-la-base-de-datos)
6. [Dockerfile y docker-compose](#6-dockerfile-y-docker-compose)
7. [Construir y levantar el contenedor](#7-construir-y-levantar-el-contenedor)
8. [Configurar Nginx como reverse proxy](#8-configurar-nginx-como-reverse-proxy)
9. [SSL con Let's Encrypt (Certbot)](#9-ssl-con-lets-encrypt-certbot)
10. [Verificar que todo funciona](#10-verificar-que-todo-funciona)
11. [Mantenimiento](#11-mantenimiento)
12. [Actualizar el juego](#12-actualizar-el-juego)
13. [Backups](#13-backups)
14. [Troubleshooting](#14-troubleshooting)

---

## 1. Requisitos

En el VPS (Ubuntu 22.04 o 24.04):

| Software | Versión mínima | Instalación |
|---|---|---|
| Docker + Docker Compose | 24+ | `sudo apt install docker.io docker-compose-v2` |
| Nginx | cualquiera | `sudo apt install nginx` |
| Certbot | cualquiera | `sudo apt install certbot python3-certbot-nginx` |
| PostgreSQL | 15+ | Ya instalado (central) |
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

## 4. Configurar `.env` de producción

Copia el ejemplo y edítalo:

```bash
cp .env.example .env
nano .env
```

Contenido recomendado para producción:

```env
# --- Servidor ---
PORT=3001
NODE_ENV=production

# Clave JWT: genera una aleatoria y larga
JWT_SECRET=$(openssl rand -hex 64)

# --- Cliente (Vite) ---
# Apuntar al subdominio con HTTPS
VITE_API_URL=https://game.tudominio.com

# --- PostgreSQL (la central del VPS) ---
DB_HOST=host.docker.internal
DB_PORT=5432
DB_USERNAME=postgres
DB_PASSWORD=tu_password_de_postgres
DB_DATABASE=triadvaults

# Obligatorio en producción: si Postgres no responde, no arrancar
DB_REQUIRED=true

# --- Correo (Zoho) ---
SMTP_HOST=smtp.zoho.com
SMTP_PORT=587
SMTP_USER=tu_correo@tudominio.com
SMTP_PASS=tu_contraseña_de_aplicacion_zoho
SMTP_FROM="Triad Vaults" <tu_correo@tudominio.com>

# En producción, el PIN NUNCA viaja en la respuesta
AUTH_DEV_ECHO_PIN=false
```

> **Importante:** `DB_HOST=host.docker.internal` permite que el contenedor Docker
> se conecte al PostgreSQL del host. En Ubuntu puede requerir configuración extra
> (ver [sección de troubleshooting](#14-troubleshooting)).

Para generar el `JWT_SECRET` de una sola vez:

```bash
sed -i "s/^JWT_SECRET=.*/JWT_SECRET=$(openssl rand -hex 64)/" .env
```

---

## 5. Crear la base de datos

Desde el host (no desde Docker), crea la base de datos y aplica las migraciones:

```bash
# Crear la base de datos
sudo -u postgres psql -c "CREATE DATABASE triadvaults;"

# Aplicar migraciones (necesitas Node.js en el host, o hazlo desde Docker después)
# Opción A: si tienes Node.js en el host
cd /opt/apps/triad-vaults
npm install --production
node migrations/migrate.js

# Opción B: desde Docker (tras construir la imagen, paso 7)
# docker compose exec app node migrations/migrate.js
```

Verifica que PostgreSQL acepta conexiones desde Docker. Edita `pg_hba.conf`:

```bash
sudo nano /etc/postgresql/*/main/pg_hba.conf
```

Añade esta línea (permite conexiones desde la red de Docker):

```
host    triadvaults    postgres    172.16.0.0/12    md5
```

Y en `postgresql.conf`, asegúrate de que escucha en todas las interfaces:

```
listen_addresses = '*'
```

Reinicia PostgreSQL:

```bash
sudo systemctl restart postgresql
```

---

## 6. Dockerfile y docker-compose

Crea el `Dockerfile` en la raíz del proyecto:

```bash
cat > Dockerfile << 'DOCKERFILE'
FROM node:20-alpine AS build

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npx vite build

# --- Imagen de producción ---
FROM node:20-alpine

WORKDIR /app

# Solo dependencias de producción
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# El build del cliente
COPY --from=build /app/dist ./dist

# El servidor y archivos compartidos
COPY server ./server
COPY shared ./shared
COPY migrations ./migrations
COPY scripts ./scripts
COPY .env .env

EXPOSE 3001

# Healthcheck interno
HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD wget -qO- http://localhost:3001/api/health || exit 1

CMD ["node", "server/index.js"]
DOCKERFILE
```

Crea `docker-compose.yml`:

```bash
cat > docker-compose.yml << 'COMPOSE'
services:
  app:
    build: .
    container_name: triad-vaults
    restart: unless-stopped
    ports:
      - "3001:3001"
    extra_hosts:
      - "host.docker.internal:host-gateway"
    env_file:
      - .env
    environment:
      - NODE_ENV=production
    logging:
      driver: json-file
      options:
        max-size: "10m"
        max-file: "3"
COMPOSE
```

Crea un `.dockerignore` para que la imagen sea liviana:

```bash
cat > .dockerignore << 'IGNORE'
node_modules
dist
.git
.env.example
docs
electron
scripts/e2e
pnpm-lock.yaml
pnpm-workspace.yaml
*.md
IGNORE
```

---

## 7. Construir y levantar el contenedor

```bash
cd /opt/apps/triad-vaults

# Construir la imagen
docker compose build

# Aplicar migraciones (si no lo hiciste en el paso 5)
docker compose run --rm app node migrations/migrate.js

# Levantar el contenedor en segundo plano
docker compose up -d

# Verificar que está corriendo
docker compose ps
docker compose logs -f --tail 50
```

Deberías ver:

```
⚡ Triad Vaults — servidor multijugador en http://localhost:3001
✅ PostgreSQL conectado
```

Comprueba el health check:

```bash
curl http://localhost:3001/api/health
# {"success":true,"uptime":...,"storage":"postgres"}
```

---

## 8. Configurar Nginx como reverse proxy

Crea el archivo de configuración:

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

    # Los certificados los pone Certbot aquí (se crean en el paso 9)
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

---

## 9. SSL con Let's Encrypt (Certbot)

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

## 10. Verificar que todo funciona

```bash
# Health check por HTTPS
curl https://game.tudominio.com/api/health

# Debería devolver:
# {"success":true,"uptime":...,"storage":"postgres"}
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

## 11. Mantenimiento

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

## 12. Actualizar el juego

Cuando hagas cambios en el código y quieras desplegar la nueva versión:

```bash
cd /opt/apps/triad-vaults

# Traer los cambios
git pull origin main

# Reconstruir la imagen (incluye el nuevo build de Vite)
docker compose build

# Aplicar migraciones nuevas (si las hay)
docker compose run --rm app node migrations/migrate.js

# Reemplazar el contenedor con la imagen nueva (0-downtime con --force-recreate)
docker compose up -d --force-recreate

# Verificar
docker compose logs -f --tail 20 app
curl https://game.tudominio.com/api/health
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
docker compose run --rm app node migrations/migrate.js

echo "🚀 Deploying..."
docker compose up -d --force-recreate

echo "⏳ Waiting for health check..."
sleep 5
curl -sf https://game.tudominio.com/api/health && echo " ✅ Deployed!" || echo " ❌ Health check failed"
DEPLOY

chmod +x deploy.sh
```

Uso:

```bash
./deploy.sh
```

---

## 13. Backups

### Base de datos (PostgreSQL)

Crea un cron para respaldos diarios:

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

## 14. Troubleshooting

### El contenedor no conecta a PostgreSQL

**Síntoma:** `✅ PostgreSQL conectado` no aparece en los logs, el health check
devuelve `"storage":"json"`.

**Causa:** Docker no puede alcanzar el Postgres del host.

**Solución:** Verifica que `host.docker.internal` resuelve desde dentro del
contenedor:

```bash
docker compose exec app ping -c 2 host.docker.internal
```

Si no resuelve, comprueba que `extra_hosts` está en el `docker-compose.yml`.

En Ubuntu < 24.04, `host-gateway` puede no funcionar. Alternativa: usa la IP
del host directamente:

```bash
# Obtener la IP del bridge de Docker
ip addr show docker0 | grep -oP 'inet \K[\d.]+'
# Normalmente 172.17.0.1
```

Pon esa IP en el `.env`:

```env
DB_HOST=172.17.0.1
```

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
docker stats triad-vaults
htop
```

---

## Resumen de puertos

| Puerto | Servicio | Acceso |
|---|---|---|
| 80 | Nginx (redirige a 443) | Público |
| 443 | Nginx (SSL → proxy a 3001) | Público |
| 3001 | Triad Vaults (Docker) | Solo localhost |
| 5432 | PostgreSQL (host) | Solo localhost + Docker bridge |

---

## Arquitectura en producción

```
                Internet
                    │
            ┌───────┴───────┐
            │   Nginx :443  │  ← SSL (Let's Encrypt)
            │  reverse proxy│
            └───────┬───────┘
                    │ proxy_pass
          ┌─────────┴──────────┐
          │  Docker Container  │
          │  triad-vaults:3001 │
          │  (Node.js + static)│
          └─────────┬──────────┘
                    │ host.docker.internal
          ┌─────────┴──────────┐
          │   PostgreSQL :5432 │  ← Central, compartida
          │   (base: triadvaults)│
          └────────────────────┘
```
