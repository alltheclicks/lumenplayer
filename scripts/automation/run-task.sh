#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 1 ]]; then
  echo "Usage: $0 <TASK_ID> [BASE_BRANCH]"
  exit 1
fi

TASK_ID="$1"
BASE_BRANCH="${2:-main}"

ROOT_DIR="$(git rev-parse --show-toplevel)"
TASK_LOWER="$(echo "$TASK_ID" | tr '[:upper:]' '[:lower:]')"
BRANCH_NAME="codex/${TASK_LOWER}-auto"
WORKTREE_BASE="${WORKTREE_BASE:-$ROOT_DIR/.codex/worktrees}"
WORKTREE_DIR="$WORKTREE_BASE/$TASK_ID"
LOG_BASE="${LOG_BASE:-$ROOT_DIR/.codex/logs}"
CODEx_LOG="$LOG_BASE/${TASK_ID}.codex.log"

mkdir -p "$WORKTREE_BASE" "$LOG_BASE"

cleanup_worktree() {
  if [[ -d "$WORKTREE_DIR" ]]; then
    echo "[${TASK_ID}] Cleaning up worktree $WORKTREE_DIR"
    git worktree remove --force "$WORKTREE_DIR" 2>/dev/null || true
  fi
}
trap cleanup_worktree EXIT

echo "[${TASK_ID}] Preparing branch $BRANCH_NAME from origin/$BASE_BRANCH"
if ! git fetch origin "$BASE_BRANCH"; then
  echo "[${TASK_ID}] ERROR: git fetch origin $BASE_BRANCH failed (network issue?)"
  exit 1
fi

if [[ -d "$WORKTREE_DIR/.git" || -f "$WORKTREE_DIR/.git" ]]; then
  echo "[${TASK_ID}] Reusing existing worktree $WORKTREE_DIR"
else
  if git show-ref --verify --quiet "refs/heads/$BRANCH_NAME"; then
    git worktree add "$WORKTREE_DIR" "$BRANCH_NAME"
  else
    git worktree add -b "$BRANCH_NAME" "$WORKTREE_DIR" "origin/$BASE_BRANCH"
  fi
fi

PROMPT=$(cat <<PROMPT_EOF
Procitaj ${ROOT_DIR}/HANDOFF.md, ${ROOT_DIR}/VISION.md, ${ROOT_DIR}/SESSION-ARCHITECTURE.md i ${ROOT_DIR}/BACKLOG.md.
Potvrdi aktivni task ID: ${TASK_ID}.
Uradi iskljucivo taj task (bez rada van scope-a).
Nalazis se vec na branchu ${BRANCH_NAME}; ne kreiraj novu granu.
Uradi commit i push na isti branch, otvori PR ka main.
Pokreni test gate.
Ne merge-uj.
NE MENJAJ HANDOFF.md i BACKLOG.md u ovom task PR-u (docs sync ide centralno kroz merge queue).
PROMPT_EOF
)

echo "[${TASK_ID}] Starting codex exec"
set +e
codex exec --cd "$WORKTREE_DIR" --dangerously-bypass-approvals-and-sandbox "$PROMPT" | tee "$CODEx_LOG"
CODEX_EXIT=${PIPESTATUS[0]}
set -e

if [[ $CODEX_EXIT -ne 0 ]]; then
  echo "[${TASK_ID}] codex exec failed with exit code $CODEX_EXIT"
  exit $CODEX_EXIT
fi

echo "[${TASK_ID}] Checking for open PR on branch $BRANCH_NAME"
PR_JSON="$(gh pr list --head "$BRANCH_NAME" --state open --json number,url -L 1 2>&1)" || {
  echo "[${TASK_ID}] ERROR: gh pr list failed: $PR_JSON"
  exit 2
}
PR_NUMBER="$(echo "$PR_JSON" | jq -r '.[0].number // empty')"
PR_URL="$(echo "$PR_JSON" | jq -r '.[0].url // empty')"

if [[ -z "$PR_NUMBER" ]]; then
  echo "[${TASK_ID}] No open PR found for branch $BRANCH_NAME."
  echo "[${TASK_ID}] Codex may not have created it. Check log: $CODEx_LOG"
  exit 2
fi

echo "[${TASK_ID}] PR opened: $PR_URL"
"$ROOT_DIR/scripts/automation/greptile-loop.sh" "$PR_NUMBER" "$WORKTREE_DIR" "$TASK_ID"

echo "[${TASK_ID}] Completed"
