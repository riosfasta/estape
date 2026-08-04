#!/usr/bin/env bash
set -Eeuo pipefail

log() {
  printf '\n[bugmega-backup] %s\n' "$*"
}

die() {
  printf '\n[bugmega-backup] ERROR: %s\n' "$*" >&2
  exit 1
}

if [ "$(id -u)" -ne 0 ]; then
  die "run this script with sudo or as root"
fi

if [ -f "${DEPLOY_CONFIG:-/etc/bugmega/deploy.env}" ]; then
  set -a
  # shellcheck disable=SC1090
  . "${DEPLOY_CONFIG:-/etc/bugmega/deploy.env}"
  set +a
fi

MONGO_URI="${MONGO_URI:-mongodb://127.0.0.1:27017/}"
MONGO_DB_NAME="${MONGO_DB_NAME:-bugmarking}"
UPLOAD_DIR="${UPLOAD_DIR:-/var/lib/bugmega/uploads}"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/bugmega}"
BACKUP_RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-14}"

command -v mongodump >/dev/null || die "mongodump is not installed"

timestamp="$(date -u +%Y%m%d-%H%M%S)"
mkdir -p "$BACKUP_DIR"

mongo_archive="$BACKUP_DIR/${MONGO_DB_NAME}-${timestamp}.archive.gz"
uploads_archive="$BACKUP_DIR/uploads-${timestamp}.tar.gz"

log "Backing up MongoDB database $MONGO_DB_NAME"
mongodump --uri "$MONGO_URI" --db "$MONGO_DB_NAME" --archive="$mongo_archive" --gzip

if [ -d "$UPLOAD_DIR" ]; then
  log "Backing up uploads from $UPLOAD_DIR"
  tar -C "$(dirname "$UPLOAD_DIR")" -czf "$uploads_archive" "$(basename "$UPLOAD_DIR")"
else
  log "Upload directory does not exist yet; skipping uploads backup"
fi

find "$BACKUP_DIR" -type f -name '*.gz' -mtime +"$BACKUP_RETENTION_DAYS" -delete

log "Mongo backup: $mongo_archive"
if [ -f "$uploads_archive" ]; then
  log "Uploads backup: $uploads_archive"
fi
