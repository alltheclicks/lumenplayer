#!/usr/bin/env bash
# Deploy a verified Lumen release candidate to the production VPS.
# Production dependencies are assembled locally from pnpm-lock.yaml; the VPS
# never resolves fresh package versions during deploy.
#
# Releases are staged in versioned directories and activated by replacing one
# symlink per component. The first proxy deploy preserves the existing real
# /opt/lumen/proxy directory as /opt/lumen/proxy-bootstrap, then keeps the
# systemd paths stable through the /opt/lumen/proxy symlink.
#
# Usage:
#   scripts/deploy/deploy-vps.sh            # deploy both web and proxy
#   scripts/deploy/deploy-vps.sh web        # deploy web only
#   scripts/deploy/deploy-vps.sh proxy      # deploy proxy only
set -euo pipefail

VPS="${LUMEN_VPS:-root@151.241.151.105}"
TARGET="${1:-all}"
PUBLIC_URL="${LUMEN_PUBLIC_URL:-https://player.exyu.tv}"
PROXY_HEALTH_URL="${LUMEN_PROXY_HEALTH_URL:-http://127.0.0.1:8788/health}"
RELEASE_GATE="${LUMEN_RELEASE_GATE:-final}"
RELEASES_TO_KEEP="${LUMEN_RELEASES_TO_KEEP:-5}"

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

case "$TARGET" in
  all|web|proxy) ;;
  *)
    echo "Unsupported target: $TARGET (expected all, web, or proxy)" >&2
    exit 2
    ;;
esac

case "$PUBLIC_URL" in
  http://*|https://*) PUBLIC_URL="${PUBLIC_URL%/}" ;;
  *)
    echo "LUMEN_PUBLIC_URL must be an http(s) URL." >&2
    exit 2
    ;;
esac
if [[ ! "$PUBLIC_URL" =~ ^https?://[^/]+$ ]]; then
  echo "LUMEN_PUBLIC_URL must be an origin without a path." >&2
  exit 2
fi

case "$PROXY_HEALTH_URL" in
  http://127.0.0.1:*|http://localhost:*) ;;
  *)
    echo "LUMEN_PROXY_HEALTH_URL must use loopback HTTP." >&2
    exit 2
    ;;
esac

if [[ ! "$RELEASES_TO_KEEP" =~ ^[0-9]+$ ]] || (( RELEASES_TO_KEEP < 2 )); then
  echo "LUMEN_RELEASES_TO_KEEP must be an integer of at least 2." >&2
  exit 2
fi

if [[ -n "$(git status --porcelain)" && "${LUMEN_ALLOW_DIRTY:-0}" != "1" ]]; then
  echo "Refusing production deploy from a dirty worktree." >&2
  echo "Commit/stash all intended changes, or set LUMEN_ALLOW_DIRTY=1 only for an explicit non-production rehearsal." >&2
  exit 2
fi

if [[ ! -f apps/web/.env.production ]]; then
  echo "Missing apps/web/.env.production." >&2
  exit 2
fi

COMMIT="$(git rev-parse --short HEAD)"
RELEASE_ID="$(date -u +%Y%m%dT%H%M%SZ)-${COMMIT}"
PROXY_ARTIFACT=""

cleanup_local_artifacts() {
  if [[ -n "$PROXY_ARTIFACT" && -d "$PROXY_ARTIFACT" ]]; then
    rm -rf -- "$PROXY_ARTIFACT"
  fi
}
trap cleanup_local_artifacts EXIT

echo "==> Deploying release ${RELEASE_ID} to ${VPS} (target: ${TARGET})"
echo "==> Public URL: ${PUBLIC_URL}; release gate: ${RELEASE_GATE}"

echo "==> Preflight"
pnpm install --frozen-lockfile
pnpm lint
pnpm typecheck
pnpm test:unit
pnpm security:audit:prod
case "$RELEASE_GATE" in
  final) pnpm release:qaf035:final ;;
  current) pnpm release:qaf035:validate ;;
  skip)
    if [[ "${LUMEN_ALLOW_UNVERIFIED_RELEASE:-0}" != "1" ]]; then
      echo "Refusing to skip release gates without LUMEN_ALLOW_UNVERIFIED_RELEASE=1." >&2
      exit 2
    fi
    ;;
  *)
    echo "Unsupported LUMEN_RELEASE_GATE: $RELEASE_GATE" >&2
    exit 2
    ;;
