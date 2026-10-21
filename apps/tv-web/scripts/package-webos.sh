#!/usr/bin/env bash
set -euo pipefail
here="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
sdk_runner="$here/../../scripts/tv-env/run"

if [[ ! -d "$here/dist/webos" ]]; then
  echo "Missing dist/webos; run build:webos first." >&2
  exit 2
fi
mkdir -p "$here/artifacts/webos"
"$sdk_runner" ares-package "$here/dist/webos" --outdir "$here/artifacts/webos"
shopt -s nullglob
packages=("$here"/artifacts/webos/*.ipk)
if [[ ${#packages[@]} -ne 1 || ! -s "${packages[0]}" ]]; then
  echo "webOS packaging did not produce exactly one non-empty IPK." >&2
  exit 1
fi
printf 'webOS IPK package created: %s\n' "${packages[0]}"
