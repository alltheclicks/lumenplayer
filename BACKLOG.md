# Backlog — Lumen Player

> Datum: 12. februar 2026
> Poslednji audit: Opus 4.6 deep codebase analysis
> Vizija: `VISION.md` (V1/V1.5/V2)
> Roadmap alignment: Phase 0A → V1 (Content/Cast/AirPlay/PWA/Perf) → Phase 1 (Dashboard) → Phase 2 (Native)

## Legend

| Status | Meaning |
|--------|---------|
| `idea` | Not yet planned |
| `planned` | Will be worked on next |
| `in-progress` | Currently being worked on |
| `done` | Completed |
| `pending-review` | Old task, needs re-validation with session-centric direction |

---

## Post-V1 QA Stabilization Track (QAF)

> Source: `docs/V2-QA-FIX-BACKLOG.md` and latest local QA report.

| ID | Task | Size | Status | Depends on |
|----|------|------|--------|------------|
| QAF-003 | Dev proxy for Xtream API to eliminate local browser CORS failures | M | done | — |
| QAF-004 | Centralized Xtream base URL resolver + tests | S | done | QAF-003 |
| QAF-001 | Clear on-demand context when switching to `TV Uživo` | M | done | QAF-003, QAF-004 |
| QAF-002 | Deterministic e2e scenario: Series episode -> TV Uživo -> Live shell | S | done | QAF-001 |
| QAF-008 | Harden QA selectors/diagnostics for series detail entry | S | done | QAF-002 |
| QAF-006 | Fix autoplay mode so live channel actually starts playing | M | done | QAF-001 |
| QAF-014 | Restore live playback resume when returning from PiP | S | done | QAF-006 |
| QAF-015 | Fix startup live playback first-frame stall (paused=false UI but video not advancing) | S | done | QAF-006 |
| QAF-016 | Improve live zapping latency (channel switch startup too slow) | S | done | QAF-015 |
| QAF-017 | Restore catch-up (`TV unazad`) section visibility under live player when applicable | S | done | QAF-013 |
| QAF-018 | Fix catch-up false-empty states (regular + fullscreen panel) for channels with known recordings | S | done | QAF-017 |
| QAF-019 | Preserve and restore last watched live channel when returning from VOD/Series | S | done | — |
| QAF-020 | Make live loading spinner overlay non-blocking for essential player controls | S | done | — |
| QAF-021 | Replace `narodna.tv` branding with `Lumen Player` and move cast icon into player-overlay friendly position (desktop/mobile) | S | done | — |
| QAF-022 | Add live status-bar catch-up/timeshift interaction with explicit `UŽIVO` return action (desktop/mobile/tv UX parity) | M | done | — |
| QAF-023 | Improve non-fullscreen catch-up discoverability (clock action should bring focus/scroll to `TV unazad` section) | S | done | — |
| QAF-010 | Fix player control overlay auto-hide behavior on idle | S | done | — |
| QAF-012 | Prevent desktop player page vertical scroll drift/dead-space | S | done | — |
| QAF-011 | Fix EPG gibberish regression in live program blocks | S | done | — |
| QAF-005 | API failure breakdown in QA report by Xtream action | S | done | QAF-003, QAF-004 |
| QAF-007 | Separate critical vs non-critical network failures in QA scoring | S | done | QAF-005 |
| QAF-013 | Clarify catch-up empty-state reason in fullscreen panel | S | done | QAF-005 |
| QAF-009 | Series poster fallback hardening (`onError` placeholder path) | S | done | — |

Completion notes (2026-02-19):
- QAF-003 merged via PR #162.
- QAF-004 merged via PR #163.
- QAF-001 merged via PR #164.
- QAF-002 merged via PR #166.
- QAF-008 merged via PR #167.
- QAF-006 merged via PR #168.
- QAF-014 merged via PR #171.
- QAF-010 merged via PR #172.
- QAF-012 merged via PR #173.
- QAF-011 merged via PR #175 (Greptile `5/5`).
- QAF-005 merged via PR #176 (Greptile `5/5`).
- QAF-007 merged via PR #177 after follow-up remediation commit; Greptile final `5/5` on latest head.
- QAF-013 merged via PR #178 after follow-up remediation commit; Greptile final `5/5` on latest head.
- QAF-009 merged via PR #180 (Greptile `5/5`).
- QAF-015 merged via PR #184 (Greptile `4/5`; documented no-blocker exception with green local + CI gates).
- QAF-016 merged via PR #185 (Greptile `5/5`).
- QAF-017 merged via PR #186 (Greptile `5/5`).
- QAF-018 merged via PR #188 (Greptile `5/5`).
- QAF-019 merged via PR #189 (Greptile `5/5` after follow-up remediation commit).
- QAF-020 merged via PR #190 (Greptile `5/5`).
- QAF-021 merged via PR #192 (Greptile final `5/5` after follow-up remediation commit).
- QAF-022 merged via PR #193 (Greptile `5/5`).
- QAF-023 merged via PR #194 (Greptile `5/5`).
- Manual intake triage (`BUG-20260219-01..06`) converted into `QAF-010..QAF-014` follow-up tasks in `docs/V2-QA-FIX-BACKLOG.md`.
- Follow-up intake tasks (`BUG-20260220-01..03`) are now closed through `QAF-015..QAF-017`.
- Follow-up intake tasks (`BUG-20260220-04..07`) are now closed through `QAF-018..QAF-020`.
- Follow-up intake tasks (`BUG-20260220-08..10`) are now closed through `QAF-021..QAF-023`.
- QA gate rerun command (`E2E_XUI_USERNAME='fica' E2E_XUI_PASSWORD='fF2024BG2025' ./run-qa-simulation.sh`) currently exits with Playwright loader conflict (`Requiring @playwright/test second time`) in local `.codex/worktrees/QA-GATE` context; needs QA tooling follow-up before using this report as pass/fail signal.