esac
pnpm build

if [[ "$TARGET" == "all" || "$TARGET" == "proxy" ]]; then
  PROXY_ARTIFACT="$(mktemp -d "${TMPDIR:-/tmp}/lumen-proxy-${RELEASE_ID}.XXXXXX")"
  echo "==> Assembling locked proxy artifact"
  pnpm --filter @lumen/proxy deploy --prod "$PROXY_ARTIFACT"
fi

if [[ "$TARGET" == "all" || "$TARGET" == "web" ]]; then
  echo "==> Building web (env from apps/web/.env.production)"
  pnpm --filter @lumen/web build
fi

echo "==> Reserving remote staging directories"
ssh "$VPS" bash -s -- "$TARGET" "$RELEASE_ID" <<'REMOTE_STAGE'
set -euo pipefail

target="$1"
release_id="$2"
proxy_root="/opt/lumen/proxy-releases"
web_root="/var/www/lumen-releases"

declare -a stages=()
declare -a releases=()

if [[ "$target" == "all" || "$target" == "proxy" ]]; then
  install -d -m 0755 "$proxy_root"
  stages+=("$proxy_root/${release_id}.staging")
  releases+=("$proxy_root/$release_id")
fi
if [[ "$target" == "all" || "$target" == "web" ]]; then
  install -d -m 0755 "$web_root"
  stages+=("$web_root/${release_id}.staging")
  releases+=("$web_root/$release_id")
fi

for path in "${stages[@]}" "${releases[@]}"; do
  if [[ -e "$path" || -L "$path" ]]; then
    echo "Refusing to overwrite existing release path: $path" >&2
    exit 1
  fi
done
for path in "${stages[@]}"; do
  install -d -m 0755 "$path"
done
REMOTE_STAGE

if [[ "$TARGET" == "all" || "$TARGET" == "proxy" ]]; then
  echo "==> Uploading staged proxy release"
  rsync -az --delete \
    --exclude='proxy.env' \
    --exclude='src/' \
    --exclude='.turbo/' \
    --exclude='tsconfig.json' \
    --exclude='*.test.js' \
    "$PROXY_ARTIFACT/" "${VPS}:/opt/lumen/proxy-releases/${RELEASE_ID}.staging/"
fi

if [[ "$TARGET" == "all" || "$TARGET" == "web" ]]; then
  echo "==> Uploading staged web release"
  rsync -az --delete \
    apps/web/dist/ "${VPS}:/var/www/lumen-releases/${RELEASE_ID}.staging/"
fi

echo "==> Validating and activating staged release"
ssh "$VPS" bash -s -- \
  "$TARGET" \
  "$RELEASE_ID" \
  "$PUBLIC_URL" \
  "$PROXY_HEALTH_URL" \
  "$RELEASES_TO_KEEP" <<'REMOTE_ACTIVATE'
set -euo pipefail

target="$1"
release_id="$2"
public_url="$3"
proxy_health_url="$4"
releases_to_keep="$5"

proxy_release_root="/opt/lumen/proxy-releases"
proxy_stage="$proxy_release_root/${release_id}.staging"
proxy_release="$proxy_release_root/$release_id"
proxy_current="/opt/lumen/proxy"
proxy_previous="/opt/lumen/proxy-previous"
proxy_bootstrap="/opt/lumen/proxy-bootstrap"

web_release_root="/var/www/lumen-releases"
web_stage="$web_release_root/${release_id}.staging"
web_release="$web_release_root/$release_id"
web_current="/var/www/lumen-current"
web_previous="/var/www/lumen-previous"
web_legacy="/var/www/player"
web_bootstrap="/var/www/lumen-current-bootstrap"

proxy_previous_target=""
web_previous_target=""
proxy_switched=0
web_switched=0
completed=0

exec 9>/run/lock/lumen-deploy.lock
if ! flock -n 9; then
  echo "Another Lumen deploy is already activating a release." >&2
  exit 1
fi

atomic_link() {
  local target_path="$1"
  local link_path="$2"
  local next_link="${link_path}.next-${release_id}"

  if [[ ! -d "$target_path" ]]; then
    echo "Refusing to link to a missing release target: $target_path" >&2
    return 1
  fi
  if [[ -e "$next_link" || -L "$next_link" ]]; then
    echo "Temporary activation path already exists: $next_link" >&2
    return 1
  fi
  ln -s "$target_path" "$next_link"
  mv -Tf "$next_link" "$link_path"
}

