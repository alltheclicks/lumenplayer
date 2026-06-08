# Lumen Player — Sveobuhvatni razvojni izveštaj (Phase 0A → V1)

> Datum: 7. jun 2026
> Referentni dokument za vlasnika projekta (Filip) i razvojne agente. Sintetiše rekonstrukciju koda, eksterno istraživanje i adverzijalno verifikovane nalaze. Kod, putanje i tehnički termini su na engleskom; analiza na srpskom (latinica).
> Metod: multi-agent audit (8 recon + 5 research + 6 deep-audit agenata) sa adverzijalnom verifikacijom 15 high/critical nalaza direktno u izvoru (14 potvrđeno, 1 odbačen).

---

## 1. Izvršni rezime

Lumen Player je session-centric IPTV platforma izgrađena kao Turborepo + pnpm monorepo. Njena **arhitektonska osnova je odlična**: session state je ispravno centralizovan u `@lumen/session-core` (idempotentne komande, BroadcastChannel cross-tab sync, `useSyncExternalStore` most ka React-u), HTTP transport je apstrahovan kroz `HttpClient` interfejs, a storage je verzionisan radi buduće migracije na mobilne/native platforme. Web aplikacija (Phase 0) je funkcionalno bogata — pokriva live, VOD, serije, EPG, catch-up, Cast, PWA i push — i provajderski je robusna (rate-limit handling, MediaKing workaround-i, MPEG-TS audio stripping). **Glavni problemi nisu arhitektonski nego strukturni i strateški**: dve „God Component" datoteke (`Player.tsx` 3029 LOC, `VideoPlayer.tsx` 3742 LOC) koncentrišu rizik i otežavaju održavanje; HLS.js je za live konfigurisan suprotno od dokumentovanih best practice (worker isključen, LL-HLS uključen na ne-LL serverima); a release-gate/QAF-035 mašinerija (≈12K LOC validatora, 7-uređajni device matrix) pretpostavlja Phase 1/2 zrelost koju Phase 0A ne isporučuje. Specifikacijski (VISION) najveći jaz je da TMDB/IMDB metadata enrichment ne postoji (samo prosleđivanje ID-jeva), 20k-kanala stress-test nije validiran, a Cast dual-video zapping je tehnički neizvodljiv na Cast prijemniku (jedan media element).

### Zrelost po oblasti

| Oblast | Ocena (1–5) | Razlog (jedna linija) |
|---|---|---|
| Shared packages (`@lumen/*`) | **4** | Čista, platform-agnostic arhitektura; dva storage modula krše apstrakciju (`credentials.ts`, `favorites.ts`). |
| App shell / routing | **3** | Idiomatičan session-centric React, ali nema route guard, nema error boundary, minimalan code-split. |
| Playback runtime (HLS) | **3** | Snažna error-recovery logika, ali pogrešna live HLS konfiguracija i monolitni `VideoPlayer.tsx`. |
| Catch-up / timeshift | **3** | Funkcionalno i provajderski-svesno, ali ekstremno gusta metadata-marshaling, ručno održavan capability matrix. |
| Xtream / EPG / data | **4** | Potpuna API pokrivenost, pametan caching; nedostaje TMDB enrichment i scale-test. |
| Google Cast | **3** | Solidan sender + dual-video receiver, ali dual-video nije izvodljivo na Cast-u; prod App ID nije obezbeđen. |
| PWA / push | **3** | Kompletan PWA setup; push backend je client-side localStorage stub, postoji odvojen `push-api` server bez integracije. |
| Proxy server | **4** | Dobro fokusiran, allowlist/SSRF zaštita, no-media hard guard; nedostaje rate limiting i redakcija kredencijala u logovima. |
| Security | **3** | Dobre osnove (allowlist, mixed-content reject), ali kredencijali u URL-ovima/logovima, CORS `*`. |
| Release-gates / CI / testing | **2** | Mašinerija disproporcionalno teška za Phase 0A; nema brzog unit/integration test signala. |

---

## 2. Mapa sistema

Monorepo: `@lumen/types` je koren zavisnosti za sve pakete. `apps/web` je Phase 0 deliverable (PWA controller + local renderer). `apps/proxy` je opcioni Fastify CORS/mixed-content servis. `apps/push-api` je standalone Node push backend (nije integrisan sa web-om).

```
                          ┌──────────────────────────────────────────────┐
                          │                @lumen/types                   │
                          │  (Channel, PlayerChannel, MediaSource,        │
                          │   PlayerAdapter, RendererAdapter, Storage…)   │
                          └───────────────┬──────────────────────────────┘
            ┌──────────────┬──────────────┼───────────────┬──────────────┐
            ▼              ▼              ▼               ▼              ▼
      @lumen/api    @lumen/core   @lumen/storage   @lumen/player-core  @lumen/input
      (Xtream,      (epg,         (Versioned,      (SeekEngine,        (key-codes,
       mappers,     channels)      Web adapter,     IdleTimer)          numeric,
       m3u-parser)                 watch-history;                       platform-detect)
       HttpClient DI               credentials/
                                   favorites = VIOLATION)
            └──────────────┬──────────────┬───────────────┬──────────────┘
                           ▼              ▼
                   @lumen/session-core  @lumen/demo-data
                   (SessionStore = SOURCE OF TRUTH,
                    idempotent reducer, BroadcastChannel,
                    contracts: SessionState/Command/Event)
                           │
                           ▼
   ┌───────────────────────────────────────────────────────────────────────┐
   │                              apps/web (PWA)                             │
   │  App.tsx ─ Router ─ SessionProvider ─ QueryClient ─ HelmetProvider      │
   │     │                                                                   │
   │     ├─ AppShell (Outlet, mobile nav, scroll-lock)                       │
   │     ├─ Pages: Login, Player(3029), VodCategories/Detail,                │
   │     │         SeriesCategories/Detail, EpgGuide, Settings, M3UImport    │
   │     ├─ Player ──► VideoPlayer(3742) ──► HlsPlayerAdapter ──► <video>+hls │
   │     │              │  └─ mpegTsAudioStrip (TS audio fix)                │
   │     │              └─ PlayerControls (SeekEngine, IdleTimer)            │
   │     ├─ useGoogleCastSender ──► (BRIDGE_NAMESPACE) ──► receiver.html      │
   │     │                                                  (dual-video A/B)  │
   │     └─ Services: xtreamService, channelEpg, xmltvEpg, observability,    │
   │                  pushSubscriptionClient/Backend, storage, appSettings   │
   └───────────────┬───────────────────────────────────┬───────────────────┘
                   │ /xui-api/<encoded>/* ,             │ POST /api/push/*
                   │ /catchup-gateway/resolve           ▼
                   ▼                            apps/push-api (Node :8787)
        apps/proxy (Fastify)                    (web-push, file-JSON store)
        - allowlist + SSRF guard                   [NIJE integrisan sa web client-om]
        - HLS manifest rewrite
        - MediaKing TS junk strip / discontinuity
        - catchup-gateway (provider-direct | proxy-normalized)
        - remux/ffmpeg HARD-DISABLED (410)
                   │
                   ▼
        Xtream Codes provideri (login host → 302 → edge/archive host;
        mediaking.fi, castcdn.net…)
```

