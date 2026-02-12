# Roadmap — Lumen Player

> Datum: 12. februar 2026
> Napomena: ovaj roadmap prati `SESSION-ARCHITECTURE.md` i `VISION.md`

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

## V1 — Complete Web/PWA Player

> Faze ispod čine V1 milestone. Redosled je fleksibilan — mogu ići paralelno gde nema zavisnosti.

### Phase V1-Content — VOD, Series, M3U, Performanse

**Goal:** Kompletna Xtream kompatibilnost + M3U podrška + performanse za velike liste.

- [ ] VOD kategorije, film detail (TMDB metadata), VOD player
- [ ] Series lista, sezone, epizode, series player
- [ ] M3U parser (`@lumen/m3u` ili u `@lumen/api`)
- [ ] M3U import UI (URL + file upload)
- [ ] Unified channel model (Xtream + M3U → isti Channel tip)
- [ ] Virtualizacija channel liste (@tanstack/react-virtual)
- [ ] EPG grid view (TV guide stil)
- [ ] XMLTV bulk EPG import
- [ ] Settings stranica
- [ ] Multi-audio/subtitle track selekcija
- [ ] Picture-in-Picture

### Phase V1-Cast — Cast First-Class Renderer

**Goal:** Cast je nativni deo playback toka, ne dodatak.

- [ ] Uvesti `RendererAdapter` koncept
- [ ] Google Cast sender + receiver flow
- [ ] `switchRenderer(local <-> cast)` bez gubitka sesije
- [ ] Phone-as-remote UI mode

### Phase V1-AirPlay — AirPlay Secondary Renderer

**Goal:** AirPlay parity gde je platformski moguće.

- [ ] AirPlay renderer kontrolni tok
- [ ] Reconnect/fallback ponašanje
- [ ] Device compatibility test matrix

### Phase V1-PWA — PWA Production Readiness

**Goal:** PWA install, offline fallback, production polish.

- [ ] PWA install UI (prompt + button)
- [ ] Offline fallback stranica
- [ ] App icon + splash screen
- [ ] Code-splitting (lazy load Player page)

### Phase V1-Perf — Performance Acceptance

**Goal:** Dokazati da player radi sa 20k+ kanala bez laganja.

- [ ] Benchmark dataset: 20k kanala + 50k EPG entries
- [ ] Time-to-first-channel metric (< 3s target)
- [ ] Memory cap test (< 200MB RSS target)
- [ ] Profile & optimize na starijim uređajima (Samsung 2019–2020 Cast receiver)

**V1 Exit criteria:** player podržava Live + VOD + Series iz Xtream i M3U izvora, Cast radi pouzdano, 20k+ kanala bez laganja, PWA installable.

---

## Phase 1 — Dashboard + Device Management

**Goal:** Web dashboard za upravljanje korisnicima, uređajima i credentials-ima.

- [ ] Dashboard app scaffold (`app.lumenplayer.com`)
- [ ] User registration + auth (email)
- [ ] Device pairing flow (kod generisanje, ABC-123 format)
- [ ] Xtream/M3U credential management per device
- [ ] Provider accounts (multi-device management)
- [ ] Free vs Paid tier logic
- [ ] Payment processing integracija

**Exit criteria:** korisnik može da registruje nalog, pair-uje uređaj kodom, i dodeli credentials kroz dashboard.

## Phase 2 — Native TV + Mobile Apps

**Goal:** Dedicirane app store aplikacije za sve platforme.

### TV
- [ ] Samsung Tizen Store app
- [ ] LG WebOS Store app
- [ ] Android TV / Fire TV app (Google Play)
- [ ] Apple TV app (App Store)

### Mobile
- [ ] Potvrda pravca: Expo vs Capacitor wrapper
- [ ] iOS mobile app (App Store)
- [ ] Android mobile app (Play Store)
- [ ] Lock-screen/media controls (MediaSession API, MPRemoteCommandCenter)

### Infrastruktura
- [ ] Device licensing system (kod-based, ne MAC)
- [ ] White-label opcija za partnere

**Exit criteria:** native apps u store-ovima, licensing sistem funkcionalan, PWA ostaje kao fallback.