wait_for_proxy() {
  local attempt
  for attempt in $(seq 1 15); do
    if systemctl is-active --quiet lumen-proxy && \
      curl --fail --silent --show-error --max-time 3 -o /dev/null "$proxy_health_url"; then
      return 0
    fi
    sleep 1
  done
  return 1
}

rollback_all() {
  set +e
  echo "==> Activation failed; rolling back switched components" >&2

  if (( web_switched == 1 )) && [[ -n "$web_previous_target" ]]; then
    atomic_link "$web_previous_target" "$web_current"
    echo "Rolled web back to $web_previous_target" >&2
  fi

  if (( proxy_switched == 1 )) && [[ -n "$proxy_previous_target" ]]; then
    atomic_link "$proxy_previous_target" "$proxy_current"
    /usr/bin/timeout 30 systemctl restart lumen-proxy
    if wait_for_proxy; then
      echo "Rolled proxy back to $proxy_previous_target" >&2
    else
      echo "WARNING: proxy rollback target did not become healthy." >&2
      systemctl status --no-pager lumen-proxy >&2
    fi
  fi
}

on_exit() {
  local exit_code=$?
  trap - EXIT
  if (( exit_code != 0 && completed == 0 )); then
    rollback_all
  fi
  exit "$exit_code"
}
trap on_exit EXIT

bootstrap_proxy_layout() {
  if [[ -L "$proxy_current" ]]; then
    if [[ ! -d "$(readlink -f "$proxy_current")" ]]; then
      echo "Current proxy symlink is broken: $proxy_current" >&2
      return 1
    fi
  elif [[ -d "$proxy_current" ]]; then
    if [[ -e "$proxy_bootstrap" || -L "$proxy_bootstrap" ]]; then
      echo "Cannot preserve legacy proxy: bootstrap path already exists." >&2
      return 1
    fi
    if [[ ! -f "$proxy_current/proxy.env" ]]; then
      echo "Legacy proxy.env is missing; refusing migration." >&2
      return 1
    fi

    echo "==> Preserving legacy proxy as $proxy_bootstrap"
    mv "$proxy_current" "$proxy_bootstrap"
    atomic_link "$proxy_bootstrap" "$proxy_current"
  elif [[ -d "$proxy_bootstrap" ]]; then
    # Recovery for interruption between the one-time move and symlink creation.
    atomic_link "$proxy_bootstrap" "$proxy_current"
  else
    echo "No existing proxy or bootstrap rollback target was found." >&2
    return 1
  fi

  if [[ ! -f "$proxy_current/proxy.env" ]]; then
    echo "The active proxy runtime environment is missing." >&2
    return 1
  fi
}

bootstrap_web_layout() {
  if [[ -L "$web_current" ]]; then
    if [[ ! -d "$(readlink -f "$web_current")" ]]; then
      echo "Current web symlink is broken: $web_current" >&2
      return 1
    fi
  elif [[ -d "$web_current" ]]; then
    if [[ -e "$web_bootstrap" || -L "$web_bootstrap" ]]; then
      echo "Cannot preserve legacy web current path: bootstrap already exists." >&2
      return 1
    fi
    mv "$web_current" "$web_bootstrap"
    atomic_link "$web_bootstrap" "$web_current"
  elif [[ -d "$web_bootstrap" ]]; then
    atomic_link "$web_bootstrap" "$web_current"
  elif [[ -d "$web_legacy" ]]; then
    # /var/www/player remains untouched and is the first web rollback target.
    atomic_link "$web_legacy" "$web_current"
  else
    echo "No existing web rollback target was found." >&2
    return 1
  fi
}

