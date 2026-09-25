# UI Next Agent Guide

This document is the operating contract for any human or agent working on the next-generation Lumen UI.

## Workspace

- Repo worktree: `/Users/filip/Documents/Lumen-Player-ui-next`
- Branch: `codex/ui-next`
- Sandbox app: `/Users/filip/Documents/Lumen-Player-ui-next/apps/web-next`
- Current production app to avoid touching by default: `/Users/filip/Documents/Lumen-Player-ui-next/apps/web`
- Dev URL for the sandbox: `http://localhost:8081`

## Mission

Build and validate a newer Lumen UI and UX direction without destabilizing the current product branch where playback, streaming, and provider fixes are still happening.

The sandbox is intentionally separate so we can:

- explore stronger visual language
- refactor layout and navigation without playback risk
- parallelize work across multiple agents
- promote only approved slices back into `main`

## Default rules

- Work inside `apps/web-next` unless a task explicitly says it is a merge-back task.
- Reuse `@lumen/core`, `@lumen/types`, and `@lumen/demo-data` before inventing duplicate domain types.
- Keep data access behind adapters or mock gateways.
- Do not move unfinished experiments into `apps/web`.
- Do not edit playback engine, Xtream integration, session restore, or streaming fixes from a UI sandbox task.
- Keep every task small enough to review independently.
- Start from the current Lumen baseline look already represented in `web-next`; do not redesign from a blank slate unless explicitly asked.

## Recommended task lanes

Use one lane per agent. Do not overlap write ownership unless a merge is planned.

### Lane 1: Shell System

Owner scope:

- `apps/web-next/src/shared/layout/**`
- `apps/web-next/src/index.css`
- `apps/web-next/src/app/**`

Focus:

- navigation
- responsive shell structure
- tokens
- typography
- spacing
- reusable panel and card primitives

### Lane 2: Live Shell

Owner scope:

- `apps/web-next/src/features/studio/pages/LiveShellPage.tsx`
- `apps/web-next/src/features/studio/data/**`
- `apps/web-next/src/features/studio/hooks/**`

Focus:

- channel rail
- hero composition
- EPG rhythm
- focus and hover states
- desktop/mobile live browsing

### Lane 3: Catalog Lab

Owner scope:

- `apps/web-next/src/features/studio/pages/CatalogLabPage.tsx`
- `apps/web-next/src/features/studio/pages/SeriesLabPage.tsx`

Focus:

- VOD listing rhythm
- series listing rhythm
- poster and metadata hierarchy
- loading, empty, and browse affordances

### Lane 4: Merge Planning

Owner scope:

- `apps/web-next/src/features/studio/pages/MergePlanPage.tsx`
- `docs/UI-NEXT-AGENT-GUIDE.md`
- `apps/web-next/README.md`

Focus:

- merge protocol
- rollout order
- PR slicing strategy
- boundaries and review criteria

## Start commands

From `/Users/filip/Documents/Lumen-Player-ui-next`:

```bash
pnpm install
pnpm --filter @lumen/web-next dev
```

Quality gates for each task:

```bash
pnpm --filter @lumen/web-next lint
pnpm --filter @lumen/web-next typecheck
pnpm --filter @lumen/web-next build
```

## Delivery rules

Every UI task should produce:

1. a focused visual or interaction improvement in `apps/web-next`
2. no accidental edits in `apps/web`
3. green lint, typecheck, and build for `@lumen/web-next`
4. a short note saying whether the result is sandbox-only or ready for promotion

## Baseline routes

`web-next` intentionally mirrors the production route map:

- `/player`
- `/vod`
- `/series`

This means agents should refine the current Lumen-like baseline rather than invent a disconnected prototype, unless the task explicitly asks for a radical exploration.

## Promotion to main

Do not migrate the entire sandbox app.

Approved work should move to `main` in this order:

1. shared tokens and low-risk primitives
2. one isolated screen or shell section
3. live shell presentation layer without playback engine changes
4. polish states and responsive refinement

When promoting:

- copy only the approved UI slice
- preserve existing production domain and playback logic unless the task explicitly includes integration work
- keep PR scope narrow
- verify behavior in the production app after transplant

## Explicit non-goals

- rewriting the current player engine inside the sandbox
- changing Xtream or M3U integration for visual reasons
- moving the whole `apps/web-next` folder into production
- large mixed PRs that combine design experiments with streaming bugfixes

## Good task examples

- "Redesign the top navigation and responsive shell in `apps/web-next` only."
- "Build a new card language for VOD and series in `apps/web-next`."
- "Prototype a stronger live channel rail with better hierarchy and status badges."
- "Extract one approved primitive from the sandbox and transplant it into `apps/web`."

## Bad task examples

- "Refactor `apps/web/src/pages/Player.tsx` to match the sandbox look."
- "While redesigning, also fix stream startup edge cases."
- "Port the whole sandbox into production in one PR."

## Agent handoff template

Use this when handing work to another agent:

```text
Work only in /Users/filip/Documents/Lumen-Player-ui-next/apps/web-next.
Do not edit apps/web or streaming-related packages.
Own only the files listed for your lane.
Run lint, typecheck, and build for @lumen/web-next before finishing.
State clearly whether your result is sandbox-only or ready for promotion.
```
