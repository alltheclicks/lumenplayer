# V3 QA Fix Backlog (Active)

Purpose: active QA backlog for new bug intake, triage, and QAF execution in V3 wave.

Previous wave archive:
- `docs/V2-QA-FIX-BACKLOG.md` (historical intake, completed tasks, old snapshots)

## Intake — Untriaged Issues

Use this section for immediate manual bug capture before triage.

ID format:
- `BUG-YYYYMMDD-XX` (example: `BUG-20260221-01`)

Template:

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

## Intake — Reopened Issues (reported multiple times, triaged)

Reporter note for this batch:
- Issues below are returned multiple times (`3-4x`) and previous implementation attempts by developer agents did not close the root cause.
- Treat these as regression-priority and require stricter acceptance + evidence before marking `done`.

### BUG-20260221-09
- Environment:
  - `http://localhost:8080/player`
  - Catch-up request seen in browser devtools:
    - `https://edge6.castcdn.net/streaming/timeshift.php?token=...`
    - response: `404 Not Found`
- Steps:
  1. Open live channel with known archive/catch-up support.
  2. Use catch-up seek (`TV unazad`).
  3. Observe playback request and player result.
- Expected:
  - Catch-up playback opens valid archived stream and starts playback.
- Actual:
  - Catch-up request resolves to `404`; player shows network failure and catch-up is not playable.
- Evidence:
  - User-provided request metadata and screenshot set (chat, 2026-02-21).
- Reporter:
  - Filip
- Timestamp:
  - 2026-02-21
- Severity (initial):
  - P1
- Status:
  - converted-to `QAF-030` (reopened, unresolved in prior attempts)

### BUG-20260221-10
- Environment:
  - `http://localhost:8080/player`, live overlay controls
- Steps:
  1. Open player overlay on live channel.
  2. Observe status text near blue catch-up bar and audio controls area.
- Expected:
  - No static coaching string `Klikni traku za TV unazad`.
  - Volume slider appears only when audio overlay is explicitly opened from volume/mute icon.
- Actual:
  - Static helper text is visible in main control row.
  - Volume slider is always visible.
- Evidence:
  - User screenshots (chat, 2026-02-21).
- Reporter:
  - Filip
- Timestamp:
  - 2026-02-21
- Severity (initial):
  - P2
- Status:
  - converted-to `QAF-027` (reopened, unresolved in prior attempts) + `QAF-032`

### BUG-20260221-11
- Environment:
  - `http://localhost:8080/player`, live/catch-up blue bar
- Steps:
  1. Open live overlay and inspect blue progress/catch-up bar.
  2. Hover/focus the bar and attempt precise seek interaction.
- Expected:
  - Blue bar has always-visible end/thumb indicator for precise targeting.
  - Thumb enlarges on hover/focus (YouTube-like affordance).
- Actual:
  - No stable visible thumb; difficult seek targeting.
- Evidence:
  - User screenshot with marked blue bar endpoint (chat, 2026-02-21).
- Reporter:
  - Filip
- Timestamp:
  - 2026-02-21
- Severity (initial):
  - P2
- Status:
  - converted-to `QAF-029` (reopened, unresolved in prior attempts)

### BUG-20260221-12
- Environment:
  - `http://localhost:8080/series`, `http://localhost:8080/series/:id`
- Steps:
  1. Open series catalog and series detail.
  2. Compare artwork with provider data/expected visuals (parity with films page behavior).
- Expected:
  - Series cards/detail should render provider poster/backdrop artwork when available.
- Actual:
  - Series UI frequently shows fallback color cards/empty poster areas.
  - Movies page loads richer artwork for the same provider context.
- Evidence:
  - User screenshots of series grid/detail without artwork (chat, 2026-02-21).
- Reporter:
  - Filip
- Timestamp:
  - 2026-02-21
- Severity (initial):
  - P2
- Status:
  - converted-to `QAF-028` (reopened, unresolved in prior attempts)

### BUG-20260221-13
- Environment:
  - Player when starting VOD movie or series episode
- Steps:
  1. Open movie/episode and start playback.
  2. Observe loader duration and available on-screen controls.
- Expected:
  - Loading indicator should be short/non-blocking.
  - On-demand playback should have overlay control parity with live player controls.
- Actual:
  - Spinner remains visible too long.
  - Overlay control set is incomplete vs live mode.
- Evidence:
  - User screenshots (chat, 2026-02-21).
- Reporter:
  - Filip
- Timestamp:
  - 2026-02-21
- Severity (initial):
  - P1
- Status:
  - converted-to `QAF-033`

## Intake triage snapshots

Add dated triage tables here (one snapshot block per triage session).

### Intake triage snapshot (2026-02-21, reopen batch)