validate_proxy_stage() {
  local env_source

  [[ -d "$proxy_stage" ]]
  [[ ! -e "$proxy_release" && ! -L "$proxy_release" ]]
  [[ -s "$proxy_stage/package.json" ]]
  [[ -s "$proxy_stage/dist/index.js" ]]
  [[ -s "$proxy_stage/dist/server.js" ]]
  [[ -d "$proxy_stage/node_modules" ]]

  if find "$proxy_stage/dist" -type f -name '*.test.js' -print -quit | grep -q .; then
    echo "Proxy artifact contains test output." >&2
    return 1
  fi
  if [[ -e "$proxy_stage/proxy.env" || -L "$proxy_stage/proxy.env" ]]; then
    echo "Staged proxy unexpectedly contains proxy.env; refusing overwrite." >&2
    return 1
  fi

  env_source="$(readlink -f "$proxy_current/proxy.env")"
  if [[ ! -f "$env_source" ]]; then
    echo "Could not resolve the preserved proxy.env." >&2
    return 1
  fi

  chmod -R u=rwX,go=rX "$proxy_stage"
  chown -R lumen:lumen "$proxy_stage"
  ln -s "$env_source" "$proxy_stage/proxy.env"
  chown -h lumen:lumen "$proxy_stage/proxy.env"

  runuser -u lumen -- /usr/bin/test -r "$proxy_stage/proxy.env"
  runuser -u lumen -- /usr/bin/node --check "$proxy_stage/dist/index.js"
  runuser -u lumen -- /usr/bin/env LUMEN_STAGE="$proxy_stage" /usr/bin/node --input-type=module -e '
    const moduleUrl = `file://${process.env.LUMEN_STAGE}/dist/server.js`;
    const { createProxyServer } = await import(moduleUrl);
    const app = createProxyServer({
      logger: false,
      env: {
        XTREAM_PROXY_ALLOWED_HOSTS: "gw.castcdn.net",
        LUMEN_CATCHUP_GATEWAY_ENABLED: "0",
        LUMEN_PROXY_REMUX_ENABLED: "0",
      },
    });
    try {
      await app.ready();
      const response = await app.inject({ method: "GET", url: "/health" });
      if (response.statusCode !== 200) {
        throw new Error(`staged health returned ${response.statusCode}`);
      }
    } finally {
      await app.close();
    }
  '
}

validate_web_stage() {
  [[ -d "$web_stage" ]]
  [[ ! -e "$web_release" && ! -L "$web_release" ]]
  [[ -s "$web_stage/index.html" ]]
  [[ -d "$web_stage/assets" ]]

  if find "$web_stage" -type l -print -quit | grep -q .; then
    echo "Web artifact contains an unexpected symlink." >&2
    return 1
  fi
  if ! find "$web_stage/assets" -type f -name '*.js' -size +0c -print -quit | grep -q .; then
    echo "Web artifact has no non-empty JavaScript bundle." >&2
    return 1
  fi
  if ! grep -q '/assets/' "$web_stage/index.html"; then
    echo "Web index does not reference the built asset bundle." >&2
    return 1
  fi

  printf '%s\n' "$release_id" > "$web_stage/lumen-release.txt"
  chmod -R u=rwX,go=rX "$web_stage"
  chown -R root:root "$web_stage"
}

cleanup_release_root() {
  local release_root="$1"
  local current_link="$2"
  local previous_link="$3"
  local current_target=""
  local previous_target=""
  local retained_unprotected=0
  local name path

  current_target="$(readlink -f "$current_link" 2>/dev/null || true)"
  previous_target="$(readlink -f "$previous_link" 2>/dev/null || true)"

  while IFS= read -r name; do
    [[ "$name" =~ ^[0-9]{8}T[0-9]{6}Z-[0-9a-f]{7,40}$ ]] || continue
    path="$release_root/$name"
    if [[ "$path" == "$current_target" || "$path" == "$previous_target" ]]; then
      continue
    fi

    retained_unprotected=$((retained_unprotected + 1))
    if (( retained_unprotected <= releases_to_keep )); then
      continue
    fi

    # Never prune a recent release; this also avoids racing a nearby manual job.
    if find "$path" -maxdepth 0 -mmin +1440 -print -quit | grep -q .; then
      echo "Pruning old release: $path"
      rm -rf --one-file-system -- "$path"
    fi
  done < <(find "$release_root" -mindepth 1 -maxdepth 1 -type d -printf '%f\n' | sort -r)

  while IFS= read -r name; do
    [[ "$name" =~ ^[0-9]{8}T[0-9]{6}Z-[0-9a-f]{7,40}\.staging$ ]] || continue
    path="$release_root/$name"
    echo "Pruning stale staging directory: $path"
    rm -rf --one-file-system -- "$path"
  done < <(find "$release_root" -mindepth 1 -maxdepth 1 -type d -mmin +10080 -printf '%f\n')
}

