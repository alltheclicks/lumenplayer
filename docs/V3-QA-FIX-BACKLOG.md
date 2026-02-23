# V3 QA Fix Backlog (Completed + Intake Open)

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
  - converted-to `QAF-030` (done via PR #205, 2026-02-21)

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
  - converted-to `QAF-027` + `QAF-032` (done via PR #201 and PR #209, 2026-02-21)

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
  - converted-to `QAF-029` (done via PR #204, 2026-02-21)

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
  - converted-to `QAF-028` (done via PR #203, 2026-02-21)

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
  - converted-to `QAF-033` (done via PR #210, 2026-02-21)

### BUG-20260221-14
- Environment:
  - `http://localhost:8080/player`, Xtream account `fica`, channels with archive (`stream_id=112`, `stream_id=105`)
  - Browser devtools + console evidence from user session (`2026-02-21 22:10-22:38`) and Codex Playwright reproduction (`2026-02-21 22:52-23:02`)
- Steps:
  1. Open live channel with TV Unazad support (example: `RTS 1`).
  2. Open `TV Unazad` list and start archived item (example: `18:28 Kvadratura kruga`).
  3. Observe playback and network calls to `timeshift.php`.
- Expected:
  - Catch-up playback starts and remains stable with video/audio.
- Actual:
  - Partial progress: more catch-up items render and player requests archive URLs.
  - Blocking issue remains: playback still fails in real user flow with `502/404` on provider timeshift path and/or playback startup failure burst.
  - User still reports non-playable catch-up video after latest fixes.
- Evidence:
  - User screenshots + console traces in chat (2026-02-21, `edge6.castcdn.net/streaming/timeshift.php?token=...` with `404/502`).
  - Observability events seen multiple times: `playback.catchup.requested`, `playback.catchup_fallback`, `PLAYBACK_START_FAILED`, `NETWORK_ERROR`, `LOAD_FAILED`.
- Reporter:
  - Filip
- Timestamp:
  - 2026-02-21
- Severity (initial):
  - P1
- Status:
  - converted-to `QAF-034` (pending-review, awaiting Reptile validation)

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
| BUG-20260221-14 | Bugfix/Catch-up Playback | P1 | QAF-034 | Reopened after multiple attempts; still not playable in user real flow |

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
- `QAF-024..QAF-033` are completed in V3 (merged on 2026-02-21).

| ID | Title | Area | Severity | Status |
|---|---|---|---|---|
| QAF-024 | Normalize player scrollbar styling and fix TV-unazad overflow scrollbar artifacts | Player Layout/Scroll UX | P1 | done |
| QAF-025 | Enforce live-edge restore on new-tab/session resume (avoid stale-segment black/static start) | Player Playback/Session Restore | P1 | done |
| QAF-026 | Define and implement pause-resume stale policy for live playback (`resume` vs `snap-to-live`) | Player Playback Policy | P2 | done |
| QAF-027 | Add volume slider control in player overlay (desktop/mobile/PWA), visible only on explicit audio-overlay trigger | Player UX/Audio Controls | P2 | done (reopened -> fixed) |
| QAF-028 | Fix Xtream series artwork mapping/loading (poster/banner parity with provider) | Series Data/UI | P2 | done (reopened -> fixed) |
| QAF-029 | Improve catch-up blue bar seek affordance with always-visible thumb + hover/focus scale-up + remote focus visibility | Catch-up UX/Controls | P2 | done (reopened -> fixed) |
| QAF-030 | Fix catch-up seek playback failures (`Greska u mrezi`) using provider-accepted timeshift URL/data path | Catch-up Playback/Networking | P1 | done (reopened -> fixed) |
| QAF-031 | Show catch-up capability badge (clock icon) in channel list for archive-enabled channels | Channel List UX | P3 | done |
| QAF-032 | Remove static helper copy `Klikni traku za TV unazad` and keep only context-aware cues | Player Copy/UX Clarity | P3 | done |
| QAF-033 | Align VOD/Series playback overlay controls with live player and make loading spinner non-blocking/short-lived | On-demand Player UX | P1 | done |
| QAF-034 | Reopened catch-up runtime failure: provider timeshift returns intermittent `404/502`, playback still fails in real user flow | Catch-up Playback/Provider Compatibility | P1 | pending-review |

## Next ready queue (strict order)

1. `QAF-034` Reptile QA verification on candidate fix branch (`codex/qaf-034-provider-timeshift-runtime-fix`)
2. If playback still fails, capture exact failing URL tuple (`stream/start/duration`) and provider response body/content-type
3. Apply minimal follow-up patch only from verified failing tuple evidence

## Execution completion snapshot (2026-02-21)

- Merged sequence:
  - `QAF-024 -> QAF-025 -> QAF-026 -> QAF-027 -> QAF-028 -> QAF-029 -> QAF-030 -> QAF-031 -> QAF-032 -> QAF-033`
- PR trace:
  - `QAF-024` -> PR #198 (Greptile `5/5`)
  - `QAF-025` -> PR #199 (Greptile `5/5`)
  - `QAF-026` -> PR #200 (Greptile `4/5`, approved no-blocker exception)
  - `QAF-027` -> PR #201 (Greptile `4/5`, approved no-blocker exception)
  - `QAF-028` -> PR #203 (Greptile `5/5`)
  - `QAF-029` -> PR #204 (Greptile `4/5`, approved no-blocker exception)
  - `QAF-030` -> PR #205 (Greptile `4/5`, approved no-blocker exception)
  - `QAF-031` -> PR #206 (Greptile `5/5`)
  - `QAF-032` -> PR #209 (Greptile `5/5`)
  - `QAF-033` -> PR #210 (Greptile `5/5`)
- QA gate note:
  - Latest post-batch run still exits with Playwright loader conflict (`Requiring @playwright/test second time`), so `output/playwright/qa-user-sim/QA-REPORT.md` remains non-actionable (`Scenario status: unknown`, `Scenarios executed: 0`) until QA tooling fix.

## QAF-034 Attempt Log (2026-02-21, unresolved)

Execution trace written for tomorrow continuation per `docs/WORKFLOW-LLM-QA.md`:

1. Reproduced in real browser automation (Playwright, Chromium) from both persisted session and clean live start.
2. Captured network pattern:
   - `xui-api/streaming/timeshift.php?username=...` -> `302` to provider token URL.
   - token manifest/segment requests show mixed behavior across attempts (`200` in some tuples, `404/502` in user-reported tuples).
3. Probed provider paths directly with Node/curl across multiple `start` offsets and durations to classify responses (`application/x-mpegurl`, `video/mp2t`, HTML/empty error).
4. Implemented and tested catch-up URL candidate expansion:
   - local-time + UTC `start` variants (`getCatchUpUrlVariants`),
   - offset candidates and sibling stream fallback list.
5. Implemented and tested playback resilience changes:
   - fallback guard position (`+15s` initial/fallback),
   - reduced false fallback loops on transitional errors,
   - adapter fatality adjustment for `MEDIA_ELEMENT_4` when `hls.js` manages media.
6. Fixed core source-type mismatch in player load path:
   - catch-up URL without `.m3u8` suffix now loads as declared `source.type='hls'` (not URL-heuristic `mp4`).
7. Validation performed:
   - `pnpm --filter @lumen/web typecheck` -> pass
   - `pnpm --filter @lumen/web lint` -> pass
   - targeted vitest runs for touched areas -> pass
8. Current outcome:
   - Local simulation can start catch-up in clean scenario, but user real flow still reports unresolved `502` runtime failure.
   - Task remains `open` until reproducible pass is confirmed on user environment with evidence.

## QAF-034 Attempt Log (2026-02-22, pending-review)

Candidate fix prepared for external runtime validation (Reptile):

1. Kept provider-compatible catch-up URL expansion:
   - local-time + UTC `start` variants,
   - offset-based `start` retries and sibling stream-id fallback candidates.
2. Hardened startup/fallback behavior:
   - initial catch-up position guard (`+15s`) to avoid live-edge not-yet-generated segments,
   - fallback only on fatal network/media/hls load failures (skip transient/non-fatal transition noise).
3. Preserved explicit HLS source type from session metadata:
   - catch-up URLs without `.m3u8` suffix continue loading via `source.type='hls'`.
4. Archive signal quality improvement:
   - short EPG remains primary,
   - archive fallback (`get_simple_data_table`) is merged when short EPG lacks `has_archive`,
   - removed past-time-only `hasCatchUp` inference to avoid false positives.
5. Local validation on this branch:
   - `pnpm --filter @lumen/web typecheck` -> pass
   - `pnpm --filter @lumen/web lint` -> pass
   - `pnpm --filter @lumen/api lint` -> pass
   - `pnpm exec vitest run src/components/player/liveTimeshift.test.ts src/services/channelEpg.test.ts src/services/epgProgramMapper.test.ts` (in `apps/web`) -> pass
   - `pnpm exec vitest run src/xtream-codes-service.test.ts` (in `packages/api`) -> pass
6. Status:
   - `QAF-034` moved to `pending-review` until Reptile confirms catch-up playback success in real user flow.

## QAF-034 Attempt Log (2026-02-23, pending-review)

Provider-specific compatibility adjustments were added after fresh runtime probing and code review:

1. Real provider behavior reconfirmed:
   - `timeshift.php` is stable with formatted `start=YYYY-MM-DD:HH-MM`.
   - epoch `start` is not consistently accepted on this provider class.
2. Catch-up URL generator hardening:
   - query-format variants now include `duration` candidates (minutes first, seconds fallback),
   - legacy path variants now include both formatted and epoch `start` fallbacks.
3. Runtime fallback order update:
   - bounded retries of primary catch-up URL are attempted before wider offset/stream-id fallback expansion.
4. Server host consistency update:
   - login/auth flow now canonicalizes server from `server_info` and persists it for runtime,
   - dev proxy now supports encoded per-target host routing so redirected/canonical hosts remain reachable in local dev.
5. Local validation:
   - `pnpm typecheck` -> pass
   - `pnpm vitest run packages/api/src/xtream-codes-service.test.ts apps/web/src/config/xtream.test.ts` -> pass
6. Status:
   - `QAF-034` remains `pending-review` until external runtime validation (real user flow + Reptile feedback) confirms catch-up playback is stable end-to-end.

## Reopened task clarifications (historical acceptance deltas)

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
