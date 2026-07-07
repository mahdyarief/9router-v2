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
FROM node:20-bookworm AS production
WORKDIR /app

# Install nginx + build tools for native modules + Python for automation scripts
RUN apt-get update && apt-get install -y \
    python3 \
    python3-venv \
    python3-pip \
    nginx \
    && rm -rf /var/lib/apt/lists/*

# Create Python virtual environment for automation scripts
RUN python3 -m venv /app/.venv

# Install Python dependencies for automation
RUN /app/.venv/bin/pip install --upgrade pip && \
    /app/.venv/bin/pip install playwright camoufox && \
    /app/.venv/bin/python -m playwright install --with-deps firefox && \
    /app/.venv/bin/python -m camoufox fetch

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

# Copy automation Python scripts
COPY backend/src/automation/ backend/src/automation/

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