**Tok komandi/podataka:** UI komponente pozivaju `useSessionCommands` → `SessionStore.dispatch(command)` → idempotentni reducer ažurira `SessionState` → `useSyncExternalStore` notifikuje React. `VideoPlayer` čita `session.source/playback/positionMs` i vozi `HlsPlayerAdapter`. Catch-up: `catchupSource.ts` → capability check → opcioni gateway → `catchupTransport` plan (do 16 pokušaja) → `sessionSources` ugrađuje metadata u `SessionSource.metadata`. Cast: `useGoogleCastSender` je samo još jedan renderer koji vozi isti session state (telefon = kontroler, prijemnik renderuje nezavisno).

---

## 3. Po oblasti: šta je odlično / dobro / slabo

### 3.1 Shared packages (`@lumen/*`)

**Odlično**
- `SessionStore` je tačno pozicioniran kao source-of-truth: idempotentni reducer, cross-tab sync, event emission. Pokriveno testovima u `packages/session-core/src/session-store.idempotency.test.ts` (5 testova). [strength, high]
- `HttpClient` apstrakcija (`packages/api/src/http-client.ts`) — DI u `XtreamCodesService`, exponential backoff + Retry-After; nema direktnog `fetch()` u biznis logici. [strength, high]
- `VersionedStorage` (`packages/storage/src/versioned-storage.ts`) — `lumen:v1:*` namespace + index za bezbednu migraciju. `WatchHistoryStorage` je uzorni primer pravilne upotrebe `StorageAdapter`. [strength, high]
- `SeekEngine`/`IdleTimer` (`packages/player-core/src/`) — čiste state machine bez DOM/platform zavisnosti, spremne za reuse na iOS/Android/Tizen. [strength, high]

**Slabo**
- **VIOLATION:** `packages/storage/src/credentials.ts:6,10,16` koristi `localStorage` direktno umesto `StorageAdapter` — blokira AsyncStorage (RN) / Keychain (iOS). [weakness, **high**]
- **VIOLATION:** `packages/storage/src/favorites.ts:4-10` koristi `typeof window` guard + direktan `localStorage` — nekonzistentno sa `watch-history.ts`. [weakness, **high**]
- Nema testova za `WebStorageAdapter` ni `VersionedStorage`. [gap, medium]
- `FetchHttpClient` nema timeout — verifikovano da `http-client.ts` ne sadrži `AbortController`/`signal`/`timeout`; hung konekcije mogu visiti neograničeno. [gap, **medium**]
- `session-core` nema consumer testove (BroadcastChannel multi-tab, persist round-trip, error state, source tranzicije). [gap, medium]

### 3.2 App shell / routing

**Dobro**
- Session-centric delegacija (`SessionProvider` + `useSessionContext`) je idiomatska; nema dupliranja playback state-a u UI-u. [strength, high]
- Code-split za `Player` (lazy + Suspense u `App.tsx`). [strength, medium]
- Responsive: Tailwind `md:` breakpoints, `100dvh/100svh` za mobilni safe-area, scroll-lock za player rutu. [strength, medium]

**Slabo**
- **Nema route guard-a**: sve sem `/login` je javno rutabilno; race-condition dok se kredencijali hidriraju asinhrono. [risk, medium]
- **Nema error boundary** u `App.tsx` — pad jedne stranice ruši celu aplikaciju (beli ekran). [gap, medium]
- Lazy-loading minimalan (samo `Player`); ostale teške stranice se eager-učitavaju. [weakness, low]
- VOD/Series paginacija je client-side slicing preko `visible` URL param-a — degradacija pri 300+ stavki. [weakness, medium]

### 3.3 Playback runtime (HLS, tracks, PiP, idle)

**Odlično**
- Load-generation semantika (`nextLoadGeneration`/`assertCurrentLoad`) sprečava race na brzom switchu; `stopCompetingPlayback` gasi rivalske `<video>`. [strength, high]
- Proaktivna MPEG-audio preflight detekcija + `mpegTsAudioStrip` (rebuild PMT, CRC32). [strength, high]
- Throttled MEDIA_ERROR recovery ladder (cap pokušaja, buffering-stall timer). [strength, high]
- Mixed-content reject (HTTPS stranica + HTTP stream → fatal pre load-a). [strength, high]
- Audio/subtitle track sync (HLS indeksi + native track API, unified model). [strength, high]