---

## Phase 0A — Session MVP

### Step 1: Session package (greenfield, ne dira apps/web)

| ID | Task | Size | Status | Depends on |
|----|------|------|--------|------------|
| LP-0101 | Create `@lumen/session-core` package scaffold (package.json, tsconfig, src/index.ts, exports) | S | done | — |
| LP-0102 | Define `SessionState` type + all command types (`SetSource`, `Play`, `Pause`, `Seek`, `SwitchRenderer`, `Stop`) + all event types (`SessionUpdated`, `RendererChanged`, `PlaybackStateChanged`, `Error`) | S | done | LP-0101 |
| LP-0103 | Implement `SessionStore`: command dispatch, event emission, BroadcastChannel sync, localStorage persistence, reconnect on reload | M | done | LP-0102 |

### Step 2: Wire session into apps/web (refactor god component)

> LP-0104 je razbijen na pod-taskove jer je bio prevelik.
> Player.tsx = 465 linija, 10 useState, PlayerControls = 760 linija, 14 props + 7 callbacks.

| ID | Task | Size | Status | Depends on |
|----|------|------|--------|------------|
| LP-0104a | Create `useSession()` hook — subscribes to `SessionStore`, returns reactive `SessionState` | S | done | LP-0103 |
| LP-0104b | Create `useSessionCommands()` hook — returns typed dispatch functions (play, pause, setSource, seek, stop) | S | done | LP-0103 |
| LP-0104c | Create `SessionProvider` context — initializes `SessionStore`, provides session + commands to component tree | S | done | LP-0104a, LP-0104b |
| LP-0104d | Refactor Player.tsx — remove `currentChannel`, `isPlaying`, `catchUpProgram`, `catchUpPosition`, `progress` state; read from session instead; dispatch commands instead of local setState | M | done | LP-0104c |
| LP-0104e | Refactor PlayerControls.tsx — remove 14 props / 7 callbacks pattern; read from session context; dispatch commands directly | M | done | LP-0104d |
| LP-0104f | Refactor VideoPlayer.tsx — make it a pure session renderer (subscribes to session source + playback state, reports position back to session) | M | done | LP-0104d |
| LP-0105 | Add reconnect/resume behavior on app reload (session survives refresh) | S | done | LP-0103 |
| LP-0112 | Add idempotency tests for session commands | S | done | LP-0103 |

### Step 3: Renderer abstraction (after session works locally)

| ID | Task | Size | Status | Depends on |
|----|------|------|--------|------------|
| LP-0106 | Add `RendererAdapter` interface (local/cast/airplay abstraction) | M | done | LP-0104f |

---

## Phase 0A-cleanup — Wire existing packages + fix bugs

> Ovi taskovi mogu ici PARALELNO sa Phase 0A Step 2, ili NAKON njega.
> Analiza je otkrila da 3 cela paketa nisu povezana sa web app-om,
> i da postoje duplikati koda + 2 buga.

### Bugfixes (otkriveni u auditu)

| ID | Task | Size | Status | Depends on |
|----|------|------|--------|------------|
| LP-0201 | FIX: Volume/mute controls are cosmetic — `PlayerControls` updates local state but never calls `playerRef.setVolume()` / `toggleMute()`. Sound does not actually change. | S | done | — |
| LP-0202 | FIX: Catch-up seek is cosmetic — `catchUpPosition` updates progress bar UI but never calls `playerRef.seek()`. Seeking does nothing. | S | done | — |

### Remove duplicate code (apps/web has inline copies of package code)

