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

## Intake triage snapshots

Add dated triage tables here (one snapshot block per triage session).

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

## Active tasks (carried from latest V2 triage)

Current snapshot:
- `QAF-001..QAF-023` are completed (see `docs/V2-QA-FIX-BACKLOG.md`).
- `QAF-024..QAF-031` remain open and continue in this V3 active backlog.

| ID | Title | Area | Severity | Status |
|---|---|---|---|---|
| QAF-024 | Normalize player scrollbar styling and fix TV-unazad overflow scrollbar artifacts | Player Layout/Scroll UX | P1 | open |
| QAF-025 | Enforce live-edge restore on new-tab/session resume (avoid stale-segment black/static start) | Player Playback/Session Restore | P1 | open |
| QAF-026 | Define and implement pause-resume stale policy for live playback (`resume` vs `snap-to-live`) | Player Playback Policy | P2 | open |
| QAF-027 | Add volume slider control in player overlay (desktop/mobile/PWA) | Player UX/Audio Controls | P2 | open |
| QAF-028 | Fix Xtream series artwork mapping/loading (poster/banner parity with provider) | Series Data/UI | P2 | open |
| QAF-029 | Improve catch-up blue bar seek affordance with handle/pointer + remote focus visibility | Catch-up UX/Controls | P2 | open |
| QAF-030 | Fix catch-up seek playback failures (`Greska u mrezi`) using provider-accepted timeshift URL/data path | Catch-up Playback/Networking | P1 | open |
| QAF-031 | Show catch-up capability badge (clock icon) in channel list for archive-enabled channels | Channel List UX | P3 | open |

## Next ready queue (strict order)

`QAF-024 -> QAF-025 -> QAF-026 -> QAF-027 -> QAF-028 -> QAF-029 -> QAF-030 -> QAF-031`

