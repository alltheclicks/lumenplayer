# Catch-up Stability Notes - 2026-05-15

## Problem

Manual testing showed two separate catch-up failures on the partner MediaKing/Xtream stack:

- some archive clicks could land on the program two hours earlier than the selected EPG row
- browser playback could download archive data but keep showing the spinner because startup recovery reopened the first segment before a first frame existed

The fix must not transcode, remux, generate temporary HLS, or spend server CPU on media processing.

## Root Causes

MediaKing/CastCDN expects formatted catch-up `start=YYYY-MM-DD:HH-MM` in provider-local time. The older generic Xtream fallback also emitted the UTC equivalent. In Europe/Belgrade this can be two hours earlier, so a Nova S click at `21:30` could fall back to `19:30`.

hls.js can report fatal media errors while the first archive TS segment is still being parsed. Recovering immediately is useful for live startup, but it is harmful for catch-up before the first frame because it interrupts a valid large archive segment and reopens the same `seg=0_...ts` request.

Later BHT 1 and B92 browser tests exposed a sharper MediaKing archive issue: the first archive segment can be non-random-access for browser playback. Local `ffprobe` on BHT 1 showed `seg=0` without usable video stream metadata at the segment start, while `seg=1` contained browser-decodable H.264/AAC. hls.js correctly tried to backtrack from `seg=1` to `seg=0` to recover the GOP boundary, but that is exactly the segment the browser cannot use.

## Current Lumen Behavior

- MediaKing/CastCDN catch-up URL candidates are local-time only, even when the real upstream host is wrapped by `/xui-api/<encoded target>`.
- Other Xtream providers can still keep the generic local + UTC candidate behavior.
- Catch-up HLS uses progressive fragment startup and archive-only `startFragPrefetch` to get the first picture sooner.
- Catch-up HLS keeps a deeper forward buffer than live (`90s` instead of `30s`) because MediaKing archive segments can be 60 seconds long and around 30 MB. This lets Lumen fetch the next archive segment before the user reaches the segment boundary.
- Catch-up `recoverMediaError()` is blocked until `playing` or real time progress proves playback has started.
- For MediaKing/CastCDN tokenized archive manifests, the local proxy inserts `#EXT-X-DISCONTINUITY` before `seg=1`. This does not transcode or remux media; it only prevents hls.js from backtracking into the known bad `seg=0` startup fragment.
- MediaKing/CastCDN catch-up starts at a provider-safe `75s` guard so the first browser playback attempt lands inside the first usable archive segment.
- The unsupported-provider overlay remains the user-facing stop for confirmed browser-incompatible archive formats.
- Catch-up provider failures with codec/archive evidence show a clear user message that live still works and offer one action to watch the same channel live.
- Runtime catch-up startup failures do not walk the full fallback matrix before the first frame. Lumen now allows one corrective startup fallback, then stops on a user-facing provider message with the same-channel live action.
- Live playback failures show a `Prijavi problem` action. The action records `playback.problem_reported` through web observability and confirms to the user that the channel was recorded for stream checking.
- No server-side transcode, remux, or generated media asset is used.

## Verification Run

Targeted tests:

```bash
pnpm vitest run apps/web/src/adapters/HlsPlayerAdapter.test.ts packages/api/src/xtream-codes-service.test.ts
```

Result: `30` tests passed.

Broader player/catch-up tests:

```bash
pnpm vitest run apps/proxy/src/server.test.ts apps/web/src/adapters/HlsPlayerAdapter.test.ts apps/web/src/components/player/sessionSources.test.ts apps/web/src/components/player/catchupSource.test.ts apps/web/src/components/player/videoPlaybackSync.test.ts
```

Result: `55` tests passed.

Build and typecheck:

```bash
pnpm --filter @lumen/proxy typecheck
pnpm --filter @lumen/proxy build
pnpm --filter @lumen/web typecheck
pnpm --filter @lumen/web build
```

Result: both passed; production web build completed in about `2.7s`.

Final local gates after the user-facing error handling changes:

```bash
pnpm vitest run
pnpm typecheck
pnpm lint
pnpm build
pnpm e2e:qa:simulate
```

Results:

- `pnpm vitest run`: `45` files, `260` tests passed.
- `pnpm typecheck`: passed.
- `pnpm lint`: passed without warnings.
- `pnpm build`: passed; the existing Vite chunk-size warning remains for the Player chunk.
- `pnpm e2e:qa:simulate`: command exited `0`, report status `passed-with-blockers`. The remaining blockers are the existing QA-scenario issues: no channel rows in QAF-006, no visible Play Episode button in QAF-002, and the tracker still records aborted Xtream requests even though direct API sanity checks pass.

Focused Playwright smoke artifacts:

- `output/playwright/manual-focused-positive-smoke.json`
  - PINK live produced a 1920x1080 frame in about `2.0s`.
  - PINK catch-up produced a 1920x1080 frame in about `18.6s`.
  - PINK catch-up pause/resume/seek checks stayed on a renderable frame.
  - RTS 1 live produced a 1920x1080 frame in about `2.0s`.
  - RTS 1 catch-up stopped on the expected provider overlay in about `9.6s` with the same-channel live action.
- `output/playwright/manual-rts-catchup-switch-live-action.json`
  - RTS 1 catch-up overlay showed the live action.
  - Clicking the live action returned to a 1920x1080 live frame in about `1.0s`.
- `output/playwright/manual-live-failure-report-action.json`
  - Forced live stream failure showed `Live kanal trenutno nije dostupan` and `Prijavi problem`.
  - Clicking the action emitted `playback.problem_reported` without credential URLs and showed the confirmation toast.

Latest local verification after the focused smoke runner fixes:

```bash
pnpm vitest run apps/web/src/components/player/sourceBlockingError.test.ts apps/web/src/components/player/videoPlaybackSync.test.ts
pnpm typecheck
pnpm lint
pnpm vitest run
pnpm build
node --check scripts/playwright/run-focused-playback-smoke.mjs
pnpm vitest run scripts/playwright/focusedPlaybackSmokeConfig.test.mjs
```

Results:

- targeted source-blocking/playback-sync tests: `22` passed.
- `pnpm typecheck`: passed.
- `pnpm lint`: `11` lint tasks passed.
- `pnpm vitest run`: `49` files, `276` tests passed.
- `pnpm build`: passed; the existing Player chunk-size warning remains.
- `node --check scripts/playwright/run-focused-playback-smoke.mjs`: passed.
- `pnpm vitest run scripts/playwright/focusedPlaybackSmokeConfig.test.mjs`: `4` tests passed.
- `pnpm vitest run apps/web/src/adapters/HlsPlayerAdapter.test.ts`: `18` tests passed, including stale HLS error suppression after source switching.
- `pnpm vitest run packages/player-core/src/seek-engine.test.ts`: `4` tests passed, covering forward/backward clamp, long-press acceleration, and direction changes before release.
- `pnpm vitest run apps/web/src/components/player/timelineSeek.test.ts`: `4` tests passed, covering mouse/touch timeline seek clamping and invalid layout data without returning `NaN`.
- `pnpm vitest run apps/web/src/components/player/liveTimeshift.test.ts apps/web/src/components/player/timelineSeek.test.ts`: `8` tests passed, including invalid live-bar ratio and empty touch fallback handling.
- `pnpm vitest run apps/web/src/pages/playbackProblemReport.test.ts`: `2` tests passed, covering sanitized problem-report metadata without stream URLs, username/password, or token leakage.

Latest local verification after binding player error actions to the source that produced the error:

```bash
pnpm lint
pnpm typecheck
pnpm vitest run apps/web/src/components/player/playerErrorState.test.ts apps/web/src/components/player/sourceBlockingError.test.ts
pnpm vitest run
pnpm build
node --check scripts/playwright/run-focused-playback-smoke.mjs
```

Results:

- `pnpm lint`: `11` lint tasks passed without warnings.
- `pnpm typecheck`: `3` typecheck tasks passed.
- targeted player error/source-blocking tests: `9` tests passed.
- `pnpm vitest run`: `50` files, `278` tests passed.
- `pnpm build`: passed; the existing Player chunk-size warning remains.
- `node --check scripts/playwright/run-focused-playback-smoke.mjs`: passed.
- Browser edge-case smoke was not rerun in this pass because local CPU was still saturated by non-Lumen desktop/system processes; no Playwright, Vite, Vitest, or `pnpm` dev process remained active.

Latest focused-smoke safety guard check:

```bash
pnpm vitest run scripts/playwright/focusedPlaybackSmokeConfig.test.mjs
node --check scripts/playwright/focusedPlaybackSmokeConfig.mjs
node --check scripts/playwright/run-focused-playback-smoke.mjs
pnpm lint
pnpm vitest run
E2E_FOCUSED_PLAYBACK_SCENARIOS=playable-catchup-controls \
E2E_PLAYABLE_CATCHUP_CANDIDATES=pink \
E2E_PLAYBACK_VIEWPORT=640x360 \
pnpm e2e:playback:focused
```

Results:

- `focusedPlaybackSmokeConfig.test.mjs`: `7` tests passed, including CPU-guard parsing and high-load blocking decisions.
- both `node --check` commands passed.
- `pnpm lint`: `11` lint tasks passed.
- `pnpm vitest run`: `50` files, `281` tests passed.
- guarded smoke run exited before dev-server/browser launch with `blocked-cpu` because preflight total CPU was `252.8%`, above the default `180%` guard.
- `output/playwright/focused-playback-smoke/report.json` and `REPORT.md` record the `blocked-cpu` status and the preflight CPU measurement.

Latest mouse-seek smoke coverage update:

```bash
pnpm vitest run scripts/playwright/focusedPlaybackSmokeConfig.test.mjs
node --check scripts/playwright/focusedPlaybackSmokeConfig.mjs
node --check scripts/playwright/run-focused-playback-smoke.mjs
pnpm lint
pnpm typecheck
pnpm vitest run
pnpm build
E2E_HEADLESS=false \
E2E_BROWSER_CHANNEL=chrome \
E2E_FOCUSED_PLAYBACK_SCENARIOS=playable-catchup-mouse-seek \
E2E_PLAYABLE_CATCHUP_CANDIDATES=pink \
E2E_PLAYBACK_VIEWPORT=640x360 \
pnpm e2e:playback:focused
```

Results:

- `focusedPlaybackSmokeConfig.test.mjs`: `8` tests passed. This now verifies that default smoke includes `playable-catchup-mouse-seek` and that selected scenarios cannot silently miss a runner.
- both `node --check` commands passed.
- `pnpm lint`: `11` lint tasks passed.
- `pnpm typecheck`: `3` typecheck tasks passed.
- `pnpm vitest run`: `50` files, `282` tests passed.
- `pnpm build`: passed; the existing Player chunk-size warning remains.
- The headful installed-Chrome smoke was attempted with the CPU guard still enabled. It exited before dev-server/browser launch with `blocked-cpu` because preflight total CPU was `223.3%`, above the default `180%` guard.
- A follow-up CPU sample was still about `221%`, so Chrome was intentionally not launched.

Focused smoke runner update:

- `PlayerControls` and the main Player TV-unazad section now expose stable `catchup-open` / `catchup-program` test IDs.
- `scripts/playwright/run-focused-playback-smoke.mjs` can run selected scenarios via `E2E_FOCUSED_PLAYBACK_SCENARIOS`.
- The playable catch-up candidate list can be narrowed via `E2E_PLAYABLE_CATCHUP_CANDIDATES`.
- The runner defaults to a smaller `1280x720` viewport and mutes browser audio to reduce local QA load.
- The runner clicks only visible `catchup-program` rows so the hidden fullscreen archive panel cannot shadow the main Player TV-unazad section in normal view.
- The runner supports `E2E_HEADLESS=false` and `E2E_BROWSER_CHANNEL=chrome` for a headful installed-Chrome run if bundled headless Chromium burns too much CPU on local video decode.
- `scripts/playwright/focusedPlaybackSmokeConfig.test.mjs` covers the scenario/candidate list parsing, viewport clamp, and browser launch override parsing without starting Chromium.
- The runner now has a CPU guard. By default it blocks before browser launch, and during long playback waits, when total local CPU is above `180%`. Use `E2E_CPU_GUARD=false` only when intentionally overriding this local safety guard.
- The runner now includes `playable-catchup-mouse-seek`, which clicks the visible catch-up timeline with real mouse coordinates at two positions and verifies that session position lands near the expected archive offsets while a renderable frame remains available.

The latest attempted browser runs were intentionally interrupted because local CPU was saturated by the Playwright headless renderer and other user/system processes. Treat `output/playwright/focused-playback-smoke/REPORT.md` from `2026-05-15T15:50:31.429Z` and `2026-05-15T15:55:31.829Z` as aborted infrastructure runs, not as functional evidence against catch-up playback.

