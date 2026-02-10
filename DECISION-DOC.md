# Lumen Player — Decision Document

> **Datum:** 10. Februar 2026
> **Autor:** Filip + Claude Code
> **Status:** Odobren za implementaciju
> **Lokacija projekta:** `/Users/filip/Documents/Lumen Player/`

---

## 1. Executive Summary

**Lumen Player** je cross-platform IPTV player koji cilja:
- Web (PWA) — **Phase 0** (prioritet)
- iOS / Android — Phase 1 (Expo, prelazak na bare kad zatreba)
- Samsung Tizen / LG WebOS — Phase 2 (zasebna TV web app)
- Android TV — Phase 2 (RN bare ili native Kotlin)

**Osnova**: Postojeći `player-standalone` iz balkan-stream projekta (React 18, Vite, HLS.js, shadcn/ui).
**Portovanje**: Vredni feature-i iz starog Lumen SmartTV projekta (exponential seek, numeric channel input, TV remote key codes, idle auto-hide, watch history).
**Arhitektura**: Turborepo + pnpm monorepo sa jasnim razdvajanjem platformi i deljenim packages.

---

## 2. Ključne arhitekturne odluke

### 2.1 Zašto Turborepo + pnpm monorepo?
- Deljeni packages (types, API, core logika) — jednom napisano, koristi se svuda
- Jedinstven CI pipeline
- Konzistentne verzije zavisnosti
- Standard za 2025/2026 React projekte

### 2.2 Zašto NE "jedan build za sve"?
- TV UX je potpuno drugačija disciplina od web/mobile
- Tizen/WebOS zahtevaju platform-specifične player adapter-e (AVPlay, webOS media API)
- Android TV treba ExoPlayer/Media3 sa leanback bibliotekom
- "Web build pokriva TV" je zamka koja košta 6-12 meseci bugova kasnije
- Svaka platforma dobija svoju app sa deljenim business logic packages

### 2.3 Zašto React Native / Expo za mobile (a ne Flutter)?
- Tim već zna React + TypeScript — minimalan learning curve
- 60-80% code reuse sa web (hooks, types, API, state)
- Expo SDK 54+ podržava iOS, Android, TV
- Expo Modules API daje pristup native kodu (Swift/Kotlin) bez "eject-a"
- Plan: početi sa Expo managed, preći na bare kad playback zahteva
- Flutter bi zahtevao učenje Dart-a i potpuni rewrite

### 2.4 Zašto PlayerAdapter pattern?
- Svaka platforma ima drugačiji video engine:
  - Web: HLS.js
  - iOS: AVPlayer (expo-video ili custom)
  - Android: ExoPlayer/Media3
  - Tizen: AVPlay API
  - WebOS: luna://com.webos.media
- Zajednički interfejs omogućava da PlayerControls, SeekEngine, IdleTimer rade identično na svim platformama
- `setSource(MediaSource)` sa DRM, headers, startPosition — spreman za production od starta

---

## 3. Monorepo struktura

```
/Users/filip/Documents/Lumen Player/
├── apps/
│   ├── web/                    # Phase 0: Web PWA (Vite + React + HLS.js)
│   ├── mobile/                 # Phase 1: Expo iOS/Android
│   ├── tv-web/                 # Phase 2: Tizen/WebOS TV app (zasebna Vite app)
│   └── android-tv/             # Phase 2: Android TV (RN bare/native Kotlin)
├── packages/
│   ├── tsconfig/               # Shared TypeScript configs
│   ├── types/                  # @lumen/types — shared TS tipovi
│   ├── api/                    # @lumen/api — Xtream Codes klijent (transport-agnostic)
│   ├── core/                   # @lumen/core — EPG/channel/time domain logika
│   ├── demo-data/              # @lumen/demo-data — Mock kanali, EPG generatori
│   ├── player-core/            # @lumen/player-core — PlayerAdapter + SeekEngine + IdleTimer
│   ├── storage/                # @lumen/storage — Versioned storage + favorites + watch history
│   └── input/                  # @lumen/input — Key codes + numeric channel input
├── turbo.json
├── pnpm-workspace.yaml
├── package.json
├── .gitignore
├── .npmrc
└── CLAUDE.md
```

---

## 4. Packages — šta svaki radi

### @lumen/types
Deljeni TypeScript tipovi: Channel, PlayerChannel, Program, EPGDay, PlaybackState, MediaSource, Xtream API tipovi.

### @lumen/api (transport-agnostic)
- **HttpClient interfejs** — apstrakcija za HTTP transport (ne direktan fetch)
- **FetchHttpClient** — web implementacija (default)
- **XtreamCodesService** — prima HttpClient + credentials kao dependency injection
- **Mappers** — XtreamLiveStream → PlayerChannel konverzija
- Svaka platforma može dati svoj HttpClient (fetch, axios, native HTTP API)

### @lumen/core (čist domain layer)
EPG utils (getCurrentProgram, getProgramProgress), time formatting, channel filtering/sorting. **Bez mock podataka** — to je u demo-data.

### @lumen/demo-data
Mock kanali i EPG generatori. Koristi se samo za development/demo mode. **Ne ulazi u production build.**

### @lumen/player-core
- **PlayerAdapter interfejs** sa `setSource(MediaSource)` — MediaSource: `{ url, mimeType?, headers?, drm?, startPosition? }`
- **Standardizovani eventi**: onStateChange, onTimeUpdate, onBufferUpdate, onTracksChange, onError
- **SeekEngine** — čista state machine (portovano iz SmartTV): exponential speed 5→10→20→...→640
- **IdleTimer** — 5s auto-hide kontrola

