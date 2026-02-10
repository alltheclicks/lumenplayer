# Roadmap — Lumen Player

## Phase 0: Web Player (current)

**Goal:** Functional web PWA player in monorepo with shared packages.

- [x] Monorepo scaffolding (Turborepo + pnpm)
- [x] 7 @lumen/* packages extracted and working
- [x] apps/web running with re-export shims (zero breaking changes)
- [x] Build + typecheck passing
- [ ] Unit tests for shared packages
- [ ] Integrate SeekEngine, NumericInput, IdleTimer into web app
- [ ] HlsPlayerAdapter implementing PlayerAdapter interface
- [ ] CI pipeline (GitHub Actions)

**Exit criteria:** All packages tested, web player fully integrated with @lumen/* packages, CI green.

## Phase 1: Mobile (Expo iOS/Android)

**Goal:** Native mobile player sharing packages with web.

- apps/mobile/ with Expo SDK
- AsyncStorageAdapter for @lumen/storage
- ExpoVideoPlayerAdapter (expo-video → bare if needed)
- Separate mobile UI (not shadcn)

**Exit criteria:** iOS + Android builds, live channel playback working, shared API/storage.

## Phase 2: TV (Tizen/WebOS/Android TV)

**Goal:** 10-foot experience for smart TVs.

- apps/tv-web/ — separate Vite app for Tizen/WebOS
- TizenPlayerAdapter (AVPlay), WebOSPlayerAdapter
- Spatial navigation, D-pad focus management
- @lumen/input key codes fully utilized
- apps/android-tv/ — RN bare or native Kotlin with ExoPlayer

**Exit criteria:** Samsung + LG app store ready, Android TV working.