| ID | Task | Size | Status | Depends on |
|----|------|------|--------|------------|
| LP-0203 | Replace `useFavorites.ts` inline implementation with `@lumen/storage` functions (loadFavorites, saveFavorites, toggleFavorite, etc.) | S | done | — |
| LP-0204 | Replace inline channel mappers in `useXtreamChannels.ts` (lines 59-85) with `@lumen/api` mapXtreamCategory/mapXtreamChannel | S | done | — |
| LP-0205 | Replace inline `formatDuration` in `PlayerControls.tsx` with `@lumen/core` formatDuration | S | done | — |
| LP-0206 | Replace inline channel filtering in `Player.tsx` with `@lumen/core` filterChannels/sortChannels | S | done | — |

### Wire unwired packages

| ID | Task | Size | Status | Depends on |
|----|------|------|--------|------------|
| LP-0007 | Integrate `SeekEngine` (`@lumen/player-core`) into player — exponential seek (5x→640x) on long-press/hold | M | done | LP-0104f |
| LP-0008 | Integrate `NumericChannelInput` (`@lumen/input`) — digit accumulation for channel zapping | S | done | LP-0104d |
| LP-0009 | Integrate `IdleTimer` (`@lumen/player-core`) into controls — auto-hide with grace period | S | done | LP-0104e |
| LP-0012 | Implement `HlsPlayerAdapter` — wrap HLS.js behind `PlayerAdapter` interface from `@lumen/types` | M | done | LP-0104f |
| LP-0207 | Wire `WebKeyCodes` from `@lumen/input` for keyboard navigation (arrows, space, etc.) | S | done | LP-0104d |
| LP-0208 | Wire `WatchHistoryStorage` from `@lumen/storage` — track what user watched | S | done | LP-0104d |
| LP-0209 | Wire `WebStorageAdapter` + `VersionedStorage` from `@lumen/storage` — replace raw localStorage usage in `apps/web` hooks/services | S | done | LP-0203 |

### Remove migration shims (after all above done)

| ID | Task | Size | Status | Depends on |
|----|------|------|--------|------------|
| LP-0210 | Remove re-export shims (`src/data/channels.ts`, `src/services/xtreamCodes.ts`, `src/types/channel.ts`, `src/types/player.ts`) — import from packages directly | S | done | LP-0203, LP-0204, LP-0206 |

---

## V1-Content — Xtream kompletnost, M3U, VOD, Series, Performanse

### Xtream API kompletnost

| ID | Task | Size | Status | Depends on |
|----|------|------|--------|------------|
| LP-0301 | Add `get_vod_info` endpoint to XtreamCodesService (movie details, TMDB ID) | S | done | — |
| LP-0302 | Add `get_series_info` endpoint to XtreamCodesService (seasons, episodes) | S | done | — |
| LP-0303 | Add series episode stream URL builder | S | done | LP-0302 |
| LP-0304 | Add XMLTV EPG endpoint (bulk EPG download) | S | done | — |

### M3U podrška

| ID | Task | Size | Status | Depends on |
|----|------|------|--------|------------|
| LP-0305 | Create M3U parser package (`@lumen/m3u` or in `@lumen/api`) — parse .m3u/.m3u8 files to Channel[] | M | done | — |
| LP-0306 | M3U playlist import UI (URL paste + file upload) | M | done | LP-0305 |
| LP-0307 | Unified channel model — ensure Xtream + M3U sources map to same Channel type | S | done | LP-0305 |

### VOD UI

| ID | Task | Size | Status | Depends on |
|----|------|------|--------|------------|
| LP-0308 | VOD categories page (grid layout, posters) | M | done | LP-0301 |
| LP-0309 | VOD film detail page (poster, description, cast, TMDB metadata) | M | done | LP-0301 |
| LP-0310 | VOD player (uses session for playback) | M | done | LP-0103, LP-0309 |

### Series UI

| ID | Task | Size | Status | Depends on |
|----|------|------|--------|------------|
| LP-0311 | Series list + categories page | M | done | LP-0302 |
| LP-0312 | Series detail page (seasons, episodes, metadata) | M | done | LP-0302 |
| LP-0313 | Episode player (uses session for playback) | M | done | LP-0103, LP-0312 |

### Performanse velikih listi

| ID | Task | Size | Status | Depends on |
|----|------|------|--------|------------|
| LP-0314 | Virtualize channel list with @tanstack/react-virtual | M | done | — |
| LP-0315 | Debounce search input | S | done | — |
| LP-0316 | Paginate/lazy-load API calls for categories | M | done | — |
| LP-0317 | EPG lazy loading (load per-channel, not all at once) | M | done | — |

### EPG

| ID | Task | Size | Status | Depends on |
|----|------|------|--------|------------|
| LP-0318 | EPG grid view (TV guide style, horizontal timeline) | L | done | — |
| LP-0319 | XMLTV bulk EPG import + caching | M | done | LP-0304 |

### UI features

