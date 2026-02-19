# V2 QA Fix Backlog (Small Tasks + Codex Prompts)

Purpose: granular fix backlog based on latest local QA run and manual browser findings.  
Goal: each task is small enough for one focused Codex chat session.

Source evidence:
- `/Users/filip/Documents/Lumen Player/output/playwright/qa-user-sim/QA-REPORT.md`
- `/Users/filip/Documents/Lumen Player/output/playwright/qa-user-sim/TASK-CANDIDATES.md`

## Intake — Untriaged Issues

Use this section for immediate manual bug capture (including late-night mobile checks) before triage.

ID format:
- `BUG-YYYYMMDD-XX` (example: `BUG-20260219-01`)

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

### BUG-20260219-01
- Environment:
  - `http://localhost:8080/player`, desktop browser, Xtream nalog `fica`
- Steps:
  1. Posle login-a prvi kanal krene automatski.
  2. Prebaci kanal (npr. INFO -> RTS1 -> HRT1) klikom u listi.
  3. Posmatraj da li live playback automatski nastavlja.
- Expected:
  - Posle promene kanala live stream treba odmah da nastavi playback bez dodatnog klika na `Play`.
- Actual:
  - Često ostane prvi frame; playback ne kreće dok se ručno ne klikne `Play`.
- Evidence:
  - Korisnički opis + screenshot set u chatu (2026-02-19).
- Reporter:
  - Filip
- Timestamp:
  - 2026-02-19
- Severity (initial):
  - P1
- Status: converted-to `QAF-006` (live playback start consistency)

### BUG-20260219-02
- Environment:
  - `http://localhost:8080/player`, desktop browser
- Steps:
  1. Otvori live player sa aktivnim kanalom.
  2. Pomeri miš/click van kontrola.
  3. Sačekaj nekoliko sekundi.
- Expected:
  - Overlay kontrole (prev/play/next/favorite/fullscreen) treba auto-hide posle idle perioda.
- Actual:
  - Overlay ostaje stalno vidljiv (osim fullscreen specifičnog ponašanja).
- Evidence:
  - Screenshot iz chata (2026-02-19) prikazuje trajno vidljiv overlay.
- Reporter:
  - Filip
- Timestamp:
  - 2026-02-19
- Severity (initial):
  - P2
- Status: converted-to `QAF-010`

### BUG-20260219-03
- Environment:
  - `http://localhost:8080/player`, live EPG blok (`Sada na programu` / `Sledi na programu`)
- Steps:
  1. Otvori različite live kanale.
  2. Posmatraj tekst u EPG blokovima.
- Expected:
  - Program title/description treba da budu čitljivi i normalizovani na svim kanalima.
- Actual:
  - Na delu kanala pojavljuje se gibberish/random string umesto čitljivog naslova.
- Evidence:
  - Screenshot iz chata (2026-02-19) sa primerom nečitljivog stringa.
- Reporter:
  - Filip
- Timestamp:
  - 2026-02-19
- Severity (initial):
  - P1
- Status: converted-to `QAF-011`

### BUG-20260219-04
- Environment:
  - `http://localhost:8080/player`, desktop browser
- Steps:
  1. Postavi miš iznad video feed-a (ne iznad liste kanala/kategorija).
  2. Scroll wheel down.
  3. Posmatraj ponašanje cele stranice.
- Expected:
  - Glavni player viewport ne treba da vertikalno "beži" van ekrana u standardnom player layout-u.
- Actual:
  - Cela strana može da se scrolluje nadole; player ode delimično van viewport-a i ostane "mrtav prostor".
- Evidence:
  - Screenshot iz chata (2026-02-19) sa pomerenim layout-om i praznim prostorom.
- Reporter:
  - Filip
- Timestamp:
  - 2026-02-19
- Severity (initial):
  - P1
- Status: converted-to `QAF-012`

### BUG-20260219-05
- Environment:
  - Live player fullscreen + catch-up panel (`Gledanje unazad`)
