#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 1 ]]; then
  echo "Usage: $0 <TASK_ID> [TASK_ID ...]"
  echo "Example: $0 LP-0202 LP-0203 LP-0204"
  exit 1
fi

ROOT_DIR="$(git rev-parse --show-toplevel)"
REQUIRE_GREPTILE="${REQUIRE_GREPTILE:-1}"
REQUIRE_CHECKS="${REQUIRE_CHECKS:-1}"
REQUIRE_CHECKS_ALLOW_EMPTY="${REQUIRE_CHECKS_ALLOW_EMPTY:-0}"
MERGE_METHOD="${MERGE_METHOD:-merge}"
SYNC_DOCS="${SYNC_DOCS:-1}"
GREPTILE_BOT="${GREPTILE_BOT:-greptile-apps}"
DOCS_WORKTREE_BASE="${DOCS_WORKTREE_BASE:-$ROOT_DIR/.codex/worktrees}"
DRY_RUN="${DRY_RUN:-0}"

merged_tasks=()
merged_prs=()
merged_urls=()

branch_for_task() {
  local task="$1"
  local lower
  lower="$(echo "$task" | tr '[:upper:]' '[:lower:]')"
  echo "codex/${lower}-auto"
}

assert_pr_open_for_branch() {
  local branch="$1"
  gh pr list --head "$branch" --state open --json number,url,headRefName -L 1
}

assert_greptile_green() {
  local pr="$1"
  local head_sha reviews_json review_json review_body comments_json

  head_sha="$(gh pr view "$pr" --json headRefOid --jq '.headRefOid')"
  reviews_json="$(gh pr view "$pr" --json reviews)"
  review_json="$(echo "$reviews_json" | jq -c --arg sha "$head_sha" --arg bot "$GREPTILE_BOT" '[.reviews[] | select((.author.login == $bot or .author.login == ($bot + "[bot]")) and .commit.oid == $sha)] | last')"

  if [[ "$review_json" == "null" ]]; then
    echo "[merge-queue] PR #$pr: no Greptile review found for HEAD $head_sha"
    return 1
  fi

  review_body="$(echo "$review_json" | jq -r '.body // ""')"
  if echo "$review_body" | rg -qi "no comments|confidence score:\s*5/5"; then
    return 0
  fi

  comments_json="$(gh pr view "$pr" --json comments)"
  if echo "$comments_json" | jq -r --arg bot "$GREPTILE_BOT" '.comments[] | select(.author.login == $bot or .author.login == ($bot + "[bot]")) | .body' | rg -qi "confidence score:[[:space:]]*5/5"; then
    return 0
  fi

  echo "[merge-queue] PR #$pr: Greptile review for HEAD is not green/no-comments"
  return 1
}

assert_checks_green() {
  local pr="$1"
  local rollup

  rollup="$(gh pr view "$pr" --json statusCheckRollup --jq '.statusCheckRollup')"
  if [[ "$rollup" == "[]" ]]; then
    if [[ "$REQUIRE_CHECKS_ALLOW_EMPTY" == "1" ]]; then
      return 0
    fi
    echo "[merge-queue] PR #$pr: no check-runs found on this PR"
    return 1
  fi

  local failing pending
  failing="$(echo "$rollup" | jq '[.[] | select((.conclusion // "") != "" and (.conclusion | ascii_downcase) != "success" and (.conclusion | ascii_downcase) != "neutral" and (.conclusion | ascii_downcase) != "skipped")] | length')"
  pending="$(echo "$rollup" | jq '[.[] | select((.status // "") != "" and (.status | ascii_downcase) != "completed")] | length')"

  if [[ "$failing" != "0" || "$pending" != "0" ]]; then
    echo "[merge-queue] PR #$pr: checks not green (failing=$failing pending=$pending)"
    return 1
  fi

  return 0
}

