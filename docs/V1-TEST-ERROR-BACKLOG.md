# V1 Test + Error Backlog

Purpose: central QA bug/task log for V1 validation.  
This file is the single source of truth for issues found during manual testing.

## Status legend

| Status | Meaning |
|---|---|
| `open` | Reported, not yet assigned |
| `triaged` | Severity/impact confirmed, root-cause hypothesis added |
| `in-progress` | Fix is being implemented |
| `pending-review` | PR opened, waiting checks/review |
| `done` | Fix merged and verified in retest |
| `won't-fix-v1` | Deferred outside V1 scope |

## Severity legend

| Severity | Meaning |
|---|---|
| `P0` | Release blocker (core flow broken) |
| `P1` | Major regression (important flow degraded) |
| `P2` | Medium impact (workaround exists) |
| `P3` | Minor/cosmetic |

## Workflow (for Codex agents + Greptile)

1. Add each new issue here as a separate item (never merge multiple bugs into one row unless same root cause is proven).
2. Assign severity (`P0-P3`) and status (`open` -> `triaged`).
3. Create one fix task branch/PR per issue or per tightly related issue group.
4. Run local checks (`pnpm lint`, `pnpm typecheck`, `pnpm build`, relevant tests).
5. Request Greptile review, resolve valid comments, update item status to `pending-review`.
6. After merge and retest, set item to `done` and append PR reference.

## Active issues

| ID | Title | Area | Severity | Status | Reproducibility |
|---|---|---|---|---|---|
| TST-001 | Live channel starts with first frame only; playback does not continue reliably and audio is missing | Live TV Playback | P0 | done | frequent |
| TST-002 | Channel switch triggers `Playback error` overlay while frame is visible in background | Live TV Playback | P0 | done | frequent |
| TST-003 | VOD `Play in Player` enters play/pause loop, stutter, and no audio | VOD Playback | P0 | done | frequent |
| TST-004 | VOD catalog appears truncated (not all items visible) | VOD Listing | P2 | done | frequent |
| TST-005 | After VOD playback entry, UX returns to channel-shell context and feels inconsistent/confusing | Navigation UX | P2 | done | frequent |
| TST-006 | Post-login player shell lacked clear Movies/Series/Catch-up discoverability in primary navigation context | Navigation UX | P1 | done | frequent |
| TST-007 | Live channel startup mode was not explicit/deterministic (`autoplay on select` vs `select then play`) | Live TV Playback | P1 | done | frequent |
| TST-008 | EPG text/metadata showed malformed/random strings instead of readable program fields | EPG Rendering | P1 | done | frequent |
| TST-009 | Active browsing/channel switching flow intermittently triggered `429 Too Many Requests` | API/Rate Limit Resilience | P1 | done | intermittent |

---

## Issue details

### TST-001
- Reported by: Filip (manual test)
- Environment: localhost web app after successful login (Xtream credentials)
- Steps:
  1. Open Channels view.
  2. Select a live channel.
  3. Playback shows first frame, requires extra play interaction, audio missing.
- Expected: channel starts smoothly with audio on first normal play interaction.
- Actual: first frame appears but playback/audio state is broken.
- Initial hypothesis:
  - Playback/session sync race around initial load/play state.
  - Audio track init/mute state mismatch in adapter/session bridge.
- Suggested fix scope:
  - Inspect `VideoPlayer` state sync and `HlsPlayerAdapter` play/audio init path.
  - Add guardrails for initial play transition and error-state reset behavior.
- Retest acceptance:
  - First selected live channel starts within normal startup window.
  - Audio present on startup.
  - No manual extra play toggle needed in normal flow.