| ID | Task | Size | Status | Depends on |
|----|------|------|--------|------------|
| LP-0320 | Settings page (theme, language, player preferences) | M | done | — |
| LP-0321 | Multi-audio track selection in player | S | done | LP-0012 |
| LP-0322 | Subtitle track selection in player | S | done | LP-0012 |
| LP-0323 | Picture-in-Picture support | S | done | — |

---

## V1-Cast — Cast (part of V1)

| ID | Task | Size | Status | Depends on |
|----|------|------|--------|------------|
| LP-0107 | Implement Google Cast sender flow in web app | M | done | LP-0106 |
| LP-0108 | Implement Cast receiver app (HTML + dual-video player bridge) at `cast.lumenplayer.com` | M | done | LP-0106 |
| LP-0109 | Add `switchRenderer(local <-> cast)` without session reset | M | done | LP-0107, LP-0108 |
| LP-0110 | Add phone-as-remote UI mode when renderer is remote | S | done | LP-0109 |

---

## V1-AirPlay — AirPlay (part of V1)

| ID | Task | Size | Status | Depends on |
|----|------|------|--------|------------|
| LP-0111 | Add AirPlay control flow (secondary renderer) | M | done | LP-0106 |

---

## V1-PWA — PWA Production Readiness (part of V1)

| ID | Task | Size | Status | Depends on |
|----|------|------|--------|------------|
| LP-0010 | PWA install UI — wire existing `usePWA` hook, add install prompt + button | S | done | — |
| LP-0324 | PWA offline fallback page | S | done | — |
| LP-0325 | PWA app icon + splash screen assets | S | done | — |
| LP-0011 | Code-splitting: lazy load Player page | S | done | — |
| LP-0330 | Web Push compatibility spike — verify iOS Home Screen PWA flow (iOS/iPadOS 16.4+), Android browser matrix, and unsupported TV browser behavior | S | done | LP-0010 |
| LP-0331 | Add push opt-in UX (pre-permission screen + user-gesture prompt) with explicit unsupported-device fallback copy | S | done | LP-0330 |
| LP-0332 | Persist push subscriptions in backend (subscribe/unsubscribe endpoints, per-user/per-device mapping) | M | done | LP-1502 |
| LP-0333 | Implement web push sender service (VAPID keys, queue/retry, delivery logging) | M | done | LP-0332 |
| LP-0334 | Add service worker push handlers (`push`, `notificationclick`) + deep-link routing into player/dashboard | S | done | LP-0331, LP-0333 |

---

## V1-Perf — Performance Acceptance (part of V1)

| ID | Task | Size | Status | Depends on |
|----|------|------|--------|------------|
| LP-0326 | Create benchmark dataset generator — 20k channels + 50k EPG entries (extend @lumen/demo-data) | M | done | — |
| LP-0327 | Performance test: time-to-first-channel < 3s with 20k channel dataset | S | done | LP-0326, LP-0314 |
| LP-0328 | Performance test: memory cap < 200MB RSS with 20k channel dataset | S | done | LP-0326, LP-0314 |
| LP-0329 | Profile + optimize Cast receiver on older devices (Samsung 2019–2020 target) | M | done | LP-0108 |

---

## V1-Release — Quality Gates (part of V1)

| ID | Task | Size | Status | Depends on |
|----|------|------|--------|------------|
| LP-0340 | Define V1 go/no-go checklist (release sign-off template with explicit pass/fail criteria per feature area) | S | done | — |
| LP-0341 | Build V1 smoke/regression test matrix (desktop + mobile browsers, Cast flow, AirPlay flow, PWA install/offline) | M | done | LP-0109, LP-0111, LP-0324 |
| LP-0342 | Add V1 compatibility matrix execution task (run and record results on target devices/browsers before release) | S | done | LP-0341 |
| LP-0343 | Produce performance evidence artifact in `docs/perf/` (20k dataset results: p95/p99 startup, memory, failure rate) | S | done | LP-0326, LP-0327, LP-0328 |
| LP-0344 | Add production observability baseline for web + cast receiver (error logging, key playback/cast events, alert thresholds) | M | done | LP-0108, LP-0109 |
| LP-0345 | Security/privacy baseline review for credential + storage handling (client storage policy, retention, incident notes) | S | done | LP-0209, LP-0211 |
| LP-0346 | Final release readiness review (all V1 gates green, blocker triage complete, rollback notes prepared) | S | done | LP-0340, LP-0342, LP-0343, LP-0344, LP-0345 |

