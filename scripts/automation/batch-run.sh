#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 1 ]]; then
  echo "Usage: $0 <TASK_ID> [TASK_ID ...]"
  echo "Example: PARALLEL=3 $0 LP-0202 LP-0203 LP-0204"
  exit 1
fi

ROOT_DIR="$(git rev-parse --show-toplevel)"
PARALLEL="${PARALLEL:-3}"
LOG_BASE="${LOG_BASE:-$ROOT_DIR/.codex/logs}"
mkdir -p "$LOG_BASE"

running_pids=()
running_tasks=()
all_tasks=("$@")
failed_tasks=()

branch_for_task() {
  local task="$1"
  local lower
  lower="$(echo "$task" | tr '[:upper:]' '[:lower:]')"
  echo "codex/${lower}-auto"
}

active_count() {
  local count=0
  local pid
  for pid in "${running_pids[@]:-}"; do
    if kill -0 "$pid" 2>/dev/null; then
      count=$((count + 1))
    fi
  done
  echo "$count"
}

launch_task() {
  local task="$1"
  local log_file="$LOG_BASE/${task}.runner.log"

  echo "[batch] Starting $task (log: $log_file)"
  (
    "$ROOT_DIR/scripts/automation/run-task.sh" "$task"
  ) >"$log_file" 2>&1 &

  running_pids+=("$!")
  running_tasks+=("$task")
}

for task in "${all_tasks[@]}"; do
  while true; do
    current="$(active_count)"
    if (( current < PARALLEL )); then
      break
    fi
    sleep 2
  done
  launch_task "$task"
done

for idx in "${!running_pids[@]}"; do
  pid="${running_pids[$idx]}"
  task="${running_tasks[$idx]}"
  if wait "$pid"; then
    echo "[batch] $task finished"
  else
    echo "[batch] $task failed (see $LOG_BASE/${task}.runner.log)"
    failed_tasks+=("$task")
  fi
done

branches=()
for task in "${all_tasks[@]}"; do
  branches+=("$(branch_for_task "$task")")
done

echo ""
echo "[batch] Checking cross-branch overlap"
set +e
"$ROOT_DIR/scripts/automation/check-overlap.sh" "${branches[@]}"
OVERLAP_EXIT=$?
set -e

echo ""
echo "[batch] Summary"
for task in "${all_tasks[@]}"; do
  branch="$(branch_for_task "$task")"
  pr_line="$(gh pr list --head "$branch" --json number,url,state -L 1 | jq -r 'if length == 0 then "no-pr" else "#\(.[0].number) \(.[0].state) \(.[0].url)" end')"
  echo "- $task | $branch | $pr_line"
done

if (( ${#failed_tasks[@]} > 0 )); then
  echo ""
  echo "[batch] Failed tasks: ${failed_tasks[*]}"
  exit 20
fi

if [[ $OVERLAP_EXIT -eq 10 ]]; then
  echo ""
  echo "[batch] Overlap detected and FAIL_ON_OVERLAP=1"
  exit 21
fi

echo ""
echo "[batch] Done"
