#!/bin/sh
set -e

# Generate JWT secret if not provided
if [ -z "$JWT_SECRET" ]; then
  export JWT_SECRET=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")
  echo "⚠️  Generated random JWT_SECRET (set JWT_SECRET env var for persistence)"
fi

# Generate initial password if not provided
if [ -z "$INITIAL_PASSWORD" ]; then
  export INITIAL_PASSWORD="admin"
  echo "⚠️  Using default INITIAL_PASSWORD=admin (change this!)"
fi

# Start nginx in background
echo "🚀 Starting nginx..."
nginx

# Start backend
echo "🚀 Starting 9Router v2 backend on port ${PORT:-20128}..."
exec node /app/backend/dist/server.js