### @lumen/storage (versioned od starta)
- **StorageAdapter interfejs** + WebStorageAdapter (localStorage)
- **VersionedStorage** — namespaced ključevi (`lumen:v1:*`) + migration stub
- Credentials, Favorites, WatchHistory — sve koristi VersionedStorage

### @lumen/input (feature-flagged)
- **WebKeyCodes** (aktivni u Phase 0)
- **SamsungKeyCodes, LgKeyCodes** (pod `tv` namespace, aktivni od Phase 2)
- **NumericChannelInput** — čista state machine za numerički unos kanala
- **PlatformDetect** — Tizen/WebOS/Web/Mobile detekcija (stub)

---

## 5. Fazni plan

### Phase 0: Web Player (SADA)
- Kreirati monorepo strukturu
- Kopirati player-standalone kao apps/web osnovu
- Ekstrahisati shared packages
- Portovati SeekEngine, NumericInput, IdleTimer iz SmartTV
- Refaktorisati web app da koristi @lumen/* packages
- Rezultat: funkcionalan web player identičan standalone-u, ali u monorepo sa deljenim packages

### Phase 1: Mobile (KASNIJE)
- Kreirati apps/mobile/ sa Expo
- Koristiti @lumen/types, api, core, storage (sa AsyncStorage adapter-om)
- Kreirati ExpoVideoPlayerAdapter koji implementira PlayerAdapter
- Evaluirati rano da li treba bare workflow za ExoPlayer kvalitet
- Potpuno odvojen UI od web-a (ne shadcn na mobilnom)

### Phase 2: TV (KASNIJE)
- **apps/tv-web/** — Zasebna Vite app za Tizen/WebOS
  - TizenPlayerAdapter (AVPlay API), WebOSPlayerAdapter
  - 10-foot dizajn, spatial navigation, D-pad focus
  - Koristi @lumen/input key codes
  - NIJE "build web app-a" — potpuno odvojena app koja deli packages

- **apps/android-tv/** — RN bare ili native Kotlin
  - ExoPlayer/Media3 sa Leanback
  - Koristi @lumen/types, api, core

---

## 6. Šta se portuje iz Lumen SmartTV

| Feature | Izvor | Destinacija | Kako |
|---------|-------|-------------|------|
| TV remote key codes (Samsung/LG) | `helpers/utility.tsx` L12-83 | `@lumen/input/key-codes.ts` | Direktan port + WebKeyCodes |
| Exponential seek | `PlayerFullScreen.tsx` L421-595 | `@lumen/player-core/seek-engine.ts` | Čista state machine |
| Numeric channel input | `ChannelsList.tsx` L94-181 | `@lumen/input/numeric-input.ts` | Čista state machine |
| Idle auto-hide (5s) | `PlayerFullScreen.tsx` L346-367 | `@lumen/player-core/idle-timer.ts` | Trivijalna ekstrakcija |
| Watch history | `db/channels.tsx` | `@lumen/storage/watch-history.ts` | Interface + basic impl |
| Platform detection | `helpers/utility.tsx` L101-133 | `@lumen/input/platform-detect.ts` | Stub za Phase 2 |

**NE portuje se**: Redux, Axios setup, ReactPlayer, CarouselSnapList, TimelineGrid, ErrorBoundary, IndexedDB bulk insert.

---

## 7. Future-proof odluke (usvojene korekcije)

1. **PlayerAdapter prošireni od starta** — `setSource(MediaSource)` sa DRM, headers, startPosition
2. **Demo data odvojeni od core** — `@lumen/demo-data` umesto mock-a u core
3. **Storage verzionisan** — `lumen:v1:*` namespace + migration stub
4. **API transport-agnostičan** — HttpClient interfejs, ne direktan fetch
5. **State machine klase** — SeekEngine i NumericInput bez DOM logike
6. **Typecheck vs Lint odvojeni** — `pnpm typecheck` (tsc) i `pnpm lint` (eslint)
7. **TV key codes feature-flagged** — ne zagađuju web UX dok TV app ne krene

---

## 8. Tech Stack rezime

| Platforma | Framework | Video Engine | UI |
|-----------|-----------|-------------|-----|
| Web (PWA) | React 18 + Vite | HLS.js | shadcn/ui + Tailwind |
| iOS | Expo (→ bare) | AVPlayer / expo-video | React Native UI |
| Android | Expo (→ bare) | ExoPlayer / expo-video | React Native UI |
| Android TV | RN bare / Kotlin | ExoPlayer/Media3 | Leanback / custom |
| Samsung Tizen | Vite + TS | AVPlay API | Custom TV UI |
| LG WebOS | Vite + TS | webOS media API | Custom TV UI |

### Deljeni packages (svi koriste):
- @lumen/types, @lumen/api, @lumen/core, @lumen/player-core, @lumen/storage, @lumen/input

---

## 9. Izvorni projekti (reference)

| Projekat | Putanja | Uloga |
|----------|---------|-------|
| Player Standalone | `narodna.tv/balkan-stream/player-standalone/` | Osnova za apps/web |
| Lumen SmartTV | `lumen old/lumen-smarttv/` | Feature portovanje (seek, keys, numeric input) |
| Balkan-Stream | `narodna.tv/balkan-stream/` | Parent projekat (sync-to-standalone.sh) |
| DPlayer | `dplayer-project/` | Nebitno — boilerplate bez playera |
| EXYU.tv | `exyu.tv/` | Marketing sajt — koristiće web player na kraju |

---

*Decision Document kreiran: 10. Februar 2026*
