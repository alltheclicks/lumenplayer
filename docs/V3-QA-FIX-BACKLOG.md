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
- `LP-1511` gateway groundwork and later `QAF-035` experiments exist on non-merged `codex/` branches; as of 2026-03-06 the accepted continuation path is a clean rebuild from `origin/main`, not further stacking on the old branch chain.

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
| QAF-034 | Reopened catch-up runtime failure: provider timeshift returns intermittent `404/502`, playback still fails in real user flow | Catch-up Playback/Provider Compatibility | P1 | in-progress |
| QAF-035 | Option B catch-up gateway refactor: optional web gateway decides `provider-direct | proxy-normalized | proxy-remuxed` and keeps provider/browser repair outside `@lumen/session-core` | Catch-up Gateway/Transport | P1 | in-progress |

Current runtime note (2026-03-09):
- `QAF-034`:
  - provider introduced `timeshift_hls` browser path
  - one Lumen-side startup bug was confirmed and fixed locally: web must not start on direct login-host `serv2/timeshift_hls/...` because that path returns `404`; the valid flow remains `serv2 /streaming/timeshift.php?... -> 302 -> archive-host /timeshift_hls/...`
  - after that fix, the remaining failures are still provider-media failures, not route construction:
    - `RTS 1` decode stop around `~2:00`
    - `PINK` decode stop around `~1:00`
  - provider-backed CLI evidence with real credentials (`smart.mediaking.fi`, `2026-03-09 17:28 CET`) now strengthens that conclusion:
    - `RTS 1` (`stream_id=112`) and `PINK` (`stream_id=105`) both follow the valid query-first startup chain `serv2 /streaming/timeshift.php?...extension=m3u8 -> 302 -> edge6 /streaming/timeshift.php?token=...`
    - `ffprobe` / `ffmpeg` on sampled token-manifest segments at `0s`, `60s`, and `120s` already report repeated `non-existing PPS 0 referenced` / `no frame!`
    - later sampled segment `seg=90` is invalid on both channels (`Invalid data found when processing input`)
    - requested `duration=240` returned a `91`-segment / `5460s` manifest on both channels, so provider duration/window semantics also look suspect
- `QAF-035`:
  - optional gateway/remux path is still the fallback architecture if provider `timeshift_hls` cannot become fully browser-safe
  - the provider evidence loop is now strong enough to justify targeted remux fallback validation for this provider without reopening the old startup-routing investigation

Current workaround note (2026-03-16):
- `QAF-035`:
  - real browser runtime is now confirmed on the optional gateway path for this provider:
    - `catchup-gateway/resolve -> proxy /xui-api/...__lumenTransport=remux-hls -> /xui-api/__remux__/session/...`
  - validated with real credentials on:
    - `RTS 1`: stable past earlier stops at `~0:58` and `~2:00`
    - `PINK`: stable past earlier stop at `~1:00`
  - this means we now have one working browser workaround for the provider-media problem
  - important caveat:
    - the current `proxy-remuxed` implementation is FFmpeg transcode (`libx264` video + `aac` audio to browser-safe fMP4/HLS), not packet-copy remux
    - it should be treated as a confirmed compatibility workaround, but CPU cost is likely too high to accept unchanged for small-production VPS hosting

## Next ready queue (strict order)

1. `QAF-035` clean continuation setup:
   - continue only from `origin/main` baseline
   - selectively carry forward validated work from `LP-1511` / `QAF-035` experimental branches
   - do not stack further commits on top of `codex/qaf-035-catchup-gateway`
2. Rebuild gateway slice in clean order:
   - `LP-1511` shared Xtream proxy groundwork
   - `QAF-035` gateway resolve/control-plane contract
   - Greptile follow-up fixes (`cache sweep`, async error handling, PiP exit, enum validation, lockfile parity)
3. Keep `QAF-034` evidence track alive:
   - preserve TiviMate/native tuple evidence as acceptance input
   - use it to decide when `provider-direct` is still allowed vs when gateway normalization/remux is required
   - latest required evidence is specifically on the new provider `timeshift_hls` path reached through the real `serv2 -> 302 -> archive-host` flow, not direct archive-host login
4. After clean gateway baseline is green:
   - continue startup/warm-open improvements first
   - then implement chunk-aware seek preparation and cancellation

## QAF-035 Branch reconciliation snapshot (2026-03-06)

| Branch | Role | Status | Keep / carry forward |
|---|---|---|---|
| `codex/lp-1511-xtream-gateway` | standalone `apps/proxy` Xtream transport groundwork | experimental, useful | yes; foundational proxy work |
| `codex/qaf-035-runtime-payload-gate` | web runtime gate for non-playable catch-up payloads | experimental, useful | yes; selective logic/tests only |
| `codex/qaf-035-catchup-runtime-gate` | in-progress runtime checkpoint | incomplete | no direct merge; inspect only if needed |
| `codex/disable-demo-fallback-xui` | bounded catch-up fallback/recovery behavior | experimental, partially useful | yes; selective carry-forward candidates |
| `codex/qaf-035-catchup-gateway` | Option B gateway resolve path + web adapter | experimental, stacked on prior branches | yes, but rebuild on clean baseline and fix review blockers before reuse |

Working rule:
- `origin/main` is the only clean baseline.
- Experimental QAF-035 branches are reference material, not the new source of truth.
- New continuation starts from a fresh `codex/` branch and ports only validated behavior.

## QAF-035 Attempt Log (2026-03-04, experimental)

1. `LP-1511` added standalone `apps/proxy` groundwork for Xtream transport mediation:
   - `/xui-api/{encoded-target}/...` compatibility path
   - host allowlist, timeout/retry, redirect-safe rewrite, structured proxy logging
