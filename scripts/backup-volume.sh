#!/bin/sh
set -eu

BACKUP_DIR="${BACKUP_DIR:-/backups}"
INTERVAL_SECONDS="${BACKUP_INTERVAL_SECONDS:-86400}"
RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-14}"
mkdir -p "$BACKUP_DIR"

while :; do
  timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
  snapshot="$(mktemp -d)"
  archive="$BACKUP_DIR/nusasuite-$timestamp.tar.gz"
  trap 'rm -rf "$snapshot"' EXIT HUP INT TERM

  echo "Creating consistent SQLite snapshot: $archive"
  sqlite3 /source/app.db ".backup '$snapshot/app.db'"
  if [ -d /source/uploads ]; then
    cp -a /source/uploads "$snapshot/uploads"
  fi
  tar -czf "$archive" -C "$snapshot" .
  rm -rf "$snapshot"
  trap - EXIT HUP INT TERM

  find "$BACKUP_DIR" -type f -name 'nusasuite-*.tar.gz' -mtime "+$RETENTION_DAYS" -delete
  echo "Backup created: $archive"
  sleep "$INTERVAL_SECONDS"
done