- Steps:
  1. Uđi u fullscreen.
  2. Klikni catch-up (ikona sata).
  3. Posmatraj listu dostupnih programa unazad.
- Expected:
  - Ako kanal ima catch-up podatke, panel treba da prikaže programe; ako nema, fallback poruka treba da bude jasna i konzistentna.
- Actual:
  - Korisnik vidi `Nema dostupnih snimaka` za RTS kanal i nije jasno da li je problem data, filtering ili UI logika.
- Evidence:
  - Screenshot iz chata (2026-02-19) sa otvorenim `Gledanje unazad` panelom.
- Reporter:
  - Filip
- Timestamp:
  - 2026-02-19
- Severity (initial):
  - P2
- Status: converted-to `QAF-013`

### BUG-20260219-06
- Environment:
  - Live player + Picture-in-Picture flow
- Steps:
  1. Pokreni live kanal.
  2. Uđi u Picture-in-Picture.
  3. Vrati se nazad na player.
- Expected:
  - Live playback treba da nastavi bez dodatne ručne interakcije.
- Actual:
  - Posle povratka iz PiP korisnik često mora ručno da klikne `Play`.
- Evidence:
  - Korisnički opis iz chata (2026-02-19).
- Reporter:
  - Filip
- Timestamp:
  - 2026-02-19
- Severity (initial):
  - P1
- Status: converted-to `QAF-014`

## Intake triage snapshot (2026-02-19)

| Intake ID | Lane | Severity | Converted to | Notes |
|---|---|---|---|---|
| BUG-20260219-01 | Bugfix/Playback | P1 | QAF-006 | Mapped under autoplay/live-start reliability fix scope |
| BUG-20260219-02 | Bugfix/UI | P2 | QAF-010 | Overlay auto-hide timeout/regression task |
| BUG-20260219-03 | Bugfix/EPG | P1 | QAF-011 | EPG text normalization regression hardening |
| BUG-20260219-04 | Bugfix/Layout | P1 | QAF-012 | Player page scroll-lock/layout containment |
| BUG-20260219-05 | Bugfix/Catch-up UX | P2 | QAF-013 | Clarify catch-up no-data vs filter/data issue |
| BUG-20260219-06 | Bugfix/Playback | P1 | QAF-014 | PiP return should auto-resume live playback |

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

## Active tasks (granular)

| ID | Title | Area | Severity | Status |
|---|---|---|---|---|
| QAF-001 | Fix stale episode context when navigating to TV Uživo | Player Session/Navigation | P0 | done |
| QAF-002 | Add deterministic test for `Series episode -> TV Uživo -> Live shell` | E2E QA | P0 | open |
| QAF-003 | Implement local dev API proxy to remove browser CORS failures | Dev Networking | P0 | done |
| QAF-004 | Ensure catalog hooks use same-origin proxied base in dev | Data Layer | P0 | done |
| QAF-005 | Add network diagnostics panel in QA report for `player_api.php` failures | QA Tooling | P1 | open |
| QAF-006 | Fix live autoplay behavior (`autoplay` mode should actually play) | Player Playback | P1 | open |
| QAF-007 | Separate logo/image failures from stream/API failures in QA scoring | QA Tooling | P2 | open |
| QAF-008 | Improve series detail entry selector reliability in QA flow | E2E QA | P2 | open |
| QAF-009 | Handle broken series posters with robust image fallback | Series UI | P3 | open |
| QAF-010 | Fix player control overlay auto-hide behavior on idle | Player UI/Controls | P2 | open |
| QAF-011 | Fix EPG gibberish text regression in live program blocks | EPG/Data Normalization | P1 | open |
| QAF-012 | Prevent whole player page vertical scroll drift in desktop layout | Player Layout/Scroll Lock | P1 | open |
| QAF-013 | Clarify/fix catch-up panel behavior when no recordings are shown | Catch-up UX/Data | P2 | open |
| QAF-014 | Resume live playback automatically after returning from PiP | Player Playback/PiP | P1 | open |

