#!/bin/sh
set -eu

# Both nginx streams get tagged here; the backend already tags its own lines.
# The braces keep $! pointing at the subshell, which ends when nginx does.
{ nginx -g 'daemon off;' 2>&1 | sed -u 's/^/[FRONTEND] /'; } &
NGINX_PID=$!

node /app/backend/dist/index.js &
NODE_PID=$!

# POSIX sh has no `wait -n`, so poll both children instead.
while kill -0 "$NGINX_PID" 2>/dev/null && kill -0 "$NODE_PID" 2>/dev/null; do
    sleep 2
done

echo "[ENTRYPOINT] a process exited, shutting down the container"
kill "$NGINX_PID" "$NODE_PID" 2>/dev/null || true
exit 1