Completion notes (2026-02-16):
- LP-0340 delivered typed checklist model + tests (`scripts/release/v1-go-no-go.ts`, `scripts/release/v1-go-no-go.test.ts`) in PR #103.
- LP-0341 delivered stricter smoke/regression coverage enforcement + matrix tests in PR #104.
- LP-0342 delivered target-aware compatibility execution (`--targets`, per-target status, `matchMode any/all`, tests) in PR #105.
- LP-0343 delivered performance evidence artifact gate (`scripts/release/v1-performance-evidence.template.json`, validator + tests) in PR #107.
- LP-0344 delivered production observability baseline (web + cast receiver event/error logging + threshold alerts) in PR #108.
- LP-0345 delivered security/privacy baseline gate (`scripts/release/v1-security-privacy-baseline.template.json`, validator + tests) in PR #109.
- LP-0346 delivered final release readiness review gate (`scripts/release/v1-release-readiness-review.template.json`, validator + tests) in PR #111.
- Post-LP-0346 immediate execution focus: run the V1 real-device validation cycle (smoke/regression, compatibility matrix, perf/security evidence) before starting new feature-track tasks.

---

## V1-UI — Alignment Hardening (part of V1)

| ID | Task | Size | Status | Depends on |
|----|------|------|--------|------------|
| LP-0350 | Restore dark-first visual token baseline to match `player-standalone` parity (`:root` theme tokens, first-paint shell mood) | S | done | LP-0346 |
| LP-0351 | Introduce persistent player shell layout across `/player`, `/vod`, `/series`, `/epg`, `/settings` so desktop/mobile navigation context remains stable | L | done | LP-0346 |
| LP-0352 | Align VOD/Series flow to in-shell playback context (no channel-shell context loss; deterministic back behavior to previous media context) | M | done | LP-0351 |
| LP-0353 | Tune channel list UI parity with virtualization retained (row density, selected state, scroll rhythm, favorites affordance) | S | done | LP-0351 |
| LP-0354 | Visual baseline parity pass vs `player-standalone` reference (tokens, typography scale, spacing rhythm, sidebar/header hierarchy) with desktop+mobile before/after evidence | M | done | LP-0353 |
| LP-0355 | Navigation discoverability parity after login (explicit Movies/Series/Catch-up entry points in shell, desktop+mobile) with acceptance checklist linked to `TST-006` | M | done | LP-0351, LP-0354 |
| LP-0356 | Player surface parity pass (control-bar structure, current-program block, CTA grouping, loading/error/idle states) against reference UX | M | done | LP-0354 |
| LP-0357 | VOD/Series UI parity pass (catalog density, card rhythm, detail layout, predictable back context) with desktop+mobile screenshot diff evidence | M | done | LP-0352, LP-0354 |
| LP-0358 | EPG readability + presentation parity pass (decode/normalize malformed strings, align program rendering in player + EPG page) tied to `TST-008` closure | M | done | LP-0354 |
| LP-0359 | Add explicit live channel startup mode setting (`autoplay on select` vs `select then play`) and enforce deterministic behavior in player flow (linked to `TST-007`) | S | done | LP-0351 |
| LP-0360 | Add short-EPG request resilience for active browsing (in-flight dedupe, cache, pacing, 429 retry/backoff, stale-cache fallback) tied to `TST-009` | M | done | LP-0351, LP-0358 |

Completion notes (2026-02-17, 2026-02-18):
- LP-0350 delivered dark-first token baseline + first-paint shell bootstrap in PR #124; Greptile final confidence score `5/5`.
- LP-0351 delivered persistent AppShell route layout + unified desktop/mobile nav shell in PR #125.
- LP-0351 Greptile check-run started, but final confidence score was not returned after 2 pings (`@greptile-apps`, `@greptileai`); fallback note was posted on PR #125.
- LP-0352 delivered deterministic in-shell on-demand return context (`backPath` metadata + season/episode URL sync) in PR #127; Greptile final confidence score `5/5`.
- LP-0353 delivered channel list parity tuning with virtualization retained (denser rows, stronger selected state, auto-scroll rhythm, direct favorites toggle) in PR #128.
- LP-0353 Greptile review started, but final confidence score was not returned on latest head after 2 pings (`@greptileai`, `@greptile-apps`); fallback PR note was posted before merge.
- LP-0354 delivered visual baseline parity updates for shell typography/spacing hierarchy and nav structure in PR #136.
- LP-0354 Greptile review started, but final confidence score was not returned on latest head after 2 pings (`@greptile-apps`, `@greptileai`); fallback PR note was posted before merge.
- LP-0355 delivered explicit Movies/Series/Catch-up discoverability actions in player shell contexts (desktop + mobile) in PR #130; Greptile final confidence score `5/5`.
- LP-0356 delivered player surface parity pass (grouped control-bar clusters + loading/error/idle CTA surfaces) in PR #137; Greptile final confidence score `5/5`.
- LP-0357 delivered VOD/Series parity pass (denser catalogs, detail surface tuning, deterministic back context via `back` query path) in PR #138.
- LP-0357 Greptile review started, but final confidence score was not returned on latest head after 2 pings (`@greptile-apps`, `@greptileai`); fallback PR note was posted before merge.
- LP-0359 delivered explicit live-channel startup mode setting and deterministic startup behavior in PR #131; Greptile review started but final confidence score was not returned on latest head after 2 pings (`@greptile-apps`, `@greptileai`); fallback PR note was posted before merge.
- LP-0358 delivered shared EPG text normalization across player-inline, EPG route fallback, and XMLTV parsing in PR #133; Greptile review started but final confidence score was not returned on latest head after 2 pings (`@greptile-apps`, `@greptileai`); fallback PR note was posted before merge.
- LP-0360 delivered short-EPG rate-limit resilience (cache + in-flight dedupe + pacing + 429 retry/backoff + stale fallback) in PR #134; Greptile review started but final confidence score was not returned on latest head after 2 pings (`@greptile-apps`, `@greptileai`); fallback PR note was posted before merge.

