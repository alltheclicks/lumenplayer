# PLAN — V1 završnica → Multi-platform TV ekspanzija

> Datum: 2026-07-06 · Status: AKTIVAN master plan za sve buduće agente/radnike
> Autor konteksta: multi-agent audit 2026-07-06 (35 agenata, adversarijalno verifikovano) + `docs/CODEBASE-AUDIT-2026-06-07.md`
> Odnos prema drugim dokumentima: `docs/RELEASE-PLAN-MVP-BETA-FINAL.md` ostaje **operativni tracker** za V1 završnicu (B2.x/F3.x taskovi i protokol rada). Ovaj dokument je **strateški krov** iznad njega i **operativni tracker za faze 4–7** (platformizacija + TV aplikacije). ROADMAP.md Phase 2 se ovim planom konkretizuje.

---

## 0. Cilj i vodeći princip

**Redosled:** (1) završiti web player (V1) → (2) platformizovati jezgro → (3) Samsung Tizen + LG webOS → (4) Android TV / Fire TV → (5) Apple TV.

**Vodeći princip (zahtev vlasnika):** svaki segment (web app, tv-web app, android-tv app, server) mora biti **izmenjiv i deploy-abilan nezavisno od ostalih**. Konkretni scenario koji MORA da radi: *Android TV app je objavljen u Play Store-u; posle toga radimo redizajn/nove funkcije web app-a — i to ne sme zahtevati nijednu izmenu ni re-publish Android app-a.*

To se postiže arhitektonskim invarijantama iz §2 — one su **obavezne za svakog agenta** od danas, ne tek od TV faze.

---

## 1. Polazno stanje (2026-07-06, sažetak)

- **Web V1 skoro gotov:** MVP faza (M1.x) 21/22 FINISHED; BETA (B2.x, 19) i FINAL (F3.x, 19) taskovi TODO u release planu. Prod na VPS 151.241.151.105 (bez TLS/domena).
- **Catch-up klijentski PTS rebase** (`final-road/catchup-client-pts-rebase`, flag `VITE_CATCHUP_CLIENT_REBASE`): validiran live protiv realnog XUI (NOVA S/PINK/RTS 1), NIJE push-ovan/merge-ovan. Rezidualni artefakt = frozen-frame 0.7–2s po minutnoj granici (video fizički fali u arhivi — klijent to ne može vratiti, samo ispeglati; detalji u memoriji `catchup-client-pts-rebase`).
- **Arhitektura je obrnuta:** ~25.300 non-test linija u `apps/web/src` vs ~2.900 u svim `packages/*` zajedno; ~7.200 linija platform-agnostične playback logike zarobljeno u web app-u. Kod je interno dobro slojevit (čista logika u testiranim `.ts` modulima) → ekstrakcija je mehanička, ne redizajn.
- **Ključne rupe za TV fazu:** `RendererAdapter` ima 0 implementacija (Cast = React hook, AirPlay = inline webkit); nema cross-device session transporta (BroadcastChannel + localStorage = jedan browser profil); catch-up metadata ide kroz netipizirani side-channel van `MediaSource` tipa; `session-core` JESTE implementiran (CLAUDE.md/BACKLOG zastareli) ali hardkoduje `localStorage`/`BroadcastChannel`.
- Pun nalaz: memorija `multi-platform-readiness-audit` + `docs/CODEBASE-AUDIT-2026-06-07.md`.

---

## 2. ARHITEKTONSKE INVARIJANTE (pravila nezavisnosti segmenata)

Ova pravila su **hard gate** — PR koji ih krši se ne merge-uje. Ona su ono što garantuje "menjamo web, ne diramo Android".

### I-1: Smer zavisnosti
- `apps/*` importuju iz `packages/*`. **Nikad obrnuto.**
- `apps/*` **nikad ne importuju jedna iz druge** (ni tipove — zajednički tip ide u `@lumen/types`).
- Paket ne sme importovati React, hls.js ni DOM API — osim paketa koji su *eksplicitno* platformski (npr. budući `@lumen/player-hls` je "browser adapter paket" i sme hls.js/DOM; to piše u njegovom README-u).