## Completion notes (2026-02-19)

- QAF-003
  - PR: `#162` (merged)
  - Greptile: `5/5`
  - Scope delivered in:
    - `apps/web/vite.config.ts`
    - `apps/web/src/services/xtreamService.ts`
    - `packages/api/src/xtream-codes-service.ts`
- QAF-004
  - PR: `#163` (merged)
  - Greptile: `5/5` after resolving one valid comment before merge
  - Scope delivered in:
    - `apps/web/src/config/xtream.ts`
    - `apps/web/src/config/xtream.test.ts`
    - `apps/web/src/services/xtreamService.ts`
- QAF-001
  - PR: `#164` (merged)
  - Greptile: initial `3/5`, final `5/5` after follow-up fix
  - Scope delivered in:
    - `apps/web/src/pages/switchToLiveMode.ts`
    - `apps/web/src/pages/switchToLiveMode.test.ts`
    - `apps/web/src/pages/Player.tsx`
    - `apps/web/src/components/layout/AppShell.tsx`
    - `apps/web/src/pages/SeriesCategories.tsx`
    - `apps/web/src/pages/VodCategories.tsx`
    - `apps/web/src/pages/SeriesDetail.tsx`

- Retest snapshot after merge batch (`2026-02-19T13:08:33Z`, localhost QA run):
  - CORS blockers improved from previous run (`cors=0` in `Console/network health` step).
  - Remaining blockers moved to next tasks: `QAF-002`, `QAF-005`, `QAF-006`, `QAF-007`, `QAF-008`.

---

## Task details + ready prompts

### QAF-001
- Problem:
  - On `/player`, episode playback context remains active after user intends to go back to Live TV.
  - Manual symptom: user lands on `Episode Playback` shell instead of live channel shell.
- Scope (small):
  1. Introduce one explicit action for "switch to live mode" that clears on-demand source context.
  2. Wire all `TV Uživo` navigations to use that action before route change.
  3. Keep route as `/player`, but ensure session source is live/null-on-demand.
- Likely files:
  - `/Users/filip/Documents/Lumen Player/apps/web/src/pages/Player.tsx`
  - `/Users/filip/Documents/Lumen Player/apps/web/src/pages/SeriesCategories.tsx`
  - `/Users/filip/Documents/Lumen Player/apps/web/src/pages/VodCategories.tsx`
  - `/Users/filip/Documents/Lumen Player/apps/web/src/pages/SeriesDetail.tsx`
- Acceptance:
  - After playing episode, clicking `TV Uživo` shows live player shell (channel list visible).
  - `Episode Playback` heading no longer persists in that path.

Prompt for new Codex chat:
```md
Implement QAF-001 in /Users/filip/Documents/Lumen Player.

Goal:
- Fix stale episode context when navigating to TV Uživo.

Requirements:
1. Add a deterministic "switch to live mode" behavior (clear on-demand source/session context).
2. Apply it to TV Uživo entry points (Series/VOD/on-demand shells), not just route navigation.
3. Keep fix minimal and safe, no broad refactors.
4. Add/adjust focused tests for this behavior.

Validation:
- Run relevant tests and report exact pass/fail.
- Then run:
  E2E_XUI_USERNAME='fica' E2E_XUI_PASSWORD='fF2024BG2025' ./run-qa-simulation.sh
- Summarize whether "Episode Playback" still appears after TV Uživo path.
```

### QAF-002
- Problem:
  - Existing QA flow has blockers around series detail entry and does not always assert exact context transition.
- Scope (small):
  1. Add a dedicated spec (or dedicated test case) only for this path:
     - open series -> open detail -> play episode -> go to TV Uživo -> assert live shell.
  2. Attach screenshot on each step.
  3. Fail with clear reason codes.
