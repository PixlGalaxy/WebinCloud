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

# The backend, and the ffmpeg it runs on uploaded files, run as PUID:PGID
# rather than root, so whatever it creates in /data belongs to a user the host
# knows. 99:100 is nobody:users, what Unraid and its SMB shares expect; PUID=0
# keeps the old behaviour of running as root.
PUID=${PUID:-99}
PGID=${PGID:-100}
UMASK=${UMASK:-002}

case "$PUID$PGID" in
    *[!0-9]*)
        echo "[ENTRYPOINT] PUID and PGID must be numbers, got PUID=$PUID PGID=$PGID"
        exit 1
        ;;
esac
case "$UMASK" in
    [0-7][0-7][0-7] | [0-7][0-7][0-7][0-7]) ;;
    *)
        echo "[ENTRYPOINT] UMASK must be octal like 002, got $UMASK"
        exit 1
        ;;
esac

# Where the backend leaves a request for this loop to restart nginx: a
# non-root backend can't signal the root nginx master itself.
CONTROL_DIR=/run/webincloud
FRONTEND_RESTART_REQUEST=$CONTROL_DIR/restart-frontend
mkdir -p "$CONTROL_DIR"
rm -f "$FRONTEND_RESTART_REQUEST"

if [ "$PUID" != 0 ]; then
    # appdata and temp hold only what the app wrote, so they are handed over
    # whole (a no-op once they match). /data is the user's content and is
    # never changed here: it only gets a warning when it isn't writable.
    for dir in "$CONTROL_DIR" "${APPDATA_ROOT:-/appdata}" "${TEMP_ROOT:-/temp}"; do
        find "$dir" \( ! -user "$PUID" -o ! -group "$PGID" \) -exec chown -h "$PUID:$PGID" {} +
    done

    DATA_DIR=${DATA_ROOT:-/data}
    # An empty folder has nothing of the user's in it yet, so it is safe to hand over.
    if ! su-exec "$PUID:$PGID" test -w "$DATA_DIR" && [ -z "$(ls -A "$DATA_DIR" 2>/dev/null)" ]; then
        chown "$PUID:$PGID" "$DATA_DIR"
    fi
    if ! su-exec "$PUID:$PGID" test -w "$DATA_DIR"; then
        echo "[ENTRYPOINT] WARNING: $DATA_DIR is not writable by $PUID:$PGID, so uploads and edits will fail."
        echo "[ENTRYPOINT] Give the files to that user on the host (Unraid: Tools > Docker Safe New Permissions),"
        echo "[ENTRYPOINT] or run: chown -R $PUID:$PGID <host folder> && chmod -R u+rwX,g+rwX <host folder>"
    fi
fi

umask "$UMASK"
if [ "$PUID" = 0 ]; then
    echo "[ENTRYPOINT] running the backend as root with umask $UMASK"
else
    echo "[ENTRYPOINT] running the backend as $PUID:$PGID with umask $UMASK"
fi

start_frontend() {
    # awk with fflush works on busybox too, unlike `sed -u`.
    nginx -g 'daemon off;' 2>&1 | awk '{ print "[FRONTEND] " $0; fflush() }' &
    FRONTEND_PID=$!
}

start_backend() {
    if [ "$PUID" = 0 ]; then
        node /app/backend/dist/index.js &
    else
        su-exec "$PUID:$PGID" node /app/backend/dist/index.js &
    fi
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

    if [ -e "$FRONTEND_RESTART_REQUEST" ]; then
        rm -f "$FRONTEND_RESTART_REQUEST"
        kill "$(cat /run/nginx.pid 2>/dev/null)" 2>/dev/null || true
        # Let nginx exit, so the check below sees it gone and starts it again.
        sleep 1
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
