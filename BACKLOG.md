# Backlog — Lumen Player

> Datum: 12. februar 2026
> Poslednji audit: Opus 4.6 deep codebase analysis
> Vizija: `VISION.md` (V1/V1.5/V2)
> Roadmap alignment: Phase 0A → V1 (Content/Cast/AirPlay/PWA/Perf) → Phase 1 (Dashboard) → Phase 2 (Native)

## Legend

| Status | Meaning |
|--------|---------|
| `idea` | Not yet planned |
| `planned` | Will be worked on next |
| `in-progress` | Currently being worked on |
| `done` | Completed |
| `pending-review` | Old task, needs re-validation with session-centric direction |

---

## Phase 0A — Session MVP

### Step 1: Session package (greenfield, ne dira apps/web)

| ID | Task | Size | Status | Depends on |
|----|------|------|--------|------------|
| LP-0101 | Create `@lumen/session-core` package scaffold (package.json, tsconfig, src/index.ts, exports) | S | planned | — |
| LP-0102 | Define `SessionState` type + all command types (`SetSource`, `Play`, `Pause`, `Seek`, `SwitchRenderer`, `Stop`) + all event types (`SessionUpdated`, `RendererChanged`, `PlaybackStateChanged`, `Error`) | S | planned | LP-0101 |
| LP-0103 | Implement `SessionStore`: command dispatch, event emission, BroadcastChannel sync, localStorage persistence, reconnect on reload | M | planned | LP-0102 |

### Step 2: Wire session into apps/web (refactor god component)

> LP-0104 je razbijen na pod-taskove jer je bio prevelik.
> Player.tsx = 465 linija, 10 useState, PlayerControls = 760 linija, 14 props + 7 callbacks.

| ID | Task | Size | Status | Depends on |
|----|------|------|--------|------------|
| LP-0104a | Create `useSession()` hook — subscribes to `SessionStore`, returns reactive `SessionState` | S | planned | LP-0103 |
| LP-0104b | Create `useSessionCommands()` hook — returns typed dispatch functions (play, pause, setSource, seek, stop) | S | planned | LP-0103 |
| LP-0104c | Create `SessionProvider` context — initializes `SessionStore`, provides session + commands to component tree | S | planned | LP-0104a, LP-0104b |
| LP-0104d | Refactor Player.tsx — remove `currentChannel`, `isPlaying`, `catchUpProgram`, `catchUpPosition`, `progress` state; read from session instead; dispatch commands instead of local setState | M | planned | LP-0104c |
| LP-0104e | Refactor PlayerControls.tsx — remove 14 props / 7 callbacks pattern; read from session context; dispatch commands directly | M | planned | LP-0104d |
| LP-0104f | Refactor VideoPlayer.tsx — make it a pure session renderer (subscribes to session source + playback state, reports position back to session) | M | planned | LP-0104d |
| LP-0105 | Add reconnect/resume behavior on app reload (session survives refresh) | S | idea | LP-0103 |
| LP-0112 | Add idempotency tests for session commands | S | idea | LP-0103 |

### Step 3: Renderer abstraction (after session works locally)

| ID | Task | Size | Status | Depends on |
|----|------|------|--------|------------|
| LP-0106 | Add `RendererAdapter` interface (local/cast/airplay abstraction) | M | idea | LP-0104f |

---

## Phase 0A-cleanup — Wire existing packages + fix bugs

> Ovi taskovi mogu ici PARALELNO sa Phase 0A Step 2, ili NAKON njega.
> Analiza je otkrila da 3 cela paketa nisu povezana sa web app-om,
> i da postoje duplikati koda + 2 buga.

### Bugfixes (otkriveni u auditu)

| ID | Task | Size | Status | Depends on |
|----|------|------|--------|------------|
| LP-0201 | FIX: Volume/mute controls are cosmetic — `PlayerControls` updates local state but never calls `playerRef.setVolume()` / `toggleMute()`. Sound does not actually change. | S | done | — |
| LP-0202 | FIX: Catch-up seek is cosmetic — `catchUpPosition` updates progress bar UI but never calls `playerRef.seek()`. Seeking does nothing. | S | done | — |

