# ─── Stage 1: Build Everything ─────────────────────────────────────────────────
FROM node:20-alpine AS build
WORKDIR /app

# Install build tools for native modules (better-sqlite3)
RUN apk add --no-cache python3 make g++

# Copy workspace package files
COPY package.json package-lock.json ./
COPY frontend/package.json frontend/
COPY backend/package.json backend/
COPY backend/open-sse/package.json backend/open-sse/

# Install ALL deps (including dev) for building
RUN npm ci

# Copy source
COPY frontend/ frontend/
COPY backend/src/ backend/src/
COPY backend/tsconfig.json backend/

# Build frontend → frontend/dist
RUN npm run build --workspace=frontend

# Build backend → backend/dist
RUN npm run build --workspace=backend

# ─── Stage 2: Production ──────────────────────────────────────────────────────
FROM node:20-alpine AS production
WORKDIR /app

# Install nginx
RUN apk add --no-cache nginx

# Copy node_modules from build (includes native modules already compiled)
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/backend/node_modules ./backend/node_modules

# Copy package files (needed for workspace resolution)
COPY package.json package-lock.json ./
COPY frontend/package.json frontend/
COPY backend/package.json backend/
COPY backend/open-sse/package.json backend/open-sse/

# Copy built frontend
COPY --from=build /app/frontend/dist ./frontend/dist

# Copy built backend
COPY --from=build /app/backend/dist ./backend/dist

# Copy open-sse runtime files (plain JS)
COPY backend/open-sse ./backend/open-sse

# Copy nginx config
COPY nginx.conf /etc/nginx/http.d/default.conf

# Create data directory
RUN mkdir -p /var/lib/9router

# Copy entrypoint
COPY docker-entrypoint.sh /app/docker-entrypoint.sh
RUN chmod +x /app/docker-entrypoint.sh

EXPOSE 20128

VOLUME ["/var/lib/9router"]

ENV NODE_ENV=production
ENV PORT=3001
ENV DATA_DIR=/var/lib/9router

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD wget -qO- http://localhost:20128/health || exit 1

ENTRYPOINT ["/app/docker-entrypoint.sh"]
