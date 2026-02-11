# CLAUDE.md — Lumen Player

## Language

- Communicate with the user in **Serbian (Latin script)**
- All code and code comments in **English**

## Project Overview

Lumen Player is a session-centric IPTV platform built as a Turborepo + pnpm monorepo.

Primary strategy:
- PWA-first product
- casting as first-class feature
- playback session independent from a single UI client/device

Read first on every session:
1. `HANDOFF.md`
2. `SESSION-ARCHITECTURE.md`
3. `BACKLOG.md`

## Commands

```bash
pnpm install        # Install all dependencies
pnpm build          # Build all packages + apps
pnpm typecheck      # TypeScript type checking
pnpm lint           # ESLint
pnpm dev            # Start apps/web dev server (port 8080)
pnpm clean          # Clean dist/.turbo
```

Single app/package:
```bash
pnpm --filter @lumen/web dev
pnpm --filter @lumen/web build
pnpm --filter @lumen/core typecheck
```

## Architecture

### Monorepo Structure

```
apps/
  web/            # Phase 0: PWA controller + local renderer
packages/
  tsconfig/       # @lumen/tsconfig
  types/          # @lumen/types
  core/           # @lumen/core
  demo-data/      # @lumen/demo-data
  api/            # @lumen/api (Xtream client)
  player-core/    # @lumen/player-core (SeekEngine, IdleTimer)
  storage/        # @lumen/storage
  input/          # @lumen/input
  session-core/   # @lumen/session-core (planned)
```

### Key Patterns

- **Session-centric model**: session state is source-of-truth, not React UI state
- **PlayerAdapter**: local playback engine
- **RendererAdapter**: local/cast/airplay rendering target abstraction
- **HttpClient DI** in `@lumen/api`
- **Re-export shims** in `apps/web/src/` kept only for migration compatibility

## Conventions

- Keep packages platform-agnostic unless explicitly renderer/platform specific
- Prefer idempotent command handlers in session layer
- Keep `apps/web` as controller + renderer client, not business state owner

## Key Files

- `DECISION-DOC.md` — base architecture decisions
- `SESSION-ARCHITECTURE.md` — active strategic model (session/cast)
- `ROADMAP.md` — active phase plan (0A/0B/0C)
- `BACKLOG.md` — prioritized tasks and pending-review items
- `HANDOFF.md` — latest execution status

## Workflow

1. Read `HANDOFF.md` + `SESSION-ARCHITECTURE.md`
2. Pick next `planned` task from `BACKLOG.md`
3. Implement only that task
4. Run validation (`typecheck`, `lint`, `build` as applicable)
5. Update `HANDOFF.md` with done/next/risks