### Remove duplicate code (apps/web has inline copies of package code)

| ID | Task | Size | Status | Depends on |
|----|------|------|--------|------------|
| LP-0203 | Replace `useFavorites.ts` inline implementation with `@lumen/storage` functions (loadFavorites, saveFavorites, toggleFavorite, etc.) | S | done | — |
| LP-0204 | Replace inline channel mappers in `useXtreamChannels.ts` (lines 59-85) with `@lumen/api` mapXtreamCategory/mapXtreamChannel | S | done | — |
| LP-0205 | Replace inline `formatDuration` in `PlayerControls.tsx` with `@lumen/core` formatDuration | S | done | — |
| LP-0206 | Replace inline channel filtering in `Player.tsx` with `@lumen/core` filterChannels/sortChannels | S | done | — |

### Wire unwired packages

| ID | Task | Size | Status | Depends on |
|----|------|------|--------|------------|
| LP-0007 | Integrate `SeekEngine` (`@lumen/player-core`) into player — exponential seek (5x→640x) on long-press/hold | M | pending-review | LP-0104f |
| LP-0008 | Integrate `NumericChannelInput` (`@lumen/input`) — digit accumulation for channel zapping | S | pending-review | LP-0104d |
| LP-0009 | Integrate `IdleTimer` (`@lumen/player-core`) into controls — auto-hide with grace period | S | pending-review | LP-0104e |
| LP-0012 | Implement `HlsPlayerAdapter` — wrap HLS.js behind `PlayerAdapter` interface from `@lumen/types` | M | pending-review | LP-0104f |
| LP-0207 | Wire `WebKeyCodes` from `@lumen/input` for keyboard navigation (arrows, space, etc.) | S | idea | LP-0104d |
| LP-0208 | Wire `WatchHistoryStorage` from `@lumen/storage` — track what user watched | S | idea | LP-0104d |
| LP-0209 | Wire `WebStorageAdapter` + `VersionedStorage` from `@lumen/storage` — replace raw localStorage usage in `apps/web` hooks/services | S | idea | LP-0203 |

### Remove migration shims (after all above done)

| ID | Task | Size | Status | Depends on |
|----|------|------|--------|------------|
| LP-0210 | Remove re-export shims (`src/data/channels.ts`, `src/services/xtreamCodes.ts`, `src/types/channel.ts`, `src/types/player.ts`) — import from packages directly | S | idea | LP-0203, LP-0204, LP-0206 |

---

## V1-Content — Xtream kompletnost, M3U, VOD, Series, Performanse

### Xtream API kompletnost

| ID | Task | Size | Status | Depends on |
|----|------|------|--------|------------|
| LP-0301 | Add `get_vod_info` endpoint to XtreamCodesService (movie details, TMDB ID) | S | idea | — |
| LP-0302 | Add `get_series_info` endpoint to XtreamCodesService (seasons, episodes) | S | idea | — |
| LP-0303 | Add series episode stream URL builder | S | idea | LP-0302 |
| LP-0304 | Add XMLTV EPG endpoint (bulk EPG download) | S | idea | — |

### M3U podrška

| ID | Task | Size | Status | Depends on |
|----|------|------|--------|------------|
| LP-0305 | Create M3U parser package (`@lumen/m3u` or in `@lumen/api`) — parse .m3u/.m3u8 files to Channel[] | M | idea | — |
| LP-0306 | M3U playlist import UI (URL paste + file upload) | M | idea | LP-0305 |
| LP-0307 | Unified channel model — ensure Xtream + M3U sources map to same Channel type | S | idea | LP-0305 |

### VOD UI

| ID | Task | Size | Status | Depends on |
|----|------|------|--------|------------|
| LP-0308 | VOD categories page (grid layout, posters) | M | idea | LP-0301 |
| LP-0309 | VOD film detail page (poster, description, cast, TMDB metadata) | M | idea | LP-0301 |
| LP-0310 | VOD player (uses session for playback) | M | idea | LP-0103, LP-0309 |

### Series UI

