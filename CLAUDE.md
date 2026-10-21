# CLAUDE.md — Klaro Player

## Language

- Communicate with the user in **Serbian (Latin script)**
- All code and code comments in **English**
- Product UI defaults to **English**, with multilingual support and language selection at least on TV and desktop/web. Follow `GRAND_PLAN.md` section 9 for locale coverage, per-device preference, localization resources, RTL and acceptance checks. Serbian prototype copy does not constrain the application's language. Keep mirrored design exports unchanged.

## Project Overview

Klaro Player (formerly Lumen Player) is a session-centric, cross-platform OTT/IPTV media player built as a Turborepo + pnpm monorepo. It ships no channels or content — users add their own source.

Brand: **Klaro Player** · `klaroplayer.com` · "One setup. Every screen." — see `docs/BRAND-KLARO-PLAYER.md`.
`lumen` remains the internal code name: do NOT rename `@lumen/*` packages, storage keys, cookies, env vars, Cast namespace, deploy paths or other technical identifiers without explicit owner approval.

Primary strategy:
- PWA-first product
- casting as first-class feature
- playback session independent from a single UI client/device

Read first on every session:
 - `TASKS.md` — mandatory shared task registry. Resolve its canonical path using `git config --local --get klaro.taskRegistry`; follow its lock, claim, path-reservation and status protocol even when the owner does not mention it. General work requests select the next eligible ready task; analysis-only requests do not start implementation. Missing registry configuration must be reported, never replaced with a competing queue.
0. `GRAND_PLAN.md` — whole-product scope, current TV-app priority, role/panel model, source conflicts and open decisions. It distinguishes accepted direction from proposals; older strategy summaries below may be superseded there.
1. `docs/AGENT-HANDOFF-20260925.md` (current Git/production map), then `HANDOFF.md`
2. `VISION.md`
3. `SESSION-ARCHITECTURE.md`
4. `BACKLOG.md`

UI / design work: read `design/README.md` and the relevant exports before implementation. If the mirror is absent, locate its branch through `GRAND_PLAN.md`. Do not hand-edit mirrored design files; distinguish current design, archived proposals and approved business rules.

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
  session-core/   # @lumen/session-core (implemented; browser storage/transport coupling remains)
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
- Public product name/copy comes from `apps/web/src/config/productIdentity.ts` + `brand.ts` (`VITE_BRAND_NAME` overrides it for customer builds such as EXYU.tv); never hardcode brand names in components

## Key Files

- `VISION.md` — product vision (V1/V1.5/V2), user personas, scope
- `DECISION-DOC.md` — base architecture decisions
- `SESSION-ARCHITECTURE.md` — active strategic model (session/cast)
- `ROADMAP.md` — active phase plan (0A → V1 → Phase 1 Dashboard → Phase 2 Native)
- `BACKLOG.md` — prioritized tasks and pending-review items
- `HANDOFF.md` — latest execution status

## Workflow

1. Read `HANDOFF.md` + `VISION.md` + `SESSION-ARCHITECTURE.md`
2. Claim the next eligible `ready` task in the canonical `TASKS.md` under its registry lock. `BACKLOG.md` is historical reference, not an automatic work queue.
3. Implement only that task
4. Run validation (`typecheck`, `lint`, `build` as applicable)
5. Update the task's evidence/handoff and canonical `TASKS.md` status under its registry lock. Separate review, integration and physical-device verification; do not overwrite another worker's handoff or reservation.