### I-2: App = UI + composition root, ništa više
- Sva playback/domen logika (transport planning, fallback politika, timeline math, EPG mapiranje, session state, TS parsiranje) živi u `packages/*`.
- App sadrži: UI komponente, rutiranje, DI wiring (composition root po uzoru na `apps/web/src/services/*`), platformski lifecycle.
- Test: "da li bi ovaj modul trebao i TV app-u?" → ako da, ide u paket **odmah**, ne "kasnije".

### I-3: Kontrakti su jedina spojnica
- Deljeni interfejsi (`PlayerAdapter`, `RendererAdapter`, `MediaSource`/`PlaybackRequest`, `StorageAdapter`, `HttpClient`, session commands/events) žive u `@lumen/types` i menjaju se **contract-first**: izmena kontrakta = zaseban task koji u ISTOM PR-u migrira sve potrošače + pun monorepo `typecheck`.
- Dodavanje opcionalnih polja/eventova = uvek OK. Breaking change = dokumentovati u HANDOFF + proveriti da li neka **objavljena** (store) aplikacija zavisi od starog ponašanja.

### I-4: Platformska specifičnost kroz DI, nikad `if (platform)` u paketima
- Umesto `import.meta.env` → injektovan config objekat.
- Umesto `window.localStorage` → `StorageAdapter`.
- Umesto `fetch` pretpostavke → `HttpClient`.
- Umesto `DOMParser` → injektovan XML parser interfejs.
- Telemetrija → injektovan sink (observability bus), paketi ne loguju sami.

### I-5: Server API je verzionisan i unazad kompatibilan
- Kada prva store aplikacija bude objavljena, `apps/proxy` (i budući session servis) API postaje **javni ugovor**: rute se verzionišu (`/v1/...`), stare verzije žive dok store analitika ne pokaže da klijenata nema.
- Store aplikacije imaju spore review cikluse — server NIKAD ne sme da uvede breaking change koji zahteva sinhroni update svih klijenata.

### I-6: Nezavisni build/deploy pipeline po segmentu
- Svaka app ima svoj build, env config i deploy/publish put; CI koristi turbo filtere (`turbo run build --filter=@lumen/tv-web...`) tako da izmena u `apps/web` ne pokreće TV build niti obrnuto.
- Release jedne app nikad ne čeka release druge.

### I-7: Paketi su samostalno proverljivi
- Svaki paket ima sopstveni `typecheck` skript i unit testove; `packages/tsconfig/base.json` dobija `"lib": ["ES2020"]` (DOM postaje eksplicitni opt-in po paketu) + ESLint `no-restricted-globals` guard za `packages/*/src` — da DOM/localStorage curenje bude nemoguće, ne samo zabranjeno.

### I-8: Dizajn je vlasništvo aplikacije
- 10-foot TV UI, web UI i mobile UI su **odvojene UI baze** (per DECISION-DOC: "svaka platforma dobija ZASEBNU app"). Deli se logika i dizajn *jezik* (tokeni, boje — može zaseban `@lumen/design-tokens` ako zatreba), ali ne komponente. Redizajn jedne app ne dira ni pakete (osim čisto aditivnih izmena) ni druge apps.

---

## 3. FAZA V1-ZAVRŠNICA (web) — pre bilo kakvog TV rada

Operativno stanje i redosled: `docs/RELEASE-PLAN-MVP-BETA-FINAL.md` (B2.x → F3.x + njegov "Obavezan ciklus rada na tasku"). Ovde samo dopune i naglasci.

### C0 — Catch-up rebase closeout (NOVO — dodati u release plan dashboard)
- [ ] **S** `stretchShortVideoTrack: true` u hls.js configu za rebase sesije (drži poslednji frejm prethodnog minuta preko GOP rupe umesto ranog prikaza sledećeg; uklanja i video-tail starvation pred granicu). `HlsPlayerAdapter.ts`. — ID: C0-a
- [ ] **S** `maxBufferHole` 0.5 → ~2.0 samo za rebase catch-up (non-contiguous joints posle seek-a / media-error recovery-ja). `HlsPlayerAdapter.ts`. — ID: C0-b
- [ ] **M** Boundary telemetrija: per-boundary `videoHoleMs` + predviđena boundary media-vremena u `catchup.rebase` evente + `catchup.stall` event sa `video.currentTime` na `waiting`/BUFFER_STALLED. `mpegTsPtsRebase.ts` + `HlsPlayerAdapter.ts` + `VideoPlayer.tsx`. — ID: C0-c
- [ ] **—** Vlasnikov retest (RTS 1 + PINK + NOVA S; obavezno obrisati `lumen:catchup-client-rebase:v1` iz localStorage pre testa) → odluka push grane + prod flag. — ID: C0-d (gate za sve dalje)
- [ ] **S** Seek watchdog tuning za 45MB minutne segmente (10s/1-retry premalo na sporim vezama uz `progressive:false`). `VideoPlayer.tsx`. — ID: C0-e
- Parkirano (ne raditi bez vlasničke odluke): streaming rewriter u `onProgress` (faza 2 rebase-a), wasm MP2→AAC.

