# Klaro — shared task registry

Updated: 2026-10-21. Owner priority: installable Samsung, LG and Android TV builds ASAP.

This is the single operational task queue for Claude and Codex. `GRAND_PLAN.md` defines product scope and decisions. `BACKLOG.md` preserves historical items, not a competing queue. Do not silently treat historical in-progress items as current assignments. Detailed evidence can live in handoffs; task ownership and status live here only.

## One live registry across worktrees

The canonical file is selected by repository-local Git configuration:

```sh
git config --local --get klaro.taskRegistry
git rev-parse --path-format=absolute --git-common-dir
```

Read and update the absolute path returned by the first command, even when your worktree contains another `TASKS.md`. The setting is shared by linked worktrees, is not committed, and must not be changed by workers. If missing, unavailable or pointing at a different repository, stop automatic claiming and report the issue; do not create a second registry. The canonical worktree must remain available. Only the coordinator relocates it, while holding the registry lock, and verifies existing workers have stopped using the old location.

Buildara is the current coordination host. A separate Mac clone is NOT the same registry or lock. Mac work must use a Buildara claim (via the approved SSH alias) or an already assigned task; never claim from a copied registry. Git commits distribute instructions and task snapshots, not live cross-host synchronization.

## Mandatory claim/update protocol

1. Read project instructions and this live registry at session start and before selecting work. Explicit owner requests override automatic selection. Analysis-only questions do not start implementation tasks.
2. On a general request to continue/work, select the highest-priority `ready` task whose dependencies are satisfied. If none are ready, report the blockers; do not invent an unrelated task. Resume your existing claim before taking another.
3. Serialize EVERY registry mutation with atomic directory creation: `mkdir <absolute-git-common-dir>/klaro-task-registry.lock`. If it already exists, do not write. Retry briefly or report the lock holder. Never delete someone else's lock automatically, including after an apparent timeout.
4. After acquiring the lock, record your session identity in its `owner.txt`, re-read the registry, and recheck status, dependencies and overlapping reserved paths. In one short update set `active`, owner (provider + unique thread/session ID), UTC updated time, worktree/branch, immutable base commit and reserved paths. Re-read to verify the claim, then remove only your own lock directory and owner file. Do not hold the lock during implementation. A crash/stale lock requires coordinator verification before removal.
5. Work in your task's isolated worktree. A registry lock prevents duplicate claims, NOT source conflicts: overlapping path reservations prohibit concurrent edits. Root package files, lockfiles and shared package contracts need a single named owner. Request an additional reservation under the same lock before expanding scope.
6. Update the registry at meaningful progress points, before ending the session and when blocked. Preserve other rows/notes. Do not commit the whole live registry incidentally with a worker's code or overwrite it with a stale branch copy. The coordinator commits registry snapshots separately.
7. Use `review` when implementation and task checks pass; attach commit and evidence. Coordinator/reviewer marks `done` only when the card's acceptance conditions are satisfied. Record integration and device verification separately. Never mark a device task done from a build or browser preview.
8. Do not steal an old claim based on age alone. Coordinator confirms the worker stopped and records reassignment. On interruption leave a resumable handoff. Conflicts or new blockers must be visible here.

Statuses: `ready`, `active`, `review`, `blocked`, `queued`, `done`. `queued` is not claimable. Priority is ascending ID within P0, then P1, then later work. Maximum initial implementation concurrency: TV web, Android TV, and shared-core/integration owners with disjoint reservations. No automatic push, merge, deployment, store submission or production changes are authorized by a task claim.

## Live queue

All unassigned tasks have owner/base/reservations unset until claimed. Dependencies require the relevant result to be available in the task's recorded base, not merely a `done` label in another branch.