**Slabo (verifikovano file:line — vidi sekciju 5)**
- `HlsPlayerAdapter.ts:627` `enableWorker: !isLiveSource` — **isključuje worker za live**, suprotno best practice. [weakness, **high**]
- `HlsPlayerAdapter.ts:628` `lowLatencyMode: isLiveSource` — **uključuje LL-HLS na Xtream serverima koji ga ne podržavaju**, uzrokuje 429. [weakness/risk, **high**]
- `HlsPlayerAdapter.ts:638` `backBufferLength: 90` za **sve** modove — memory rast pri channel-surf, rizik pada na TV. [weakness, **high**]
- `VideoPlayer.tsx` (3742 LOC) — monolitni catch-up orchestration; ~1200 LOC fallback chain. [weakness, **high**]
- Nema fatal-NETWORK_ERROR → `startLoad()` recovery (samo MEDIA_ERROR se oporavlja). [gap, medium]
- `RendererAdapter` definisan u tipovima ali **nijedna implementacija** ne postoji; `VideoPlayer` hardkoduje local-web. [weakness, high]
- `setSource(MediaSource)` ne obrađuje `source.drm` ni custom headers — DRM nije integrisan. [gap, high — relevantno za buduće provajdere]

### 3.4 Catch-up / timeshift

**Dobro**
- Čista slojevitost: capability (`catchupCapability.ts`) → transport plan (`catchupTransport.ts`, 16 pokušaja) → gateway (`catchupGateway.ts`) → error (`sourceBlockingError.ts`). [strength]
- No-media-processing rigorozno sprovedeno (proxy remux 410, ffmpeg feature-gated out). [strength]
- Provajderski workaround-i izolovani i dokumentovani (MediaKing host affinity, local-time offset, discontinuity). [strength]
- Runtime compatibility cache (`catchupRuntimeCompatibility.ts`, TTL 30min, redaktuje kredencijale). [strength]

**Slabo**
- `buildCatchUpTransportPlan()` duboko ugnježden, 7+ uslova, 3 ortogonalne kategorije pokušaja — težak za čitanje. [weakness, medium]
- `sessionSources.ts` (596 LOC, verifikovano) — gusta metadata marshaling sa 12+ polja; male promene → tihi padovi. [weakness, medium]
- Host affinity memorija je module-scope `Map` bez TTL/decay — rizik od bajatih edge host-ova. [weakness, medium]
- Capability matrix je ručno održavan static JSON (snimak 2026-05-13) — decay rizik. [weakness, medium]
- Live↔catch-up tranzicije nemaju integration test state machine-a. [risk, **high**]

### 3.5 Xtream / EPG / data

**Odlično**
- Potpuna API pokrivenost (13 endpoint-a: live/VOD/series/EPG/XMLTV/catch-up). [strength, high]
- Rate-limit handling u `channelEpg.ts` (429 detekcija, exp backoff, stale-cache fallback). [strength, high]
- Dual EPG path (short + archive fallback, merge po signaturi). [strength, high]
- M3U + Xtream unifikovan model; channel virtualizacija (`@tanstack/react-virtual`, overscan 10/8). [strength, high]
- EPG text normalizacija (base64 → HTML entities → unicode → mojibake CP1252 repair). [strength, medium]

**Slabo**
- **TMDB/IMDB enrichment ne postoji** — samo prosleđivanje `tmdb_id` iz Xtream-a; nema eksternih API poziva. [gap, **high**]
- **Nema 20k+ kanala stress-testa** — overscan tuning je empirijski. [gap, **high**]
- Watch history čuva samo `channelId` — nema VOD/series resume pozicija. [gap, medium]
- Nema circuit breaker-a / provider health check-a. [gap, medium]
- EPG cache nema schema verzionisanje. [gap, low]

### 3.6 Google Cast

