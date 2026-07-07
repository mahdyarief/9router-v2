# ─── Stage 1: Build Frontend ───────────────────────────────────────────────────
FROM node:20-alpine AS frontend-build
WORKDIR /app

# Copy workspace root
COPY package.json package-lock.json ./
COPY frontend/package.json frontend/
COPY backend/package.json backend/
COPY backend/open-sse/package.json backend/open-sse/

# Install all deps (needed for workspace resolution)
RUN npm ci

# Copy frontend source
COPY frontend/ frontend/
COPY backend/open-sse/ backend/open-sse/

# Build frontend → frontend/dist
RUN npm run build --workspace=frontend

# ─── Stage 2: Build Backend ───────────────────────────────────────────────────
FROM node:20-alpine AS backend-build
WORKDIR /app

# Install build tools for native modules (better-sqlite3)
RUN apk add --no-cache python3 make g++

# Copy workspace root
COPY package.json package-lock.json ./
COPY frontend/package.json frontend/
COPY backend/package.json backend/
COPY backend/open-sse/package.json backend/open-sse/

# Install all deps
RUN npm ci

# Copy backend source
COPY backend/ backend/

# Build backend → backend/dist
RUN npm run build --workspace=backend

# ─── Stage 3: Production ──────────────────────────────────────────────────────
FROM node:20-alpine AS production
WORKDIR /app

# Install runtime deps for native modules + nginx
RUN apk add --no-cache python3 make g++ nginx shadow \
    && npm install -g npm

# Create app user
RUN useradd -r -u 1001 -g root appuser 2>/dev/null || true

# Copy workspace package files
COPY package.json package-lock.json ./
COPY frontend/package.json frontend/
COPY backend/package.json backend/
COPY backend/open-sse/package.json backend/open-sse/

# Install production deps only
RUN npm ci --omit=dev

# Copy built frontend
COPY --from=frontend-build /app/frontend/dist ./frontend/dist

# Copy built backend
COPY --from=backend-build /app/backend/dist ./backend/dist

# Copy runtime files
COPY --from=backend-build /app/backend/open-sse ./backend/open-sse
COPY nginx.conf /etc/nginx/http.d/default.conf

# Create data directory
RUN mkdir -p /var/lib/9router \
    && chown -R node:node /app /var/lib/9router

# Copy entrypoint
COPY docker-entrypoint.sh /app/docker-entrypoint.sh
RUN chmod +x /app/docker-entrypoint.sh

EXPOSE 20128

VOLUME ["/var/lib/9router"]

ENV NODE_ENV=production
ENV PORT=3001
ENV DATA_DIR=/var/lib/9router

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD wget -qO- http://localhost:20128/ || exit 1

ENTRYPOINT ["/app/docker-entrypoint.sh"]
