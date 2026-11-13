# syntax=docker/dockerfile:1.7

ARG NODE_IMAGE=node:24-alpine
ARG TSX_VERSION=4.23.15

# Build and type-check the frontend with dependency caching.
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

# Production dependencies only. tsx is installed separately because the API
# executes TypeScript at runtime while tsx is a development dependency.
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
RUN command -v tsx \
    && command -v pg_dump \
    && command -v pg_restore \
    && command -v psql
WORKDIR /app

COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm,sharing=locked \
    npm ci --omit=dev --no-audit --no-fund

COPY --from=build --chown=node:node /app/server ./server
COPY --from=build --chown=node:node /app/pg-migrations ./pg-migrations
COPY --from=build --chown=node:node /app/dist ./dist
COPY --chown=root:root docker-entrypoint.sh /usr/local/bin/app-entrypoint
RUN chmod 0755 /usr/local/bin/app-entrypoint

EXPOSE 3001
STOPSIGNAL SIGTERM
ENTRYPOINT ["/usr/local/bin/app-entrypoint"]
CMD ["npm", "start"]