| Intake ID | Lane | Severity | Converted to | Notes |
|---|---|---|---|---|
| BUG-20260221-09 | Bugfix/Catch-up Playback | P1 | QAF-030 | Reopened (`3-4x` repeated); prior attempts did not remove `timeshift.php` 404 path |
| BUG-20260221-10 | Bugfix/Player UX | P2 | QAF-027 + QAF-032 | Reopened; volume behavior still incorrect, static helper text should be removed |
| BUG-20260221-11 | Feature/UX | P2 | QAF-029 | Reopened; seek bar handle affordance still missing |
| BUG-20260221-12 | Bugfix/Data Mapping | P2 | QAF-028 | Reopened; series artwork parity still not achieved |
| BUG-20260221-13 | Bugfix/Player VOD UX | P1 | QAF-033 | New QAF for on-demand player overlay parity + spinner behavior |

## Status legend

| Status | Meaning |
|---|---|
| `open` | Ready to start |
| `in-progress` | Active implementation |
| `pending-review` | Code complete, waiting validation |
| `done` | Merged + retested |
| `blocked` | Cannot progress due to external dependency |

## Severity legend

| Severity | Meaning |
|---|---|
| `P0` | Core flow broken / release blocker |
| `P1` | Major regression |
| `P2` | Medium impact, workaround exists |
| `P3` | Minor/cosmetic |

## Active tasks (V3 execution list)

Current snapshot:
- `QAF-001..QAF-023` are completed (see `docs/V2-QA-FIX-BACKLOG.md`).
- `QAF-024..QAF-033` are active in V3.

| ID | Title | Area | Severity | Status |
|---|---|---|---|---|
| QAF-024 | Normalize player scrollbar styling and fix TV-unazad overflow scrollbar artifacts | Player Layout/Scroll UX | P1 | open |
| QAF-025 | Enforce live-edge restore on new-tab/session resume (avoid stale-segment black/static start) | Player Playback/Session Restore | P1 | open |
| QAF-026 | Define and implement pause-resume stale policy for live playback (`resume` vs `snap-to-live`) | Player Playback Policy | P2 | open |
| QAF-027 | Add volume slider control in player overlay (desktop/mobile/PWA), visible only on explicit audio-overlay trigger | Player UX/Audio Controls | P2 | open (reopened) |
| QAF-028 | Fix Xtream series artwork mapping/loading (poster/banner parity with provider) | Series Data/UI | P2 | open (reopened) |
| QAF-029 | Improve catch-up blue bar seek affordance with always-visible thumb + hover/focus scale-up + remote focus visibility | Catch-up UX/Controls | P2 | open (reopened) |
| QAF-030 | Fix catch-up seek playback failures (`Greska u mrezi`) using provider-accepted timeshift URL/data path | Catch-up Playback/Networking | P1 | open (reopened) |
| QAF-031 | Show catch-up capability badge (clock icon) in channel list for archive-enabled channels | Channel List UX | P3 | open |
| QAF-032 | Remove static helper copy `Klikni traku za TV unazad` and keep only context-aware cues | Player Copy/UX Clarity | P3 | open |
| QAF-033 | Align VOD/Series playback overlay controls with live player and make loading spinner non-blocking/short-lived | On-demand Player UX | P1 | open |

## Next ready queue (strict order)

`QAF-024 -> QAF-025 -> QAF-026 -> QAF-027 -> QAF-028 -> QAF-029 -> QAF-030 -> QAF-031 -> QAF-032 -> QAF-033`

## Reopened task clarifications (must-have acceptance deltas)

### QAF-027 delta
- Volume slider must be hidden by default.
- Slider opens only from volume/mute control interaction (hover/tap/click/focus depending on device).
- No persistent always-on slider in baseline overlay row.

### QAF-028 delta
- Validate field mapping for Xtream series artwork end-to-end:
  - list card poster, detail poster, detail backdrop.
- Add diagnostics note in implementation PR showing exact source fields used from provider payload.

### QAF-029 delta
- Blue bar must have visible thumb even without hover.
- Thumb grows on hover/focus for precise mouse/remote targeting.
- Keyboard/remote focus state must be visually obvious.

### QAF-030 delta
- Catch-up URL builder must avoid provider-rejected forms and produce provider-accepted playable path.
- Add probe evidence in PR description:
  - request URL form
  - response status/content type
  - proof of playable playlist response for at least one known archive-enabled stream.
- Do not close task on UI-only fallback; root playback path must work.

### QAF-032 acceptance
- Remove `Klikni traku za TV unazad` from primary playback control row.
- Keep only contextual hints where needed (no persistent instruction noise).

### QAF-033 acceptance
- VOD/series player must expose equivalent essential overlay controls as live mode (play/pause, seek timeline, audio access, fullscreen/PiP where applicable).
- Loading spinner must not block control interaction longer than startup window.
- If source is not ready, controls remain discoverable and user can recover (retry/back/live route).
