# Lumen Player — Plan puta: MVP → Beta → Final

> Datum: 7. jun 2026
> Bazira se na `docs/CODEBASE-AUDIT-2026-06-07.md`. Kod/putanje/termini na engleskom; analiza na srpskom (latinica).
> Odluke vlasnika (2026-06-07):
> - **MVP uključuje Cast** (Live + VOD + Serije + EPG + Catch-up + Cast + PWA).
> - **Cast = custom CAF receiver na `cast.lumenplayer.com` + queue-preload** (NE dual-video na prijemniku).
> - **Native (Tizen/webOS/Android TV/mobile) je Phase 2** — kreće tek posle Final web ship-a (sekcija na kraju).

Effort: **S** ≤0.5d · **M** ≤2d · **L** >2d. Oznake `(KN-x)` referišu na kritične nalaze iz audita.

---

## 📋 PROTOKOL RADA — OVAJ FAJL JE JEDINI IZVOR ISTINE ZA SVE TASKOVE

> Ovo važi za svakog agenta (Claude, Codex, ili bilo koji drugi) i za svaku ručnu izmenu. Ako čitaš ovaj fajl da bi radio task — pročitaj OVU sekciju do kraja PRE nego što kreneš.

### Statusi (legenda)
- `TODO` — nije započet (čekboks `[ ]`).
- `IN PROGRESS` — neko trenutno radi na njemu (čekboks `[~]`).
- `BLOCKED` — započet ali zaustavljen zbog zavisnosti/odluke (čekboks `[!]`); MORA imati razlog u logu.
- `FINISHED` — završen i (ako je test moguć) verifikovan (čekboks `[x]`).
- `NOT APPLICABLE` — svesno preskočen (čekboks `[-]`); MORA imati razlog u logu.

### Kako se identifikuje task
Svaki task ima stabilan ID u formatu `M1.1-a`, `B2.3-b`, `F3.1-c`. ID se NIKAD ne menja i ne reciklira. Kad korisnik kaže „uradi sledeći task", uzmi prvi task po redu (odozgo nadole, faza po faza) koji je `TODO` i čije su zavisnosti `FINISHED`.

