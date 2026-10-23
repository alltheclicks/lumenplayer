#!/usr/bin/env bash
set -euo pipefail
here="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
sdk_runner="$here/../../scripts/tv-env/run"

if [[ -z "${KLARO_TIZEN_PROFILE:-}" ]]; then
  echo "Blocked: set KLARO_TIZEN_PROFILE to an owner-created Samsung TV certificate profile before packaging." >&2
  exit 2
fi
if [[ ! -d "$here/dist/tizen" ]]; then
  echo "Missing dist/tizen; run build:tizen first." >&2
  exit 2
fi

mkdir -p "$here/artifacts/tizen"
"$sdk_runner" tizen build-web -- "$here/dist/tizen"
"$sdk_runner" tizen package -t wgt -s "$KLARO_TIZEN_PROFILE" -o "$here/artifacts/tizen/klaro-tv.wgt" -- "$here/dist/tizen/.buildResult"
test -s "$here/artifacts/tizen/klaro-tv.wgt"
printf 'Samsung WGT package created: %s\n' "$here/artifacts/tizen/klaro-tv.wgt"
