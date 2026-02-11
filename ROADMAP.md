# Roadmap — Lumen Player

> Datum: 11. februar 2026  
> Napomena: ovaj roadmap prati `SESSION-ARCHITECTURE.md`

## Phase 0 (done) — Monorepo Foundation

**Goal:** Stabilan monorepo sa deljenim paketima i funkcionalnim `apps/web`.

- [x] Turborepo + pnpm setup
- [x] `@lumen/*` packages scaffold
- [x] Web app migrirana kroz shim sloj

## Phase 0A (active) — Session MVP

**Goal:** Playback state više ne živi u UI-u, već u centralnoj sesiji.

- [ ] Dodati `@lumen/session-core`
- [ ] Definisati `SessionState`, command i event model
- [ ] Dodati `SessionStore` (BroadcastChannel + storage fallback)
- [ ] Refaktorisati `apps/web` u session-driven klijent

**Exit criteria:** restart/reload klijenta ne gubi aktivnu sesiju i stanje reprodukcije.

## Phase 0B (next) — Cast First-Class Renderer

**Goal:** Cast je nativni deo playback toka, ne dodatak.

- [ ] Uvesti `RendererAdapter` koncept
- [ ] Google Cast sender + receiver flow
- [ ] `switchRenderer(local <-> cast)` bez gubitka sesije
- [ ] Phone-as-remote UI mode

**Exit criteria:** cast prebacivanje i reconnect rade pouzdano u realnim uslovima.

## Phase 0C (next) — AirPlay Secondary Renderer

**Goal:** AirPlay parity gde je platformski moguće.

- [ ] AirPlay renderer kontrolni tok
- [ ] Reconnect/fallback ponašanje
- [ ] Device compatibility test matrix

**Exit criteria:** AirPlay radi stabilno na podržanim uređajima uz jasan fallback.

## Phase 1 — Mobile Packaging (decision pending)

**Goal:** Mobile distribucija bez razbijanja session modela.

- [ ] Potvrda pravca: Expo vs Capacitor wrapper
- [ ] Session parity na iOS/Android
- [ ] Lock-screen/media controls gde platforma dozvoljava
- [ ] Android: MediaSession API za lock screen / notification kontrole (radi i u PWA)
- [ ] iOS: MPRemoteCommandCenter za lock screen / Control Center kontrole (zahteva native wrapper)
- [ ] iOS: Live Activity / Dynamic Island podrška (iOS 16.1+, native only)

**Exit criteria:** mobile klijent upravlja istom sesijom kao web i cast.

## Phase 2 — TV Expansion (optional)

**Goal:** Procena da li dedicated TV app donosi dodatnu vrednost pored cast-centric modela.

- [ ] Business/usage review za Tizen/WebOS/Android TV native app
- [ ] Ako treba: `apps/tv-web` / `apps/android-tv` kao zaseban workstream

**Exit criteria:** jasna odluka "cast-only" ili "cast + native TV apps".