- Likely files:
  - `/Users/filip/Documents/Lumen Player/e2e/qa-user-simulation.spec.ts`
  - or new: `/Users/filip/Documents/Lumen Player/e2e/qa-series-live-context.spec.ts`
- Acceptance:
  - Test reliably reproduces bug pre-fix and passes post-fix.

Prompt for new Codex chat:
```md
Implement QAF-002 in /Users/filip/Documents/Lumen Player.

Create a focused Playwright scenario:
Series -> Series Detail -> Play Episode -> TV Uživo -> Live Player.

Requirements:
- Keep this as an isolated test (small and deterministic).
- Add step-level screenshots and clear blocker messages.
- Do not mix unrelated checks (autoplay, VOD, settings) in this scenario.

Output:
- Updated/added test file
- Updated report output so this scenario result is visible as a separate block.
```

### QAF-003
- Problem:
  - Browser CORS errors for `https://gw.castcdn.net/player_api.php...` from `http://localhost:8080`.
- Scope (small):
  1. Add Vite dev proxy endpoint (`/xui-api` style) targeting Xtream server.
  2. Route dev requests through same-origin proxy.
  3. Keep production behavior unchanged.
- Likely files:
  - `/Users/filip/Documents/Lumen Player/apps/web/vite.config.ts`
  - `/Users/filip/Documents/Lumen Player/apps/web/src/config/xtream.ts`
  - `/Users/filip/Documents/Lumen Player/apps/web/src/services/xtreamService.ts`
- Acceptance:
  - No browser CORS errors for `player_api.php` in local dev.
  - Live/VOD categories fetch via proxied route in dev.

Prompt for new Codex chat:
```md
Implement QAF-003 in /Users/filip/Documents/Lumen Player.

Goal:
- Remove localhost CORS failures by using a Vite dev proxy for Xtream API.

Requirements:
1. Add a same-origin proxy path in vite.config.ts.
2. Ensure Xtream API calls use proxy path in dev only.
3. Preserve existing production behavior.
4. Add concise docs note with exact env/URL behavior.

Validation:
- Start dev server on localhost:8080.
- Confirm requests no longer hit CORS errors in browser console.
```

### QAF-004
- Problem:
  - Some hooks/routes still end up with direct remote requests instead of unified base strategy.
- Scope (small):
  1. Audit all Xtream calls for base URL usage.
  2. Unify with one helper function (dev proxy vs prod direct).
  3. Add unit tests around base URL resolver.
- Likely files:
  - `/Users/filip/Documents/Lumen Player/apps/web/src/config/xtream.ts`
  - hooks/services using Xtream calls
- Acceptance:
  - Single source of truth for Xtream base URL resolution.
  - No mixed direct/proxy calls in dev.

Prompt for new Codex chat:
```md
Implement QAF-004 in /Users/filip/Documents/Lumen Player.

Goal:
- Ensure every Xtream request path uses one centralized base URL strategy.

Requirements:
- Add/extend a single resolver utility for dev/prod API base.
- Refactor callers to use it.
- Add unit tests for resolver behavior.
- Keep PR scope tight and avoid unrelated UI edits.
```

### QAF-005
- Problem:
  - QA report has blockers but needs sharper diagnostics for API failures by endpoint/action.
- Scope (small):
  1. Parse console/request failures into grouped counters:
     - `get_live_categories`, `get_live_streams`, `get_vod_categories`, etc.
  2. Add section `API Failure Breakdown` in QA report.
  3. Keep artifact links unchanged.
- Likely files:
  - `/Users/filip/Documents/Lumen Player/e2e/qa-user-simulation.spec.ts`
  - `/Users/filip/Documents/Lumen Player/scripts/playwright/run-qa-user-sim.mjs`
- Acceptance:
  - Report shows endpoint-level failure counts.

Prompt for new Codex chat:
```md
Implement QAF-005 in /Users/filip/Documents/Lumen Player.

Enhance QA reporting:
- Add endpoint/action-level API failure grouping in QA-REPORT.md
- Keep current timeline and blockers, just enrich diagnostics.

Need:
- Parse requestfailed + console errors
- Group by Xtream action (get_live_categories/get_live_streams/get_vod_categories/...)
- Output a short actionable breakdown
```