| ID | Priority | Task | Status | Dependencies | Owner | Updated UTC | Branch/base/reserved paths | Evidence / blocker |
|---|---|---|---|---|---|---|---|---|
| TV-001 | P0 | Establish implementation base and shared-file ownership | ready | — | — | — | — | Current plan/design and newer P4 work are separate; see card |
| TV-002 | P0 | Prepare TV build toolchains and device runbooks | ready | — | — | — | — | Owner inventory in GRAND_PLAN section 3; Sony model/OS and device access still needed |
| TV-003 | P0 | Minimum shared playback/source contract for TV | queued | TV-001 | — | — | — | Extract only what the first TV clients require |
| TV-004 | P0 | Shared Samsung/LG shell and installable packages | queued | TV-001 | — | — | — | Can use explicit adapter stub until TV-003 lands |
| TV-005 | P0 | Android TV shell and installable package | queued | TV-001 | — | — | — | Can use explicit adapter stub until TV-003 lands |
| TV-006 | P0 | Samsung live/EPG/catch-up adapter | queued | TV-003, TV-004 | — | — | — | Samsung-specific playback evidence required |
| TV-007 | P0 | LG live/EPG/catch-up adapter | queued | TV-003, TV-004 | — | — | — | Separate adapter; reserve shared shell edits explicitly |
| TV-008 | P0 | Android TV live/EPG/catch-up adapter | queued | TV-003, TV-005 | — | — | — | Media3 integration and lifecycle |
| TV-009 | P0 | Samsung physical-device acceptance | queued | TV-002, TV-006 | — | — | — | UE43RU7092UXXH (2019); T-MSLDEUC-1500.9; owner-reported |
| TV-010 | P0 | LG physical-device acceptance | queued | TV-002, TV-007 | — | — | — | 60UN71003LB; webOS 5.6.2-21; owner-reported |
| TV-011 | P0 | Sony Android TV physical-device acceptance | queued | TV-002, TV-008 | — | — | — | Sony 2022 or 2023 (year unconfirmed) Android TV; exact model/OS pending |
| TV-012 | P1 | Fire TV compatibility and physical-device acceptance | queued | TV-002, TV-008 | — | — | — | Fire TV Stick 4K Max; Fire OS 7.7.1.3; Android-family path, generation/access pending |
| NEXT-001 | P1 | Reconcile account/provider/credit rules | queued | Owner decisions | — | — | — | Does not block internal TV playback builds |
| NEXT-002 | P1 | Connected beta: backend, pairing and minimal role panel | queued | NEXT-001 | — | — | — | Split into bounded cards before marking ready |
| LATER-001 | Later | Remaining whole-product scope | queued | Milestone planning | — | — | — | Coverage index below; not an executable mega-task |

## First-wave task cards

### TV-001 — implementation base

Read-only Git/code assessment plus coordination docs. Check live branch/worktree state; preserve newer P4 work and unrelated dirty files. Identify an exact base and the commits needed to combine plan/design with P4. Define concrete directories and exclusive ownership for TV web shell, Samsung/LG adapters, Android client and shared contracts. Inspect existing APIs before proposing changes. Reserve root manifests/lockfile to one integration owner. Record integration commands and required checks; execute merges only with task-specific owner authorization. Do not discard existing work or redo completed extraction.

Acceptance: immutable base/integration evidence, remaining approvals or blockers explicitly recorded, downstream reservations and build commands specified. Mark downstream tasks ready only once their actual base is accessible. No full-core rewrite or backend prerequisite for the first packages.

### TV-002 — build toolchains, devices and installation

Owner authorized background environment preparation on 2026-10-21. Allowed scope: `docs/tv/TV-002-environment.md`, `scripts/tv-env/` and isolated user-owned SDK/tool directories on Buildara. Inspect existing tools first; install compatible pinned LG CLI, Samsung tooling and Android build tools where feasible, without replacing global runtimes or touching services. Validate CLI commands and minimal disposable build/package samples; document blockers requiring accounts/licenses/signing. No secret/signing material in tracked files, no device mutation, no store submission. Do not edit root manifests or lockfile; TV-001 owns coordination of those paths. Device-test documentation must contain no secrets or serials. Use the corrected owner inventory in GRAND_PLAN section 3: Samsung UE43RU7092UXXH (2019), LG 60UN71003LB, Sony Android TV (2022 or 2023, unconfirmed) and Fire TV Stick 4K Max on Fire OS 7.7.1.3. Do not ask again for supplied software versions. Discover what can be read without runtime changes and request remaining Sony model/OS, Fire generation and access details together. Document developer-mode, packaging/signing prerequisites, installation and log capture per target using current official guidance when needed. Do not change devices merely to write the runbook. Mobile/emulator/device execution follows the Mac boundary in workspace instructions.

