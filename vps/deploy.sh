#!/usr/bin/env bash
set -Eeuo pipefail

log() {
  printf '\n[pinflow] %s\n' "$*"
}

die() {
  printf '\n[pinflow] ERROR: %s\n' "$*" >&2
  exit 1
}

require_root() {
  if [ "$(id -u)" -ne 0 ]; then
    die "run this script with sudo or as root"
  fi
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
  if [ -z "${APP_URL:-}" ]; then
    if [ -n "$APP_DOMAIN" ] && [ "$APP_DOMAIN" != "example.com" ]; then
      APP_URL="https://$APP_DOMAIN"
    else
      APP_URL="http://localhost:$PORT"
    fi
  fi
  APP_URL="${APP_URL%/}"

  REPO_BRANCH="${REPO_BRANCH:-}"
  APP_USER="${APP_USER:-pinflow}"
  APP_GROUP="${APP_GROUP:-$APP_USER}"
  APP_ROOT="${APP_ROOT:-/opt/pinflow}"
  APP_DIR="${APP_DIR:-$APP_ROOT/app}"
  BIN_DIR="${BIN_DIR:-$APP_ROOT/bin}"
  APP_BIN="${APP_BIN:-$BIN_DIR/pinflow}"
  APP_ENV_FILE="${APP_ENV_FILE:-/etc/pinflow/pinflow.env}"
  SERVICE_NAME="${SERVICE_NAME:-pinflow}"
  UPLOAD_DIR="${UPLOAD_DIR:-/var/lib/pinflow/uploads}"

  MONGO_URI="${MONGO_URI:-mongodb://127.0.0.1:27017/}"
  MONGO_DB_NAME="${MONGO_DB_NAME:-bugmarking}"
  PAYPAL_MODE="${PAYPAL_MODE:-sandbox}"
  SMTP_PORT="${SMTP_PORT:-587}"
  SMTP_FROM="${SMTP_FROM:-no-reply@pinflow.local}"
  OWNER_NAME="${OWNER_NAME:-Platform Owner}"
  OWNER_EMAIL="${OWNER_EMAIL:-owner@pinflow.local}"
  OWNER_PASSWORD="${OWNER_PASSWORD:-ChangeMe123!}"
  GOOGLE_REDIRECT_URL="${GOOGLE_REDIRECT_URL:-$APP_URL/api/auth/google/callback}"
  ENABLE_NGINX="${ENABLE_NGINX:-true}"
}

resolve_git_defaults() {
  if [ -d "$APP_DIR/.git" ]; then
    git config --global --add safe.directory "$APP_DIR" >/dev/null 2>&1 || true
    if [ -z "${REPO_URL:-}" ] || [[ "${REPO_URL:-}" == *"YOUR_USER/YOUR_REPO"* ]]; then
      REPO_URL="$(git -C "$APP_DIR" config --get remote.origin.url || true)"
    fi
    current_branch="$(git -C "$APP_DIR" rev-parse --abbrev-ref HEAD 2>/dev/null || true)"
    if [ -z "${REPO_BRANCH:-}" ] && [ -n "$current_branch" ] && [ "$current_branch" != "HEAD" ]; then
      REPO_BRANCH="$current_branch"
    fi
  fi
  REPO_BRANCH="${REPO_BRANCH:-main}"
}

ensure_user_and_dirs() {
  if ! getent group "$APP_GROUP" >/dev/null; then
    groupadd --system "$APP_GROUP"
  fi
  if ! id -u "$APP_USER" >/dev/null 2>&1; then
    useradd --system --gid "$APP_GROUP" --home-dir "$APP_ROOT" --shell /usr/sbin/nologin "$APP_USER"
  fi
  mkdir -p "$APP_ROOT" "$APP_DIR" "$BIN_DIR" "$(dirname "$APP_ENV_FILE")" "$UPLOAD_DIR"
  chown -R "$APP_USER:$APP_GROUP" "$(dirname "$UPLOAD_DIR")"
  chmod 750 "$(dirname "$UPLOAD_DIR")" "$UPLOAD_DIR"
}

env_line() {
  key="$1"
  value="${2:-}"
  value="$(printf '%s' "$value" | sed "s/'/'\\\\''/g")"
  printf "%s='%s'\n" "$key" "$value"
}

ensure_jwt_secret() {
  if [ -n "${JWT_SECRET:-}" ]; then
    return
  fi
  if [ -f "$APP_ENV_FILE" ]; then
    existing="$(grep -E '^JWT_SECRET=' "$APP_ENV_FILE" | head -n 1 | cut -d= -f2- || true)"
    existing="${existing%\"}"
    existing="${existing#\"}"
    existing="${existing%\'}"
    existing="${existing#\'}"
    if [ -n "$existing" ]; then
      JWT_SECRET="$existing"
      return
    fi
  fi
  JWT_SECRET="$(openssl rand -hex 32)"
}

