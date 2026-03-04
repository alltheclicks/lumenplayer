# QAF Agent Runbook (2026-02-24)

Purpose: ready-to-run prompts for Codex agents, aligned with:
- `docs/WORKFLOW-LLM-QA.md`
- `docs/V3-QA-FIX-BACKLOG.md`
- `HANDOFF.md`
- `BACKLOG.md`
- `VISION.md`

## Hard Closure Rule (`PASS-100`)

Do not mark any QAF `done` unless all three are `PASS` on latest head:
1. Local gates (`lint`, `typecheck`, relevant tests).
2. Manual reproduction on target flow (`Filip` confirmation).
3. Greptile final review with no unresolved valid blockers.

If any of the three is missing, status stays `pending-review` or `in-progress`.

## Current QAF Queue (2026-02-24)

1. `QAF-035` catch-up token payload playable-response gate
2. `QAF-038` catch-up badge/list consistency (`Nick Junior`)
3. `QAF-036` keyboard up/down semantic alignment
4. `QAF-037` zapping debounce / 429 burst guard
5. `QAF-040` volume slider interaction model
6. `QAF-041` overlay visibility scoped to player viewport
7. `QAF-042` favorites reference semantics + no-restart restore
8. `QAF-039` series poster/backdrop parity re-open

## Single-Run Prompt Template

```md
Task: <QAF-ID> <title>

Follow strictly:
- docs/WORKFLOW-LLM-QA.md
- docs/V3-QA-FIX-BACKLOG.md
- HANDOFF.md
- BACKLOG.md
- VISION.md

Execution rules:
- one task only
- one branch only: codex/<task-id>-<slug>
- one PR only with exact QAF ID in title
- minimal scope, no side quests

Mandatory gates:
1) local PASS: pnpm lint, pnpm typecheck, relevant vitest/playwright coverage
2) manual PASS: reproducible before/after steps and explicit Filip confirmation
3) Greptile PASS: final review on latest head without unresolved valid blockers

Status rule:
- if any gate is missing/failing -> do not mark done
- done only after PASS-100

Deliverables:
- code + tests
- PR description with evidence paths
- docs sync (V3-QA-FIX-BACKLOG.md, BACKLOG.md, HANDOFF.md)
- short regression checklist for touched flows
```

## Ready Single-Run Prompts

### Prompt — `QAF-036`

```md
Execute QAF-036: Align live channel keyboard navigation semantics so ArrowUp/ArrowDown always move selection in matching visual direction.

Acceptance criteria:
- ArrowUp moves selection to previous/upper item.
- ArrowDown moves selection to next/lower item.
- No regression in Enter/Space channel confirm behavior.
- Works in both regular list and favorites list contexts.

Test requirements:
- add/extend unit tests for keyboard navigation mapping.
- run lint + typecheck + relevant tests.
- include manual repro evidence from /player.

Apply PASS-100 closure gate (local/manual/Greptile all PASS before done).
```

### Prompt — `QAF-037`

```md
Execute QAF-037: Add keyboard zapping commit debounce (~300ms dwell) so rapid key-hold browsing does not start playback for every transient highlight and does not burst requests (429 risk).

Acceptance criteria:
- Rapid ArrowUp/ArrowDown traversal updates highlight without starting each channel.
- Playback starts only after selection dwell threshold (target ~300ms) or explicit confirm action.
- Slower step-by-step navigation still starts expected channel behavior without perceptible lag.
- Request burst pattern is reduced; no per-highlight startup flood.

Test requirements:
- add/extend tests around zapping commit policy and debounce timing.
- add regression test ensuring no duplicate startup triggers during key hold.
- run lint + typecheck + relevant tests.
- include manual network evidence (before/after request density).

Apply PASS-100 closure gate.
```

### Prompt — `QAF-038`

```md
Execute QAF-038: Stabilize catch-up availability consistency for archive-badged channels (Nick Junior repro path).

Acceptance criteria:
- If catch-up badge is shown, catch-up list state is deterministic for same session/account/provider data.
- If no entries exist, empty-state reason is explicit and data-source consistent.
- Dev-server restart must not flip badge/list behavior without underlying provider data change.
- Diagnostics capture source used (short EPG vs fallback source).

Test requirements:
- add/extend tests for catch-up badge/list consistency logic.
- include targeted runtime diagnostics logs and evidence tuple.
- run lint + typecheck + relevant tests.

Apply PASS-100 closure gate.
```

