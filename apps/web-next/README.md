# Lumen Next Studio

Parallel UI sandbox for the next generation Lumen shell and catalog experience.

This app now mirrors the current Lumen route structure and baseline look so agents can iterate from the existing product feel instead of designing from scratch.

## Commands

```bash
pnpm install
pnpm --filter @lumen/web-next dev
pnpm --filter @lumen/web-next lint
pnpm --filter @lumen/web-next typecheck
pnpm --filter @lumen/web-next build
```

The dev server runs on `http://localhost:8081` so it can coexist with the current `apps/web` app.

## Boundaries

- Treat `apps/web-next` as a presentation sandbox that starts from the current Lumen baseline.
- Prefer mock and adapter-driven data sources until a design direction is approved.
- Reuse workspace packages like `@lumen/core`, `@lumen/types`, and `@lumen/demo-data`.
- Do not change `apps/web` from this app unless you are explicitly promoting an approved slice into the main product.

## Current routes

- `/player` live shell baseline
- `/vod` movie catalog baseline
- `/series` series catalog baseline
- `/studio` sandbox overview
- `/studio/merge-plan` rules for promoting approved UI work into `main`