| ID | Task | Size | Status | Depends on |
|----|------|------|--------|------------|
| LP-0311 | Series list + categories page | M | idea | LP-0302 |
| LP-0312 | Series detail page (seasons, episodes, metadata) | M | idea | LP-0302 |
| LP-0313 | Episode player (uses session for playback) | M | idea | LP-0103, LP-0312 |

### Performanse velikih listi

| ID | Task | Size | Status | Depends on |
|----|------|------|--------|------------|
| LP-0314 | Virtualize channel list with @tanstack/react-virtual | M | idea | — |
| LP-0315 | Debounce search input | S | idea | — |
| LP-0316 | Paginate/lazy-load API calls for categories | M | idea | — |
| LP-0317 | EPG lazy loading (load per-channel, not all at once) | M | idea | — |

### EPG

| ID | Task | Size | Status | Depends on |
|----|------|------|--------|------------|
| LP-0318 | EPG grid view (TV guide style, horizontal timeline) | L | idea | — |
| LP-0319 | XMLTV bulk EPG import + caching | M | idea | LP-0304 |

### UI features

| ID | Task | Size | Status | Depends on |
|----|------|------|--------|------------|
| LP-0320 | Settings page (theme, language, player preferences) | M | idea | — |
| LP-0321 | Multi-audio track selection in player | S | idea | LP-0012 |
| LP-0322 | Subtitle track selection in player | S | idea | LP-0012 |
| LP-0323 | Picture-in-Picture support | S | idea | — |

---

## V1-Cast — Cast (part of V1)

| ID | Task | Size | Status | Depends on |
|----|------|------|--------|------------|
| LP-0107 | Implement Google Cast sender flow in web app | M | idea | LP-0106 |
| LP-0108 | Implement Cast receiver app (HTML + dual-video player bridge) at `cast.lumenplayer.com` | M | idea | LP-0106 |
| LP-0109 | Add `switchRenderer(local <-> cast)` without session reset | M | idea | LP-0107, LP-0108 |
| LP-0110 | Add phone-as-remote UI mode when renderer is remote | S | idea | LP-0109 |

---

## V1-AirPlay — AirPlay (part of V1)

| ID | Task | Size | Status | Depends on |
|----|------|------|--------|------------|
| LP-0111 | Add AirPlay control flow (secondary renderer) | M | idea | LP-0106 |

---

## V1-PWA — PWA Production Readiness (part of V1)

| ID | Task | Size | Status | Depends on |
|----|------|------|--------|------------|
| LP-0010 | PWA install UI — wire existing `usePWA` hook, add install prompt + button | S | idea | — |
| LP-0324 | PWA offline fallback page | S | idea | — |
| LP-0325 | PWA app icon + splash screen assets | S | idea | — |
| LP-0011 | Code-splitting: lazy load Player page | S | idea | — |

---

## V1-Perf — Performance Acceptance (part of V1)

| ID | Task | Size | Status | Depends on |
|----|------|------|--------|------------|
| LP-0326 | Create benchmark dataset generator — 20k channels + 50k EPG entries (extend @lumen/demo-data) | M | idea | — |
| LP-0327 | Performance test: time-to-first-channel < 3s with 20k channel dataset | S | idea | LP-0326, LP-0314 |
| LP-0328 | Performance test: memory cap < 200MB RSS with 20k channel dataset | S | idea | LP-0326, LP-0314 |
| LP-0329 | Profile + optimize Cast receiver on older devices (Samsung 2019–2020 target) | M | idea | LP-0108 |

---

## Foundation / Quality

| ID | Task | Size | Status | Depends on |
|----|------|------|--------|------------|
| LP-0001 | Monorepo scaffolding (Turborepo + pnpm + packages) | M | done | — |
| LP-0003 | Add unit tests for `@lumen/core` (epg, time, channels) | S | idea | — |
| LP-0004 | Add unit tests for `@lumen/player-core` (SeekEngine, IdleTimer) | S | idea | — |
| LP-0005 | Add unit tests for `@lumen/input` (NumericChannelInput) | S | idea | — |
| LP-0006 | Add unit tests for `@lumen/storage` (favorites, credentials, watch-history) | S | idea | — |
| LP-0014 | Add ESLint flat config (`eslint.config.*`) for repo/app | S | in-progress | — |
| LP-0015 | CI pipeline: typecheck + lint + build | S | planned | — |
| LP-0211 | FIX: `VersionedStorage.clear()` must clear only namespaced keys (not entire storage) | S | done | — |
| LP-0013 | Replace demo-data import guard so it doesn't enter production bundle | S | idea | — |