### QAF-006
- Problem:
  - In autoplay mode, test shows `video.paused=true` after selecting channel.
- Scope (small):
  1. Trace live channel select flow when mode=`autoplay`.
  2. Ensure `play()` is triggered at correct point after source set and not cancelled.
  3. Add focused unit/integration test for autoplay.
- Likely files:
  - `/Users/filip/Documents/Lumen Player/apps/web/src/pages/Player.tsx`
  - `/Users/filip/Documents/Lumen Player/apps/web/src/pages/liveChannelStartupMode.ts`
  - `/Users/filip/Documents/Lumen Player/apps/web/src/pages/liveChannelStartupMode.test.ts`
- Acceptance:
  - Autoplay mode yields playing state consistently in local flow.

Prompt for new Codex chat:
```md
Implement QAF-006 in /Users/filip/Documents/Lumen Player.

Goal:
- Fix live autoplay mode so selected channel starts playing immediately.

Requirements:
- Diagnose why autoplay path leaves video paused.
- Implement minimal safe fix in Player/source-selection flow.
- Add/extend tests for autoplay manual vs autoplay modes.

Validation:
- Run relevant tests.
- Run QA simulation and confirm autoplay blocker is gone.
```

### QAF-007
- Problem:
  - QA currently mixes non-critical image/logo aborts with critical API/stream failures.
- Scope (small):
  1. Categorize request failures:
     - `critical`: player_api / stream manifest/media
     - `non-critical`: logos/posters/CDN images
  2. Only critical failures should block scenario.
- Likely files:
  - `/Users/filip/Documents/Lumen Player/e2e/qa-user-simulation.spec.ts`
- Acceptance:
  - Report still lists non-critical failures, but blocker decision uses critical-only policy.

Prompt for new Codex chat:
```md
Implement QAF-007 in /Users/filip/Documents/Lumen Player.

QA scoring change:
- Distinguish critical network failures from cosmetic image/logo failures.
- Only critical failures should mark scenario as blocked.

Keep:
- Full diagnostics in report
- Existing timeline format
```

### QAF-008
- Problem:
  - Step `Series episode -> player on-demand mode` fails with `No series detail card available`.
- Scope (small):
  1. Harden selector strategy for first series item.
  2. Add fallback route open when list is empty but category is loaded.
  3. Improve step diagnostics (loaded item count, selector used).
- Likely files:
  - `/Users/filip/Documents/Lumen Player/e2e/qa-user-simulation.spec.ts`
- Acceptance:
  - Step fails only for real data absence, not selector fragility.

Prompt for new Codex chat:
```md
Implement QAF-008 in /Users/filip/Documents/Lumen Player.

Goal:
- Make series detail entry step robust in QA test.

Requirements:
- Improve selectors for series cards.
- Add fallback logic and better debug notes (item counts/selector path).
- Keep behavior deterministic and avoid long retries.
```

### QAF-009
- Problem:
  - Series image loading can fail visually; current UX fallback is partial.
- Scope (small):
  1. Add `onError` fallback for series poster images.
  2. Render local placeholder state consistently.
  3. Keep layout stable.
- Likely files:
  - `/Users/filip/Documents/Lumen Player/apps/web/src/pages/SeriesCategories.tsx`
  - `/Users/filip/Documents/Lumen Player/apps/web/src/pages/SeriesDetail.tsx`
- Acceptance:
  - Broken image URLs no longer show broken-image icon or blank container.

Prompt for new Codex chat:
```md
Implement QAF-009 in /Users/filip/Documents/Lumen Player.

Goal:
- Add robust image fallback for series posters in list and detail views.

Requirements:
- Use onError fallback to deterministic local placeholder.
- Preserve current card dimensions and visual hierarchy.
- Add minimal tests if existing test setup allows; otherwise provide manual verification checklist.
```