# Preserve the live legacy targets before touching either staged release. The
# proxy conversion is a one-time migration; it never deletes the old tree or
# its proxy.env and is recoverable if interrupted between move and link.
if [[ "$target" == "all" || "$target" == "proxy" ]]; then
  bootstrap_proxy_layout
fi
if [[ "$target" == "all" || "$target" == "web" ]]; then
  bootstrap_web_layout
fi

# Validate every selected component before switching either current symlink.
if [[ "$target" == "all" || "$target" == "proxy" ]]; then
  echo "==> Validating staged proxy"
  validate_proxy_stage
fi
if [[ "$target" == "all" || "$target" == "web" ]]; then
  echo "==> Validating staged web"
  validate_web_stage
fi

# Promotion is a same-filesystem rename. These immutable release directories
# remain available even when activation is rolled back for postmortem use.
if [[ "$target" == "all" || "$target" == "proxy" ]]; then
  mv "$proxy_stage" "$proxy_release"
fi
if [[ "$target" == "all" || "$target" == "web" ]]; then
  mv "$web_stage" "$web_release"
fi

if [[ "$target" == "all" || "$target" == "proxy" ]]; then
  proxy_previous_target="$(readlink -f "$proxy_current")"
  atomic_link "$proxy_previous_target" "$proxy_previous"
  atomic_link "$proxy_release" "$proxy_current"
  proxy_switched=1

  echo "==> Restarting proxy on release $release_id"
  /usr/bin/timeout 30 systemctl restart lumen-proxy
  if ! wait_for_proxy; then
    echo "New proxy release failed its local health check." >&2
    exit 1
  fi
fi

if [[ "$target" == "all" || "$target" == "web" ]]; then
  web_previous_target="$(readlink -f "$web_current")"
  atomic_link "$web_previous_target" "$web_previous"
  atomic_link "$web_release" "$web_current"
  web_switched=1
fi

echo "==> Final public smoke"
curl --fail --show-error --silent --location \
  --retry 2 --retry-delay 1 --retry-connrefused --max-time 15 \
  -o /dev/null "$public_url/"
curl --fail --show-error --silent --location \
  --retry 2 --retry-delay 1 --retry-connrefused --max-time 15 \
  -o /dev/null "$public_url/health"
if [[ "$target" == "all" || "$target" == "proxy" ]]; then
  observe_headers="$(curl --fail --show-error --silent --max-time 15 \
    --retry 2 --retry-delay 1 --retry-connrefused \
    --dump-header - --output /dev/null --request OPTIONS \
    --header "Origin: $public_url" \
    --header 'Access-Control-Request-Method: POST' \
    "$public_url/observe")"
  if ! printf '%s\n' "$observe_headers" | tr -d '\r' | \
    grep -Fqi "access-control-allow-origin: $public_url"; then
    echo "Public /observe CORS does not allow the exact player origin." >&2
    exit 1
  fi
  if ! printf '%s\n' "$observe_headers" | tr -d '\r' | \
    grep -Eqi '^access-control-allow-methods:.*POST'; then
    echo "Public /observe CORS does not allow POST." >&2
    exit 1
  fi
fi
if [[ "$target" == "all" || "$target" == "web" ]]; then
  served_release="$(curl --fail --show-error --silent --location \
    --retry 2 --retry-delay 1 --retry-connrefused --max-time 15 \
    "$public_url/lumen-release.txt?deploy=$release_id")"
  if [[ "$served_release" != "$release_id" ]]; then
    echo "Public web release marker does not match $release_id." >&2
    exit 1
  fi
fi

# Public smoke is the activation commit point. Cleanup is best-effort and can
# never roll a healthy new release back.
completed=1
if [[ "$target" == "all" || "$target" == "proxy" ]]; then
  cleanup_release_root "$proxy_release_root" "$proxy_current" "$proxy_previous" || \
    echo "WARNING: proxy release cleanup failed; releases were left in place." >&2
fi
if [[ "$target" == "all" || "$target" == "web" ]]; then
  cleanup_release_root "$web_release_root" "$web_current" "$web_previous" || \
    echo "WARNING: web release cleanup failed; releases were left in place." >&2
fi

echo "==> Activated release $release_id"
REMOTE_ACTIVATE

echo "==> Done (release ${RELEASE_ID})"
