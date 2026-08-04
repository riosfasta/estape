#!/usr/bin/env bash
set -Eeuo pipefail

log() {
  printf '\n[pinflow-setup] %s\n' "$*"
}

die() {
  printf '\n[pinflow-setup] ERROR: %s\n' "$*" >&2
  exit 1
}

require_root() {
  if [ "$(id -u)" -ne 0 ]; then
    die "run this script with sudo or as root"
  fi
}

script_dir() {
  cd "$(dirname "${BASH_SOURCE[0]}")" && pwd
}

repo_root() {
  cd "$(script_dir)/../.." && pwd
}

load_config() {
  CONFIG_FILE="${DEPLOY_CONFIG:-/etc/pinflow/deploy.env}"
  if [ -f "$CONFIG_FILE" ]; then
    set -a
    # shellcheck disable=SC1090
    . "$CONFIG_FILE"
    set +a
  fi

  APP_NAME="${APP_NAME:-PinFlow}"
  APP_DOMAIN="${APP_DOMAIN:-}"
  PORT="${PORT:-8080}"
  APP_USER="${APP_USER:-pinflow}"
  APP_GROUP="${APP_GROUP:-$APP_USER}"
  APP_ROOT="${APP_ROOT:-/opt/pinflow}"
  APP_DIR="${APP_DIR:-$APP_ROOT/app}"
  BIN_DIR="${BIN_DIR:-$APP_ROOT/bin}"
  APP_ENV_FILE="${APP_ENV_FILE:-/etc/pinflow/pinflow.env}"
  SERVICE_NAME="${SERVICE_NAME:-pinflow}"
  UPLOAD_DIR="${UPLOAD_DIR:-/var/lib/pinflow/uploads}"
  GO_VERSION="${GO_VERSION:-1.26.4}"
  INSTALL_MONGODB="${INSTALL_MONGODB:-true}"
  MONGO_VERSION="${MONGO_VERSION:-8.0}"
  MONGO_REPO_CODENAME="${MONGO_REPO_CODENAME:-bookworm}"
  MONGO_URI="${MONGO_URI:-mongodb://127.0.0.1:27017/}"
  MONGO_DB_NAME="${MONGO_DB_NAME:-bugmarking}"
  ENABLE_NGINX="${ENABLE_NGINX:-true}"
  ENABLE_CERTBOT="${ENABLE_CERTBOT:-false}"
  CERTBOT_EMAIL="${CERTBOT_EMAIL:-}"
  BACKUP_DIR="${BACKUP_DIR:-/var/backups/pinflow}"
  BACKUP_RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-14}"

  if [ -z "${APP_URL:-}" ]; then
    if [ -n "$APP_DOMAIN" ] && [ "$APP_DOMAIN" != "example.com" ]; then
      APP_URL="https://$APP_DOMAIN"
    else
      APP_URL="http://localhost:$PORT"
    fi
  fi
  APP_URL="${APP_URL%/}"
  GOOGLE_REDIRECT_URL="${GOOGLE_REDIRECT_URL:-$APP_URL/api/auth/google/callback}"
}

resolve_repo_defaults() {
  local root
  root="$(repo_root)"
  if [ -d "$root/.git" ] && [ "$APP_DIR" = "$root" ]; then
    git config --global --add safe.directory "$APP_DIR" >/dev/null 2>&1 || true
  fi
  if [ -d "$APP_DIR/.git" ]; then
    if [ -z "${REPO_URL:-}" ] || [[ "${REPO_URL:-}" == *"YOUR_USER/YOUR_REPO"* ]]; then
      REPO_URL="$(git -C "$APP_DIR" config --get remote.origin.url || true)"
    fi
    current_branch="$(git -C "$APP_DIR" rev-parse --abbrev-ref HEAD 2>/dev/null || true)"
    if [ -z "${REPO_BRANCH:-}" ] && [ -n "$current_branch" ] && [ "$current_branch" != "HEAD" ]; then
      REPO_BRANCH="$current_branch"
    fi
  elif [ -d "$root/.git" ] && [ "$APP_DIR" = "$APP_ROOT/app" ]; then
    APP_DIR="$root"
    REPO_URL="$(git -C "$APP_DIR" config --get remote.origin.url || true)"
    current_branch="$(git -C "$APP_DIR" rev-parse --abbrev-ref HEAD 2>/dev/null || true)"
    if [ -n "$current_branch" ] && [ "$current_branch" != "HEAD" ]; then
      REPO_BRANCH="${REPO_BRANCH:-$current_branch}"
    fi
  fi
  REPO_BRANCH="${REPO_BRANCH:-main}"
}

