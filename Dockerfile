# syntax=docker/dockerfile:1.7

ARG NODE_IMAGE=node:24-alpine
ARG TSX_VERSION=4.23.15

# Build the frontend and validate the application with the full dependency set.
FROM ${NODE_IMAGE} AS build
WORKDIR /app

COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm,sharing=locked \
    npm ci --no-audit --no-fund

COPY . .
RUN npm run build \
    && test -s dist/index.html \
    && test -s server/index.ts \
    && test -f pg-migrations/001_skema_pg.sql

# Runtime image: production dependencies, PostgreSQL client utilities, and tsx.
FROM ${NODE_IMAGE} AS runtime
USER root
ARG TSX_VERSION
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    API_PORT=3001 \
    TZ=Asia/Jakarta \
    NPM_CONFIG_UPDATE_NOTIFIER=false

RUN apk add --no-cache postgresql-client tzdata su-exec \
    && npm install --global "tsx@${TSX_VERSION}" --no-audit --no-fund --allow-scripts=esbuild \
    && mkdir -p /app/data/uploads /app/data/backups \
    && chown -R node:node /app/data

WORKDIR /app
COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm,sharing=locked \
    npm ci --omit=dev --no-audit --no-fund

COPY --from=build --chown=node:node /app/server ./server
COPY --from=build --chown=node:node /app/pg-migrations ./pg-migrations
COPY --from=build --chown=node:node /app/dist ./dist
COPY --chown=root:root docker-entrypoint.sh /usr/local/bin/app-entrypoint
RUN chmod 0755 /usr/local/bin/app-entrypoint \
    && command -v tsx \
    && command -v pg_dump \
    && command -v pg_restore \
    && command -v psql

EXPOSE 3001
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD ["node", "-e", "fetch('http://127.0.0.1:3001/api/health').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"]
STOPSIGNAL SIGTERM
ENTRYPOINT ["/usr/local/bin/app-entrypoint"]
CMD ["npm", "start"]
