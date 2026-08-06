FROM node:22-alpine AS build

WORKDIR /app
RUN corepack enable && corepack prepare pnpm@11.1.2 --activate
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm exec vite build

# --- Imagen de producción ---
FROM node:22-alpine

WORKDIR /app
RUN corepack enable && corepack prepare pnpm@11.1.2 --activate

# Solo dependencias de producción
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile --prod

# El build del cliente
COPY --from=build /app/dist ./dist

# El servidor y archivos compartidos.
#
# Ya no se copian `migrations` ni `src/locales`: el esquema vive en realtyba-api
# (database/migrations/TriadVaults) y las plantillas de correo también, porque el
# envío pasó al servicio central.
COPY server ./server
COPY shared ./shared
COPY scripts ./scripts

EXPOSE 3001

# Healthcheck interno. La ruta es /health y no /api/health: el prefijo /api de
# este servidor desapareció con las rutas de cuentas.
HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD wget -qO- http://localhost:3001/health || exit 1

CMD ["node", "server/index.js"]