### QAF-010
- Problem:
  - Live player controls overlay does not auto-hide in normal (non-fullscreen) usage.
- Scope (small):
  1. Reproduce idle-timer/control-visibility path in player controls.
  2. Restore deterministic hide-on-idle behavior for overlay controls.
  3. Add focused regression test for visibility timeout.
- Likely files:
  - `/Users/filip/Documents/Lumen Player/apps/web/src/components/player/PlayerControls.tsx`
  - `/Users/filip/Documents/Lumen Player/apps/web/src/pages/Player.tsx`
- Acceptance:
  - Overlay hides after configured idle interval and reappears on interaction.

### QAF-011
- Problem:
  - EPG text intermittently regresses to gibberish on some channels.
- Scope (small):
  1. Capture failing payload examples in mapper tests.
  2. Strengthen normalization/decoding fallback path.
  3. Verify both "Sada na programu" and "Sledi" blocks.
- Likely files:
  - `/Users/filip/Documents/Lumen Player/apps/web/src/services/epgProgramMapper.ts`
  - `/Users/filip/Documents/Lumen Player/apps/web/src/services/epgProgramMapper.test.ts`
  - `/Users/filip/Documents/Lumen Player/apps/web/src/pages/Player.tsx`
- Acceptance:
  - EPG strings are readable for previously failing channels in test fixtures and manual spot-check.

### QAF-012
- Problem:
  - Desktop player page can vertically scroll as a whole and reveal dead space.
- Scope (small):
  1. Lock page-level vertical scroll on player route where layout should be viewport-contained.
  2. Keep intended scroll areas only (channel/category lists, program sections as designed).
  3. Add regression check for body/page overflow behavior.
- Likely files:
  - `/Users/filip/Documents/Lumen Player/apps/web/src/pages/Player.tsx`
  - `/Users/filip/Documents/Lumen Player/apps/web/src/components/layout/AppShell.tsx`
  - `/Users/filip/Documents/Lumen Player/apps/web/src/index.css`
- Acceptance:
  - Wheel scroll over video area does not move whole page out of viewport on desktop player layout.

### QAF-013
- Problem:
  - Catch-up panel in fullscreen is ambiguous when showing "Nema dostupnih snimaka".
- Scope (small):
  1. Differentiate "no catch-up data" vs "fetch/filter failed" in UI state.
  2. Add clear empty-state copy and optional retry where applicable.
  3. Add targeted diagnostics event for catch-up data source result.
- Likely files:
  - `/Users/filip/Documents/Lumen Player/apps/web/src/pages/Player.tsx`
  - `/Users/filip/Documents/Lumen Player/apps/web/src/services/channelEpg.ts`
- Acceptance:
  - User sees explicit reason-state, not generic ambiguous empty panel.

### QAF-014
- Problem:
  - Returning from Picture-in-Picture often leaves live playback paused until manual Play.
- Scope (small):
  1. Reproduce PiP enter/exit transition in local renderer path.
  2. Ensure live playback state is restored/resumed correctly on PiP exit.
  3. Add focused regression test around PiP state handoff.
- Likely files:
  - `/Users/filip/Documents/Lumen Player/apps/web/src/components/player/VideoPlayer.tsx`
  - `/Users/filip/Documents/Lumen Player/apps/web/src/pages/Player.tsx`
- Acceptance:
  - After PiP exit, live playback resumes automatically without extra Play click.

---

## Execution order suggestion

1. QAF-002  
2. QAF-008  
3. QAF-006  
4. QAF-014  
5. QAF-010  
6. QAF-012  
7. QAF-011  
8. QAF-005  
9. QAF-007  
10. QAF-013  
11. QAF-009

Rationale: after merged baseline fixes (`QAF-001/003/004`), next priority is deterministic episode-live proof and core playback continuity, then control/layout regressions, then diagnostics/scoring clarity, then catch-up/message polish.
