# Agent handoff — 25 September 2026

## Start here

Repository: `alltheclicks/lumenplayer` (private). Use the GitHub `main` branch after the alignment PR is merged, in a fresh worktree. Do not start from the old dirty `/Users/filip/Documents/Lumen Player` checkout.

```sh
git fetch origin
git worktree add -b codex/<your-work> ../lumen-your-work origin/main
cd ../lumen-your-work
pnpm install --frozen-lockfile
```

Read this document, `docs/PLAYER-RELIABILITY-20260923.md`, `docs/PLAN-MULTIPLATFORM-EXECUTION.md`, and the latest HANDOFF entry. Older checklist statuses and architecture documents may be stale: verify code and live evidence before reusing them.

## Production baseline (verified 25 September)

- Public player: https://player.exyu.tv ; marker `/lumen-release.txt` is `20260923T123151Z-918b5ad`.
- Player VPS: `root@151.241.151.105`. Web `/var/www/lumen-current` and proxy `/opt/lumen/proxy` both resolve to that release. Proxy service is `lumen-proxy`.
- Git source: `918b5ad`; `f87bfe2` adds only deployment documentation. The alignment branch adds handoff documentation only. No application code change or deployment is part of alignment.
- All 21 web files match the saved release build. All 13 deployed proxy dist files match; six local test files are intentionally excluded from deployment. Public JS/CSS, service worker and manifest match; Cloudflare injects its script into the public HTML.
- The production reliability branch was 10 commits ahead of old `main@b51ed13`; the alignment PR brings these existing deployed changes into main with CI verification.
- Physical iPhone/device QA, provider-specific catch-up/VOD failures, MP2 audio support and EXYU worker memory root cause are still open. Prior 507-test and browser evidence is documented in the September 23 report; it does not prove these outstanding items.

## Local work preserved separately

| Branch | Meaning | Action |
| --- | --- | --- |
| `codex/player-reliability-20260923` | Deployed code and deployment report | Baseline incorporated into main by the alignment PR |
| `codex/archive-fixovi-wip-20260925` | Snapshot of 30 tracked edits plus source/documentation drafts from the old checkout | Unfinished archive; many edits already ported to production. Compare before cherry-picking; never deploy or merge wholesale |
| `codex/archive-ui-next-20260925` | Unfinished `apps/web-next`, guide and working lockfile | Prototype archive; not production and not newly validated |
| `codex/lumen-code-cleanup` | Eight cleanup commits at `3cda98e` | Separate proposal; not deployed or merged into main |
| `codex/exyu-marketing-fixes-20260914` | Earlier candidate at `eb7c6a1` | Compare with current production; do not treat as a newer release |
| `codex/archive-shadow-validation-20260925` | Sanitized copy of historical shadow-only work | Original `6e780ee` remains local because its test fixtures contain credentials |

Other historical commits are retained in dedicated archive branches listed in `docs/GIT-ARCHIVE-INVENTORY-20260925.md`. Old open PRs are not a queue to merge blindly: some overlap later work or target other historical branches.

The original main workspace edits are preserved in archive branches, a named local Git stash and the recovery archive before switching that workspace to the aligned baseline. Other original worktrees, ignored environments, browser data and build outputs are preserved. Do not assume ignored local environment files match production. A private local recovery bundle and patches are at `/Users/filip/Documents/Lumen Player/output/git-handoff-20260925` (not in GitHub). Raw console/browser logs and provider PHP/base64 dumps were not uploaded. Newly archived draft URL credentials/tokens are redacted. Access secrets through the owner's existing environment; never commit them.

## EXYU analytics is a separate repository

- Local checkout: `/Users/filip/Documents/exyu-tv-nextjs-reliability-20260923`, branch `codex/player-analytics-reliability-20260923`, head `3f654e7`.
- No GitHub remote configured at the start of this handoff. Repository destination is awaiting the owner's answer; `alltheclicks/exyu.tv` is the legacy Vite project and must not be overwritten.
- Live host: `deploy@178.162.212.149`, SSH port 8722. Current `/var/www/exyu.tv/current` resolves to release `20260923122931`; all eight exyu-tv workers use that release (verified September 25).
- That release was built from a copy of the previous LIVE release plus scoped analytics patch `0f5719e`, not a wholesale deployment of the local Next.js tree. Do not assume local main equals the live website.
- Indexes `idx_player_events_time_id` and `idx_player_events_diagnostic_time_id` were applied September 23. SQL/procedure: `scripts/sql/player-analytics-reliability-20260923.*` in the backend repo. Do not rerun blindly.

## TV continuation

No Android TV, Samsung or LG application has been implemented in the inspected production baseline. Start with supported device/version decisions and small live/catch-up playback proofs on real devices, then extract shared logic and build TV-specific UI. Samsung/LG share a proposed TV web foundation; Android framework choice remains open (older and newer plans differ). Do not mark the TV readiness plan implemented merely because the web build passes.

## Validation and release boundaries

```sh
pnpm lint
pnpm typecheck
pnpm test:unit
pnpm build
pnpm release:qaf035:validate
```

GitHub PR Quality Gate also runs release guardrails and production dependency audit. Use the alignment PR's checks as the fresh baseline. Archive branches are preservation only and carry no new runtime-validation claim.

A GitHub push/merge is not a production deploy. Deployment, provider changes and database mutations require the owner's explicit authorization. Keep shared provider `timeshift.php` unchanged for Lumen experiments; use isolated endpoints. Preserve rollback releases and verify public assets, service state and actual playback when a deployment is authorized.

## Alignment validation

Local verification passed on September 25: 507 unit tests, lint, typecheck, build and all 24 current-mode release gates. Turbo reused matching cached lint/typecheck/build outputs; GitHub CI executes the PR checks independently. Final release/device gates remain explicitly pending. PR: https://github.com/alltheclicks/lumenplayer/pull/227 .
