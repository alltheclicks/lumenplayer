# Backlog — Lumen Player

## Legend

| Status | Meaning |
|--------|---------|
| `idea` | Not yet planned |
| `planned` | Will be worked on |
| `in-progress` | Currently being worked on |
| `done` | Completed |

---

## Phase 0 — Web Player

| ID | Task | Size | Status |
|----|------|------|--------|
| LP-0001 | Monorepo scaffolding (Turborepo + pnpm + packages) | M | done |
| LP-0002 | Enable strict mode in packages (already strict) + apps/web (currently false) | S | idea |
| LP-0003 | Add unit tests for @lumen/core (epg, time, channels) | S | idea |
| LP-0004 | Add unit tests for @lumen/player-core (SeekEngine, IdleTimer) | S | idea |
| LP-0005 | Add unit tests for @lumen/input (NumericChannelInput) | S | idea |
| LP-0006 | Add unit tests for @lumen/storage (favorites, credentials, watch-history) | S | idea |
| LP-0007 | Integrate SeekEngine into apps/web VideoPlayer | M | idea |
| LP-0008 | Integrate NumericChannelInput into apps/web Player | S | idea |
| LP-0009 | Integrate IdleTimer into apps/web PlayerControls | S | idea |
| LP-0010 | PWA improvements: offline page, better caching, app icon | S | idea |
| LP-0011 | Code-splitting: lazy load Player page | S | idea |
| LP-0012 | HlsPlayerAdapter: implement PlayerAdapter for HLS.js | M | idea |
| LP-0013 | Replace demo-data import guard so it doesn't enter production bundle | S | idea |
| LP-0014 | Add ESLint config to all packages | S | idea |
| LP-0015 | CI pipeline: GitHub Actions for typecheck + lint + build | S | idea |

## Phase 1 — Mobile (future)

| ID | Task | Size | Status |
|----|------|------|--------|
| LP-1001 | apps/mobile Expo project setup | M | idea |
| LP-1002 | AsyncStorageAdapter for @lumen/storage | S | idea |
| LP-1003 | ExpoVideoPlayerAdapter | M | idea |

## Phase 2 — TV (future)

| ID | Task | Size | Status |
|----|------|------|--------|
| LP-2001 | apps/tv-web Tizen/WebOS project setup | M | idea |
| LP-2002 | TizenPlayerAdapter (AVPlay API) | L | idea |
| LP-2003 | Spatial navigation system for TV | L | idea |
| LP-2004 | apps/android-tv project setup | L | idea |
