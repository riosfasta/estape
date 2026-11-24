#!/usr/bin/env bash
set -e

echo "==> Pulling latest code..."
cd /opt/bugmega/app
git pull origin main

echo "==> Rebuilding Go binary..."
go mod download
CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -trimpath -ldflags="-s -w" -o /opt/bugmega/bin/bugmega ./cmd/server

echo "==> Restarting Go service..."
systemctl restart bugmega

echo "==> Rebuilding Astro builder..."
cd /opt/bugmega/app/fastpress_ast
npm run build

echo "==> Restarting Astro in PM2..."
pm2 restart all

echo "==> Done! Status:"
systemctl --no-pager status bugmega