### Prompt — `QAF-039`

```md
Execute QAF-039: Reopen Xtream series artwork parity and enforce poster/backdrop mapping on list + detail with payload diagnostics.

Acceptance criteria:
- Series list cards render provider poster when available.
- Series detail renders poster and backdrop when available.
- Fallbacks trigger only when provider fields are actually empty/invalid.
- PR includes exact payload fields used for mapping and one real payload example.

Test requirements:
- extend series artwork mapping tests.
- run lint + typecheck + relevant tests.
- include before/after visual evidence.

Apply PASS-100 closure gate.
```

### Prompt — `QAF-040`

```md
Execute QAF-040: Rework volume slider interaction model (icon-triggered overlay, hide on blur/leave, remove arrow-toggle metaphor).

Acceptance criteria:
- Volume icon opens audio slider overlay.
- Slider hides when pointer/focus leaves audio control area.
- Up/down arrow toggle affordance is removed from this interaction model.
- Keyboard and pointer behavior stay predictable.

Test requirements:
- add/extend tests for volume overlay visibility state transitions.
- run lint + typecheck + relevant tests.
- include manual evidence on desktop flow.

Apply PASS-100 closure gate.
```

### Prompt — `QAF-041`

```md
Execute QAF-041: Scope player overlay show/hide to player viewport only; ignore mouse movement outside player surface.

Acceptance criteria:
- Overlay visibility reacts only to interactions inside player viewport/controls hitbox.
- Pointer movement over channel list/categories/page chrome does not show/hide player overlay.
- Existing idle/autohide behavior inside player remains intact.

Test requirements:
- add/extend tests for overlay scope behavior.
- run lint + typecheck + relevant tests.
- include manual repro evidence with side-panel movement.

Apply PASS-100 closure gate.
```

### Prompt — `QAF-042`

```md
Execute QAF-042: Favorites must behave as channel references (not duplicate playback identity), and removing active favorite should restore selection without stream restart.

Acceptance criteria:
- Adding to favorites does not create duplicated runtime channel identity.
- Playing channel from favorites uses same underlying channel identity as source list.
- Removing active favorite restores selection to source list (when available) without reloading stream.
- Favorites toggle remains deterministic across list contexts.

Test requirements:
- add/extend tests for favorites identity and selection-restore behavior.
- run lint + typecheck + relevant tests.
- include manual evidence for add/remove while playing.

Apply PASS-100 closure gate.
```

## Ordered Batch Prompts

### Batch A — Catch-up Stabilization (`QAF-035 -> QAF-038`)

```md
Run ordered batch: QAF-035 -> QAF-038.

Rules:
- one task at a time, one branch per task, one PR per task.
- sync latest main before each task.
- do not start next task before previous task reaches PASS-100.

Task goals:
1) QAF-035 playable-response gate for token payloads (`200 video/mp2t` is not auto-success in web).
2) QAF-038 badge/list consistency on archive-enabled channels (Nick Junior repro).

For each task:
- local PASS gates
- manual PASS evidence
- Greptile PASS
- docs sync in V3 backlog + BACKLOG + HANDOFF
```

### Batch B — Input and Overlay UX (`QAF-036 -> QAF-037 -> QAF-040 -> QAF-041`)

```md
Run ordered batch: QAF-036 -> QAF-037 -> QAF-040 -> QAF-041.

Rules:
- strict sequential execution, no mixed-task PRs.
- keep scope minimal per QAF.
- PASS-100 required per task before moving forward.

Focus:
- keyboard direction correctness
- zapping debounce/request burst guard
- volume slider interaction model
- overlay visibility limited to player viewport
```

### Batch C — Data Mapping and Favorites Integrity (`QAF-042 -> QAF-039`)

```md
Run ordered batch: QAF-042 -> QAF-039.

Rules:
- one task per branch/PR.
- PASS-100 required per task.

Focus:
- favorites reference semantics and no-restart removal behavior
- series poster/backdrop mapping parity with provider payload evidence
```

## Parallelization Note

Most tasks above touch `Player.tsx` / `PlayerControls.tsx` and should be kept sequential to avoid merge collisions.
Safer parallel option:
- run `QAF-039` in separate agent while one other agent handles one ordered player-controls batch.
