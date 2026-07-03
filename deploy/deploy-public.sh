#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEPLOY_DIR="${ROOT_DIR}/deploy"

if [[ ! -f "${ROOT_DIR}/.env.production" ]]; then
  echo "Missing ${ROOT_DIR}/.env.production"
  echo "Create it from .env.production.example before deployment."
  exit 1
fi

if [[ ! -f "${DEPLOY_DIR}/.env" ]]; then
  echo "Missing ${DEPLOY_DIR}/.env"
  echo "Create it from deploy/.env.example before deployment."
  exit 1
fi

cd "${DEPLOY_DIR}"

docker compose -f docker-compose.public.yml down --remove-orphans
docker compose -f docker-compose.public.yml up -d --build
docker compose -f docker-compose.public.yml ps

echo
echo "Deployment finished."
echo "Check health:"
echo "  https://$(grep '^APP_DOMAIN=' .env | cut -d= -f2)/health"