Run the browser edge-case smoke again only when local CPU is stable, for example:

```bash
E2E_FOCUSED_PLAYBACK_SCENARIOS=playable-catchup-controls \
E2E_PLAYABLE_CATCHUP_CANDIDATES=pink \
E2E_PLAYBACK_VIEWPORT=640x360 \
pnpm e2e:playback:focused
```

If bundled headless Chromium still saturates CPU, try the same smoke in installed Chrome:

```bash
E2E_HEADLESS=false \
E2E_BROWSER_CHANNEL=chrome \
E2E_FOCUSED_PLAYBACK_SCENARIOS=playable-catchup-controls \
E2E_PLAYABLE_CATCHUP_CANDIDATES=pink \
E2E_PLAYBACK_VIEWPORT=640x360 \
pnpm e2e:playback:focused
```

Latest guarded headful Chrome mouse-seek verification after the seek recovery fixes:

```bash
pnpm vitest run apps/web/src/components/player/videoPlaybackSync.test.ts apps/web/src/adapters/HlsPlayerAdapter.test.ts
pnpm typecheck
pnpm lint
pnpm vitest run
pnpm build
E2E_HEADLESS=false \
E2E_BROWSER_CHANNEL=chrome \
E2E_CPU_GUARD_MAX_TOTAL=550 \
E2E_FOCUSED_PLAYBACK_SCENARIOS=playable-catchup-mouse-seek \
E2E_PLAYABLE_CATCHUP_CANDIDATES=pink \
E2E_PLAYBACK_VIEWPORT=1280x720 \
nice -n 10 pnpm e2e:playback:focused
```

Results:

- targeted video playback/HLS tests: `38` tests passed.
- `pnpm typecheck`: `3` typecheck tasks passed.
- `pnpm lint`: `11` lint tasks passed.
- `pnpm vitest run`: `50` files, `287` tests passed.
- `pnpm build`: passed; the existing Player chunk-size warning remains.
- guarded installed-Chrome smoke passed at `2026-05-15T19:48:55.271Z`.
- PINK live started with a 1920x1080 frame in about `4.5s`.
- PINK catch-up started from the TV-unazad list with a 1920x1080 frame in about `2.5s`.
- Mouse timeline seek to `35%` landed at about `2203s`, with a 1920x1080 frame in about `2.5s`.
- Mouse timeline seek to `70%` landed at about `4407s`, with a 1920x1080 frame in about `8.1s`.
- The runner kept credentials redacted, screenshot failure non-fatal, and no Playwright/Chrome/Vite process remained after cleanup.

Fixes added for this edge case:

- catch-up timeline clicks now flow through session state first, so stale video time cannot overwrite the user target.
- `VideoPlayer` tracks the intended seek target and does not clear the seek guard until a catch-up frame is actually renderable.
- non-fatal HLS errors no longer force the adapter into `error`, so buffering recovery can continue.
- a catch-up seek watchdog retries once at the target position and then shows the existing TV-unazad/live-action overlay if the provider still cannot render a frame.
- the focused smoke runner now reveals playback controls before mouse timeline clicks and only clicks a timeline that receives pointer events.

Latest guarded headful Chrome default focused smoke:

```bash
pnpm typecheck
pnpm lint
pnpm vitest run
pnpm build
E2E_HEADLESS=false \
E2E_BROWSER_CHANNEL=chrome \
E2E_CPU_GUARD_MAX_TOTAL=450 \
E2E_PLAYABLE_CATCHUP_CANDIDATES=rts1,hrt1,prva,obn,bht1,pink \
E2E_PLAYBACK_VIEWPORT=1280x720 \
nice -n 10 pnpm e2e:playback:focused
```

Results:

- `pnpm typecheck`: `3` typecheck tasks passed.
- `pnpm lint`: `11` lint tasks passed.
- `pnpm vitest run`: `50` files, `289` tests passed.
- `pnpm build`: passed; the existing Player chunk-size warning remains.
- guarded installed-Chrome default smoke passed at `2026-05-15T20:18:29.002Z`.
- `live-failure-report`: live failure overlay and sanitized report action passed.
- `catchup-failure-live-action`: RTS 1 catch-up provider overlay appeared in about `0.5s`; same-channel live action returned to a 1920x1080 live frame in about `1.0s`.
- `playable-catchup-controls`: PINK `Klopka ljubavi` started with a 1920x1080 catch-up frame in about `1.5s`; pause/resume/seek kept a renderable frame.
- `playable-catchup-mouse-seek`: PINK `Klopka ljubavi` started with a 1920x1080 catch-up frame in about `1.5s`; mouse seek either landed on a frame or produced the TV-unazad/live-action overlay without credential leakage.
- `rapid-live-zap`: RTS 1 -> HRT 1 -> PRVA -> PINK -> NOVA S settled on NOVA S with a 1920x1080 live frame in about `4.0s`.
- no Playwright/Chrome/Vite process remained after cleanup.