merge_pr() {
  local pr="$1"
  local method_flag

  case "$MERGE_METHOD" in
    squash) method_flag="--squash" ;;
    rebase) method_flag="--rebase" ;;
    merge|*) method_flag="--merge" ;;
  esac

  if [[ "$DRY_RUN" == "1" ]]; then
    echo "[merge-queue] DRY_RUN: would merge PR #$pr ($MERGE_METHOD)"
    return 0
  fi
  gh pr merge "$pr" "$method_flag" --delete-branch >/dev/null
}

sync_docs_after_merge() {
  local ts wt branch_name
  ts="$(date +%Y%m%d-%H%M%S)"
  branch_name="codex/docs-sync-$ts"
  wt="$DOCS_WORKTREE_BASE/docs-sync-$ts"
  mkdir -p "$DOCS_WORKTREE_BASE"

  git fetch origin main
  git worktree add -b "$branch_name" "$wt" origin/main >/dev/null

  # Update BACKLOG statuses to done for merged tasks.
  for task in "${merged_tasks[@]}"; do
    perl -i -pe "s/^(\|\s*${task}\s*\|[^|]*\|[^|]*\|)\s*[^|]+\s*(\|.*)
/\$1 done \$2
/" "$wt/BACKLOG.md"
  done

  # Prepend HANDOFF summary block.
  local tmp entry_date
  tmp="$(mktemp)"
  entry_date="$(date '+%Y-%m-%d')"
  {
    echo "# Handoff — Lumen Player"
    echo ""
    echo "## Session ${entry_date} — Batch merge sync (${merged_tasks[*]})"
    echo ""
    echo "- **Done:**"
    for i in "${!merged_tasks[@]}"; do
      echo "  - ${merged_tasks[$i]} merged via PR #${merged_prs[$i]} (${merged_urls[$i]})"
    done
    echo "- **Note:**"
    echo "  - Docs sync generated centrally by merge queue to keep task PRs conflict-free"
    echo ""
    echo "---"
    echo ""
    # Append old handoff content without first title line.
    tail -n +2 "$wt/HANDOFF.md"
  } > "$tmp"
  mv "$tmp" "$wt/HANDOFF.md"

  if git -C "$wt" diff --quiet -- BACKLOG.md HANDOFF.md; then
    echo "[merge-queue] Docs already up to date; no docs commit created"
    git worktree remove --force "$wt"
    return 0
  fi

  git -C "$wt" add BACKLOG.md HANDOFF.md
  git -C "$wt" commit -m "docs: sync backlog/handoff after batch merge (${merged_tasks[*]})" >/dev/null
  git -C "$wt" push origin "HEAD:main" >/dev/null

  git worktree remove --force "$wt"
  echo "[merge-queue] Docs sync pushed to main"
}

for task in "$@"; do
  branch="$(branch_for_task "$task")"
  pr_json="$(assert_pr_open_for_branch "$branch")"
  pr_number="$(echo "$pr_json" | jq -r '.[0].number // empty')"
  pr_url="$(echo "$pr_json" | jq -r '.[0].url // empty')"

  if [[ -z "$pr_number" ]]; then
    echo "[merge-queue] No open PR for task $task ($branch)"
    exit 2
  fi

  echo "[merge-queue] Task $task -> PR #$pr_number"

  if [[ "$REQUIRE_GREPTILE" == "1" ]]; then
    assert_greptile_green "$pr_number"
  fi

  if [[ "$REQUIRE_CHECKS" == "1" ]]; then
    assert_checks_green "$pr_number"
  fi

  merge_pr "$pr_number"
  echo "[merge-queue] Merged PR #$pr_number"

  merged_tasks+=("$task")
  merged_prs+=("$pr_number")
  merged_urls+=("$pr_url")
done

if [[ "$SYNC_DOCS" == "1" ]]; then
  if [[ "$DRY_RUN" == "1" ]]; then
    echo "[merge-queue] DRY_RUN: would sync BACKLOG.md and HANDOFF.md on main"
    echo "[merge-queue] Completed (dry run)"
    exit 0
  fi
  sync_docs_after_merge
fi

echo "[merge-queue] Completed"