**Dobro**
- Sender hook (`useGoogleCastSender.ts`, 634 LOC verifikovano) — pun sync kontrakt (2s interval, 1.5s threshold). [strength, high]
- **MP2 Cast guard** (`useGoogleCastSender.ts:12-13,127-128`, PR #224 grana): kad je live audio MP2, Cast se blokira sa porukom „nije dostupan za ovaj kanal". To je **guard sa porukom, NE rešenje audija** (vidi 3.6.1). [napomena, ispravka ranije tvrdnje „MP2 codec filter"]
- Receiver (`receiver.html`) dual-video A/B bridge — čista preload/swap arhitektura sa perf stats. [strength, high]

**Slabo**
- **Cast App ID silent fallback**: `useGoogleCastSender.ts:9` `DEV_CAST_RECEIVER_APP_ID = 'CC1AD845'`; nema runtime greške ako prod ID nedostaje (`:101-108`, `:330`). [weakness, **medium**]
- **Dual-video zapping na samom Cast prijemniku nije izvodljiv** — Cast uređaji izlažu jedan media element. Trenutni receiver A/B radi, ali strategija mora biti queue-preload ili source-swap. [risk, **high — strateški**]
- Receiver observability je samo `console` (`[lumen-cast-observe]`), bez slanja nazad. [weakness, medium]

### 3.6.1 MP2 audio — kanali bez zvuka u web/PWA [P0 audio gap, dodato 2026-06-08]

> Verifikovano u kodu (grana `codex/qaf-035-production-web-catchup`, PR #224; na `main` ovog koda NEMA).

**Problem (fundamentalan, ne bug):** Browser MSE (HLS.js put u Chrome/Edge) **ne dekoduje MPEG-1/2 Layer II (MP2) audio**. Kanali sa MP2 audio track-om imaju **sliku bez zvuka** — i live i catch-up. Native playeri (TiviMate) nemaju problem jer ne idu kroz MSE.

**Šta JE urađeno (PR #224) — detekcija + graceful degradation, NE fix zvuka:**
- `HlsPlayerAdapter.ts:596-606` — `shouldUseMpegAudioVideoOnlyFallback(url)` probe-uje live manifest; ako je MP2 → emituje `onUnsupportedAudioCodec` i pušta **video-only** (slika bez zvuka). [strength — degradacija umesto crnog ekrana]
- `VideoPlayer.tsx:1742-1775,2892,3682` — hvata događaj, state, overlay poruka: „Zvuk nije dostupan za ovaj kanal. Kanal koristi MP2 audio… Video može raditi bez zvuka."
- `sessionSources.ts:18,68,313` — propagira `unsupportedAudioCodec:'mp2'` kroz session metadata.
- `useGoogleCastSender.ts:12,127` — blokira Cast za MP2 sa porukom.

**Šta NIJE urađeno (i ovde je suština):**
- **Stvarni fix zvuka = transcode MP2→AAC** — ne postoji aktivno nigde. Remux/copy NE pomaže (audio ostaje MP2). [gap, **high**]
- Video-only fallback je gated samo na **live** (`isLiveSource && probeLiveMpegAudio`); catch-up MP2 putanja nije eksplicitno pokrivena istim probe-om. [gap, medium]
- Sve to živi **samo na PR #224 grani** — na `main` (i u MVP baseline-u) MP2 detekcija ne postoji uopšte. [risk, **high**]

**Strateška kontradikcija (vidi 3.4 + 4):** transcode put POSTOJI napisan (`apps/proxy/src/catchup-remux.ts`, profil `transcode` → `-c:a aac`), ali ga je **QAF-035 no-media politika namerno hard-disable-ovala** (`server.ts:597,624,722` → 410; web `catchupGateway.ts:194` isključuje `proxy-remuxed`; `e5e9e07` disable-ovao i probe). Dakle jedino tehničko rešenje za zvuk je politikom zabranjeno. Odluka (transcode na serveru videoteke vs reaktivacija proxy transcode-a vs prihvatanje degradacije) je vlasnička i nije doneta. Praćeno kao task **M1.6** u `RELEASE-PLAN-MVP-BETA-FINAL.md`.

### 3.7 PWA / push

**Dobro**
- Kompletan PWA setup (`vite.config.ts`, VitePWA autoUpdate, manifest, `offline.html`, NetworkFirst 3s). [strength, high]
- `pushCompatibility.ts` ispravno detektuje iOS 16.4+, Android, TV unsupported. [strength]

**Slabo**
- **Push backend je client-side `localStorage` stub** (`pushSubscriptionBackend.ts`, key `push_subscriptions_v1`); pravi `apps/push-api` server **nije integrisan** sa web client-om. [weakness, **medium**]
- Observability events samo `console` — nema backend kolekcije ni alertinga. [weakness, medium]
- Push payload nema deep-link u kanal/program (samo `/player`). [gap, low]
- `push-api` `configureWebPush` soft-fail-uje ako VAPID env nedostaje → tihi padovi slanja. [risk, medium]

### 3.8 Proxy server

**Odlično**
- Allowlist validacija pre svakog upstream fetch-a (`isHostAllowed`), wildcard podrška — sprečava open-relay/SSRF. [strength, high]
- Remux/transcode hard-disabled runtime guard-om: `server.ts:717,722` → `sendRemuxDisabledError` (410) PRE downstream obrade; defense-in-depth (`server-registry.ts`). [strength, high]
- Redirect chain re-validacija allowlist-a; HLS manifest rewrite ka proxy formi; streaming bez buffer-a (`hijack()`). [strength, medium]

**Slabo**
- **Nema rate limiting-a / concurrency cap-a** — visok volumen requestova može preopteretiti provajdera/memoriju. [weakness, medium]
- **Kredencijali u URL-ovima se loguju** (`request.url` sadrži username/password u `/timeshift/` putanjama). [weakness, **low→medium**]
- CORS `*` za Allow-Origin i Allow-Headers (arhitektonski trade-off). [weakness, medium]
- Nema redirect depth limit-a; hardkodovana MediaKing host detekcija. [gap, low]

### 3.9 Security (presek)

- Mixed-content reject u HLS adapteru — dobro. [strength, high]
- Allowlist + SSRF zaštita u proxy-ju — dobro. [strength, high]
- Kredencijali u plaintext URL-ovima/logovima — treba redakcija. [weakness, medium]
- URL string-manipulacija na provider redirect lancima (`rewriteCatchUpUrlTargetOrigin`) oslanja se na browser `URL()` bez eksplicitne sanitizacije — protocol-injection rizik. [risk, **high**]

### 3.10 Release-gates / CI / testing

**Odlično**
- Validatori dobro faktorisani (single-responsibility, artifact+command specifični). [strength, high]
- No-media policy višeslojno dokumentovana (VISION + runbook + validator testovi + CI). [strength, high]

**Slabo / disproporcija**
- **Mašinerija je nesrazmerno teška za Phase 0A**: ~12K LOC validatora, 47 `release:*` npm skripti, 7-uređajni device matrix (Android/iOS/AirPlay/Tizen), capacity/observability/security baseline — pretpostavlja Phase 1/2 koja nije započeta. [gap, **high**]
- **Nema brzog unit/integration test signala** — većina signala dolazi iz validatora (koji testiraju sebe) i e2e (zahteva staging + kredencijale). [weakness, **high**]
- **73 od poslednjih 100 commit-ova su `release`-tagovani** (verifikovano `git log`) — overwhelming većina skorašnjeg rada je release-gate churn, ne feature rad. [weakness, **high**]

---

## 4. Usklađenost sa specifikacijom (VISION)

| Obećana V1 sposobnost | Status | Napomena |
|---|---|---|
| Xtream Codes 100% kompatibilnost (live/VOD/series/EPG/catch-up) | **Done** | 13 endpoint-a u `xtream-codes-service.ts`. |
| M3U import | **Done** | `m3u-parser.ts` + `M3UImport.tsx`; catch-up samo binarni flag. |
| 20.000+ kanala bez laganja (virtualizacija) | **Partial** | Virtualizacija aktivna (`ChannelList.tsx`), ali **nema validiranog 20k stress-testa**. |
| VOD film detail sa TMDB/IMDB metapodacima | **Missing** | Samo `tmdb_id` passthrough; **nema eksternih TMDB/IMDB poziva**. |
| EPG / catch-up (TV unazad) | **Done** | XMLTV bulk + per-channel short EPG, dual-path. |
| Multi-audio / multi-subtitle izbor | **Done** | Mapirano u `HlsPlayerAdapter` (HLS + native); nedostaje auto-preference po jeziku. |
| Picture-in-Picture | **Partial** | Standard + WebKit PiP detekcija; nema testa permisija/izuzetaka. |
| Google Cast (first-class) | **Partial** | Sender + receiver rade; **dual-video na Cast-u nije izvodljiv**, prod App ID nije obezbeđen. |
| Cast dual-video prefetch zapping | **Missing/Infeasible** | Cast = jedan media element; treba queue-preload/source-swap strategija. |
| AirPlay | **Partial** | Detekcija dostupnosti radi; nema AirPlay-specific playback flow-a. |
| PWA install + offline fallback | **Done** | `vite-plugin-pwa`, `offline.html`; nema offline playback-a. |
| Push notifikacije | **Partial** | Client + SW handler rade; backend je localStorage stub, `push-api` neintegrisan. |
| Session nezavisan od uređaja (cross-renderer) | **Partial** | Session model odličan; ali on-demand volume/seek state živi u `Player.tsx`, ne u sesiji → može se izgubiti pri renderer switch-u. |
| No-media-processing (no ffmpeg/remux/transcode) | **Done** | Hard-disabled u proxy (410) i feature-gated; VISION addendum poštovan. |
| HTTP+HTTPS kompatibilnost | **Done** | Mixed-content guard + proxy. |
| Multi-renderer (RendererAdapter) apstrakcija | **Missing** | Interfejs definisan, **nula implementacija**; `VideoPlayer` hardkoduje local-web. |
| Native TV / mobile (Phase 1/2) | **Not started** | Po planu; release-gates ipak već zahtevaju njihove dokaze. |

---

## 5. Kritični nalazi (verifikovani)

> Verifikovano u repozitorijumu na grani `codex/qaf-035-production-web-catchup`. Trust verdicts > sirove audit tvrdnje.

### KN-1 — Live HLS isključuje Web Worker (visok)
- **Problem:** `enableWorker: !isLiveSource` → transmux/parse na main thread-u za live.
- **Dokaz:** `apps/web/src/adapters/HlsPlayerAdapter.ts:627` (verifikovano).
- **Uticaj:** Jank i pad performansi, posebno na low-power Android TV/Tizen/webOS; suprotno HLS.js dokumentaciji (`enableWorker:true` non-negotiable za IPTV).
- **Preporuka:** Postaviti `enableWorker: true` i za live (osim ako postoji dokumentovan worker bug — tada zapisati zašto).

### KN-2 — LL-HLS uključen na Xtream serverima koji ga ne podržavaju (visok)
- **Problem:** `lowLatencyMode: isLiveSource` šalje `_HLS_msn/_HLS_part` requestove; serveri odgovaraju 429/503.
- **Dokaz:** `apps/web/src/adapters/HlsPlayerAdapter.ts:628` (verifikovano). Kontradikcija sa projektnim MEMORY pravilom („`lowLatencyMode` MORA biti `false` za catch-up i verovatno live").
- **Uticaj:** Redundantni requestovi → rate-limiting (429) → nestabilnost.
- **Preporuka:** `lowLatencyMode: false` za Xtream live; uključiti `true` samo kad se u manifestu detektuje `EXT-X-PART`/`EXT-X-SERVER-CONTROL`.

### KN-3 — Prekomeran back buffer za live (visok)
- **Problem:** `backBufferLength: 90` za sve modove uključujući live.
- **Dokaz:** `apps/web/src/adapters/HlsPlayerAdapter.ts:638` (verifikovano).
- **Uticaj:** Memory rast pri brzom channel-surf-u (nema rewind UI za live), rizik pada na memorijski ograničenim TV uređajima — poklapa se sa projektnim catchup-transport beleškama.
- **Preporuka:** Live `backBufferLength` ~10–30s; zadržati ~90s samo za catch-up (legitimno treba scrub-back).

### KN-4 — Storage moduli krše platform-agnosticism (visok)
- **Problem:** `credentials.ts` i `favorites.ts` koriste `localStorage` direktno, ne `StorageAdapter`.
- **Dokaz:** `packages/storage/src/credentials.ts:6,10,16`; `packages/storage/src/favorites.ts:4-10` (verifikovano).
- **Uticaj:** Blokira RN/Expo (AsyncStorage) i native iOS (Keychain) — direktno protiv VISION/DECISION-DOC cilja.
- **Preporuka:** Refaktorisati da injektuju `StorageAdapter` po uzoru na `watch-history.ts`.

### KN-5 — Dve „God Component" datoteke koncentrišu rizik (visok)
- **Problem:** `Player.tsx` (3029 LOC, verifikovano) i `VideoPlayer.tsx` (3742 LOC, verifikovano) sa 30+ useEffect-a, kompleksnim dependency array-jevima.
- **Dokaz:** verifikovani LOC; `sessionSources.ts` 596 LOC.
- **Uticaj:** Visok rizik stale-closure/infinite-loop bug-ova; izmene su skupe i opasne; otežava testiranje i reuse za native.
- **Preporuka:** Dekompozicija u: `CatchUpPanel`, `ChannelSelector`, `PlaybackRestorer`, `OnDemandControls`, i izdvojen `catch-up-fallback-strategy` modul + state machine sa testovima.

### KN-6 — Multi-renderer apstrakcija ne postoji u implementaciji (visok)
- **Problem:** `RendererAdapter` definisan u `@lumen/types`, ali nijedna implementacija; `VideoPlayer` hardkoduje local-web, `session.renderer` se koristi samo za logging.
- **Uticaj:** Cast/AirPlay nisu pravi renderer-i; on-demand volume/seek state ne preživljava renderer switch.
- **Preporuka:** Implementirati `RendererAdapter` (bar `local-web` + `cast`) i pomeriti on-demand state u session metadata.

### KN-7 — Cast dual-video zapping nije izvodljiv na prijemniku (visok, strateški)
- **Problem:** Cast uređaji izlažu **jedan** media element; dual-video prefetch tehnika iz lokalnog renderer-a se ne može preneti.
- **Dokaz:** Google Cast dokumentacija (istraživanje, sekcija 8).
- **Uticaj:** Ako se Cast doda bez prilagođene strategije, zapping daje crni ekran između kanala.
- **Preporuka:** Za Cast koristiti queue preload API (`preloadTime`) ILI custom CAF receiver sa source-swap pre-fetch-om; dual-video zadržati samo za lokalni web renderer.

### KN-8 — Cast App ID silent fallback u produkciji (srednji)
- **Problem:** Dev fallback `CC1AD845` bez runtime greške ako prod ID nedostaje.
- **Dokaz:** `apps/web/src/hooks/useGoogleCastSender.ts:9,101-108,330,552` (verifikovano).
- **Uticaj:** Tiha degradacija na pogrešan/null receiver u produkciji.
- **Preporuka:** Hard-fail (vidljiva greška) ako `VITE_GOOGLE_CAST_APP_ID` nije postavljen van dev-a.

### KN-9 — Live↔catch-up state machine bez integration testova (visok)
- **Problem:** Tranzicije (snap-to-live, timeshift prozor, runtime cache, switch-to-live) su raspršene; pri clock skew/network lag korisnik vidi konfuzno stanje.
- **Uticaj:** Teško reprodukovati/popraviti regresije.
- **Preporuka:** Izdvojiti state machine i pokriti integration testovima (bez punog browser-a).

### KN-10 — FetchHttpClient bez timeout-a (srednji)
- **Problem:** Nema `AbortController`/timeout; hung konekcija visi neograničeno.
- **Dokaz:** `packages/api/src/http-client.ts` (95 LOC) ne sadrži `timeout/AbortController/signal` (verifikovano grep-om — prazan rezultat).
- **Preporuka:** Dodati konfigurabilan timeout (default 10–30s).

**Spušteno/odbačeno:** No-media policy enforcement je tačan i sproveden (proxy 410 hard guard verifikovan na `server.ts:717,722`) — nije rizik nego strength; relevantan rizik je samo da nedostaje runtime-guard test pokrivenost za slučaj ponovnog uključivanja remux-a.

---

## 6. Plan: MVP → Beta → Final (web/PWA)

> Marširajući redosled za dev agente. Effort: S (≤0.5d), M (≤2d), L (>2d). Najpre stabilnost/performanse, pa specifikacijski jaz, pa polish.

### Faza A — MVP hardening (stabilnost + performanse; PRIORITET)
- [ ] **S** — `enableWorker: true` za live. `HlsPlayerAdapter.ts:627`. (KN-1)
- [ ] **S** — `lowLatencyMode: false` za Xtream live; gate na `EXT-X-PART` detekciju. `HlsPlayerAdapter.ts:628`. (KN-2)
- [ ] **S** — Live `backBufferLength` ~10–30s, catch-up ~90s. `HlsPlayerAdapter.ts:638`. (KN-3)
- [ ] **M** — Strukturisane HLS load policies (`fragLoadPolicy`/`playlistLoadPolicy`, `backoff:'exponential'`, `maxRetryDelayMs ~8s`, `shouldRetry` bail na 401/403). `HlsPlayerAdapter.ts`. (istraživanje)
- [ ] **S** — Fatal NETWORK_ERROR → throttled `startLoad()` recovery. `HlsPlayerAdapter.ts`. (gap)
- [ ] **M** — Refaktorisati `credentials.ts` i `favorites.ts` na `StorageAdapter`. `packages/storage/src/`. (KN-4)
- [ ] **S** — Dodati timeout u `FetchHttpClient`. `packages/api/src/http-client.ts`. (KN-10)
- [ ] **S** — Error boundary oko `<Outlet />` u `AppShell`/`App.tsx`. (gap)
- [ ] **S** — Route guard / auth context (redirect na `/login` ako nema kredencijala). `App.tsx`/`AppShell.tsx`. (risk)

### Faza B — Beta (specifikacijski jaz + dekompozicija)
- [ ] **L** — Dekomponovati `Player.tsx` (`CatchUpPanel`, `ChannelSelector`, `PlaybackRestorer`, `OnDemandControls`). (KN-5)
- [ ] **L** — Dekomponovati `VideoPlayer.tsx`; izdvojiti `catch-up-fallback-strategy` modul + testovi. (KN-5)
- [ ] **M** — Definisati `CatchUpSessionMetadata` interfejs u `@lumen/types`, ukloniti `Record<string, unknown>` typeof check-ove. `sessionSources.ts`. (KN-9)
- [ ] **M** — Implementirati `RendererAdapter` (`local-web` prvo), pomeriti on-demand volume/seek u session metadata. (KN-6)
- [ ] **L** — TMDB/IMDB metadata enrichment servis (VOD/Series detail). `VodDetail.tsx`, `SeriesDetail.tsx`, novi `services/metadata.ts`. (VISION gap)
- [ ] **M** — 20k+ kanala stress-test (perf benchmark + virtualizacija profil). `scripts/perf/`, `ChannelList.tsx`. (VISION gap)
- [ ] **M** — VOD/Series resume pozicije + view history (proširiti `WatchHistoryEntry`). (gap)
- [ ] **M** — Integrisati `push-api` sa web client-om (zameniti localStorage stub). `pushSubscriptionBackend.ts` ↔ `apps/push-api`. (push)
- [ ] **S** — Cast App ID hard-fail u produkciji. `useGoogleCastSender.ts:101`. (KN-8)
- [ ] **M** — Cast fast-zap strategija (queue preload ili custom CAF source-swap). (KN-7)
- [ ] **M** — Audio/subtitle auto-preference po sačuvanom jeziku. `HlsPlayerAdapter.ts`. (istraživanje)

### Faza C — Final (polish + observability + security)
- [ ] **M** — Redaktovati kredencijale u proxy logovima; razmotriti rate-limit/concurrency cap. `apps/proxy/src/server.ts`. (security)
- [ ] **M** — Observability backend sink (zameniti console-only). `services/observability.ts`. (gap)
- [ ] **M** — Media Session API integracija (lock-screen kontrole, metadata). (istraživanje)
- [ ] **S** — Skeleton/loading UI za VOD/Series/EPG/Detail. (gap)
- [ ] **M** — Offset-based ili virtual-scroll paginacija za kataloge. `VodCategories.tsx`/`SeriesCategories.tsx`. (weakness)
- [ ] **S** — `capLevelToPlayerSize` za multivariant streams. `HlsPlayerAdapter.ts`. (istraživanje)
- [ ] **S** — DRM/header passthrough u `setSource` (priprema za token-auth provajdere). (gap)

---

## 7. Plan: Android TV / Samsung Tizen / LG webOS (+ mobile)

> Zasnovano na istraživanju TV platformi. Ključ: **web-React kod se NE deli direktno sa Android TV-om**; deli se samo platform-agnostic logika.

### Šta je reusable (svi targeti)
- `@lumen/types`, `@lumen/api` (Xtream client + `HttpClient` DI), `@lumen/core` (epg/channels), `@lumen/session-core` (SessionStore), `@lumen/player-core` (SeekEngine/IdleTimer), `@lumen/input` (key-codes već feature-flagged za Samsung/LG), `@lumen/storage` (NAKON KN-4 fix-a, sa AsyncStorage/Keychain adapterima).
- Catch-up/EPG odlučujuća logika kao čiste klase/funkcije.

### Šta je per-platform
- **Rendering layer i video engine** — kritična divergencija:
  - **Tizen**: web bundle → `.wgt`; native AVPlay WebAPI ili MSE/EME (hls.js/Shaka) za novije modele. Toolchain: Tizen Studio + Certificate Extension **≥ 2.0.73** (obavezno posle sep 2025). Build kao **zaseban Vite target** koji emituje `.wgt`.
  - **webOS**: web bundle → `.ipk`; native HLS pipeline (PAŽNJA: nedostaje `EXT-X-DISCONTINUITY`/`PROGRAM-DATE-TIME`/ID3 — MediaKing discontinuity workaround postaje kritičan). MSE/EME preporučeno za novije modele.
  - **Android TV**: pravi native — Kotlin + Jetpack Compose for TV (preko starog Leanback) + Media3/ExoPlayer (`media3-ui-compose`/`PlayerSurface`). `react-native-tvos` cilja samo Apple TV + Android TV, NE Tizen/webOS.
- D-pad/focus navigacija, store submission, ikone/manifest po platformi.

### Cast-first vs native — preporuka
Samsung je u 2026 ugradio **native Google Cast** u Tizen (One UI Tizen v2115), uz rollout na 2023–2025 setove; webOS i Google TV već imaju Cast. To znači da Cast sender može da streamuje na TV bez instalirane native aplikacije — **Cast-first realno odlaže native TV apps**. Ali industrijski trend (Netflix ukinuo phone-to-TV cast dec 2025) pokazuje da za ozbiljan, brendiran lean-back doživljaj native instalirane aplikacije ostaju očekivanje (discovery, retencija, store prisustvo).

### Preporučeni sekvencijal
1. **Sada (Phase 0):** Završiti web/PWA + **Cast (queue-preload/custom CAF, ne dual-video)** + AirPlay handoff. Ovo pokriva Samsung 2024+/webOS/Google TV preko Cast-built-in bez ijedne TV aplikacije.
2. **Phase 1 (mobile):** Capacitor wrapper PWA-a ILI Expo (DECISION-DOC pending) — reuse `@lumen/*`, native `HttpClient`/`StorageAdapter`. Najjeftiniji native iskorak.
3. **Phase 2a (Tizen + webOS):** Zasebni Vite build-ovi → `.wgt`/`.ipk`; MSE/EME player na deljenom PlayerAdapter kontraktu; native AVPlay/pipeline fallback za stare uređaje.
4. **Phase 2b (Android TV):** Native Kotlin/Compose + Media3; reuse samo logičkih paketa kroz API/contract paritet (ne kroz kod).

---

## 8. Tehnološke preporuke (iz istraživanja)

### HLS.js (engine choice: ZADRŽATI hls.js)
- Zadržati hls.js kao playback engine, graditi custom React UI (ili koristiti Media Chrome/Video.js v10 samo kao UI skin). **Ne** migrirati na black-box player. Izvor: Mux blog, hls.js v1.6.x API docs.
- Konkretne izmene → mapirano na KN-1/2/3 + load policies + `capLevelToPlayerSize` + audio/subtitlePreference (sekcija 6).
- Memory disciplina (single-instance teardown, loadGeneration cancel) već je tačna — **zadržati**.
- Za .m3u8 Xtream platformu hls.js je ispravan transport; `mpegts.js` samo ako se dodaju raw-TS/http-flv endpoint-i. fMP4/CMAF preferirati kad provajder nudi (manje transmux CPU na TV-u).

### Google Cast (CAF)
- Registrovati Custom Web Receiver ($5 jednokratno) rano; hostovati na istoj TLS infra kao PWA; **prod proxy mora emitovati CORS** za receiver origin (Cast uređaj sam fetch-uje segmente — trenutno samo dev proxy ima CORS).
- Standardizovati na **Shaka-for-HLS** (`useShakaForHls: true`) — MPL je zamrznut, Shaka je default od 18.05.2026.
- LOAD interceptor (`skipPlayersLoad:true`, `disableIdleTimeout:true`) da se reuse-uje Lumen-ova HLS/proxy/header logika na jednom `<video>`.
- DRM verovatno nepotreban za plain Xtream; pripremiti `PlaybackConfig.licenseUrl` + segment request handler za token-auth.

### PWA / Media Session
- Dodati Media Session API (lock-screen/hardware-key kontrole, metadata, artwork) — trenutno nedostaje.
- Push: integrisati pravi `apps/push-api` backend; deep-link payload u kanal/program.

### TV SDK
- Tizen Certificate Extension ≥ 2.0.73 (blocker posle sep 2025). webOS native HLS feature gaps → MSE/EME za novije modele. Android TV: Compose for TV + Media3, ne Leanback.

---

## 9. Rizici & tehnološki dug

### Najveći tehnološki dug
1. **Dve God Component datoteke** (`Player.tsx` 3029, `VideoPlayer.tsx` 3742) — najveći single-point rizik za regresije. Dekompozicija je preduslov za bezbedan native port.
2. **Pogrešna live HLS konfiguracija** (KN-1/2/3) — aktivno šteti performansama i izaziva 429; jeftin fix, visok ROI.
3. **Storage violations** (KN-4) — blokira ceo Phase 1/2 multi-platform put.
4. **Nedostatak brzog test signala** — refaktoring (tačka 1) je rizičan bez unit/integration testova za session-core/catch-up.

### Da li je release-gate / no-media ceremonija postala disproporcionalna? — Da.
Mašinerija (~12K LOC validatora, 47 `release:*` npm skripti, 7-uređajni device matrix, closure plans, design parity capture, multi-device signoff) pretpostavlja Phase 1/2 zrelost koju Phase 0A ne isporučuje. **73 od poslednjih 100 commit-ova su release-tagovani** (verifikovano) — gotovo sav skorašnji rad je release-gate churn, ne feature rad. **Sama no-media policy je opravdana i tačno sprovedena** (proxy 410 guard verifikovan) — to NE treba dirati. Disproporcija je u **device/capacity/observability/security gate-ovima za nepostojeće platforme**.

**Šta uraditi:**
- Označiti Phase 1/2 gate-ove eksplicitno kao `not-applicable-phase-0a` (ne `pending`) da ne stvaraju lažni utisak obaveze.
- Uvesti **brzu test traku**: poseban top-level `test:unit` skript (vitest) za `@lumen/*` koji daje deterministički feedback nezavisno od validatora i e2e.
- Dodati jedan runtime-guard test koji dokazuje da je remux path nedostižan (zapečatiti policy u kodu).
- Zamrznuti dalje širenje device-matrix ceremonije do kraja Phase 0A; reevaluirati posle web/PWA ship-a.

### Ostali rizici
- URL string-manipulacija na provider redirect lancima bez eksplicitne sanitizacije (protocol-injection). [high]
- Kredencijali u proxy logovima. [medium]
- Push `configureWebPush` soft-fail → tihi padovi. [medium]
- EPG cache bez schema verzionisanja. [low]

---

## 10. Preporuke za druge agente

**Prioritet (ovim redom):**
1. Faza A iz sekcije 6 (HLS config fixevi KN-1/2/3 + storage KN-4 + timeout KN-10) — najjeftinije, najviši uticaj, niskorizično.
2. Tek POSLE uvođenja unit/integration testova za session-core i catch-up: dekompozicija `Player.tsx`/`VideoPlayer.tsx` (KN-5).

**NE dirati:**
- No-media policy / remux hard-guard (`apps/proxy/src/server.ts:717,722`) — tačan i namerno onesposobljen; ne re-enable-ovati remux.
- Single-instance HLS teardown / `loadGeneration` cancellation u `HlsPlayerAdapter` — ispravan, zadržati.
- `SessionStore` idempotentni reducer i `useSyncExternalStore` most — arhitektonski tačni.
- Izvorne reference projekte (`narodna.tv/`, `lumen old/`, `exyu.tv/`) — read-only.

**Kako verifikovati:**
- HLS izmene: live channel-surf + 300s burn-in + provjeriti odsustvo 429 u network tracku; memory profil pri rapidnom zap-u.
- Storage refaktor: `pnpm typecheck` + novi adapter testovi (`WebStorageAdapter`, `VersionedStorage`).
- Svaka izmena: `pnpm typecheck`, `pnpm lint`, `pnpm build`; ažurirati `HANDOFF.md` (done/next/risks).

**Najvažniji sledeći korak:** Primeniti tri HLS.js live fixa (`HlsPlayerAdapter.ts:627` worker, `:628` lowLatencyMode, `:638` backBufferLength) — tri jednolinijske izmene koje rešavaju verifikovane 429 rate-limit i memory probleme i imaju najveći odnos uticaj/trud u celom projektu.
