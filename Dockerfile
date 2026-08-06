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

EXPOSE 3001

# Healthcheck interno
HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD wget -qO- http://localhost:3001/api/health || exit 1

CMD ["node", "server/index.js"]
