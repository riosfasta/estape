#!/usr/bin/env bash
set -Eeuo pipefail

log() {
  printf '\n[pinflow-restore] %s\n' "$*"
}

die() {
  printf '\n[pinflow-restore] ERROR: %s\n' "$*" >&2
  exit 1
}

if [ "$(id -u)" -ne 0 ]; then
  die "run this script with sudo or as root"
fi

if [ -f "${DEPLOY_CONFIG:-/etc/pinflow/deploy.env}" ]; then
  set -a
  # shellcheck disable=SC1090
  . "${DEPLOY_CONFIG:-/etc/pinflow/deploy.env}"
  set +a
fi

MONGO_URI="${MONGO_URI:-mongodb://127.0.0.1:27017/}"
MONGO_DB_NAME="${MONGO_DB_NAME:-bugmarking}"
UPLOAD_DIR="${UPLOAD_DIR:-/var/lib/pinflow/uploads}"
APP_USER="${APP_USER:-pinflow}"
APP_GROUP="${APP_GROUP:-$APP_USER}"
SERVICE_NAME="${SERVICE_NAME:-pinflow}"

mongo_archive="${1:-}"
uploads_archive="${2:-}"

if [ -z "$mongo_archive" ] || [ ! -f "$mongo_archive" ]; then
  die "usage: sudo bash restore-mongodb.sh /path/mongo.archive.gz [/path/uploads.tar.gz]"
fi

command -v mongorestore >/dev/null || die "mongorestore is not installed"

printf 'This will drop and restore MongoDB database "%s". Type Confirm to continue: ' "$MONGO_DB_NAME"
read -r answer
if [ "$answer" != "Confirm" ]; then
  die "restore cancelled"
fi

systemctl stop "$SERVICE_NAME" || true

log "Restoring MongoDB database $MONGO_DB_NAME"
mongorestore --uri "$MONGO_URI" --db "$MONGO_DB_NAME" --drop --archive="$mongo_archive" --gzip

if [ -n "$uploads_archive" ]; then
  if [ ! -f "$uploads_archive" ]; then
    die "uploads archive not found: $uploads_archive"
  fi
  log "Restoring uploads into $(dirname "$UPLOAD_DIR")"
  mkdir -p "$(dirname "$UPLOAD_DIR")"
  tar -C "$(dirname "$UPLOAD_DIR")" -xzf "$uploads_archive"
  chown -R "$APP_USER:$APP_GROUP" "$(dirname "$UPLOAD_DIR")"
fi

systemctl start "$SERVICE_NAME"
systemctl --no-pager --full status "$SERVICE_NAME" || true
log "Restore complete"