- Fix PR: [#113](https://github.com/alltheclicks/lumenplayer/pull/113)
- Retest result (2026-02-16): PASS on local flow; first live channel starts without extra play toggle and audio is present on startup.

### TST-002
- Reported by: Filip (manual test, example channel switch to HRT1)
- Environment: Channels view while switching among live streams
- Steps:
  1. Start one live channel.
  2. Switch to another channel.
  3. Observe playback error overlay while background frame is visible.
- Expected: channel switch transitions to stable playback without blocking overlay if stream is playable.
- Actual: blocking playback error overlay remains while frame exists.
- Initial hypothesis:
  - Error overlay not cleared/reset correctly on source change.
  - Adapter emits start failure while video already has decoded frame.
- Suggested fix scope:
  - Reset player error state deterministically on every source switch.
  - Tighten failure criteria to avoid false-positive fatal overlay.
- Retest acceptance:
  - Repeated channel switching does not leave stale blocking error overlays.
  - If source is playable, overlay must disappear and playback continues.
- Fix PR: [#115](https://github.com/alltheclicks/lumenplayer/pull/115)
- Retest result (2026-02-16): PASS on local flow; repeated live channel switches no longer keep stale `Playback error` overlay when stream recovers/continues playback.

### TST-003
- Reported by: Filip (manual VOD flow)
- Environment: VOD list -> detail -> `Play in Player`
- Steps:
  1. Open VOD, select item, click `Play in Player`.
  2. Playback enters repeated play/pause behavior with stutter and missing audio.
- Expected: VOD starts once, stable playback, audio present.
- Actual: oscillating play/pause behavior, degraded performance, no audio.
- Initial hypothesis:
  - Session command loop between UI state and adapter playback state.
  - Duplicate media load/sync cycle triggers contradictory commands.
- Suggested fix scope:
  - De-duplicate playback state transitions during VOD handoff.
  - Add idempotent guards around play/pause commands in sync loop.
- Retest acceptance:
  - VOD starts once without command oscillation.
  - Playback smooth and audio present.
- Fix PR: [#117](https://github.com/alltheclicks/lumenplayer/pull/117)
- Retest result (2026-02-16): PASS on local flow; VOD handoff no longer drops into startup play/pause oscillation and playback starts stably.
- Greptile note: final score was not returned after 2 pings (`@greptile-apps`, `@greptileai`); PR comment documented this before merge.

### TST-004
- Reported by: Filip (manual VOD browsing)
- Environment: VOD category listing
- Steps:
  1. Open VOD category `All`.
  2. Scroll list and observe apparent limit/cutoff.
- Expected: full available catalog can be browsed/load more works as intended.
- Actual: list appears capped/truncated.
- Initial hypothesis:
  - Lazy-load/pagination threshold not continuing.
  - Grid/container height/scroll boundary issue.
- Suggested fix scope:
  - Verify API pagination cursor and infinite-load triggers.
  - Verify viewport virtualization/scroll container calculations.
- Retest acceptance:
  - Catalog continues loading until full dataset available (or explicit backend limit message).
- Fix PR: [#119](https://github.com/alltheclicks/lumenplayer/pull/119)
- Retest result (2026-02-16): PASS on local flow; `All` VOD catalog no longer truncates on single unfiltered API slice and continues to render full aggregated set across categories.

### TST-005
- Reported by: Filip (manual UX observation)
- Environment: Enter VOD playback from detail view
- Steps:
  1. Open VOD detail and start playback.
  2. Observe main shell context/left nav behavior.
- Expected: clear VOD playback context with predictable return path.
- Actual: UX feels mixed with channel-shell context and is confusing.
- Initial hypothesis:
  - Shell layout logic coupled to player route without source-context-aware nav state.
- Suggested fix scope:
  - Define route-level UX states for Live vs VOD vs Series playback.
  - Ensure return action consistently restores prior context.
- Retest acceptance:
  - User can always understand current content context and navigate back predictably.
- Fix PR: [#121](https://github.com/alltheclicks/lumenplayer/pull/121)
- Retest result (2026-02-17): PASS via focused code-level verification (unit test for context-aware on-demand back-path resolution + green `pnpm lint`, `pnpm typecheck`, `pnpm build`); player now renders on-demand shell context during VOD/episode playback with predictable return actions.

### TST-006
- Reported by: Filip (manual UX test)
- Environment: login -> `/player` shell
- Steps:
  1. Login with valid Xtream username/password.
  2. Land on player shell with left channel list/bouquets.
  3. Attempt to quickly navigate to Movies/Series/Catch-up.
- Expected: explicit, predictable Movies/Series/Catch-up entry points in shell on desktop and mobile.
- Actual: media discoverability was reduced/unclear in primary shell context.
- Initial hypothesis:
  - Shell nav hierarchy/regional visibility rules hid/de-prioritized media sections.
- Suggested fix scope:
  - Restore explicit discoverability actions in player shell and align labels for clarity.
- Retest acceptance:
  - After login, user can immediately reach Movies/Series/Catch-up from shell without hunting.
- Fix PR: [#130](https://github.com/alltheclicks/lumenplayer/pull/130)
- Retest result (2026-02-17): PASS on local flow; discoverability actions restored in player shell contexts (desktop + mobile), labels aligned for clearer media entry.

### TST-007
- Reported by: Filip (manual live playback test)
- Environment: `/player` live channel selection
- Steps:
  1. Select live channel from list.
  2. Verify startup behavior.
  3. Check if user can choose startup interaction mode.
- Expected: explicit setting for startup mode (`autoplay on select` vs `select then play`) and deterministic behavior.
- Actual: startup expectation and behavior were not explicit/consistent.
- Initial hypothesis:
  - Startup guards and settings mapping were not aligned with expected interaction model.
- Suggested fix scope:
  - Add persisted live startup mode setting and enforce behavior across all selection paths.
- Retest acceptance:
  - Startup mode selectable in settings and applied consistently for list/zap/next-prev/initial bootstrap.
- Fix PR: [#131](https://github.com/alltheclicks/lumenplayer/pull/131)
- Retest result (2026-02-17): PASS on local flow; explicit startup mode added and deterministic behavior enforced across live selection paths.

### TST-008
- Reported by: Filip (manual EPG inspection)
- Environment: player inline EPG + `/epg` route
- Steps:
  1. Inspect current program/EPG text below player.
  2. Open EPG page and inspect rows.
  3. Observe malformed/random strings.
- Expected: human-readable EPG title/description/time fields across all EPG surfaces.
- Actual: malformed/random-like strings appeared in EPG text.
- Initial hypothesis:
  - Missing shared decoding/normalization for provider payload variants.
- Suggested fix scope:
  - Introduce shared EPG mapper normalization and wire all EPG surfaces to it.
- Retest acceptance:
  - EPG text is readable and consistent in player inline + EPG route (and XMLTV path where applicable).
- Fix PR: [#133](https://github.com/alltheclicks/lumenplayer/pull/133)
- Retest result (2026-02-17): PASS on local flow; shared EPG normalization pipeline now used across player inline, EPG route fallback, and XMLTV parsing path.
- Greptile note: final score not returned after 2 pings (`@greptile-apps`, `@greptileai`); fallback PR comment posted before merge.

### TST-009
- Reported by: Filip (manual active browsing test)
- Environment: frequent channel switching / active player browsing
- Steps:
  1. Browse and switch channels repeatedly.
  2. Observe short-EPG/network request behavior.
  3. Intermittently hit `429 Too Many Requests`.
- Expected: client request behavior should remain provider-safe, with graceful backoff/fallback under rate-limit pressure.
- Actual: intermittent `429` responses during active usage.
- Initial hypothesis:
  - Burst duplicate requests without sufficient dedupe/pacing/backoff.
- Suggested fix scope:
  - Add short-EPG in-flight dedupe, cache, pacing, 429 retry/backoff, and stale fallback.
- Retest acceptance:
  - Normal active session no longer triggers persistent 429 interruptions; degraded conditions recover gracefully.
- Fix PR: [#134](https://github.com/alltheclicks/lumenplayer/pull/134)
- Retest result (2026-02-17): PASS on local flow; resilient short-EPG request layer introduced with dedupe/cache/pacing/retry-backoff/stale fallback and wired into both player and EPG page.
- Greptile note: final score not returned after 2 pings (`@greptile-apps`, `@greptileai`); fallback PR comment posted before merge.

---

## New issue template

Copy this block for each newly found problem:

```md
### TST-XXX
- Reported by:
- Environment:
- Steps:
  1.
  2.
  3.
- Expected:
- Actual:
- Initial hypothesis:
- Suggested fix scope:
- Retest acceptance:
```
