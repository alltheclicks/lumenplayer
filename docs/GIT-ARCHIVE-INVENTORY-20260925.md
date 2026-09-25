# Git preservation inventory — 2026-09-25

These branches preserve historical or unfinished work. They are not approved deployment candidates and are not merged into main by alignment.

| Original local branch | GitHub branch | Commit |
| --- | --- | --- |
| `codex/archive-fixovi-wip-20260925` | `codex/archive-fixovi-wip-20260925` | `4205472` |
| `codex/archive-ui-next-20260925` | `codex/archive-ui-next-20260925` | `7aba8bd` |
| `codex/archive-shadow-validation-20260925` | `codex/archive-shadow-validation-20260925` | `3fe5572` |
| `codex/lumen-code-cleanup` | `codex/lumen-code-cleanup` | `3cda98e` |
| `codex/exyu-marketing-fixes-20260914` | `codex/exyu-marketing-fixes-20260914` | `eb7c6a1` |
| `LP-0351-persistent-player-shell` | `codex/archive-lp0351-original-20260925` | `baf7478` |
| `codex/docs-sync-lp-0322-0323-0107` | `codex/archive-docs0322-20260925` | `f2d028c` |
| `codex/lp-0350-dark-first-baseline` | `codex/archive-lp0350-20260925` | `c6c87ac` |
| `codex/lp-0351-persistent-player-shell` | `codex/archive-lp0351-20260925` | `1074955` |
| `codex/lp-035x-docs-sync` | `codex/archive-lp035x-docs-20260925` | `08c3ba7` |
| `final-road/M1.6-shadow` | `codex/archive-m16-shadow-20260925` | `351ac9d` |
| `final-road/planning-docs` | `codex/archive-planning-docs-20260925` | `e0d27f1` |

The historical original `6e780ee` is deliberately not pushed: its test fixtures contained provider credential literals. `codex/archive-shadow-validation-20260925` preserves the change with dummy credentials, on the original parent. The untouched original remains in the private local bundle.

Raw browser/console logs and provider PHP/base64 snapshots are local-only recovery artifacts. A fresh clone contains the application source and sanitized draft documents, not those operational captures.

The current workspace is moved onto `codex/workspace-handoff-20260925` tracking `origin/main` after the alignment PR merge. Its previous staged/unstaged/untracked work is retained in the stash named `pre-handoff-original-workspace-20260925`; inspect it in an isolated worktree if exact recovery is necessary. Do not pop it over main.
