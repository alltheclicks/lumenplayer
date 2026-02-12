#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 2 ]]; then
  echo "Usage: $0 <BRANCH_1> <BRANCH_2> [BRANCH_3 ...]"
  exit 1
fi

ROOT_DIR="$(git rev-parse --show-toplevel)"
BASE_REF="${BASE_REF:-origin/main}"
FAIL_ON_OVERLAP="${FAIL_ON_OVERLAP:-0}"
IGNORE_OVERLAP_REGEX="${IGNORE_OVERLAP_REGEX:-^(BACKLOG\\.md|HANDOFF\\.md)$}"

TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

branch_file() {
  local branch="$1"
  local safe
  safe="$(echo "$branch" | sed 's#[^A-Za-z0-9._-]#_#g')"
  echo "$TMP_DIR/$safe.files"
}

for branch in "$@"; do
  if ! git rev-parse --verify --quiet "$branch" >/dev/null; then
    echo "Branch not found: $branch"
    exit 2
  fi
  git diff --name-only "$BASE_REF...$branch" \
    | rg -v "$IGNORE_OVERLAP_REGEX" \
    | sort -u > "$(branch_file "$branch")"
done

has_overlap=0
for ((i=1; i<=$#; i++)); do
  bi="${!i}"
  for ((j=i+1; j<=$#; j++)); do
    bj="${!j}"
    overlap="$(comm -12 "$(branch_file "$bi")" "$(branch_file "$bj")")"
    if [[ -n "$overlap" ]]; then
      has_overlap=1
      echo ""
      echo "Overlap detected: $bi <-> $bj"
      echo "$overlap"
    fi
  done

done

if [[ $has_overlap -eq 0 ]]; then
  echo "No file overlap detected across branches."
  exit 0
fi

if [[ "$FAIL_ON_OVERLAP" == "1" ]]; then
  exit 10
fi
