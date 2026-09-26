#!/bin/sh
set -eu

# The backend tags its own lines with [BACKEND]; nginx access_log carries
# [FRONTEND] via log_format, so only its error stream needs prefixing here.
nginx -g 'daemon off;' 2>&1 | sed -u 's/^/[FRONTEND] /' &
NGINX_PID=$!

node /app/backend/dist/index.js &
NODE_PID=$!

# Whichever process dies first takes the container down, so Docker restarts it.
wait -n "$NGINX_PID" "$NODE_PID"
echo "[ENTRYPOINT] a process exited, shutting down the container"
kill "$NGINX_PID" "$NODE_PID" 2>/dev/null || true
exit 1