---

## Phase 1 — Dashboard + Device Management (idea)

| ID | Task | Size | Status | Depends on |
|----|------|------|--------|------------|
| LP-1501 | Dashboard app scaffold (apps/dashboard or separate repo) | M | idea | — |
| LP-1502 | User registration + auth (email-based) | M | idea | LP-1501 |
| LP-1503 | Device pairing flow — code generation (ABC-123 format), display on TV, enter in dashboard | L | idea | LP-1502 |
| LP-1504 | Xtream/M3U credential management per device in dashboard | M | idea | LP-1503 |
| LP-1505 | Provider accounts — multi-device management, bulk provisioning | L | idea | LP-1502 |
| LP-1506 | Payment integration — free vs paid tier logic | L | idea | LP-1502 |

---

## Phase 2 — Native TV + Mobile Apps (idea)

### TV

| ID | Task | Size | Status | Depends on |
|----|------|------|--------|------------|
| LP-2001 | apps/tv-web Tizen/WebOS project setup | M | pending-review | LP-0104f |
| LP-2002 | TizenPlayerAdapter (AVPlay API) | L | pending-review | LP-0012 |
| LP-2003 | Spatial navigation system for TV | L | pending-review | — |
| LP-2004 | apps/android-tv project setup | L | pending-review | — |
| LP-2005 | Fire TV app setup (Android TV variant) | L | idea | LP-2004 |
| LP-2006 | Apple TV app setup (tvOS) | L | idea | — |

### Mobile

| ID | Task | Size | Status | Depends on |
|----|------|------|--------|------------|
| LP-2008 | Decision: Expo vs Capacitor for mobile wrapper | S | idea | — |
| LP-2009 | iOS mobile app setup (App Store) | L | idea | LP-2008 |
| LP-2010 | Android mobile app setup (Play Store) | L | idea | LP-2008 |
| LP-2011 | iOS lock-screen controls (MPRemoteCommandCenter) | M | idea | LP-2009 |
| LP-2012 | Android MediaSession API integration (lock screen + notification) | M | idea | LP-2010 |

### Infrastruktura

| ID | Task | Size | Status | Depends on |
|----|------|------|--------|------------|
| LP-2007 | Device licensing system — code-based identification (not MAC) | L | idea | LP-1503 |
| LP-2013 | White-label build pipeline (custom branding, domains, store listings) | L | idea | LP-2007 |

---

## Audit notes (2026-02-12)

### Key findings from deep codebase analysis:

1. **Player.tsx je "god component"** — 465 linija, 10 useState, sav playback state je lokalan
2. **PlayerControls.tsx** — 760 linija, prima 14 props i vraca 7 callbacks (props drilling)
3. **3 cela paketa nepovezana**: `@lumen/player-core`, `@lumen/input`, vecina `@lumen/storage`
4. **Duplirani kod**: favorites, channel mappers, formatDuration, channel filtering — postoji i u paketu i inline u apps/web
5. **2 buga**: volume kontrole ne rade (kozmeticke), catch-up seek ne radi (kozmeticki)
6. **`usePWA` hook postoji ali se nigde ne koristi** — nema install UI
7. **`useToast` wired ali niko ne poziva toast()** — Toaster renderuje ali nema poziva
8. **Nema React Context-a** — sve ide kroz props, session refactor uvodi prvi context
9. **`@lumen/session-core` paket NE POSTOJI** — samo je planiran

### Sync notes (2026-02-12)

- `LP-0014` je pokrenut: dodat je `apps/web/eslint.config.mjs`, `pnpm --filter @lumen/web lint` sada radi.
- `LP-0209` nije završen (apps/web još ima raw localStorage), ali storage osnova je poboljšana kroz LP-0211.