---

## V1-UI — Balkan Stream Design Parity (mandatory before V1 sign-off)

> Added later (2026-02-17): full visual alignment target with Narodna TV/Balkan Stream design system.
>
> Source-of-truth: `/Users/filip/Documents/narodna.tv/balkan-stream` (not `player-standalone`).
>
> Acceptance spec: `docs/DESIGN-PARITY-BALKAN-STREAM.md`.

| ID | Task | Size | Status | Depends on |
|----|------|------|--------|------------|
| LP-0361 | Lock design reference baseline: define and freeze Balkan Stream parity target (desktop/mobile screenshots + key UI contracts) in repo docs so all follow-up UI work validates against same source | S | done | LP-0360 |
| LP-0362 | Global design token parity pass: align `apps/web/src/index.css` with Balkan Stream tokens/utilities (`--sidebar-*`, badge styles, starlight borders, gradients), remove non-reference shell mood effects | M | done | LP-0361 |
| LP-0363 | Remove/reshape Lumen-specific shell chrome on non-player routes so routed screens visually match Balkan Stream app style (no divergent icon-rail/header look) | M | done | LP-0362 |
| LP-0364 | Rebuild `/player` desktop layout to Balkan Stream 3-pane structure (left category rail, middle channel panel, right media+EPG surface) with matching spacing, sizing, and hierarchy | L | done | LP-0362 |
| LP-0365 | Category rail parity pass in player (active/inactive states, counters, VOD CTA styling, account/info block, bottom actions) to match Balkan Stream behavior and visuals | M | done | LP-0364 |
| LP-0366 | Channel list visual parity pass (`ChannelList`): row density, typography, selected row treatment, favorites affordance, logo slot rhythm aligned with Balkan Stream | M | done | LP-0364 |
| LP-0367 | Video surface + control overlay parity pass (`VideoPlayer` + `PlayerControls`): overlay gradients, control clusters, info stack, fullscreen behavior, and error/loading/idle presentation | L | done | LP-0364 |
| LP-0368 | EPG presentation parity pass in player: "Sada na programu", "Sledi", "TV Unazad" section styling/accordion rhythm/CTA treatment aligned to Balkan Stream | M | done | LP-0364 |
| LP-0369 | Mobile player parity pass: quick actions, sheet behavior, sticky/nav zones, and responsive spacing aligned with Balkan Stream mobile UX | M | done | LP-0367 |
| LP-0370 | Login screen parity pass: copy, spacing, iconography, server status strip, password visibility UX, and alert/toast presentation aligned to Balkan Stream | S | done | LP-0362 |
| LP-0371 | Movies page parity pass (`/vod`): sticky header, category pills, card grid rhythm, navigation treatment, and mobile bottom navigation aligned to Balkan Stream Movies | M | done | LP-0363 |
| LP-0372 | Series page parity pass (`/series`): parity equivalent of Movies page for Series list/detail entry flow and responsive layout | M | done | LP-0363 |
| LP-0373 | Design quality gate before V1 sign-off: produce desktop+mobile before/after parity evidence for login/player/movies/series/epg and block V1 completion unless parity review is accepted | S | done | LP-0365, LP-0366, LP-0367, LP-0368, LP-0369, LP-0370, LP-0371, LP-0372 |

