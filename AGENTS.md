# AGENTS.md — Klaro Player

## Start here

Mandatory task coordination: read `TASKS.md` at every session start and resolve the live registry with `git config --local --get klaro.taskRegistry`. Follow its atomic claim/update protocol before implementation, even if the owner does not mention tracking. For a general work/continue request, resume your claim or take the highest-priority eligible `ready` task; analysis-only questions do not authorize implementation. Record your unique session identity, base, worktree, reserved paths and evidence. Never use a worktree's stale copy as the live queue. If configuration is missing, report it rather than creating a competing registry. `TASKS.md` governs execution order; `GRAND_PLAN.md` governs product decisions.

1. Read `GRAND_PLAN.md` first for whole-product scope, current priorities, platform and panel requirements, accepted decisions, proposals, open questions and repository evidence.
2. Read `CLAUDE.md` for shared project conventions and validation commands. These project instructions also apply to Codex.
3. Read the relevant latest handoff and task-specific documents identified by `GRAND_PLAN.md` before implementation. Check the current branch, commit and working tree; some newer work and source documents live on another branch or worktree.
4. Before UI/design work, read `design/README.md` and the applicable player/panel export. If absent, see the design source location in `GRAND_PLAN.md`; do not assume the export was merged. Treat mirrored files as read-only and distinguish current screens from archived proposals.

Follow the owner's latest explicit instructions. Do not treat proposals as approved decisions, historical reports as live verification, or this plan as authorization to deploy or publish. Resolve older roadmap conflicts using the conflict register in `GRAND_PLAN.md`.

Reply to the owner in Serbian (Latin script). Preserve existing code and documentation language conventions.

Product language is separate from agent communication: Klaro defaults to English and must support language selection at least on TV and desktop/web. Before UI/copy work, follow `GRAND_PLAN.md` section 9 localization requirements (resources, per-device preference, scripts/RTL, fallback and validation). Serbian design copy is prototype reference, not a Serbian-only product requirement. Do not edit mirrored design exports to translate them.

Latest execution evidence starts at the current entry in `HANDOFF.md` and its `docs/tv/` links. Older handoffs are historical. A minimal development shell or successful package build is not full design parity or functioning playback.

## Continuity

Keep `GRAND_PLAN.md` current when product decisions or milestone status change. Record detailed implementation and validation evidence in the relevant handoff. Distinguish code completion, review, actual-device verification and release. Preserve the whole-product vision while implementing bounded tasks.
