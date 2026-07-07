# ─── Stage 1: Build Frontend ───────────────────────────────────────────────────
FROM node:20-alpine AS frontend-build
WORKDIR /app

# Install build tools for native modules (better-sqlite3)
RUN apk add --no-cache python3 make g++

# Copy workspace package files
COPY package.json package-lock.json ./
COPY frontend/package.json frontend/
COPY backend/package.json backend/
COPY backend/open-sse/package.json backend/open-sse/

# Install all deps
RUN npm ci

# Copy frontend source
COPY frontend/ frontend/
COPY backend/open-sse/ backend/open-sse/

# Build frontend → frontend/dist
RUN npm run build --workspace=frontend

# ─── Stage 2: Production ──────────────────────────────────────────────────────
FROM node:20-alpine AS production
WORKDIR /app

# Install nginx + build tools for native modules
RUN apk add --no-cache python3 make g++ nginx

# Copy workspace package files
COPY package.json package-lock.json ./
COPY frontend/package.json frontend/
COPY backend/package.json backend/
COPY backend/open-sse/package.json backend/open-sse/

# Install ALL deps (tsx is devDep, needed to run backend)
RUN npm ci

# Copy built frontend
COPY --from=frontend-build /app/frontend/dist ./frontend/dist

# Copy backend source (run with tsx, no compile needed)
COPY backend/src/ backend/src/
COPY backend/tsconfig.json backend/
COPY backend/open-sse/ backend/open-sse/

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
