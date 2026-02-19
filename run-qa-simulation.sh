#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT_DIR"

if ! command -v pnpm >/dev/null 2>&1; then
  echo "[qa-sim] Greška: pnpm nije instaliran."
  exit 1
fi

if ! command -v node >/dev/null 2>&1; then
  echo "[qa-sim] Greška: node nije instaliran."
  exit 1
fi

if [[ -z "${E2E_BASE_URL:-}" ]]; then
  export E2E_BASE_URL="http://localhost:8080"
fi

if [[ -z "${E2E_XUI_USERNAME:-}" ]]; then
  read -r -p "Unesi XUI username: " E2E_XUI_USERNAME
  export E2E_XUI_USERNAME
fi

if [[ -z "${E2E_XUI_PASSWORD:-}" ]]; then
  read -r -s -p "Unesi XUI password: " E2E_XUI_PASSWORD
  echo
  export E2E_XUI_PASSWORD
fi

echo "[qa-sim] Root: $ROOT_DIR"
echo "[qa-sim] Base URL: $E2E_BASE_URL"
echo "[qa-sim] Install/validate dependencies..."
pnpm install --prefer-offline

echo "[qa-sim] Install/validate Playwright Chromium..."
pnpm exec playwright install chromium

echo "[qa-sim] Running QA user simulation..."
pnpm e2e:qa:simulate

echo
echo "[qa-sim] Gotovo."
echo "[qa-sim] Report: $ROOT_DIR/output/playwright/qa-user-sim/QA-REPORT.md"