Completion notes (2026-02-17):
- LP-0361 delivered canonical Balkan Stream parity spec + frozen baseline screenshots/manifest in PR #142; Greptile final confidence score `5/5`.
- LP-0362 delivered global token/utilities parity pass in PR #143; after 2 pings (`@greptile-apps`, `@greptileai`) fallback PR note was posted before merge, then Greptile returned delayed final confidence score `4/5` on latest head (non-blocking remarks: missing Tailwind token mappings for new semantic tokens and partial utility layer organization outside `@layer`).
- LP-0363 delivered non-player shell chrome reshape (removed divergent icon rail/header, aligned mobile bottom nav treatment) in PR #144; Greptile final confidence score `5/5`.
- LP-0364 delivered `/player` desktop 3-pane rebuild (category rail + channel panel + media/EPG surface) in PR #145; Greptile final confidence score `5/5`.
- LP-0365 delivered player category rail parity pass (active/inactive states, counters, VOD CTA cards, account/info parity block, bottom actions) in PR #147; Greptile review started but final confidence score was not returned on latest head after 2 pings (`@greptile-apps`, `@greptileai`); fallback PR note was posted before merge.
- LP-0366 delivered `ChannelList` visual parity pass (row rhythm, typography, active row treatment, heart favorites affordance, logo slot cadence) in PR #148; Greptile review started but final confidence score was not returned on latest head after 2 pings (`@greptile-apps`, `@greptileai`); fallback PR note was posted before merge.
- LP-0367 delivered video surface/control overlay parity pass in PR #150; Greptile review started but final confidence score was not returned on latest head after 2 pings (`@greptile-apps`, `@greptileai`); fallback PR note was posted before merge.
- LP-0368 delivered player EPG presentation parity pass ("Sada na programu", "Sledi", "TV Unazad") in PR #151; Greptile review started but final confidence score was not returned on latest head after 2 pings (`@greptile-apps`, `@greptileai`); fallback PR note was posted before merge.
- LP-0369 delivered mobile player parity pass (quick actions, mobile header/zones, integrated channel discoverability rhythm) in PR #152; Greptile review started but final confidence score was not returned on latest head after 2 pings (`@greptile-apps`, `@greptileai`); fallback PR note was posted before merge.
- LP-0370 delivered login parity pass (copy/iconography/server strip/password visibility/toast flow) in PR #153; Greptile review started but final confidence score was not returned on latest head after 2 pings (`@greptile-apps`, `@greptileai`); fallback PR note was posted before merge.
- LP-0371 delivered `/vod` parity pass (sticky header/filter pills, Serbian movie catalog/card rhythm, route-owned mobile nav treatment) in PR #156; Greptile review started but final confidence score was not returned on latest head after 2 pings (`@greptile-apps`, `@greptileai`); fallback PR note was posted before merge.
- LP-0372 delivered `/series` parity pass (sticky header/filter pills, Serbian series catalog/card rhythm, route-owned mobile nav treatment) in PR #157; Greptile review started but final confidence score was not returned on latest head after 2 pings (`@greptile-apps`, `@greptileai`); fallback PR note was posted before merge.
- LP-0373 delivered V1 design parity quality gate in PR #158 via `scripts/release/v1-design-parity-evidence.template.json`, `scripts/release/validate-design-parity-evidence.mjs`, and release-readiness required-gate wiring; Greptile review started but final confidence score was not returned on latest head after 2 pings (`@greptile-apps`, `@greptileai`); fallback PR note was posted before merge.

---

## Foundation / Quality

| ID | Task | Size | Status | Depends on |
|----|------|------|--------|------------|
| LP-0001 | Monorepo scaffolding (Turborepo + pnpm + packages) | M | done | — |
| LP-0003 | Add unit tests for `@lumen/core` (epg, time, channels) | S | done | — |
| LP-0004 | Add unit tests for `@lumen/player-core` (SeekEngine, IdleTimer) | S | idea | — |
| LP-0005 | Add unit tests for `@lumen/input` (NumericChannelInput) | S | idea | — |
| LP-0006 | Add unit tests for `@lumen/storage` (favorites, credentials, watch-history) | S | idea | — |
| LP-0014 | Add ESLint flat config (`eslint.config.*`) for repo/app | S | done | — |
| LP-0015 | CI pipeline: typecheck + lint + build | S | done | — |
| LP-0211 | FIX: `VersionedStorage.clear()` must clear only namespaced keys (not entire storage) | S | done | — |
| LP-0013 | Replace demo-data import guard so it doesn't enter production bundle | S | idea | — |

Completion notes (2026-02-17):
- LP-0003 delivered focused unit coverage for `@lumen/core` channel/EPG/time helpers in PR #139; Greptile final confidence score `5/5`.

---

## Intake — Untriaged Ideas

Use this section for quick idea capture before formal planning.

ID format:
- `IDEA-YYYYMMDD-XX` (example: `IDEA-20260219-01`)

Template:

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

---

## Phase 1 — Dashboard + Device Management (idea)

