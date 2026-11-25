#!/bin/sh
set -eu

mkdir -p /app/data/uploads /app/data/backups
chown -R node:node /app/data/uploads /app/data/backups
exec su-exec node "$@"
