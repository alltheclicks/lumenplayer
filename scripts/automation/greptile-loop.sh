#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 3 ]]; then
  echo "Usage: $0 <PR_NUMBER> <WORKTREE_DIR> <TASK_ID>"
  exit 1
fi

PR_NUMBER="$1"
WORKTREE_DIR="$2"
TASK_ID="$3"

MAX_ROUNDS="${MAX_ROUNDS:-3}"
POLL_SECONDS="${POLL_SECONDS:-20}"
WAIT_TIMEOUT_SECONDS="${WAIT_TIMEOUT_SECONDS:-1200}"
GREPTILE_BOT="${GREPTILE_BOT:-greptile-apps}"

get_head_sha() {
  gh pr view "$PR_NUMBER" --json headRefOid --jq '.headRefOid'
}

wait_for_greptile_review() {
  local head_sha="$1"
  local started_at
  started_at="$(date +%s)"

  while true; do
    local now elapsed reviews_json review
    now="$(date +%s)"
    elapsed=$((now - started_at))

    reviews_json="$(gh pr view "$PR_NUMBER" --json reviews)"
    review="$(echo "$reviews_json" | jq -c --arg sha "$head_sha" --arg bot "$GREPTILE_BOT" '[.reviews[] | select((.author.login == $bot or .author.login == ($bot + "[bot]")) and .commit.oid == $sha)] | last')"

    if [[ "$review" != "null" ]]; then
      echo "$review"
      return 0
    fi

    if (( elapsed > WAIT_TIMEOUT_SECONDS )); then
      return 1
    fi

    sleep "$POLL_SECONDS"
  done
}

for round in $(seq 1 "$MAX_ROUNDS"); do
  HEAD_SHA="$(get_head_sha)"
  echo "[${TASK_ID}] Greptile round $round/$MAX_ROUNDS on SHA $HEAD_SHA"

  gh pr comment "$PR_NUMBER" --body "@greptileai please review latest commit $HEAD_SHA for task $TASK_ID." >/dev/null

  if ! REVIEW_JSON="$(wait_for_greptile_review "$HEAD_SHA")"; then
    echo "[${TASK_ID}] Greptile did not respond in time for SHA $HEAD_SHA"
    exit 3
  fi

  REVIEW_BODY="$(echo "$REVIEW_JSON" | jq -r '.body // ""')"
  if echo "$REVIEW_BODY" | rg -qi "no comments"; then
    echo "[${TASK_ID}] Greptile returned no comments for SHA $HEAD_SHA"
    exit 0
  fi

  echo "[${TASK_ID}] Greptile found feedback; running Codex fix pass"

  FIX_PROMPT=$(cat <<PROMPT_EOF
Pogledaj PR #${PR_NUMBER} komentare i review od Greptile za trenutni HEAD commit ${HEAD_SHA}.
Popravi sve validne komentare.
Ako je false-positive, oznaci ga u PR komentaru kratkim obrazlozenjem.
Pokreni test gate.
Commit i push fix na isti branch.
Ne merge-uj.
PROMPT_EOF
)

  set +e
  codex exec --cd "$WORKTREE_DIR" --dangerously-bypass-approvals-and-sandbox "$FIX_PROMPT"
  CODEX_EXIT=$?
  set -e

  if [[ $CODEX_EXIT -ne 0 ]]; then
    echo "[${TASK_ID}] Codex fix pass failed with exit code $CODEX_EXIT"
    exit $CODEX_EXIT
  fi

  NEW_HEAD_SHA="$(get_head_sha)"
  if [[ "$NEW_HEAD_SHA" == "$HEAD_SHA" ]]; then
    echo "[${TASK_ID}] No new commit pushed after fix pass; stopping loop"
    exit 4
  fi

done

echo "[${TASK_ID}] Reached max Greptile rounds without no-comments result"
exit 5