2. `QAF-035` runtime payload gate branch added web-side protection against non-playable `200 video/mp2t` payloads:
   - runtime gate classification
   - enriched catch-up retry/fallback metadata
   - startup-time fallback continuation
3. `QAF-035` gateway branch added Option B resolve flow:
   - asset identity / resolve contract
   - optional gateway transport adapter in web
   - gateway-first catch-up source resolution
4. Current state of those branches:
   - useful direction is confirmed
   - implementation stack is not clean because later branches were built on top of earlier experimental history rather than directly on `origin/main`
   - latest gateway PR also still has valid follow-up fixes before it is safe to treat as carry-forward baseline

## QAF-035 Attempt Log (2026-03-06, baseline reset)

1. Reconciled actual git state:
   - `main` / `origin/main` are at `a825816`
   - `codex/qaf-035-catchup-gateway` (`66a608a`) is stacked on top of `codex/disable-demo-fallback-xui` (`017e9a6`), not directly on `main`
2. Accepted architecture direction:
   - Option B remains the target
   - catch-up gateway stays outside `@lumen/session-core`
   - live/VOD should not regress and are not part of gateway scope by default
3. Accepted process decision:
   - stop extending the old stacked branch chain
   - continue from clean `origin/main` baseline with docs synced first
   - selectively port validated code/tests into the next clean continuation branch
4. Immediate carry-forward blockers already known from review/runtime:
   - periodic cache sweep in proxy service
   - async error handling for catch-up program switching
   - PiP cleanup restore
   - stricter gateway response enum validation
   - `pnpm-lock.yaml` parity for CI

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

## QAF-034 Attempt Log (2026-02-23, TiviMate comparative capture)

Live native traffic capture was executed on Buildara (`100.74.23.120`) while user performed real TiviMate actions on Sony Android TV:

1. Confirmed TiviMate request sequence for live:
   - `GET /live/{user}/{pass}/{stream}.ts` on login host (`iptvmedia.pro:8080`)
   - `302` redirect to edge/archive host (`l2.mediaking.fi:8080`) with token
   - media fetch continues on redirected host
2. Confirmed TiviMate request sequence for catch-up:
   - `GET /timeshift/{user}/{pass}/{duration}/{start}/{stream}.ts` on login host
   - `302` redirect to tokenized `https://edge*.castcdn.net/streaming/timeshift.php?token=...`
   - rapid retry bursts are visible with start-minute adjustments
   - observed retry cadence from capture:
     - `start=2026-02-23:22-37` -> 6 attempts
     - `start=2026-02-23:22-35` -> 2 attempts
     - `start=2026-02-23:22-19` -> 3 attempts
     - inter-attempt timing buckets: 8 retries `<2s`, 1 retry `2-15s`, 1 retry `>=15s`
3. Practical interpretation for Lumen:
   - redirect+token is expected provider behavior, not exceptional path
   - parity target is native flow semantics (`request -> 302 -> final media`) under web transport constraints
4. Status:
   - `QAF-034` moved to `in-progress` pending next web-runtime parity patch and external validation.

## QAF-034 Attempt Log (2026-02-23, TiviMate comparative capture #2)

Additional guided scenario was captured (live RTS1 -> seek back 5m -> seek back 30m -> return live -> channel changes -> RTS1):

1. Live flow remains consistent:
   - login host request -> `302` -> edge/live host with token
   - observed live redirect targets include `l2.mediaking.fi` and `fra10.mediaking.fi`.
2. Catch-up flow remains redirect-driven:
   - all observed `/timeshift/...` requests on login host return `302` to `https://edge6.castcdn.net/streaming/timeshift.php?token=...`.
3. Retry cadence (same run, `22:52+` window):
   - `302` totals: `timeshift_token=38`, `live=6`.
   - attempts by stream/start:
     - `112 @ 22-34` -> 8
     - `112 @ 22-35` -> 1
     - `112 @ 22-37` -> 4
     - `2927 @ 22-52` -> 2
     - `2927 @ 22-49` -> 4
     - `2927 @ 22-23` -> 1
     - `2927 @ 22-22` -> 1
     - `2927 @ 22-19` -> 13
     - `2927 @ 22-53` -> 3
   - retry gap buckets: `<2s=24`, `2-10s=9`, `>=10s=3`.
4. Practical implication:
   - TiviMate aggressively retries and moves start-minute in bursts before giving up or returning to live.
   - This behavior should be mirrored in Lumen catch-up transport policy (without regressing live startup).

## QAF-034 Attempt Log (2026-02-23, HTTPS profile probe)

User executed an additional run with HTTPS-oriented profile settings to compare with HTTP baseline.

1. Observed transport shape is hybrid (not pure HTTPS):
   - control/API requests still visible on `iptvmedia.pro:8080` (`/player_api.php`, `/xmltv.php`) in plaintext capture;
   - media plane opens TLS sessions to `gw.castcdn.net` and `edge{3,5,6}.castcdn.net` (port 443).
2. TLS SNI evidence in run window:
   - `gw.castcdn.net`, `edge3.castcdn.net`, `edge5.castcdn.net`, `edge6.castcdn.net`.
3. New TLS connection targets (SYN to 443) in sampled window:
   - `45.141.56.136` (edge3), `79.137.99.121` (edge6), `188.241.219.211` (edge5) plus minor auxiliary endpoints.
4. Interpretation:
   - switching profile to HTTPS does not eliminate provider-side host/protocol switching;
   - player compatibility still depends on robust redirect/token handling and mixed transport support (`http` control + `https` media).

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