| ID | Task | Size | Status | Depends on |
|----|------|------|--------|------------|
| LP-1501 | Dashboard app scaffold (apps/dashboard or separate repo) | M | idea | — |
| LP-1502 | User registration + auth (email-based) | M | idea | LP-1501 |
| LP-1503 | Device pairing flow — code generation (ABC-123 format), display on TV, enter in dashboard | L | idea | LP-1502 |
| LP-1504 | Xtream/M3U credential management per device in dashboard | M | idea | LP-1503 |
| LP-1505 | Provider accounts — multi-device management, bulk provisioning | L | idea | LP-1502 |
| LP-1506 | Payment integration — free vs paid tier logic | L | idea | LP-1502 |
| LP-1507 | Data-plane spike in dashboard backend: Xtream/M3U/EPG proxy + cache feasibility, tenant isolation, and cost model | M | idea | LP-1504 |
| LP-1508 | Implement optional ingest/cache middleware in dashboard backend (feature-flagged, non-blocking for direct mode) | L | idea | LP-1507 |
| LP-1509 | Add parser/normalization pipeline for large Xtream payloads (channels, VOD, series, EPG) with incremental refresh | L | idea | LP-1508 |
| LP-1510 | Define middleware activation criteria + SLO gates (enable when direct mode exceeds latency/memory/error thresholds) | S | idea | LP-1507, LP-0327, LP-0328 |

---

## Phase 2 — Native TV + Mobile Apps (idea)

### TV

| ID | Task | Size | Status | Depends on |
|----|------|------|--------|------------|
| LP-2001 | apps/tv-web Tizen/WebOS project setup | M | pending-review | LP-0104f |
| LP-2002 | TizenPlayerAdapter (AVPlay API) | L | pending-review | LP-0012 |
| LP-2003 | Spatial navigation system for TV | L | pending-review | — |
| LP-2004 | apps/android-tv project setup | L | pending-review | — |
| LP-2005 | Fire TV app setup (Android TV variant) | L | idea | LP-2004 |
| LP-2006 | Apple TV app setup (tvOS) | L | idea | — |

### Mobile

| ID | Task | Size | Status | Depends on |
|----|------|------|--------|------------|
| LP-2008 | Decision: Expo vs Capacitor for mobile wrapper | S | idea | — |
| LP-2009 | iOS mobile app setup (App Store) | L | idea | LP-2008 |
| LP-2010 | Android mobile app setup (Play Store) | L | idea | LP-2008 |
| LP-2011 | iOS lock-screen controls (MPRemoteCommandCenter) | M | idea | LP-2009 |
| LP-2012 | Android MediaSession API integration (lock screen + notification) | M | idea | LP-2010 |

### Infrastruktura

| ID | Task | Size | Status | Depends on |
|----|------|------|--------|------------|
| LP-2007 | Device licensing system — code-based identification (not MAC) | L | idea | LP-1503 |
| LP-2013 | White-label build pipeline (custom branding, domains, store listings) | L | idea | LP-2007 |

---

## Audit notes (2026-02-12)

### Key findings from deep codebase analysis:

1. **Player.tsx je "god component"** — 465 linija, 10 useState, sav playback state je lokalan
2. **PlayerControls.tsx** — 760 linija, prima 14 props i vraca 7 callbacks (props drilling)
3. **3 cela paketa nepovezana**: `@lumen/player-core`, `@lumen/input`, vecina `@lumen/storage`
4. **Duplirani kod**: favorites, channel mappers, formatDuration, channel filtering — postoji i u paketu i inline u apps/web
5. **2 buga**: volume kontrole ne rade (kozmeticke), catch-up seek ne radi (kozmeticki)
6. **`usePWA` hook postoji ali se nigde ne koristi** — nema install UI
7. **`useToast` wired ali niko ne poziva toast()** — Toaster renderuje ali nema poziva
8. **Nema React Context-a** — sve ide kroz props, session refactor uvodi prvi context
9. **`@lumen/session-core` paket NE POSTOJI** — samo je planiran

### Sync notes (2026-02-12)

- `LP-0014` zavrsen: dodat je root `eslint.config.mjs`, package-level lint skripte i pun workspace lint gate.
- `LP-0209` je završen u kasnijoj sesiji kroz app-level `VersionedStorage` wiring (`apps/web` hooks/services).

### Sync notes (2026-02-16)

- `LP-0340` zavrsen i mergovan kroz PR #98.
- `LP-0341` zavrsen i mergovan kroz PR #99.
- `LP-0342` zavrsen i mergovan kroz PR #100.
- `LP-0346` zavrsen i mergovan kroz PR #111.
- Greptile je za #98/#99/#100 pokrenuo review check-run i validni komentari su zatvoreni, ali finalna confidence ocena nije vracena ni posle pingova; ovo je evidentirano u PR komentarima.
- Za #111 svi obavezni lokalni checkovi su prosli (`pnpm lint`, `pnpm typecheck`, `pnpm build`) kao i task-specific checkovi (`pnpm release:readiness:validate`, `pnpm release:readiness:test`).
- Greptile je na #111 kasnio sa finalnim odgovorom; nakon 2 pinga i obaveznog PR komentara naknadno je vracena finalna confidence ocena `5/5`.