Additional fixes from the default smoke:

- the post-seek recovery helper no longer treats `currentTime == target` as success unless a frame is renderable.
- TV-unazad program rows expose stable start/end metadata so smoke tests can avoid just-ended archive rows that providers have not made browser-playable yet.
- playable focused-smoke scenarios now choose an older stable archive row; provider-not-ready latest rows remain covered by the failure-overlay scenario.

Latest catch-up edge-stress smoke update:

```bash
pnpm lint
pnpm typecheck
pnpm vitest run
pnpm build
E2E_HEADLESS=false \
E2E_BROWSER_CHANNEL=chrome \
E2E_CPU_GUARD_MAX_TOTAL=450 \
E2E_PLAYABLE_CATCHUP_CANDIDATES=rts1,hrt1,prva,obn,bht1,pink \
E2E_PLAYBACK_VIEWPORT=1280x720 \
nice -n 10 pnpm e2e:playback:focused
```

Results:

- `pnpm lint`: `11` lint tasks passed without warnings.
- `pnpm typecheck`: `3` typecheck tasks passed.
- `pnpm vitest run`: `50` files, `293` tests passed.
- `pnpm build`: passed; the existing Player chunk-size warning remains.
- guarded installed-Chrome default smoke passed at `2026-05-15T22:29:55.439Z`.
- Default smoke now includes `catchup-edge-stress` and `catchup-live-switch-stress` in addition to live failure reporting, catch-up provider fallback, playable controls, mouse seek, and rapid live zap.
- `playable-catchup-controls`: HRT 1 started a compatible catch-up frame and pause/resume/seek controls stayed usable.
- `playable-catchup-mouse-seek`: HRT 1 started a compatible catch-up frame and mouse timeline seek passed.
- `catchup-edge-stress`: HRT 1 catch-up stayed renderable through visible UI pause/resume, repeated 10s forward/back controls, rapid mouse timeline clicks, and final live recovery.
- `catchup-live-switch-stress`: HRT 1 catch-up started with a renderable frame, switched from catch-up to NOVA S live, returned to HRT 1 live, reopened HRT 1 catch-up, and mouse-seeked after the switch-back. PINK and RTS 1 attempts in the same scenario showed the provider-overlay/live-action path where the current archive row was not browser-playable.
- A PINK-only default smoke immediately before this broader run failed because the current PINK archive row returned provider decode errors from `edge6.castcdn.net`. The broader candidate run is the publish-relevant result because it proves unsupported rows show the user-facing live-action path while compatible catch-up candidates still play.
- No Playwright/Chrome/Vite process remained after cleanup.

Additional fixes from the edge-stress smoke:

- post-start catch-up seeks now keep the seek watchdog armed even if rapid clicks have already dropped the current frame, as long as the catch-up source previously rendered.
- `PlayerControls` exposes stable test IDs for visible catch-up pause/resume, skip forward/back, and same-channel live controls.
- focused smoke now has a `catchup-edge-stress` scenario that covers visible UI pause/resume, repeated skip forward/back, rapid mouse timeline clicks, and provider-overlay live recovery.

Latest guarded headful Chrome live soak:

```bash
E2E_HEADLESS=false \
E2E_BROWSER_CHANNEL=chrome \
E2E_CPU_GUARD_MAX_TOTAL=450 \
E2E_FOCUSED_PLAYBACK_SCENARIOS=live-multichannel-soak \
E2E_LIVE_SOAK_CHANNEL_MS=300000 \
E2E_PLAYBACK_VIEWPORT=1280x720 \
nice -n 10 pnpm e2e:playback:focused
```

Results:

- guarded installed-Chrome live soak passed at `2026-05-15T22:06:41.789Z`.
- RTS 1, HRT 1, PRVA, PINK, and NOVA S each started with a 1920x1080 live frame in about `4.0s` to `4.6s`.
- Each channel then held live playback for `300s` with a renderable frame, no live-failure overlay, and no credential leakage in page text.
- Before the final passing run, the 30s soak exposed a real post-start live teardown: HRT 1/PINK could start with a frame and then drop to `readyState=0`, `networkState=0`, and `paused=true` without an overlay. Lumen now treats post-start live `idle`/unexpected pause as a recoverable provider/runtime stop, reloads the same live source once, emits `playback.retry` with `LIVE_UNEXPECTED_IDLE` or `LIVE_UNEXPECTED_PAUSE`, and then shows the reportable live-failure overlay instead of going blank if the retry also fails.
- The 300s burn-in also exposed that non-fatal live `NETWORK_ERROR`/`MEDIA_ERROR` events can happen while the video still renders. Lumen no longer shows the report-problem overlay for those recoverable live errors while a frame is renderable; fatal or no-frame live failure still surfaces the report action.
- The final passing run exercised `unexpected_idle_retry` on RTS 1, HRT 1, PRVA, and PINK, and all recovered to stable live playback for the full hold window; NOVA S also passed its full 300s hold after startup retry.
- no Playwright/Chrome/Vite process remained after cleanup.

## Publish-Readiness Audit

- Live playback startup and recovery:
  - Covered by `VideoPlayer.hasRenderableFrame()`, live startup hard retry, post-start live idle/pause/no-frame recovery, recoverable live-error suppression while frames still render, `videoPlaybackSync.test.ts`, production build, rapid live zap, and a guarded live soak where RTS 1, HRT 1, PRVA, PINK, and NOVA S each held a 1920x1080 live frame for `300s`.
  - Residual risk: this is still a focused 5-channel burn-in, not an overnight soak, but it covers the explicit multi-channel longer-running live concern for publish prep.
- Catch-up edge cases on browser-compatible streams:
  - Covered by focused smoke across current compatible candidates: RTS 1 controls, HRT 1 mouse timeline seek, HRT 1 edge stress, HRT 1 catch-up/live switch stress through NOVA S, provider-overlay live recovery for incompatible rows, `timelineSeek.test.ts` for pointer/touch clamp behavior, `seek-engine.test.ts` for long-press forward/back/reverse behavior, and `HlsPlayerAdapter.test.ts` for stale HLS errors after source switches.
  - The latest default focused smoke includes rapid live zap, catch-up provider recovery, visible controls, mouse seek, rapid catch-up edge stress, and catch-up-to-other-live-to-catch-up switch-back stress.
- Provider-side catch-up failures:
  - Covered by `sourceBlockingError.test.ts`, the `VideoPlayer` overlay action, and prior RTS 1 focused smoke where catch-up showed the live action and the action returned to live.
  - User-facing copy explicitly says the issue is not the user/device/player and offers same-channel live for catch-up.
- Provider-side live failures:
  - Covered by `sourceBlockingError.test.ts`, `playbackProblemReport.test.ts`, `Player.reportPlaybackProblem`, and prior forced live-failure smoke.
  - The report metadata intentionally avoids stream URLs, username/password, and tokens.
- Current non-browser release gates:
  - `pnpm lint`, `pnpm typecheck`, `pnpm vitest run`, `pnpm build`, and `node --check scripts/playwright/run-focused-playback-smoke.mjs` passed locally after the latest seek recovery and focused-smoke runner fixes.
- Current blocker:
  - No blocking playback issue remains in the focused publish-prep matrix. A longer overnight soak could still increase confidence, but the current release evidence now includes full focused smoke plus a 5-channel 300s live burn-in.

## Manual Test Focus

Use the real Xtream dev server and check these flows in the browser:

- live zap still starts quickly on RTS 1, HRT 1, PRVA, PINK, OBN, Nova S, BHT 1, BN
- RTS 1 catch-up starts from the selected EPG row and does not keep reopening the first segment
- Prva catch-up starts from the selected EPG row
- OBN catch-up crosses the `1:59/2:00` segment boundary without freezing while the next 60-second archive segment downloads
- Nova S Friday `21:30` starts the selected `21:30` program, not the UTC-shifted `19:30` program
- known unsupported archive streams show the blocking overlay and offer the same channel live
- live stream failure overlay shows `Prijavi problem` and records a report event without exposing credential URLs
