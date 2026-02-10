# CLAUDE.md — Lumen Player

## Language

- Communicate with the user in **Serbian (Latin script)**
- All code and code comments in **English**

## Project Overview

Lumen Player is a cross-platform IPTV player built as a Turborepo + pnpm monorepo.

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
pnpm --filter @lumen/web dev        # Dev server only
pnpm --filter @lumen/web build      # Build web app only
pnpm --filter @lumen/core typecheck # Typecheck single package
```

## Architecture

### Monorepo Structure

```
apps/
  web/          # Phase 0: React 18 + Vite + HLS.js + shadcn/ui (PWA)
packages/
  tsconfig/     # @lumen/tsconfig — shared TS configs
  types/        # @lumen/types — all shared TypeScript types
  core/         # @lumen/core — EPG, time formatting, channel utils
  demo-data/    # @lumen/demo-data — mock channels + EPG generator
  api/          # @lumen/api — Xtream Codes client (transport-agnostic via HttpClient DI)
  player-core/  # @lumen/player-core — SeekEngine + IdleTimer
  storage/      # @lumen/storage — credentials, favorites, watch history
  input/        # @lumen/input — key codes (Samsung/LG/Web) + NumericChannelInput
```

### Package Dependency Graph

```
@lumen/types        ← no deps (foundation)
@lumen/core         ← types
@lumen/demo-data    ← types
@lumen/api          ← types
@lumen/player-core  ← types
@lumen/storage      ← types
@lumen/input        ← no deps
@lumen/web          ← all packages
```

### Key Patterns

- **PlayerAdapter interface** in `@lumen/types`: each platform implements its own (HLS.js, AVPlayer, ExoPlayer, AVPlay)
- **HttpClient DI** in `@lumen/api`: XtreamCodesService takes HttpClient in constructor, not hardcoded fetch
- **Re-export shims** in `apps/web/src/`: `data/channels.ts`, `services/xtreamCodes.ts`, `types/*.ts` re-export from @lumen/* packages for backward compat
- **SeekEngine**: pure state machine — exponential speed doubling (5→10→20→...→640), 1.2s speed interval, 50ms tick
- **NumericChannelInput**: accumulates digit presses, searches channel list, 2s auto-select timeout

### Path Aliases

`apps/web` uses `@/` → `./src/` (configured in tsconfig.json + vite.config.ts).

## Conventions

- Packages use `type: "module"` and export raw TypeScript (no build step for packages)
- Package exports use `types` + `import` + `default` conditions pointing to `./src/index.ts`
- `apps/web/tsconfig.json` has `strict: false` (inherited codebase)
- New packages should use `strict: true` via `@lumen/tsconfig/base.json`

## Key Files

- `DECISION-DOC.md` — architecture decisions and rationale
- `BACKLOG.md` — task list
- `HANDOFF.md` — current status for session continuity
- `ROADMAP.md` — phase plan

## Workflow

1. Read `HANDOFF.md` at session start
2. Pick next task from `BACKLOG.md`
3. Work on it
4. Before finishing: `pnpm build && pnpm typecheck`
5. Update `HANDOFF.md` at session end
