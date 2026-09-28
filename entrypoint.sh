#!/bin/sh
set -u

# Each service respawns on its own after exiting — used by the admin panel's
# "restart backend"/"restart frontend" buttons (see process-control.ts), which
# just make the process exit and let this loop bring it back in ~2s. A crash
# loop is still fatal to the container: more than MAX_RESTARTS exits within
# WINDOW_SECONDS for either service means something is actually broken, not a
# deliberate one-off restart, and the whole container goes down as before.
MAX_RESTARTS=8
WINDOW_SECONDS=60

start_frontend() {
    # awk with fflush works on busybox too, unlike `sed -u`.
    nginx -g 'daemon off;' 2>&1 | awk '{ print "[FRONTEND] " $0; fflush() }' &
    FRONTEND_PID=$!
}

start_backend() {
    node /app/backend/dist/index.js &
    BACKEND_PID=$!
}

start_frontend
start_backend

frontend_restarts=0
backend_restarts=0
window_start=$(date +%s)

# POSIX sh has no `wait -n`, so poll both children instead.
while true; do
    sleep 2

    now=$(date +%s)
    if [ $((now - window_start)) -gt "$WINDOW_SECONDS" ]; then
        window_start=$now
        frontend_restarts=0
        backend_restarts=0
    fi

    if ! kill -0 "$FRONTEND_PID" 2>/dev/null; then
        frontend_restarts=$((frontend_restarts + 1))
        if [ "$frontend_restarts" -gt "$MAX_RESTARTS" ]; then
            echo "[ENTRYPOINT] frontend is crash-looping, shutting down the container"
            kill "$BACKEND_PID" 2>/dev/null || true
            exit 1
        fi
        echo "[ENTRYPOINT] frontend exited, restarting"
        start_frontend
    fi

    if ! kill -0 "$BACKEND_PID" 2>/dev/null; then
        backend_restarts=$((backend_restarts + 1))
        if [ "$backend_restarts" -gt "$MAX_RESTARTS" ]; then
            echo "[ENTRYPOINT] backend is crash-looping, shutting down the container"
            kill "$FRONTEND_PID" 2>/dev/null || true
            exit 1
        fi
        echo "[ENTRYPOINT] backend exited, restarting"
        start_backend
    fi
done
