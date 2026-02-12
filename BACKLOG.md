# Backlog — Lumen Player

> Datum: 11. februar 2026

## Legend

| Status | Meaning |
|--------|---------|
| `idea` | Not yet planned |
| `planned` | Will be worked on next |
| `in-progress` | Currently being worked on |
| `done` | Completed |
| `pending-review` | Old task, needs re-validation with session-centric direction |

---

## Active Track — Session/Cast (Phase 0A/0B/0C)

| ID | Task | Size | Status |
|----|------|------|--------|
| LP-0101 | Create `@lumen/session-core` package scaffold | S | planned |
| LP-0102 | Define `SessionState` + command/event contracts | S | planned |
| LP-0103 | Implement local `SessionStore` (BroadcastChannel + storage fallback) | M | planned |
| LP-0104 | Refactor `apps/web` player flow to session-driven state | M | planned |
| LP-0105 | Add reconnect/resume behavior on app reload | S | idea |
| LP-0106 | Add `RendererAdapter` interface (local/cast/airplay abstraction) | M | idea |
| LP-0107 | Implement Google Cast sender flow in web app | M | idea |
| LP-0108 | Implement Cast receiver app (HTML + player bridge) | M | idea |
| LP-0109 | Add `switchRenderer(local <-> cast)` without session reset | M | idea |
| LP-0110 | Add phone-as-remote UI mode when renderer is remote | S | idea |
| LP-0111 | Add AirPlay control flow (secondary renderer) | M | idea |
| LP-0112 | Add idempotency tests for session commands | S | idea |

---

## Foundation / Quality

| ID | Task | Size | Status |
|----|------|------|--------|
| LP-0001 | Monorepo scaffolding (Turborepo + pnpm + packages) | M | done |
| LP-0003 | Add unit tests for `@lumen/core` (epg, time, channels) | S | idea |
| LP-0004 | Add unit tests for `@lumen/player-core` (SeekEngine, IdleTimer) | S | idea |
| LP-0005 | Add unit tests for `@lumen/input` (NumericChannelInput) | S | idea |
| LP-0006 | Add unit tests for `@lumen/storage` (favorites, credentials, watch-history) | S | idea |
| LP-0014 | Add ESLint flat config (`eslint.config.*`) for repo/app | S | planned |
| LP-0015 | CI pipeline: typecheck + lint + build | S | planned |

---

## Phase 0A-cleanup — Duplicate Removal

| ID | Task | Size | Status |
|----|------|------|--------|
| LP-0203 | Replace `useFavorites.ts` inline implementation with `@lumen/storage` functions (`loadFavorites`, `saveFavorites`, `toggleFavorite`, etc.) | S | done |

---

## Tasks under review (old plan, needs session-first decision)

| ID | Task | Size | Status |
|----|------|------|--------|
| LP-0007 | Integrate SeekEngine into apps/web VideoPlayer | M | pending-review |
| LP-0008 | Integrate NumericChannelInput into apps/web Player | S | pending-review |
| LP-0009 | Integrate IdleTimer into apps/web PlayerControls | S | pending-review |
| LP-0010 | PWA improvements: offline page, better caching, app icon | S | idea |
| LP-0011 | Code-splitting: lazy load Player page | S | idea |
| LP-0012 | HlsPlayerAdapter: implement PlayerAdapter for HLS.js | M | pending-review |
| LP-0013 | Replace demo-data import guard so it doesn't enter production bundle | S | idea |
| LP-1001 | apps/mobile setup (Expo) | M | pending-review |
| LP-1002 | AsyncStorageAdapter for `@lumen/storage` | S | pending-review |
| LP-1003 | ExpoVideoPlayerAdapter | M | pending-review |
| LP-2001 | apps/tv-web Tizen/WebOS project setup | M | pending-review |
| LP-2002 | TizenPlayerAdapter (AVPlay API) | L | pending-review |
| LP-2003 | Spatial navigation system for TV | L | pending-review |
| LP-2004 | apps/android-tv project setup | L | pending-review |