### Naglasci u postojećim B2.x/F3.x (dupla uloga: V1 kvalitet + TV preduslov)
| Task | Zašto je i TV preduslov |
|---|---|
| B2.1-a/b (testovi session-core + live↔catch-up state machine) | bez njih dekompozicija i ekstrakcija (faza P4) nisu bezbedne — "nikad dekompozicija bez testova prvo" |
| B2.1-c/d (dekompozicija `Player.tsx`/`VideoPlayer.tsx`) | god-komponente su porasle (4.007 / 3.129 linija); sve što se izdvoji kao čist modul = kandidat za paket |
| B2.1-e (`CatchUpSessionMetadata` u `@lumen/types`) | direktno zatvara "netipizirani side-channel" gap — uraditi PRE P4.1 |
| B2.3-a/b (RendererAdapter implementacije) | KN-6; bez ovoga "Cast-centric" strategija postoji samo na papiru |
| B2.4-a/b (storage platform-agnosticism) | KN-4; blokira svaki native port |
| F3.1-b (protocol-injection sanitizacija) | **povući napred** (audit: high; URL rewriting površina je porasla sa rebase granom) |

### V1 ship-lista (van koda, čeka vlasnika)
domen + TLS + certbot (PWA SW ne radi na http://IP) · CDN CORS na `gw.castcdn.net` da video ide direktno (EX-1; VPS 4TB cap) · Cast App ID registracija (M1.3-a) + real-device Cast test (KN-7 realno otvoren!) · PWA install validacija · MP2 odluka za V1 (shadow endpoint ili "poznato ograničenje").

**Exit kriterijum faze:** release plan BETA+FINAL exit kriterijumi ✅ + C0-d gate prošao + ship-lista rešena.

---

## 4. FAZA P4 — PLATFORMIZACIJA JEZGRA (most ka TV-u)

**Cilj:** `apps/web` postaje UI shell + composition root; sav playback mozak u paketima. Ovo je NAJVAŽNIJA faza za nezavisnost segmenata — TV app posle nje kreće kao "UI + adapter", ne kao rewrite. Ekstrakcija je verifikovano mehanička: ~15 injectable dodirnih tačaka (`import.meta.env`, `window.localStorage`, `window.location`) u ciljnim modulima.

**Redosled je bitan:** P4.1 (kontrakti) → P4.2 (paketi) → P4.3 (session/renderer) → P4.4 (guardrails mogu paralelno od starta).

### P4.1 — Kontrakti
- [ ] **M** `PlaybackRequest` tip u `@lumen/types`: proširiti/zameniti `MediaSource` ({url,type,drm}) tipiziranim catch-up/live metapodacima (mode, streamId, startup mode, startPosition, clientRebase flag). Ukida metadata side-channel. Zavisi: B2.1-e. — ID: P4.1-a
- [ ] **M** `PlayerAdapter` interfejs: dodati opcione capability evente (manifest resolved, unsupported codec, rebase telemetrija) koji su sada out-of-band constructor callbacks `HlsPlayerAdapter`-a; uvesti adapter factory da `VideoPlayer` prestane da `new`-uje konkretnu klasu. — ID: P4.1-b
- [ ] **S** Session contract dopune: razdvojiti `seek` (namera korisnika) od `progressReported` (telemetrija pozicije) — preduslov za multi-client sesije; rešiti `liveOffsetMs` (implementirati ili ukloniti mrtvo polje). `packages/session-core/`. — ID: P4.1-c

### P4.2 — Novi paketi (ekstrakcija iz apps/web)
- [ ] **L** `@lumen/player-hls`: preseliti `apps/web/src/adapters/` (HlsPlayerAdapter 2.097 + mpegTsPtsRebase 632 + mpegTsAudioStrip 331 + testovi). Već čist (importuje samo hls.js + `@lumen/types` + sibling module). Browser-adapter paket (DOM/hls.js dozvoljeni po I-1 izuzetku). — ID: P4.2-a
- [ ] **L** `@lumen/catchup-core`: preseliti čiste player policy module iz `apps/web/src/components/player/*.ts` i `pages/*.ts` (catchupTransport 899, catchupSource, catchupGateway, catchupProgramNavigation, liveTimeshift, timelineSeek, videoPlaybackSync 964, playerErrorState, sessionSources, compat cache…) sa DI za config/storage/baseOrigin (I-4). Testovi (~3.800 linija) idu sa modulima. — ID: P4.2-b
- [ ] **M** `@lumen/epg`: EPG parsiranje/mapiranje (channelEpg, epgProgramMapper, xmltvEpg) sa injektovanim XML parserom (Tizen/webOS imaju DOMParser, RN nema). — ID: P4.2-c
- [ ] **S** `@lumen/observability`: event bus iz `services/observability.ts` kao deljeni telemetry kontrakt (sink se injektuje per-app). — ID: P4.2-d

### P4.3 — Session & renderer sloj
- [ ] **M** `session-core` DI: injektabilan sync KV storage + broadcast transport u `SessionStoreOptions` (web defaulti = localStorage/BroadcastChannel; RN dobija AsyncStorage/no-op). — ID: P4.3-a
- [ ] **M** Renderer sloj dovršen preko B2.3-a: `LocalRendererAdapter` + `CastRendererAdapter` implementiraju postojeći interfejs; generična controller logika iz `useGoogleCastSender.ts` (position/playstate reconciliation, :275-311, :441-542) u framework-free modul. — ID: P4.3-b
- [ ] **M** **ODLUKA + dizajn** session transporta (SESSION-ARCHITECTURE otvorena odluka 9.3): server-side session orchestrator (prirodno mesto: uz `apps/proxy` ili nov `apps/session`). Za TV MVP dovoljan je **contract + stub** (TV apps kreću standalone, per §5–6); puna implementacija tek za "phone-as-remote za TV" scenario. — ID: P4.3-c
- [ ] **S** `@lumen/input`: proširiti `Platform` union (`androidtv`, kasnije `tvos`) + detekcija kroz injektovan hint. — ID: P4.3-d

### P4.4 — Guardrails (I-6/I-7 postaju mehanički)
- [ ] **S** `packages/tsconfig/base.json`: `"lib": ["ES2020"]`; DOM opt-in po paketu; `typecheck` skript u SVAKOM paketu (sad se paketi typecheck-uju samo kroz potrošače!). — ID: P4.4-a
- [ ] **S** ESLint `no-restricted-globals` (window/document/localStorage/navigator) za `packages/*/src` sa eksplicitnim izuzecima za platformske pakete. — ID: P4.4-b
- [ ] **S** CI turbo filteri: pipeline po app-u; izmena `apps/web` ne pokreće TV build i obrnuto. `turbo.json` + CI config. — ID: P4.4-c
- [ ] **S** Obrisati mrtav `packages/storage/src/credentials.ts`; `favorites.ts` refaktorisati na `StorageAdapter` (NIJE mrtav — 4/6 exports u upotrebi; = B2.4-a). — ID: P4.4-d
- [ ] **S** Docs sync: CLAUDE.md (session-core "planned" → implementiran; shims ne postoje), BACKLOG:532, VISION QAF-035 addendum (provider-infra transcode dozvoljen — uskladiti sa shipped M1.6), DECISION-DOC/ROADMAP: formalizovati vlasnikovu odluku **V2 = dedicated TV apps** (razrešava Cast-first vs TV-apps tenziju); LP-2001..2004 re-promovisati u planned. — ID: P4.4-e

**Exit kriterijum P4:** `apps/web` ne sadrži nijedan modul koji TV app treba; svi paketi typecheck-uju standalone; pun regression (typecheck/lint/test:unit/build + ručni smoke live/catch-up/cast) zelen — **web se ponaša identično kao pre faze** (ovo je čist refactoring, nula feature izmena).

---

## 5. FAZA T5 — SAMSUNG TIZEN + LG WEBOS (`apps/tv-web`)

**Strategija:** oba su Chromium → **jedna Vite app, dva build targeta** (LP-2001). Reuse: `@lumen/player-hls` (ceo battle-tested engine, uklj. catch-up rebase!), `@lumen/catchup-core`, `session-core`, `api`, `input` (Samsung/LG key mape već postoje). Piše se samo: 10-foot UI + platform lifecycle. Posle P4 ovo je ~80% reuse player stacka.

- [ ] **M** `apps/tv-web` scaffold: Vite + TS, dva entry/config targeta (tizen/webos), composition root po uzoru na `apps/web/src/services/*`. — ID: T5.1-a
- [ ] **M** Toolchain: Tizen Studio CLI + webOS CLI, packaging (.wgt/.ipk), emulatori + bar 1 realan uređaj po brendu u test matrici. Definisati minimalne verzije (predlog: Tizen 4.0+/2018+, webOS 4.0+; starije = eksplicitno out of scope V2). — ID: T5.1-b
- [ ] **S** SPIKE (rano!): hls.js/MSE smoke na najstarijem ciljanom realnom TV-u — live + catch-up rebase + memorija (TV MSE budžeti su mali; pratiti QuotaExceeded; tuning `maxBufferSize` po platformi kroz config DI). — ID: T5.1-c
- [ ] **L** 10-foot UI: novi dizajn (NE port web UI-ja), spatial navigation / focus management (LP-2003) na `@lumen/input`; kanali/EPG/catch-up/player kontrole daljinskim. — ID: T5.2-a
- [ ] **M** Platform lifecycle: visibility/suspend/resume (TV apps se agresivno suspenduju), registracija remote tastera (Tizen `tizen.tvinputdevice`), exit/back semantika, screensaver inhibit tokom playback-a. — ID: T5.2-b
- [ ] **M** (uslovno, po ishodu T5.1-c) `TizenAvPlayAdapter` implementira `PlayerAdapter` (LP-2002) — fallback ako MSE/hls.js ne zadovolji na starijim Tizen-ima; **bonus: AVPlay nativno svira MP2/AC3** → MP2 kanali rade bez transkodiranja. Isto važi za webOS native pipeline. — ID: T5.2-c
- [ ] **M** Store submission: Samsung Seller Office + LG Content Store (nalozi, sertifikati, content rating, privacy policy). — ID: T5.3-a

**Exit:** app u oba store-a (ili bar interno QA-ovan na realnim uređajima), live+catch-up+EPG rade, web app netaknut (I-6 dokaz: nijedan `apps/web` fajl u TV PR-ovima osim eventualnih aditivnih paket izmena).

---

## 6. FAZA A6 — ANDROID TV / FIRE TV

- [ ] **S** **ODLUKA A6.1 (prva, blokira sve):** `react-native-tvos` vs native Kotlin. Kriterijumi: RN-tvos čuva ~6–7k linija policy/session/api paketa I pokriva **i Apple TV istim codebase-om** (react-native-tvos targetuje Android TV + tvOS); native Kotlin = 0 code reuse (paketi postaju izvršna specifikacija) ali čistiji player sloj. **Preporuka: react-native-tvos**, sa ExoPlayer-om kao native modulom. Fire TV = Android TV varijanta (LP-2005). — ID: A6.1-a
- [ ] **M** SPIKE (rano!): ExoPlayer/Media3 protiv realnog XUI catch-up-a — hipoteza: ExoPlayer toleriše per-file PTS resete i mid-GOP startove kao TiviMate → **rebase NIJE potreban** na ovoj platformi. Ako hipoteza padne: server-side put (dump_extra cron / remux edge) je preduslov za Android TV catch-up, NE portovanje rebase-a. — ID: A6.1-b
- [ ] **L** `ExoPlayerAdapter` (native modul) implementira `PlayerAdapter` kontrakt iz `@lumen/types`; `AsyncStorage` `StorageAdapter`; RN `HttpClient`. — ID: A6.2-a
- [ ] **L** TV UI u RN (leanback navigacija, D-pad focus). Dizajn jezik može pratiti T5, kod se NE deli sa `apps/tv-web` (I-8). — ID: A6.2-b
- [ ] **M** MediaSession integracija (LP-2012), Play Store + Amazon Appstore publish, licensing odluka (LP-2007 zavisi od Phase 1 dashboarda — ako dashboard ne postoji do tada, V2 ide sa Xtream credentials loginom kao web). — ID: A6.3-a

**Exit:** Play Store publish. Od ovog trenutka **I-5 postaje živ**: server/proxy izmene moraju biti unazad kompatibilne sa objavljenom verzijom.

---

## 7. FAZA 7 — APPLE TV (kasnije)

- Ako je A6.1-a = react-native-tvos → Apple TV je **isti codebase, tvOS target** (LP-2006 se svodi na platformske adaptere: AVPlayer native modul umesto ExoPlayer, TVFocusGuide, App Store review specifičnosti za IPTV).
- Ako je A6 native → tvOS je zaseban Swift/AVPlayer app; TS paketi služe kao izvršna specifikacija (portuju se state machine-i: SeekEngine, session reducer, transport politika).
- Ne planirati detaljnije dok A6 ne bude u store-u.

---

## 8. Otvorene odluke (čekaju vlasnika)

| # | Odluka | Blokira | Preporuka |
|---|---|---|---|
| O-1 | Push + prod flag za rebase granu (posle C0-d retesta) | sve | push posle čistog retesta |
| O-2 | Domen + TLS za VPS | PWA, beta | rešiti pre bete |
| O-3 | Cast App ID ($5) + real-device test | M1.3-a, KN-7 | registrovati — bez ovoga je Cast strategija neverifikovana |
| O-4 | RN vs native za Android TV (A6.1-a) | A6, faza 7 | react-native-tvos |
| O-5 | Session transport scope (P4.3-c): standalone TV prvo ili odmah thin-renderer | P4.3-c | standalone prvo, contract odmah |
| O-6 | MP2 strategija po platformi (web=shadow?, Tizen=AVPlay?, ATV=ExoPlayer svira MP2 nativno) | M1.6 nastavak | odlučiti per-platform u T5/A6 spike-ovima |
| O-7 | Formalizacija "V2 = dedicated TV apps" u DECISION-DOC/ROADMAP (P4.4-e) | P4.4-e | potvrđeno usmeno 2026-07-06, upisati |

---

## 9. Šta NE dirati + poznate zamke (za sve buduće agente)

- **NE dirati** (audit "do not touch", i dalje na snazi): proxy 410 remux guard (`apps/proxy`), `loadGeneration` teardown u `HlsPlayerAdapter`, `SessionStore` idempotentni reducer.
- **TVRDO PRAVILO:** deljeni produkcijski `timeshift.php` na provider floti se NIKAD ne menja za Lumen potrebe (memorija `no-shared-timeshift-edits`) — sve novo ide na zaseban endpoint.
- `lowLatencyMode` MORA ostati `false` za catch-up (Xtream ne podržava LL-HLS).
- Pre svakog ručnog catch-up testa obrisati `lumen:catchup-client-rebase:v1` (30-min failure marker tiho isključuje rebase → lažni "regression").
- Frozen-frame 0.7–2s na minutnim granicama catch-up-a je **fizički pod** (frejmovi ne postoje u arhivi) — ne trošiti klijentske sesije na "popravljanje" preko C0-a/b/c nivoa; potpuno rešenje je isključivo server-side (XUI writer fix ili remux edge).
- Radni protokol: grana po tasku (`final-road/<task-id>`), ciklus iz `RELEASE-PLAN-MVP-BETA-FINAL.md` §"Obavezan ciklus rada", validacija `pnpm typecheck && pnpm lint && pnpm test:unit && pnpm build`, HANDOFF.md update na kraju svake sesije.

---

## 10. Zavisnosti (graf)

```
V1 završnica (C0 + B2.x + F3.x + ship-lista)
        │
        ▼
P4 PLATFORMIZACIJA ── P4.1 kontrakti → P4.2 paketi → P4.3 session/renderer
        │                                   (P4.4 guardrails paralelno)
        ├──────────────────┬───────────────────┐
        ▼                  ▼                   │
T5 Tizen+webOS       A6 Android TV ◄── O-4 ────┘
 (T5.1-c spike!)      (A6.1-b spike!)
        │                  │
        │                  ▼
        │           Faza 7: Apple TV (isti RN codebase ako O-4=RN)
        ▼
   store publish → I-5 (server backward-compat) postaje obavezan
```

**Paralelizam:** T5 i A6 mogu ići paralelno posle P4 (različiti timovi/agenti, nula deljenih fajlova van paketa). Unutar V1 završnice, C0 je nezavisan od B2.x i može odmah.