env_line() {
  key="$1"
  value="${2:-}"
  value="$(printf '%s' "$value" | sed "s/'/'\\\\''/g")"
  printf "%s='%s'\n" "$key" "$value"
}

persist_deploy_config() {
  mkdir -p "$(dirname "$CONFIG_FILE")"
  if [ -f "$CONFIG_FILE" ]; then
    chmod 600 "$CONFIG_FILE"
    return
  fi

  log "Creating $CONFIG_FILE"
  umask 077
  {
    env_line APP_NAME "$APP_NAME"
    env_line APP_DOMAIN "$APP_DOMAIN"
    env_line APP_URL "$APP_URL"
    env_line PORT "$PORT"
    env_line REPO_URL "${REPO_URL:-}"
    env_line REPO_BRANCH "$REPO_BRANCH"
    env_line APP_USER "$APP_USER"
    env_line APP_GROUP "$APP_GROUP"
    env_line APP_ROOT "$APP_ROOT"
    env_line APP_DIR "$APP_DIR"
    env_line BIN_DIR "$BIN_DIR"
    env_line APP_ENV_FILE "$APP_ENV_FILE"
    env_line SERVICE_NAME "$SERVICE_NAME"
    env_line UPLOAD_DIR "$UPLOAD_DIR"
    env_line GO_VERSION "$GO_VERSION"
    env_line GO_SHA256 "${GO_SHA256:-}"
    env_line INSTALL_MONGODB "$INSTALL_MONGODB"
    env_line MONGO_VERSION "$MONGO_VERSION"
    env_line MONGO_REPO_CODENAME "$MONGO_REPO_CODENAME"
    env_line MONGO_URI "$MONGO_URI"
    env_line MONGO_DB_NAME "$MONGO_DB_NAME"
    env_line ENABLE_NGINX "$ENABLE_NGINX"
    env_line ENABLE_CERTBOT "$ENABLE_CERTBOT"
    env_line CERTBOT_EMAIL "$CERTBOT_EMAIL"
    env_line JWT_SECRET "${JWT_SECRET:-}"
    env_line OWNER_NAME "${OWNER_NAME:-Platform Owner}"
    env_line OWNER_EMAIL "${OWNER_EMAIL:-owner@pinflow.local}"
    env_line OWNER_PASSWORD "${OWNER_PASSWORD:-ChangeMe123!}"
    env_line SMTP_HOST "${SMTP_HOST:-}"
    env_line SMTP_PORT "${SMTP_PORT:-587}"
    env_line SMTP_USER "${SMTP_USER:-}"
    env_line SMTP_PASSWORD "${SMTP_PASSWORD:-}"
    env_line SMTP_FROM "${SMTP_FROM:-no-reply@pinflow.local}"
    env_line GOOGLE_CLIENT_ID "${GOOGLE_CLIENT_ID:-}"
    env_line GOOGLE_CLIENT_SECRET "${GOOGLE_CLIENT_SECRET:-}"
    env_line GOOGLE_REDIRECT_URL "$GOOGLE_REDIRECT_URL"
    env_line STRIPE_PUBLISHABLE_KEY "${STRIPE_PUBLISHABLE_KEY:-}"
    env_line STRIPE_SECRET_KEY "${STRIPE_SECRET_KEY:-}"
    env_line STRIPE_WEBHOOK_SECRET "${STRIPE_WEBHOOK_SECRET:-}"
    env_line PAYPAL_CLIENT_ID "${PAYPAL_CLIENT_ID:-}"
    env_line PAYPAL_CLIENT_SECRET "${PAYPAL_CLIENT_SECRET:-}"
    env_line PAYPAL_WEBHOOK_ID "${PAYPAL_WEBHOOK_ID:-}"
    env_line PAYPAL_MODE "${PAYPAL_MODE:-sandbox}"
    env_line FCM_PROJECT_ID "${FCM_PROJECT_ID:-}"
    env_line FCM_SERVICE_ACCOUNT_FILE "${FCM_SERVICE_ACCOUNT_FILE:-}"
    env_line FCM_SERVICE_ACCOUNT_JSON "${FCM_SERVICE_ACCOUNT_JSON:-}"
    env_line BACKUP_DIR "$BACKUP_DIR"
    env_line BACKUP_RETENTION_DAYS "$BACKUP_RETENTION_DAYS"
  } > "$CONFIG_FILE"
  chmod 600 "$CONFIG_FILE"
}