Acceptance: reproducible installation/check procedure per first target and explicit missing prerequisites. Mark blocked if required details remain absent; do not invent device verification.

### TV-003 — minimum shared contracts

Allowed scope: shared packages explicitly reserved after TV-001. Reuse P4 contracts. Define the minimum source/catalog, playback, seek/catch-up, capabilities, cancellation/error and lifecycle interfaces consumed by both client families. Supply meaningful contract tests and test fixtures without credentials. Client workers consume these contracts rather than independently editing them.

Acceptance: shared checks pass, both client owners can integrate the documented interface. No server transcoding/remux, new billing backend or unrelated migration.

### TV-004 / TV-005 — first installable shells

Separate owners and directories: TV-004 owns the common TV web UI and Tizen/webOS packaging; TV-005 owns the Android TV client. Exact paths/base must be registered by TV-001 before claiming. Implement the smallest route from launch to a test playback screen, remote focus/Back/OK, loading/error states, English-default localization resources and reachable language settings. Use the imported Klaro design; preserve column-collapse intent. Build packages and document installation. A stubbed adapter must be visibly identified in handoff, never described as working playback.

Acceptance: reproducible platform builds, package locations and remote-navigation checks appropriate to available tooling. Installation on hardware is recorded only when actually performed; physical acceptance remains TV-009–011. Full commercial activation, payments, complete translation inventory and pixel-perfect secondary screens do not gate these internal builds.

### TV-006 / TV-007 / TV-008 — playable vertical slice

Each task owns only its platform adapter/integration paths. Use a controlled test source supplied securely, never hardcoded credentials. Deliver channels/categories, search, favorites, EPG, live, catch-up and return to live through the shared contract. Preserve navigation and expose actionable playback errors. Cover switching, cancellation, seek and lifecycle recovery with appropriate tests. Shared UI changes require its owner's reservation or a follow-up task.

Acceptance: platform build/checks pass, reproducible playback scenarios and limitations documented, then request the corresponding physical acceptance task. No claims of universal provider or codec support. Media delivery stays outside Convex; no transcoding/remux shortcut.

### TV-009 / TV-010 / TV-011 / TV-012 — actual-device evidence

Record exact model, OS, source type, build commit and installation result. Exercise launch, remote navigation, channel switching, EPG, archive start/seek/return-to-live, network loss/reconnect, standby/resume and a viewing session with recorded duration. Report startup and seek observations, errors, recovery and reproducibility; do not invent performance thresholds. A failure becomes a specific follow-up row with platform, owner and acceptance criterion. A missing device is blocked, not passed. Fire gets independent checks even if it shares the Android artifact.

Acceptance: explicit pass/fail per scenario and reproducible failures resolved or owner-accepted limitations. Build-only and simulated UI results cannot close these tasks.

## Whole-product coverage and historical work

The queue prioritizes first TV builds without dropping the rest of `GRAND_PLAN.md`: account/device recovery; Convex/realtime/offline sync; provider/reseller/genadmin and user panels; credits/payments/support/telemetry; VOD/series, audio/subtitles/casting; full localization; web/mobile redesign; Apple TV, iOS/Android mobile, VIDAA and further platforms. Expand NEXT/LATER entries into bounded rows here when their phase is scheduled. Do not create a second live queue.

Existing `BACKLOG.md`, P4 handoffs and QA documents remain evidence. Before reviving any old task, inspect its actual branch/status and add a linked row here, preserving its historical ID. Unverified historical `in-progress` entries do not reserve files today. The first TV task cards are internal engineering scope, not the entire public launch scope.

## Coordination limitations

This protocol coordinates cooperating agents that have loaded these instructions; it is not a background scheduler or an enforcement service. Existing sessions must re-read the entry points. New worktrees need the instruction commits in their base. A newly started session does not execute tasks without a work request, but a general “continue the next ready task” request needs no manually chosen ID. Local changes here have not automatically reached other branches or machines.
