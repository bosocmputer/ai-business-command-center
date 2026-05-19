#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${APP_DIR:-/home/bosscatdog/deployments/ai-business-command-center}"

cd "$APP_DIR"

git pull --ff-only
docker compose \
  -f infra/docker-compose.yml \
  --env-file .env.server \
  up -d --build

docker compose \
  -f infra/docker-compose.yml \
  --env-file .env.server \
  ps

curl -fsS http://127.0.0.1:${AI_BCC_API_PORT:-4055}/health
printf "\nWeb: http://192.168.2.109:${AI_BCC_WEB_PORT:-3055}/command-center\n"
