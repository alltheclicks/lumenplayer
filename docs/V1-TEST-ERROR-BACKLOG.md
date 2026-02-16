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
| TST-002 | Channel switch triggers `Playback error` overlay while frame is visible in background | Live TV Playback | P0 | open | frequent |
| TST-003 | VOD `Play in Player` enters play/pause loop, stutter, and no audio | VOD Playback | P0 | open | frequent |
| TST-004 | VOD catalog appears truncated (not all items visible) | VOD Listing | P2 | open | frequent |
| TST-005 | After VOD playback entry, UX returns to channel-shell context and feels inconsistent/confusing | Navigation UX | P2 | open | frequent |

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