write_app_env() {
  ensure_jwt_secret
  umask 077
  {
    env_line APP_NAME "$APP_NAME"
    env_line APP_URL "$APP_URL"
    env_line PORT "$PORT"
    env_line MONGO_URI "$MONGO_URI"
    env_line MONGO_DB_NAME "$MONGO_DB_NAME"
    env_line JWT_SECRET "$JWT_SECRET"
    env_line UPLOAD_DIR "$UPLOAD_DIR"
    env_line OWNER_NAME "$OWNER_NAME"
    env_line OWNER_EMAIL "$OWNER_EMAIL"
    env_line OWNER_PASSWORD "$OWNER_PASSWORD"
    env_line SMTP_HOST "${SMTP_HOST:-}"
    env_line SMTP_PORT "$SMTP_PORT"
    env_line SMTP_USER "${SMTP_USER:-}"
    env_line SMTP_PASSWORD "${SMTP_PASSWORD:-}"
    env_line SMTP_FROM "$SMTP_FROM"
    env_line GOOGLE_CLIENT_ID "${GOOGLE_CLIENT_ID:-}"
    env_line GOOGLE_CLIENT_SECRET "${GOOGLE_CLIENT_SECRET:-}"
    env_line GOOGLE_REDIRECT_URL "$GOOGLE_REDIRECT_URL"
    env_line STRIPE_PUBLISHABLE_KEY "${STRIPE_PUBLISHABLE_KEY:-}"
    env_line STRIPE_SECRET_KEY "${STRIPE_SECRET_KEY:-}"
    env_line STRIPE_WEBHOOK_SECRET "${STRIPE_WEBHOOK_SECRET:-}"
    env_line PAYPAL_CLIENT_ID "${PAYPAL_CLIENT_ID:-}"
    env_line PAYPAL_CLIENT_SECRET "${PAYPAL_CLIENT_SECRET:-}"
    env_line PAYPAL_WEBHOOK_ID "${PAYPAL_WEBHOOK_ID:-}"
    env_line PAYPAL_MODE "$PAYPAL_MODE"
    env_line FCM_PROJECT_ID "${FCM_PROJECT_ID:-}"
    env_line FCM_SERVICE_ACCOUNT_FILE "${FCM_SERVICE_ACCOUNT_FILE:-}"
    env_line FCM_SERVICE_ACCOUNT_JSON "${FCM_SERVICE_ACCOUNT_JSON:-}"
  } > "$APP_ENV_FILE"
  chown root:"$APP_GROUP" "$APP_ENV_FILE"
  chmod 640 "$APP_ENV_FILE"
}

sync_repo() {
  if [ -d "$APP_DIR/.git" ]; then
    log "Pulling latest code from GitHub"
    git -C "$APP_DIR" fetch origin "$REPO_BRANCH"
    git -C "$APP_DIR" checkout "$REPO_BRANCH"
    git -C "$APP_DIR" pull --ff-only origin "$REPO_BRANCH"
    return
  fi

  if [ -z "${REPO_URL:-}" ] || [[ "$REPO_URL" == *"YOUR_USER/YOUR_REPO"* ]]; then
    die "set REPO_URL in $CONFIG_FILE before first deploy"
  fi
  log "Cloning $REPO_URL into $APP_DIR"
  rm -rf "$APP_DIR"
  git clone --branch "$REPO_BRANCH" "$REPO_URL" "$APP_DIR"
}

build_app() {
  export PATH="/usr/local/go/bin:$PATH"
  command -v go >/dev/null || die "Go is not installed. Run setup-debian.sh first."

  log "Building Go application"
  cd "$APP_DIR"
  go mod download
  mkdir -p "$BIN_DIR"
  CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -trimpath -ldflags="-s -w" -o "$APP_BIN" ./cmd/server
  chown root:root "$APP_BIN"
  chmod 755 "$APP_BIN"
}

write_systemd_service() {
  log "Writing systemd service"
  cat > "/etc/systemd/system/${SERVICE_NAME}.service" <<EOF
[Unit]
Description=${APP_NAME} web application
After=network-online.target mongod.service
Wants=network-online.target

[Service]
Type=simple
User=${APP_USER}
Group=${APP_GROUP}
WorkingDirectory=${APP_DIR}
EnvironmentFile=${APP_ENV_FILE}
ExecStart=${APP_BIN}
Restart=always
RestartSec=5
KillSignal=SIGTERM
TimeoutStopSec=30
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=full
ReadWritePaths=${UPLOAD_DIR}

[Install]
WantedBy=multi-user.target
EOF
  systemctl daemon-reload
  systemctl enable "$SERVICE_NAME"
}

write_nginx_site() {
  if [ "$ENABLE_NGINX" != "true" ]; then
    return
  fi
  if ! command -v nginx >/dev/null; then
    log "nginx is not installed; skipping nginx config"
    return
  fi

  server_name="_"
  if [ -n "$APP_DOMAIN" ] && [ "$APP_DOMAIN" != "example.com" ]; then
    server_name="$APP_DOMAIN"
  fi

  log "Writing nginx reverse proxy"
  cat > /etc/nginx/sites-available/pinflow.conf <<EOF
server {
    listen 80;
    listen [::]:80;
    server_name ${server_name};
    client_max_body_size 32m;

    location / {
        proxy_pass http://127.0.0.1:${PORT};
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_read_timeout 300s;
    }
}
EOF
  ln -sf /etc/nginx/sites-available/pinflow.conf /etc/nginx/sites-enabled/pinflow.conf
  rm -f /etc/nginx/sites-enabled/default
  nginx -t
  systemctl enable nginx
  systemctl reload nginx || systemctl restart nginx
}

restart_app() {
  log "Restarting $SERVICE_NAME"
  systemctl restart "$SERVICE_NAME"
  systemctl --no-pager --full status "$SERVICE_NAME" || true
}

main() {
  require_root
  load_config
  resolve_git_defaults
  ensure_user_and_dirs
  write_app_env
  sync_repo
  build_app
  write_systemd_service
  write_nginx_site
  restart_app
  log "Deploy complete: $APP_URL"
}

main "$@"