### Obavezan ciklus rada na tasku (svaki agent)
1. **Pre rada:** postavi status na `IN PROGRESS` (`[~]`), upiši `Owner:` (ko/koji agent) i `Started:` (datum) u `Log:` liniju tog taska.
2. **Radi** isključivo taj task (i njegove eksplicitno navedene pod-stavke). Poštuj „NE dirati" pravila na dnu fajla.
3. **Testiraj ako je test moguć:** pokreni relevantne komande (`pnpm typecheck`, `pnpm lint`, `pnpm build`, `pnpm test:unit`, i task-specifičnu „Verifikacija" liniju ako postoji). Ako test NIJE moguć (npr. zahteva real-device Cast ili živi provajder), to eksplicitno napiši u logu kao `Verifikacija: ručno/nije moguće automatski — <razlog>`.
4. **Posle rada:** postavi finalni status (`FINISHED` / `BLOCKED` / `NOT APPLICABLE`) i upiši u `Log:`:
   - datum (`Finished:` ili `Updated:`),
   - šta je konkretno urađeno (1–3 rečenice),
   - koji su fajlovi dirnuti,
   - rezultat testova (npr. `typecheck ✅ lint ✅ build ✅ test:unit ✅`, ili koji je pao i zašto),
   - ako `BLOCKED`/`NOT APPLICABLE` — razlog.
5. **Sinhronizuj `HANDOFF.md`** (done/next/risks) kao i do sada — ovaj fajl je task-truth, `HANDOFF.md` ostaje narativni status.

### Format zapisa po tasku
Svaki task ima `Status:` i `Log:` liniju odmah ispod sebe. Primer popunjenog taska:

```
- [x] **S** `enableWorker: true` za live. `HlsPlayerAdapter.ts:627`. (KN-1) — ID: M1.1-a
  - Status: FINISHED
  - Log: Owner: Claude | Started: 2026-06-08 | Finished: 2026-06-08 | Promenjen `HlsPlayerAdapter.ts:627` (enableWorker: true). Testovi: typecheck ✅ lint ✅ build ✅. Verifikacija: 300s live burn-in bez 429 ✅.
```

Prazan task izgleda ovako (početno stanje):

```
- [ ] **S** <opis>. `<fajl>`. (KN-x) — ID: M1.1-a
  - Status: TODO
  - Log: —
```

### Git workflow (final-road)
- Baza je uvek **`main`** (sinhronizovan sa `origin/main` pre starta taska).
- Svaki task ide na **svoju granu**: `final-road/<task-id>` (npr. `final-road/M1.1-a`). Više sitnih povezanih taskova iz iste grupe smeju deliti granu `final-road/<grupa>` (npr. `final-road/M1.1`) — navedi to u logu.
- Po **uspešnom** završetku taska (testovi prošli, status `FINISHED`): **`git commit`** na toj grani; poruka počinje task ID-jem, npr. `feat(web): M1.1-a enable HLS worker for live`.
- Commit poruke završiti `Co-Authored-By:` linijom (kao do sada).
- Merge u `main` radi vlasnik (ili eksplicitno odobri) — agent NE merge-uje sam bez naloga.
- Procedura za jedan task:
  ```
  git checkout main && git pull --ff-only
  git checkout -b final-road/<task-id>
  # ... rad + testovi (typecheck/lint/build/test:unit + Verifikacija) ...
  git add -A && git commit -m "<tip>: <task-id> <opis>"
  # u ovom fajlu: Status -> FINISHED, popuni Log, osveži dashboard
  ```

### Pravila integriteta
- NE briši završene taskove — ostaju kao istorija (`FINISHED`).
- NE menjaj postojeće ID-jeve. Novi task = novi ID na kraju te grupe.
- Ako otkriješ novi posao tokom rada, dodaj novi task sa novim ID-jem (ne ubacuj „usput" izmene bez evidencije).
- „Verifikacija" linije po grupi su exit-uslov te grupe, ne zamena za per-task testove.

---

## 📊 Status dashboard (ažurirati pri svakoj promeni statusa)

> Brzi pregled. Brojevi se ručno ažuriraju kad agent menja status taska. Ukupno taskova: **60**.

| Faza | Ukupno | TODO | IN PROGRESS | FINISHED | BLOCKED | N/A |
|---|---|---|---|---|---|---|
| MVP (M1.x) | 22 | 20 | 1 | 1 | 0 | 0 |
| BETA (B2.x) | 19 | 19 | 0 | 0 | 0 | 0 |
| FINAL (F3.x) | 19 | 19 | 0 | 0 | 0 | 0 |
| **Σ** | **60** | **58** | **1** | **1** | **0** | **0** |

**Sledeći task na redu:** `M1.1-a` — `enableWorker: true` za live (`HlsPlayerAdapter.ts:627`).

---

## 0. Trenutno stanje (polazna tačka)

Verifikovano u kodu na grani `codex/qaf-035-production-web-catchup`:
- ✅ Session-centric arhitektura radi (`@lumen/session-core`).
- ✅ Live/VOD/Serije/EPG/Catch-up/PWA/Cast sender postoje i funkcionišu.
- ✅ Proxy sa allowlist/SSRF/no-media guard.
- ✅ Perf skriptovi postoje (`scripts/perf/`: TTFC, memory-cap, staging-capacity).
- ❌ HLS live konfiguracija pogrešna (KN-1/2/3).
- ❌ `credentials.ts`/`favorites.ts` krše StorageAdapter (KN-4).
- ❌ Nema route guard-a (sve rute javne — `App.tsx:42-62`), nema error boundary.
- ❌ `RendererAdapter` samo interfejs (`packages/types/src/index.ts:305`), nula implementacija (KN-6).
- ❌ Cast prod App ID nije obezbeđen, dual-video strategija pogrešna za prijemnik (KN-7/8).
- ❌ Nema TMDB enrichment servisa, nema `test:unit` skripta.
- ⚠️ God Components: `Player.tsx` 3029 LOC, `VideoPlayer.tsx` 3742 LOC (KN-5).
- ⚠️ Release-gate ceremonija disproporcionalna (73/100 commit-ova release-tagovano).
- ❌ **MP2 audio nekompatibilnost (M1.6):** kanali sa MPEG-1/2 Layer II audijem nemaju zvuk u web/PWA (MSE ne dekoduje MP2) — i live i catch-up. Rešenje zahteva transcode MP2→AAC (na serveru videoteke ili proxy-ju); proxy transcode trenutno hard-disabled no-media politikom (QAF-035).

---

## FAZA 1 — MVP

> **Cilj:** Pouzdan player koji prvi realni korisnik (npr. „mama u Nemačkoj") može da instalira i koristi za Live + VOD + Serije + EPG + Catch-up, i da prebaci na TV preko Cast-a. Sve mora da radi *stabilno*, bez vidljivih grešaka i bez 429 rate-limit padova.

### M1.1 — HLS stabilnost & performanse (PRVO, najveći ROI)
- [ ] **S** `enableWorker: true` za live. `HlsPlayerAdapter.ts:627`. (KN-1) — ID: M1.1-a
  - Status: TODO
  - Log: —
- [ ] **S** `lowLatencyMode: false` za Xtream live; uključi `true` samo ako manifest sadrži `EXT-X-PART`/`EXT-X-SERVER-CONTROL`. `HlsPlayerAdapter.ts:628`. (KN-2) — ID: M1.1-b
  - Status: TODO
  - Log: —
- [ ] **S** Live `backBufferLength` ~10–30s; catch-up zadrži ~90s. `HlsPlayerAdapter.ts:638`. (KN-3) — ID: M1.1-c
  - Status: TODO
  - Log: —
- [ ] **M** Strukturisane HLS load policies: `fragLoadPolicy`/`playlistLoadPolicy` sa `backoff:'exponential'`, `maxRetryDelayMs ~8s`, `shouldRetry` bail na 401/403. `HlsPlayerAdapter.ts`. — ID: M1.1-d
  - Status: TODO
  - Log: —
- [ ] **S** Fatal `NETWORK_ERROR` → throttled `startLoad()` recovery (trenutno se oporavlja samo `MEDIA_ERROR`). `HlsPlayerAdapter.ts`. — ID: M1.1-e
  - Status: TODO
  - Log: —
- **Verifikacija (exit grupe):** live channel-surf + 300s burn-in; network track BEZ 429; memory profil pri rapidnom zap-u stabilan.

### M1.2 — Robusnost klijenta
- [ ] **S** Error boundary oko `<Outlet />`. `AppShell.tsx` / `App.tsx`. (gap) — ID: M1.2-a
  - Status: TODO
  - Log: —
- [ ] **S** Route guard / auth context — redirect na `/login` ako nema kredencijala (sada su sve rute javne, `App.tsx:45-60`). (risk) — ID: M1.2-b
  - Status: TODO
  - Log: —
- [ ] **S** Dodati timeout (`AbortController`) u `FetchHttpClient`, default 10–30s. `packages/api/src/http-client.ts`. (KN-10) — ID: M1.2-c
  - Status: TODO
  - Log: —
- [ ] **S** Uvesti `test:unit` skript (vitest, samo `@lumen/*` + `apps/web/src`, bez release-validatora) za brz feedback. `package.json`. — ID: M1.2-d
  - Status: TODO
  - Log: —

### M1.3 — Cast MVP (custom CAF receiver + queue-preload)
- [ ] **S** Registrovati Custom Web Receiver u Google Cast Console ($5), dobiti prod App ID; postaviti `VITE_GOOGLE_CAST_APP_ID`. — ID: M1.3-a
  - Status: TODO
  - Log: —
- [ ] **S** Hard-fail ako prod App ID nedostaje van dev-a (sad tiho pada na `CC1AD845`). `useGoogleCastSender.ts:9,101-108`. (KN-8) — ID: M1.3-b
  - Status: TODO
  - Log: —
- [ ] **M** Custom CAF receiver na `cast.lumenplayer.com`: LOAD interceptor (`skipPlayersLoad`, `disableIdleTimeout`) da reuse-uje HLS/proxy/header logiku na jednom `<video>`; standardizovati na Shaka-for-HLS (`useShakaForHls:true`). `apps/web/public/receiver.html`. (KN-7) — ID: M1.3-c
  - Status: TODO
  - Log: —
- [ ] **M** Queue preload (`preloadTime`) / source-swap za brz zapping na prijemniku (zameniti dual-video pretpostavku). (KN-7) — ID: M1.3-d
  - Status: TODO
  - Log: —
- [ ] **S** **Prod proxy mora emitovati CORS** za Cast receiver origin (sad samo dev proxy ima CORS) — Cast uređaj sam fetch-uje segmente. `apps/proxy/src/server.ts`. — ID: M1.3-e
  - Status: TODO
  - Log: —
- **Verifikacija (exit grupe):** real-device Cast test (Chromecast + TV-built-in); zapping bez crnog ekrana; catch-up na Cast-u radi ili daje jasan unsupported overlay.

### M1.4 — Catch-up: dovesti do „pouzdano radi ili jasno kaže da ne radi"
- [ ] **S** Dodati host-affinity TTL/decay (sad module-scope `Map` bez isteka — bajati edge host rizik). `catchupTransport.ts`/`sessionSources.ts`. (weakness) — ID: M1.4-a
  - Status: TODO
  - Log: —
- [ ] **S** Osigurati da svaki neuspeli catch-up završi jasnim `unsupported` overlay-em (ne tihim spinerom). `catchUpEmptyState.ts`/`sourceBlockingError.ts`. — ID: M1.4-b
  - Status: TODO
  - Log: —
- **Verifikacija (exit grupe):** test na 2–3 realna provajdera; nijedan slučaj ne sme ostaviti beskonačan spinner.

### M1.5 — PWA install iskustvo
- [ ] **S** Proveriti/dovršiti install prompt + ikone + splash; offline fallback (`offline.html`) radi. `vite.config.ts`, `usePWA.ts`. — ID: M1.5-a
  - Status: TODO
  - Log: —
- **Verifikacija (exit grupe):** instalacija na desktop Chrome + Android; offline stranica se prikazuje bez mreže.

### M1.6 — MP2 audio: kanali bez zvuka u web/PWA (live + catch-up) [P0 audio gap]

> **Kontekst (verifikovano 2026-06-08):** Browser MSE (Chrome/Edge HLS.js put) **NE dekoduje MPEG-1/2 Layer II (MP2) audio**. Kanali sa MP2 audio track-om puštaju **samo sliku, bez zvuka** — i na LIVE i na CATCH-UP. Native playeri (TiviMate i sl.) nemaju problem jer ne idu kroz MSE.
> **Jedino tehničko rešenje = transcode MP2→AAC (`-c:a aac`); remux/copy NE pomaže** (samo prepakuje kontejner, audio ostaje MP2). Video može `copy` (slika se ne dira — jeftino).
> **Gde transcode može da se desi:** (1) na serveru videoteke / `{server}/streaming/timeshift.php` (vaša infra — NE krši Lumen no-media politiku), (2) na Lumen proxy-ju (postoji napisan ali **hard-disabled** transcode put `proxy-remuxed`/`catchup-remux.ts` na grani `codex/qaf-035-production-web-catchup`; reaktivacija KRŠI QAF-035 no-media politiku), (3) u browseru (WASM ffmpeg/WebCodecs — nerealno za live, ne preporučeno).
> **Bitno:** `timeshift.php` u kodu je standardni Xtream endpoint (`{credentials.server}/streaming/timeshift.php?...`, vidi `packages/api/src/xtream-codes-service.ts:269,375`); klijent ga samo gađa.
>
> **🔑 KLJUČNO OTKRIĆE (2026-06-08, SSH provera servera videoteke `mainssl`/`136.243.57.82`):** Server-side MP2→AAC rešenje (opcija A) **VEĆ POSTOJI, napisano i deployed, ali NIKAD AKTIVIRANO.**
> - Original `/home/xtreamcodes/iptv_xtream_codes/wwwdir/streaming/timeshift.php` (XtreamCodes, 2018) — **0 ffmpeg poziva, NE transkoduje** (MP2 ostaje MP2).
> - Codex je 2026-03-16 napisao **`timeshift_shadow.php`** (paralelni endpoint, live deployed pored originala): ffprobe codec → ako nije AAC-LC@44.1/48k transkoduje `-c:a aac -profile:a aac_low -b:a 128k -ac 2 -ar 48000`, video `-c:v copy`, izlaz `-f mpegts`. **To TAČNO rešava MP2.** Backup: `/root/codex-backups/catchup/20260316-*`.
> - **ALI je mrtav kod:** NIJE rout-an u nginx-u, `/tmp/catchup_shadow.log` ne postoji, `tv_archive_shadow/` prazan → nikad pozvan. ffmpeg na serveru ima `aac` encoder ✅.
> - Flota recording servera (Tailscale): `mainssl`(.1), `usa-ca-videoteka`(.23), `ovh-videoteka`(.34), `videoteka-16tb-hetzner`(.14) + edge (lyra/nyc/zet). Detalji u memoriji `videoteka-servers-timeshift-shadow.md`.

- [x] **S** **Dijagnostika:** izmeriti koji audio codec vraća server videoteke i da li `timeshift.php` transkoduje. — ID: M1.6-a
  - Status: FINISHED
  - Log: Owner: Claude | Finished: 2026-06-08 | SSH read-only provera `mainssl` (`136.243.57.82`/Tailscale `100.96.250.114`). Nalaz: original `timeshift.php` NE transkoduje (0 ffmpeg poziva); MP2 segmenti idu sirovi → otud nema zvuka u web MSE. Server-side fix `timeshift_shadow.php` POSTOJI (MP2→AAC, deployed 2026-03-16) ali NIJE aktiviran (nije routan/log/archive prazni). Verifikacija: ručno na serveru (read-only + ffmpeg encoder check). Detalji: memorija `videoteka-servers-timeshift-shadow.md`.
> **📏 MERENJE CODECA (2026-06-08, ffprobe read-only na `ns3239635`/ovh-videoteka, 87 kanala sa arhivom):** Audio: 79 AAC (91% ✅), **7 MP2** (8% — `12,53,81,148,149,277,1495`), 1 MP3 (`1509`, Chrome svira ✅). Video: 84 h264 (✅), **3 HEVC** (`149,2927,30270` — Chrome desktop/Android NE dekoduju; `149`=MP2+HEVC). Snimanje NIJE na mainssl (`tv_archive` prazan) → glavni recording je `ns3239635` (Tailscale .34, 24TB, 16 CPU). **Zaključak: problem je mali i ciljan — realno ~7 MP2 kanala.**

- [~] **M** **Server-side MP2→AAC (opcija A): hardening `timeshift_shadow.php` + dinamička codec-mapa.** Repo: `infra/videoteka-shadow/`. — ID: M1.6-b
  - Status: IN PROGRESS
  - Log: Owner: Claude | Started: 2026-06-08 | Povučena tačna live kopija shadow-a (`timeshift_shadow.live.php`, md5 `a4ae3c60`), napravljena `timeshift_shadow.hardened.php` sa 3 hardening izmene (ADD-only): (1) globalni concurrency cap (`SHADOW_MAX_CONCURRENT_BUILDS=4`, iznad → 503), (2) inline cache GC za `/tmp` (sampled 1/25, max-age 7200s), (3) **dinamička codec-mapa** (`probe-codec-map.sh` cron → JSON; shadow `409 step-aside` za AAC/MP3 kanale, fail-open na ffprobe za unknown — hvata kanale koji se prebace na MP2). HEVC se NE transkoduje. Verifikacija: `php -l` ✅ lokalno + serverski PHP 7.2 ✅; `bash -n` ✅. NIJE deploy-ovano (čeka izolovan test). Sledeće: M1.6-c (klijent), pa deploy/test (M1.6-e).
- [ ] **S** **Klijentska integracija:** Lumen web da gađa `timeshift_shadow.php` (token/credentials format isti kao original) i da hendluje `409 step-aside` (`X-Lumen-Shadow: step-aside-safe`) → fallback na normalan catch-up put. `packages/api/src/xtream-codes-service.ts` + catch-up transport. — ID: M1.6-c
  - Status: TODO
  - Log: —
- [ ] **S** **HEVC kanali (`149,2927,30270`): klijentska detekcija + poruka** (ne transkodujemo video). Proširiti postojeći `unsupportedAudioCodec` mehanizam (PR #224) na `unsupportedVideoCodec:'hevc'` → overlay „ovaj kanal koristi HEVC, podržan na Safari/iOS, ne na ovom uređaju". `HlsPlayerAdapter.ts`/`VideoPlayer.tsx`. — ID: M1.6-d
  - Status: TODO
  - Log: —
- [ ] **M** **Izolovan test deploy** (vlasnička potvrda pre svakog koraka): backup → deploy hardened shadow na JEDAN recording server (`ns3239635`) → `php -l` na serveru → cron codec-mapa → nginx routing (samo ako nije već) → test na realnom MP2 kanalu (live+catch-up) u Chrome/PWA → CPU pod opterećenjem. Procedura+rollback: `infra/videoteka-shadow/README.md`. **ADD-only, instant rollback, original `timeshift.php` se NIKAD ne dira.** — ID: M1.6-e
  - Status: TODO
  - Log: —
- **Verifikacija (exit grupe):** na realnom MP2 kanalu (live + catch-up) zvuk radi u Chrome/PWA; HEVC kanali daju jasnu poruku (ne crn/tih ekran); shadow ne obara CPU recording servera pod beta opterećenjem (≤500 korisnika).

### ✅ MVP Exit kriterijumi
1. Login (Xtream + M3U), Live + VOD + Serije + EPG + Catch-up rade na realnom provajderu.
2. 300s live burn-in bez 429 i bez memory rasta.
3. Cast radi na bar jednom Chromecast + jednom TV-built-in uređaju, zapping bez crnog ekrana.
4. PWA installable, offline fallback radi.
5. Nijedan flow ne ostavlja beli ekran (error boundary) ni beskonačan spinner.
6. MP2 audio (M1.6): zvuk radi na MP2 kanalima u web/PWA, ILI je svesno dokumentovana opcija C sa jasnom porukom korisniku (ne tiha tišina).
7. `pnpm typecheck`, `pnpm lint`, `pnpm build`, `pnpm test:unit` zeleni.

---

## FAZA 2 — BETA

> **Cilj:** Proizvod spreman za ograničenu javnu betu (300–500 korisnika): popunjen VISION feature-set, smanjen tehnološki dug do nivoa gde su izmene bezbedne, prava observability i push, dokazane performanse na velikim listama.

### B2.1 — Bezbedna dekompozicija (PREDUSLOV: prvo testovi)
- [ ] **M** Integration testovi za session-core consumer flow (BroadcastChannel multi-tab, persist round-trip, source tranzicije). `packages/session-core/`. — ID: B2.1-a
  - Status: TODO
  - Log: —
- [ ] **M** State-machine test za live↔catch-up tranzicije (snap-to-live, timeshift prozor, switch-to-live). (KN-9) — ID: B2.1-b
  - Status: TODO
  - Log: —
- [ ] **L** Dekomponovati `Player.tsx` → `CatchUpPanel`, `ChannelSelector`, `PlaybackRestorer`, `OnDemandControls`. (KN-5) — ID: B2.1-c (zavisi od B2.1-a, B2.1-b)
  - Status: TODO
  - Log: —
- [ ] **L** Dekomponovati `VideoPlayer.tsx`; izdvojiti `catch-up-fallback-strategy` modul + testovi. (KN-5) — ID: B2.1-d (zavisi od B2.1-a, B2.1-b)
  - Status: TODO
  - Log: —
- [ ] **M** Definisati `CatchUpSessionMetadata` interfejs u `@lumen/types`, ukloniti `Record<string, unknown>` typeof check-ove. `sessionSources.ts`. (KN-9) — ID: B2.1-e
  - Status: TODO
  - Log: —

### B2.2 — VISION feature jaz
- [ ] **L** TMDB/IMDB metadata enrichment servis (poster/opis/cast/ocena) za VOD/Series detail. Novi `apps/web/src/services/metadata.ts`, `VodDetail.tsx`, `SeriesDetail.tsx`. (VISION gap) — ID: B2.2-a
  - Status: TODO
  - Log: —
- [ ] **M** VOD/Series resume pozicije + view history (proširiti `WatchHistoryEntry` da nosi i VOD/series + poziciju). `packages/storage/src/watch-history.ts`. (gap) — ID: B2.2-b
  - Status: TODO
  - Log: —
- [ ] **M** Audio/subtitle auto-preference po sačuvanom jeziku. `HlsPlayerAdapter.ts` + Settings. (research) — ID: B2.2-c
  - Status: TODO
  - Log: —
- [ ] **S** `capLevelToPlayerSize` za multivariant streams (ABR po veličini playera). `HlsPlayerAdapter.ts`. (research) — ID: B2.2-d
  - Status: TODO
  - Log: —

### B2.3 — Multi-renderer (pravi temelj za Cast/AirPlay)
- [ ] **M** Implementirati `RendererAdapter` (`local-web` prvi, pa `cast`); `VideoPlayer` da prestane da hardkoduje local-web. `packages/types/src/index.ts:305` → konkretne implementacije. (KN-6) — ID: B2.3-a
  - Status: TODO
  - Log: —
- [ ] **M** Pomeriti on-demand volume/seek state iz `Player.tsx` u session metadata da preživi renderer switch. (KN-6, VISION „session nezavisan od uređaja") — ID: B2.3-b
  - Status: TODO
  - Log: —

### B2.4 — Platform-agnosticism (preduslov za Phase 2 native)
- [ ] **M** Refaktorisati `credentials.ts` i `favorites.ts` da injektuju `StorageAdapter` (po uzoru na `watch-history.ts`). `packages/storage/src/`. (KN-4) — ID: B2.4-a
  - Status: TODO
  - Log: —
- [ ] **S** Dodati testove za `WebStorageAdapter` i `VersionedStorage`. (gap) — ID: B2.4-b
  - Status: TODO
  - Log: —

### B2.5 — Observability & push (pravi backend)
- [ ] **M** Integrisati `apps/push-api` sa web client-om (zameniti localStorage stub `push_subscriptions_v1`). `pushSubscriptionBackend.ts` ↔ `apps/push-api`. (push) — ID: B2.5-a
  - Status: TODO
  - Log: —
- [ ] **M** Observability backend sink — slati `catchup.*`/`playback.error` evente na kolektor umesto samo `console`. `services/observability.ts`. (gap) — ID: B2.5-b
  - Status: TODO
  - Log: —
- [ ] **S** Push payload deep-link u konkretan kanal/program (ne samo `/player`). (gap) — ID: B2.5-c
  - Status: TODO
  - Log: —
- [ ] **S** `configureWebPush` hard-fail/jasan log ako VAPID env nedostaje (sad soft-fail → tihi pad). `apps/push-api`. (risk) — ID: B2.5-d
  - Status: TODO
  - Log: —

### B2.6 — Performanse na velikim listama
- [ ] **M** 20k+ kanala stress-test (iskoristiti postojeći `scripts/perf/` + benchmark fixture); profilisati virtualizaciju i overscan. `ChannelList.tsx`, `scripts/perf/`. (VISION gap) — ID: B2.6-a
  - Status: TODO
  - Log: —
- [ ] **M** Offset-based ili virtual-scroll paginacija za kataloge (sad client-side slicing degradira >300 stavki). `VodCategories.tsx`/`SeriesCategories.tsx`. (weakness) — ID: B2.6-b
  - Status: TODO
  - Log: —

### B2.7 — Release-gate higijena (smanjiti šum)
- [ ] **S** Označiti Phase 1/2 gate-ove (device matrix, capacity za native, itd.) eksplicitno `not-applicable-phase-0a` umesto `pending`. `artifacts/release/`, validatori. — ID: B2.7-a
  - Status: TODO
  - Log: —
- [ ] **S** Zamrznuti dalje širenje device-matrix ceremonije do kraja web Final-a. — ID: B2.7-b
  - Status: TODO
  - Log: —
- **NE dirati:** no-media policy / remux hard-guard (`apps/proxy/src/server.ts:717,722`).

### ✅ BETA Exit kriterijumi
1. Svi VISION V1 feature-i: done ili svesno odloženo (TMDB, resume, multi-renderer, push).
2. `Player.tsx`/`VideoPlayer.tsx` dekomponovani, pokriveni testovima za kritične flow-ove.
3. Dokazane performanse na 20k+ kanala (TTFC < 3s target, memory pod kontrolom).
4. Pravi push + observability backend, ne stub.
5. 300–500 korisnika capacity: provajder/infra signoff (realni, ne template).
6. Storage potpuno iza `StorageAdapter` (spremno za native).

---

## FAZA 3 — FINAL VERSION

> **Cilj:** Produkciono spreman, brendiran, bezbedan proizvod za širu javnost. Polish, security hardening, operativna spremnost.

### F3.1 — Security hardening
- [ ] **M** Redaktovati kredencijale u proxy logovima (sad `request.url` sadrži user/pass u `/timeshift/` putanjama). `apps/proxy/src/server.ts`. (security) — ID: F3.1-a
  - Status: TODO
  - Log: —
- [ ] **M** Eksplicitna sanitizacija protokola na provider redirect lancima (`rewriteCatchUpUrlTargetOrigin` — protocol-injection rizik). (KN/security, high) — ID: F3.1-b
  - Status: TODO
  - Log: —
- [ ] **M** Rate limiting / concurrency cap na proxy-ju. `apps/proxy/src/server.ts`. (weakness) — ID: F3.1-c
  - Status: TODO
  - Log: —
- [ ] **S** Suziti proxy CORS sa `*` na konkretne origin-e gde je moguće. `apps/proxy/src/server.ts`. — ID: F3.1-d
  - Status: TODO
  - Log: —
- [ ] **S** Redirect depth limit na proxy-ju. (gap) — ID: F3.1-e
  - Status: TODO
  - Log: —

### F3.2 — Platform integracije & UX polish
- [ ] **M** Media Session API (lock-screen/hardware-key kontrole, metadata, artwork) — trenutno nedostaje. (research) — ID: F3.2-a
  - Status: TODO
  - Log: —
- [ ] **M** PiP dovršiti (permisije/izuzeci handling, testovi). `VideoPlayer.tsx`. (VISION partial) — ID: F3.2-b
  - Status: TODO
  - Log: —
- [ ] **M** AirPlay playback flow (sad samo detekcija dostupnosti) — kao drugi `RendererAdapter`. (VISION partial) — ID: F3.2-c (zavisi od B2.3-a)
  - Status: TODO
  - Log: —
- [ ] **S** Skeleton/loading UI za VOD/Series/EPG/Detail. (gap) — ID: F3.2-d
  - Status: TODO
  - Log: —
- [ ] **S** DRM/header passthrough u `setSource(MediaSource)` (priprema za token-auth provajdere). `HlsPlayerAdapter.ts`. (gap) — ID: F3.2-e
  - Status: TODO
  - Log: —
- [ ] **S** EPG cache schema verzionisanje. (gap) — ID: F3.2-f
  - Status: TODO
  - Log: —

### F3.3 — Operativna spremnost
- [ ] **M** Alerting na playback/cast/no-media evente (na bazi observability sink-a iz Bete). (ops) — ID: F3.3-a (zavisi od B2.5-b)
  - Status: TODO
  - Log: —
- [ ] **M** Provider health check / circuit breaker (jasna degradacija kad provajder padne). (gap) — ID: F3.3-b
  - Status: TODO
  - Log: —
- [ ] **S** Lazy-load preostalih teških stranica (sad samo `Player` lazy). `App.tsx`. (weakness) — ID: F3.3-c
  - Status: TODO
  - Log: —
- [ ] **S** Offline cached channel lista (VISION „offline" cilj). `usePWA.ts`/SW. (VISION) — ID: F3.3-d
  - Status: TODO
  - Log: —

### ✅ FINAL Exit kriterijumi
1. Security review prošao (proxy, kredencijali, redirect sanitizacija) — bez high/critical otvorenih.
2. Media Session + PiP + AirPlay rade; brendiranje/manifest finalni.
3. Operativni alerting + provider health monitoring aktivni.
4. Sve VISION V1 obećane sposobnosti: done.
5. Real-device QA matrix (desktop/mobile/Cast/TV-built-in) zelen sa realnim dokazima.

---

## PHASE 2 (posle Final web-a) — Native: Android TV / Tizen / webOS / Mobile

> Posebna faza, kreće tek posle Final web ship-a. Ovde su smernice; detaljan plan se pravi na startu Phase 2.

**Reusable (kroz `@lumen/*`):** types, api (Xtream + HttpClient DI), core (epg/channels), session-core (SessionStore), player-core (SeekEngine/IdleTimer), input (key-codes već feature-flagged), storage (POSLE B2.4 fix-a). **NE deli se** React/DOM UI kod.

**Per-platform (rendering + video engine):**
- **Mobile (prvo, najjeftinije):** Capacitor wrapper PWA-a ILI Expo (DECISION-DOC pending). Native `HttpClient`/`StorageAdapter`. Lock-screen kontrole (MediaSession/MPRemoteCommandCenter).
- **Tizen:** zaseban Vite target → `.wgt`; MSE/EME (hls.js/Shaka) za novije, AVPlay fallback za stare. Toolchain: Tizen Studio + Certificate Extension **≥ 2.0.73** (obavezno posle sep 2025).
- **webOS:** zaseban Vite target → `.ipk`; native HLS pipeline ima feature gaps (`EXT-X-DISCONTINUITY`/`PROGRAM-DATE-TIME`/ID3) → MediaKing discontinuity workaround postaje kritičan; MSE/EME za novije.
- **Android TV:** pravi native — Kotlin + Jetpack Compose for TV + Media3/ExoPlayer. `react-native-tvos` NE pokriva Tizen/webOS.

**Cast-first odlaže native TV:** Samsung 2024+/webOS/Google TV imaju ugrađen Cast — Final web + Cast pokriva veliki deo TV-a bez ijedne instalirane aplikacije. Native dolazi za brendirano lean-back iskustvo, store prisustvo, retenciju.

**Sekvenca Phase 2:** mobile (Capacitor/Expo) → Tizen + webOS → Android TV.

---

## Redosled rada (za dev agente — sažeto)

1. **M1.1** (3 HLS one-liner + load policies) — apsolutno prvo, najveći ROI, nizak rizik.
2. **M1.2** (error boundary, route guard, http timeout, test:unit traka).
3. **M1.3 + M1.4 + M1.5** (Cast, catch-up robusnost, PWA) — MVP ship.
4. **B2.1** (testovi PA dekompozicija) — nikad dekompozicija bez testova prvo.
5. Ostatak Bete paralelno gde nema zavisnosti (B2.2–B2.7).
6. Final (F3.x).
7. Phase 2 native.

**Pravilo za svaku izmenu:** `pnpm typecheck` + `pnpm lint` + `pnpm build` + `pnpm test:unit`; ažurirati `HANDOFF.md` (done/next/risks). **NE dirati:** no-media remux guard, HLS teardown/loadGeneration, SessionStore reducer.

> ⚠️ Posle SVAKOG taska: ispoštuj **📋 PROTOKOL RADA** (vrh fajla) — postavi `Status:`, popuni `Log:` (owner/datum/šta/fajlovi/test rezultat), i osveži **📊 Status dashboard** brojeve + „Sledeći task na redu". Ovaj fajl je jedini izvor istine o taskovima.
