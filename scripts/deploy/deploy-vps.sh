#!/usr/bin/env bash
# Deploy Lumen web + proxy to the production VPS from the CURRENT git checkout.
#
# Builds from whatever commit is checked out, so revert = `git checkout <good-commit>`
# then re-run this script. Nothing is built on the server.
#
# Usage:
#   scripts/deploy/deploy-vps.sh            # deploy both web and proxy
#   scripts/deploy/deploy-vps.sh web        # deploy web only
#   scripts/deploy/deploy-vps.sh proxy      # deploy proxy only
set -euo pipefail

VPS="${LUMEN_VPS:-root@151.241.151.105}"
TARGET="${1:-all}"

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

COMMIT="$(git rev-parse --short HEAD)"
echo "==> Deploying from commit ${COMMIT} to ${VPS} (target: ${TARGET})"

if [[ "$TARGET" == "all" || "$TARGET" == "proxy" ]]; then
  echo "==> Building proxy"
  pnpm --filter @lumen/proxy build
  echo "==> Syncing proxy"
  rsync -az --exclude='*.test.js' apps/proxy/dist apps/proxy/package.json "${VPS}:/opt/lumen/proxy/"
  ssh "$VPS" 'cd /opt/lumen/proxy && npm install --omit=dev --no-audit --no-fund >/dev/null 2>&1; systemctl restart lumen-proxy && sleep 2 && systemctl is-active lumen-proxy'
fi

if [[ "$TARGET" == "all" || "$TARGET" == "web" ]]; then
  echo "==> Building web (env from apps/web/.env.production)"
  pnpm --filter @lumen/web build
  echo "==> Syncing web"
  rsync -az --delete apps/web/dist/ "${VPS}:/var/www/player/"
fi

echo "==> Smoke"
curl -sS -o /dev/null -w "index: %{http_code}\n" "http://151.241.151.105/"
curl -sS -w "health: %{http_code}\n" -o /dev/null "http://151.241.151.105/health"
echo "==> Done (commit ${COMMIT})"
