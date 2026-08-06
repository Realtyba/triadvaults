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

# El servidor y archivos compartidos
COPY server ./server
COPY shared ./shared
COPY migrations ./migrations
COPY scripts ./scripts

# server/mailer.js lee las plantillas de email localizadas de aquí
COPY src/locales ./src/locales

EXPOSE 3001

# Healthcheck interno
HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD wget -qO- http://localhost:3001/api/health || exit 1

CMD ["node", "server/index.js"]