install_base_packages() {
  log "Installing base packages"
  export DEBIAN_FRONTEND=noninteractive
  apt-get update
  apt-get install -y ca-certificates curl gnupg git tar gzip openssl build-essential
  if [ "$ENABLE_NGINX" = "true" ]; then
    apt-get install -y nginx
  fi
}

install_go() {
  export PATH="/usr/local/go/bin:$PATH"
  if command -v go >/dev/null 2>&1 && go version | grep -q "go${GO_VERSION} "; then
    log "Go ${GO_VERSION} is already installed"
    return
  fi

  log "Installing Go ${GO_VERSION}"
  tmp="/tmp/go${GO_VERSION}.linux-amd64.tar.gz"
  curl -fL --retry 3 -o "$tmp" "https://go.dev/dl/go${GO_VERSION}.linux-amd64.tar.gz"
  if [ -n "${GO_SHA256:-}" ]; then
    printf '%s  %s\n' "$GO_SHA256" "$tmp" | sha256sum -c -
  fi
  rm -rf /usr/local/go
  tar -C /usr/local -xzf "$tmp"
  ln -sf /usr/local/go/bin/go /usr/local/bin/go
  ln -sf /usr/local/go/bin/gofmt /usr/local/bin/gofmt
  go version
}

install_mongodb() {
  if [ "$INSTALL_MONGODB" != "true" ]; then
    log "Skipping MongoDB installation"
    return
  fi

  # shellcheck disable=SC1091
  . /etc/os-release
  if [ "${ID:-}" != "debian" ]; then
    die "this MongoDB installer is intended for Debian"
  fi
  if [ "${VERSION_CODENAME:-}" != "$MONGO_REPO_CODENAME" ]; then
    die "detected Debian ${VERSION_CODENAME:-unknown}, but MONGO_REPO_CODENAME is $MONGO_REPO_CODENAME"
  fi
  if [ "$MONGO_REPO_CODENAME" != "bookworm" ]; then
    die "MongoDB ${MONGO_VERSION} official repo in this script targets Debian 12 Bookworm. Set MONGO_REPO_CODENAME=bookworm on a Debian 12 VPS."
  fi

  log "Installing MongoDB ${MONGO_VERSION} for Debian ${MONGO_REPO_CODENAME}"
  rm -f "/usr/share/keyrings/mongodb-server-${MONGO_VERSION}.gpg"
  curl -fsSL "https://pgp.mongodb.com/server-${MONGO_VERSION}.asc" | gpg -o "/usr/share/keyrings/mongodb-server-${MONGO_VERSION}.gpg" --dearmor
  printf 'deb [ arch=amd64 signed-by=/usr/share/keyrings/mongodb-server-%s.gpg ] https://repo.mongodb.org/apt/debian %s/mongodb-org/%s main\n' "$MONGO_VERSION" "$MONGO_REPO_CODENAME" "$MONGO_VERSION" > "/etc/apt/sources.list.d/mongodb-org-${MONGO_VERSION}.list"
  apt-get update
  apt-get install -y mongodb-org

  if [ -f /etc/mongod.conf ] && grep -qE '^[[:space:]]*bindIp:' /etc/mongod.conf; then
    sed -i 's/^\([[:space:]]*bindIp:\).*/\1 127.0.0.1/' /etc/mongod.conf
  fi
  systemctl enable mongod
  systemctl restart mongod
}

run_deploy() {
  log "Running app deploy"
  DEPLOY_CONFIG="$CONFIG_FILE" bash "$(script_dir)/deploy.sh"
}

run_certbot() {
  if [ "$ENABLE_CERTBOT" != "true" ]; then
    return
  fi
  if [ -z "$APP_DOMAIN" ] || [ "$APP_DOMAIN" = "example.com" ]; then
    die "set APP_DOMAIN before enabling certbot"
  fi
  if [ -z "$CERTBOT_EMAIL" ] || [ "$CERTBOT_EMAIL" = "admin@example.com" ]; then
    die "set CERTBOT_EMAIL before enabling certbot"
  fi
  log "Installing TLS certificate with certbot"
  export DEBIAN_FRONTEND=noninteractive
  apt-get install -y certbot python3-certbot-nginx
  certbot --nginx -d "$APP_DOMAIN" --non-interactive --agree-tos -m "$CERTBOT_EMAIL" --redirect
}

main() {
  require_root
  load_config
  resolve_repo_defaults
  persist_deploy_config
  install_base_packages
  install_go
  install_mongodb
  run_deploy
  run_certbot
  log "Setup complete"
  log "App: $APP_URL"
  log "Config: $CONFIG_FILE"
  log "Update later with: sudo bash $APP_DIR/deploy/vps/deploy.sh"
}

main "$@"
