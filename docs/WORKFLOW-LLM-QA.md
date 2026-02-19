# WORKFLOW LLM + QA (Operational Guide)

> Version: 1.0  
> Date: 2026-02-19  
> Scope: Lumen Player ongoing delivery with parallel LLM agents.

## 1) Current project state (from source-of-truth files)

- Vision baseline: `VISION.md`
  - V1 goal is complete IPTV web/PWA player with Xtream, VOD, Series, EPG, Cast/AirPlay, performance and parity.
- Execution backlog: `BACKLOG.md`
  - Core LP tracks are mostly `done`, including V1-UI Balkan Stream parity track (`LP-0361+`).
- Delivery log: `HANDOFF.md`
  - Ordered batches and PR traces are recorded, with Greptile behavior patterns documented.
- Active QA reality: `output/playwright/qa-user-sim/QA-REPORT.md`
  - Current local run is `passed-with-blockers` and has real blockers (CORS, autoplay, episode/live flow issues).

Interpretation:
- Backlog says major tracks are done.
- QA/manual evidence says there are still runtime regressions and integration gaps.
- Therefore work mode is now: **stabilization + regression-hardening**.

## 2) Source-of-truth hierarchy

Use this order when agents conflict:

1. `VISION.md` (product intent and quality bar)
2. `BACKLOG.md` (planned/ordered work)
3. `HANDOFF.md` (what was actually done and in which order)
4. QA artifacts (`output/playwright/qa-user-sim/QA-REPORT.md`, timelines, screenshots)
5. Chat context (lowest authority)

## 3) Parallel agent model (hour-based, not day-based)

- Multiple agents can implement in parallel only on independent tasks.
- Git flow is strict and sequential per task:
  - one branch per task
  - one PR per task
  - merge only when task gate is satisfied
- If dependencies are unclear, stop parallelization and continue in order.

## 4) Task lanes (never mix in one PR)

- `Feature/UX`: new behavior or product ideas.
- `Bugfix`: runtime defects, regressions, logic/navigation failures.
- `QA/Tooling`: tests, scripts, diagnostics, reporting.
- `Docs-sync`: backlog/handoff/workflow updates only.

Rule:
- One PR should belong to one lane and one primary task ID.

## 5) Intake protocol (where to add new ideas/issues immediately)

This is the critical part for "2AM mobile testing" input.

### 5.1 New idea (not yet bug-confirmed)

- File: `BACKLOG.md`
- Section to use: append under a dedicated heading:
  - `## Intake — Untriaged Ideas`
- ID format:
  - `IDEA-YYYYMMDD-XX`
  - Example: `IDEA-20260219-01`

Required fields:
- Title
- Context (why this matters)
- Proposed user value
- Notes/evidence (optional)
- Reporter
- Timestamp
- Initial status: `idea`

### 5.2 New bug/problem noticed manually

- File: `docs/V2-QA-FIX-BACKLOG.md`
- Section to use: append under:
  - `## Intake — Untriaged Issues`
- ID format:
  - `BUG-YYYYMMDD-XX`
  - Example: `BUG-20260219-03`

Required fields:
- Environment (device/browser/url/build)
- Steps to reproduce
- Expected
- Actual
- Evidence (screenshot/console/video path)
- Reporter
- Timestamp
- Initial severity guess (`P0-P3`)
- Initial status: `open`

### 5.3 QA-script discovered issue

- File: `docs/V2-QA-FIX-BACKLOG.md`
- Convert to `QAF-XXX` only after triage confirms it is a real actionable task.
- Keep link to report:
  - `output/playwright/qa-user-sim/QA-REPORT.md`

## 6) ID lifecycle and conversion rules

- Raw intake IDs (`IDEA-*`, `BUG-*`) are temporary capture IDs.
- During triage, convert:
  - product/feature ideas -> `LP-XXXX` (if roadmap-level)
  - qa/bugfix tasks -> `QAF-XXX` (if stabilization task)
  - keep cross-reference to original intake ID

Rule:
- Never delete intake rows; mark them as:
  - `converted-to: LP-XXXX` or `converted-to: QAF-XXX`

## 7) Mandatory triage cycle (for every new intake)

For each new intake item:

1. Classify lane (`Feature/UX`, `Bugfix`, `QA/Tooling`).
2. Assign severity (`P0-P3`).
3. Decide if blocker for current batch.
4. Split into smallest safe task unit.
5. Add acceptance criteria.
6. Schedule in execution order with dependencies.

## 8) Execution loop per task (strict)

For each task ID:

1. Sync latest `main`.
2. Create branch (`codex/<task-id>-<slug>`).
3. Implement minimal scope only.
4. Run local gates (at least `lint`, `typecheck`, relevant tests).
5. Open PR with exact task ID.
6. Run Greptile review, handle valid comments.
7. Wait for Greptile review start confirmation (seen/check-run).
8. Merge only when task gate is satisfied.
9. Update `HANDOFF.md`.

## 9) QA gate after each bugfix batch

After each bugfix batch (1-2 tasks max), run:

```bash
E2E_XUI_USERNAME='...' E2E_XUI_PASSWORD='...' ./run-qa-simulation.sh
```

Then update:
- `output/playwright/qa-user-sim/QA-REPORT.md` (generated)
- `docs/V2-QA-FIX-BACKLOG.md` (status changes and new blockers)
- `HANDOFF.md` (what changed + evidence)

## 10) Definition of done (task level)

Task is `done` only when all are true:

- Code merged.
- Acceptance criteria satisfied.
- Relevant tests/checks passed.
- QA impact verified (no untracked regression).
- `HANDOFF.md` updated with evidence paths.

## 11) Quick templates (copy/paste)

### 11.1 Idea intake template

```md
### IDEA-YYYYMMDD-XX
- Title:
- Context:
- User value:
- Evidence/notes:
- Reporter:
- Timestamp:
- Status: idea
```

### 11.2 Bug intake template

```md
### BUG-YYYYMMDD-XX
- Environment:
- Steps:
  1.
  2.
  3.
- Expected:
- Actual:
- Evidence:
- Reporter:
- Timestamp:
- Severity (initial):
- Status: open
```

## 12) Immediate operating focus

Until blockers are cleared, priority order is:

1. CORS/API reachability in local dev flow
2. Episode -> TV Uživo context reset correctness
3. Live autoplay correctness
4. QA diagnostics precision and false-positive reduction
5. Poster/image robustness

This priority is based on latest `QA-REPORT.md` blocker list and manual browser evidence.
