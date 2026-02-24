# WORKFLOW LLM + QA (Operational Guide)

> Version: 1.2  
> Date: 2026-02-23  
> Scope: Lumen Player ongoing delivery with parallel LLM agents.

Current QA backlog: `docs/V3-QA-FIX-BACKLOG.md`

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

### 2.1 Fresh-start check (mandatory for any new agent session)

Before selecting "next tasks", always do this in order:

1. Sync and verify branch state:
   - `git fetch origin --prune`
   - confirm `main` vs `origin/main` has `0/0` ahead/behind
2. Read current planning state from:
   - `BACKLOG.md` (what is planned/open and dependencies)
   - active QA backlog doc (latest intake + QAF conversion + active status)
3. Read execution reality from:
   - latest session block in `HANDOFF.md` (what was actually merged and in which order)
4. Reconcile mismatch rule:
   - If docs conflict or look stale, trust latest merged PR state + `HANDOFF.md`, then do a docs-sync PR first.
5. Only after steps 1-4, pick next ready tasks.

Never choose next work from chat memory alone when source-of-truth files disagree or are incomplete.

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

- File: active QA backlog doc (`Current QA backlog` pointer at top of this file)
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

- File: active QA backlog doc (`Current QA backlog` pointer at top of this file)
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
- active QA backlog doc (status changes and new blockers)
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

## 13) XUI catch-up reality (2026-02-20 finding)

For this provider class, `tv_archive=1` alone is not enough to assume playable catch-up.

Observed behavior from direct API/stream probes:

- `get_short_epg` can return very short windows and missing `has_archive` (`null`).
- `get_simple_data_table` returns the reliable archive signal (`has_archive=1`) across historical rows.
- Path-style catch-up URL (`/timeshift/{user}/{pass}/{duration}/{start}/{stream}.m3u8`) can return:
  - `404`, or
  - `200` with empty body (`text/html`), or
  - token redirect without usable playlist.
- Streaming endpoint with explicit extension is the stable catch-up path:
  - `/streaming/timeshift.php?username=...&password=...&stream=...&start=YYYY-MM-DD:HH-MM&duration=...&extension=m3u8`
  - expected response: `200`, content type `application/x-mpegurl`, body starts with `#EXTM3U`.

Operational rule:
- Catch-up availability in UI must be based on EPG rows with `has_archive=1` (not on "past program" heuristic).
- If `get_short_epg` has no archived past rows, fallback to `get_simple_data_table` before rendering empty-state.
- Do not enable live-bar timeshift for a current program that is not archive-flagged.

## 14) Mandatory diagnostics checklist for TV Unazad bugs

When reproducing `Greška u mreži` for catch-up, run this sequence before coding:

1. Verify channel capabilities:
   - `get_live_streams` -> `tv_archive`, `tv_archive_duration`, `stream_id`.
2. Verify EPG data source quality:
   - `get_short_epg&stream_id=<id>&limit=<N>`
   - `get_simple_data_table&stream_id=<id>`
   - compare counts of past rows and rows with `has_archive=1`.
3. Probe generated catch-up URL with headers and body type:
   - `curl -L -D - <url>`
   - classify as:
     - valid playlist (`application/x-mpegurl`, `#EXTM3U`)
     - TS payload (`video/mp2t`)
     - empty/HTML error (`404` or `200` with `0` bytes)
   - for web/browser runtime specifically:
     - `200` + `video/mp2t` on token URL is not auto-success; treat as `non-playable candidate` unless proven renderable in player
4. If endpoint format mismatch is detected:
   - switch URL builder to provider-accepted format first,
   - then retest with the same stream/time tuple.
5. Document evidence in PR description:
   - sample API payload snippets,
   - tested URL patterns,
   - final accepted URL format and response type.

This checklist is required for any future `QAF` item touching catch-up playback.

## 15) QAF-034 TiviMate comparative protocol (2026-02-23)

Purpose:
- Keep `QAF-034` evidence-driven by comparing real native-player traffic vs web-player runtime behavior.

Confirmed from live capture (`Buildara`, Sony Android TV, TiviMate 5.2.0):
- Live flow:
  - `GET /live/{user}/{pass}/{stream}.ts` on login host
  - `302` to edge/archive host with `token=...`
  - final media fetch on redirected host
- Catch-up flow:
  - `GET /timeshift/{user}/{pass}/{duration}/{start}/{stream}.ts` on login host
  - `302` to tokenized URL (`/streaming/timeshift.php?token=...`) on edge host
  - repeated quick retries + `start` minute adjustments

Operational rules for `QAF-034`:
1. Treat `302` as expected success handshake (not failure) for both live and catch-up.
2. Preserve host affinity after redirect (login host -> final edge/archive host).
3. Keep catch-up fallback minute-based first (`start` rounding/offset attempts), then wider fallback.
4. For web runtime, enforce same-origin/proxy path when direct fetch is blocked by browser CORS/mixed-content policy.
5. Validate with both `http` and `https` provider combinations.

Mandatory evidence bundle before closing `QAF-034`:
1. Native reference tuple log:
   - one successful live request chain and one successful catch-up chain (`request -> 302 -> final media`).
2. Web runtime tuple log:
   - same stream/time tuple with final status, content-type, and final host.
3. Startup metric:
   - time from user seek/click to first playable media bytes (native vs web).
4. Failure classification:
   - provider error (`404/502`) vs browser/runtime transport issue.

Working capture commands (Buildara):
- `ssh filip@100.74.23.120 "tail -100 /home/filip/tv_capture/live_feed.log"`
- `ssh filip@100.74.23.120 "tshark -r /home/filip/tv_capture/tivimate_*.pcap -Y 'http.request' -T fields -e frame.time -e http.host -e http.request.uri"`
- `ssh filip@100.74.23.120 "tshark -r /home/filip/tv_capture/tivimate_*.pcap -Y 'http.response.code' -T fields -e frame.time -e http.response.code -e http.location"`

## 16) Catch-up token payload gate for web runtime (2026-02-23)

New finding from local reproduction on `RTS 1` same-day catch-up (`23:15 Dnevnik`):

- request chain can end in `200` token response with `content-type: video/mp2t` and large payload;
- browser player may still fail to render first frame/audio (appears like download behavior);
- therefore transport success must not be inferred from `HTTP 200` alone.

Operational rule for next QAF pass:

1. Catch-up startup success criteria on web:
   - final response is HLS-playable (playlist content type or parsed manifest path), and playback reaches first frame/audio.
2. If response is `200 video/mp2t` and playback does not start:
   - classify as `non_playable_ts_payload`;
   - continue retry/fallback attempt plan without long stall.
3. Observability minimum:
   - include `responseContentType` and `rejectionReason` in `catchup.retry`/`catchup.fallback` when applicable.
4. Closure guard:
   - do not mark catch-up task `done` without evidence bundle proving first-frame success on real browser flow for at least one known problematic tuple (`RTS 1`, same-day archive).
