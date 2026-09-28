# 1: Frontend build
FROM node:26-alpine AS build-frontend
WORKDIR /app/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend ./
COPY locales /app/locales
RUN npm run build

# 2: Backend build
# better-sqlite3 and argon2 are native modules: when no prebuilt binary matches
# the running Node ABI they fall back to node-gyp, which needs this toolchain.
# It never reaches the final image, which only receives the built output.
FROM node:26-alpine AS build-backend
RUN apk add --no-cache python3 make g++
WORKDIR /app/backend
COPY backend/package.json backend/package-lock.json ./
RUN npm ci
COPY backend ./
RUN npm run build && npm prune --omit=dev

# 3: Final image, nginx + Node.js
FROM node:26-alpine
WORKDIR /app

# Filled in by the publish workflow (docker/metadata-action's resolved tag and
# the commit it built from) — a container can't otherwise know its own image
# tag from the inside without talking to the Docker daemon. Left as "dev" for
# a plain local `docker build`. Surfaced on the admin panel's System page.
ARG APP_IMAGE_REF=dev
ARG APP_IMAGE_REVISION=
ENV APP_IMAGE_REF=$APP_IMAGE_REF \
    APP_IMAGE_REVISION=$APP_IMAGE_REVISION

# Links the package to its repository on GHCR and fills in its description.
LABEL org.opencontainers.image.source="https://github.com/PixlGalaxy/WebinCloud" \
      org.opencontainers.image.title="Webin Cloud Server" \
      org.opencontainers.image.description="Self-hosted web server for your files: accounts, per-folder permissions, in-browser previews and public share links." \
      org.opencontainers.image.licenses="MIT"

RUN apk add --no-cache nginx tini ffmpeg tar

COPY --from=build-frontend /app/frontend/dist /usr/share/nginx/html
COPY --from=build-backend /app/backend/dist /app/backend/dist
COPY --from=build-backend /app/backend/node_modules /app/backend/node_modules
COPY --from=build-backend /app/backend/package.json /app/backend/package.json
COPY locales /app/locales
# Defaults copied into /appdata on first boot so they can be replaced there.
COPY branding /app/branding

COPY nginx.conf /etc/nginx/nginx.conf
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

ENV NODE_ENV=production \
    PORT=4000 \
    DATA_ROOT=/data \
    APPDATA_ROOT=/appdata \
    TEMP_ROOT=/temp \
    LOCALES_DIR=/app/locales \
    DEFAULT_BRANDING_DIR=/app/branding \
    LANGUAGE=en

# WebinCloud_Data holds user files, WebinCloud_AppData the database and avatars,
# and WebinCloud_Temp the generated archives, which are disposable.
VOLUME ["/data", "/appdata", "/temp"]
EXPOSE 80

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD node -e "fetch('http://127.0.0.1:4000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# tini as PID 1 so signals and zombie processes are handled properly.
ENTRYPOINT ["tini", "--", "/entrypoint.sh"]
