#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 1 ]]; then
  echo "Usage: $0 <TASK_ID> [TASK_ID ...]"
  exit 1
fi

ROOT_DIR="$(git rev-parse --show-toplevel)"
DOCS_WORKTREE_BASE="${DOCS_WORKTREE_BASE:-$ROOT_DIR/.codex/worktrees}"

merged_tasks=("$@")
ts="$(date +%Y%m%d-%H%M%S)"
branch_name="codex/docs-sync-$ts"
wt="$DOCS_WORKTREE_BASE/docs-sync-$ts"
mkdir -p "$DOCS_WORKTREE_BASE"

git fetch origin main
git worktree add -b "$branch_name" "$wt" origin/main >/dev/null

for task in "${merged_tasks[@]}"; do
  perl -i -pe "s/^(\|\s*${task}\s*\|[^|]*\|[^|]*\|)\s*[^|]+\s*(\|.*)
/\$1 done \$2
/" "$wt/BACKLOG.md"
done

# Add fallback section for tasks that do not exist in BACKLOG.md yet.
missing_tmp="$(mktemp)"
: > "$missing_tmp"
for task in "${merged_tasks[@]}"; do
  if ! rg -q "^\|\s*${task}\s*\|" "$wt/BACKLOG.md"; then
    lower="$(echo "$task" | tr '[:upper:]' '[:lower:]')"
    branch="codex/${lower}-auto"
    pr_num="$(gh pr list --head "$branch" --state merged --json number -L 1 | jq -r 'if length==0 then "" else .[0].number end')"
    if [[ -n "$pr_num" ]]; then
      echo "| ${task} | Completed via merge queue (PR #${pr_num}) | S | done |" >> "$missing_tmp"
    else
      echo "| ${task} | Completed via merge queue | S | done |" >> "$missing_tmp"
    fi
  fi
done

if [[ -s "$missing_tmp" ]]; then
  {
    echo ""
    echo "## Batch Completed Tasks (auto)"
    echo ""
    echo "| ID | Task | Size | Status |"
    echo "|----|------|------|--------|"
    cat "$missing_tmp"
  } >> "$wt/BACKLOG.md"
fi
rm -f "$missing_tmp"

tmp="$(mktemp)"
entry_date="$(date '+%Y-%m-%d')"
{
  echo "# Handoff — Lumen Player"
  echo ""
  echo "## Session ${entry_date} — Central docs sync (${merged_tasks[*]})"
  echo ""
  echo "- **Done:**"
  for task in "${merged_tasks[@]}"; do
    lower="$(echo "$task" | tr '[:upper:]' '[:lower:]')"
    branch="codex/${lower}-auto"
    pr_line="$(gh pr list --head "$branch" --state merged --json number,url,mergedAt -L 1 | jq -r 'if length==0 then "" else "#\(.[0].number) \(.[0].url)" end')"
    if [[ -n "$pr_line" ]]; then
      echo "  - ${task} merged (${pr_line})"
    else
      echo "  - ${task} marked done in central docs sync"
    fi
  done
  echo "- **Note:**"
  echo "  - Docs sync generated centrally to keep task PRs conflict-free"
  echo ""
  echo "---"
  echo ""
  tail -n +2 "$wt/HANDOFF.md"
} > "$tmp"
mv "$tmp" "$wt/HANDOFF.md"

if git -C "$wt" diff --quiet -- BACKLOG.md HANDOFF.md; then
  echo "[docs-sync] No docs changes"
  git worktree remove --force "$wt"
  exit 0
fi

git -C "$wt" add BACKLOG.md HANDOFF.md
git -C "$wt" commit -m "docs: central backlog/handoff sync (${merged_tasks[*]})" >/dev/null
git -C "$wt" push origin "HEAD:main" >/dev/null

git worktree remove --force "$wt"
echo "[docs-sync] Pushed docs sync to main"
