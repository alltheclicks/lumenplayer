# P4 — Izdvajanje jezgra iz `apps/web` (izvršni plan, osvežen 2026-10-06)

> Status: AKTIVAN · Odluka: `docs/DECISION-KLARO-PLATFORM-STACK-20261006.md` (D5 — P4 ide pre svake TV aplikacije)
> Zamenjuje detalje iz `PLAN-MULTIPLATFORM-EXECUTION.md` §4 (ciljevi, invarijante i exit kriterijum odatle i dalje važe). Inventar je izmeren na `0105fb7` (`wc -l`), ne procenjen.

**Pravilo za svaki korak:** čist refactoring, nula promena ponašanja. Svaki PR prolazi `pnpm lint && pnpm typecheck && pnpm test:unit && pnpm build && pnpm release:qaf035:validate`. Koraci označeni 🔥 dodatno traže ručni smoke (live, catch-up, VOD, Cast) na pravom provideru.

## 1. Gde smo (izmereno)

- `apps/web/src`: 92 non-test modula / 28.995 linija (bez `components/ui`), 49 test fajlova / 9.213 linija.
- `packages/*`: ~2.950 linija. Nijedan paket nema sopstveni `typecheck`; paketi se proveravaju samo kroz `apps/web`, koji je `strict: false`.
- God-komponente rastu: `VideoPlayer.tsx` 4.475 (jul: 4.007), `Player.tsx` 3.270 (3.129), `PlayerControls.tsx` 2.018, `HlsPlayerAdapter.ts` 2.527 (2.097).
- Nijedan preduslov iz jula nije urađen: nema `PlaybackRequest`/`CatchUpSessionMetadata` u `@lumen/types` (adapter i dalje čita netipizirani side-channel, `HlsPlayerAdapter.ts:151-159`), `base.json` nema `lib` ograničenje, nema ESLint guard-a, `credentials.ts` je i dalje mrtav, `session-core` hardkoduje `localStorage`/`BroadcastChannel` (`session-store.ts:550-571`), `RendererAdapter` nema implementaciju, session-core ima samo 6 idempotency testova.
- ~35 modula nije bilo u julskom planu (analitika, brand config, katalog/serije, `pages/*.ts` policy helperi).

### Kandidati po ciljnom paketu

| Cilj | Modula | Src / test linija | Napomena |
|---|---|---|---|
| `@lumen/player-hls` (browser adapter, DOM dozvoljen) | 3 | 3.629 / 3.083 | `HlsPlayerAdapter` + `mpegTsPtsRebase` + `mpegTsAudioStrip`; touch points: `fetch`, `window.location`, `document.querySelectorAll` |
| `@lumen/catchup-core` — čisti | 10 + 8 `pages/*` | 2.483 / 3.041 | `videoPlaybackSync`, `sessionSources`, `timelineSeek`, `liveTimeshift`, `catchupPrefetch`, `catchUpEmptyState`, `catchUpSegmentInFlight`, `catchupProgramNavigation`, `controlsIdlePolicy`, `playerErrorState`; `restoreSessionSource`, `playerOnDemandContext`, `restoreLiveChannel`, `playbackProblemReport`, `livePauseResumePolicy`, `liveCatchUp*`, `liveChannelStartupMode` |
| `@lumen/catchup-core` — traže DI | 7 | 2.880 / 1.697 | `catchupTransport`, `catchupSource` (importuje hls.js!), `catchupGateway`, `catchupRuntimeCompatibility`, `catchupClientRebaseCompat`, `catchupCapability`, `sourceBlockingError` — `import.meta.env`, `window.location.origin`, `localStorage`, `config/brand`, `config/xtream`, module-level state |
| `@lumen/epg` | 3 | 712 / 227 | `epgProgramMapper` (atob), `xmltvEpg` (DOMParser), `channelEpg` (singleton `xtreamService`; DI factory već postoji) |
| `@lumen/observability` | 4 + deo `playerAnalytics` | 500 + ~370 / 260 | `playerAnalytics.ts` (1.363) se prvo deli: linije ~1–368 čiste, ostatak je DOM/rrweb sink koji ostaje u webu |
| `@lumen/catalog` (novo) | 6 | 353 / 97 | `seriesDetail`, `seriesNavigation`, `vodReleaseYear`, `seriesArtwork`, `seriesCountLabel`, `catalogQueryParams` |
| `@lumen/storage` | 6 | 390 / 134 | `appSettings` (deli se na normalize vs DOM apply), `onDemandProgress`, `playerLayoutPreferences`, `managedAccessMode`, `watchHistory`, `xtreamCredentials` |
| Ostaje u webu | — | — | push/PWA servisi, `playerFullscreen`, `routeGuard`, `services/storage.ts` i `xtreamService.ts` (composition root), svi React hook-ovi i komponente |

### Logika zakopana u komponentama (korak 5)

- `VideoPlayer.tsx`: helperi :222-590; `switchToCatchUpFallbackIfAvailable` :1376-1718; `scheduleCatchUpSeekWatchdog` :1859-2063; **glavni adapter-wiring effect :2069-3436 (1.368 linija, `new HlsPlayerAdapter` na :2075)**; seek/session sync :3529-4119; background/visibility :1069-1232.
- `Player.tsx`: helperi :159-313, `isSameSessionSource` :380-400, bootstrap :860-1022, `resolveCatchUpProgramPlayback`/`playCatchUpProgram` :1153-1283.
- `PlayerControls.tsx` :98-130 `groupProgramsByDate` duplira `Player.tsx` :209.
- `useGoogleCastSender.ts` :275-311 i :440-529 (Cast reconciliation).

### Isti ugovor napisan na dva mesta (proxy ↔ web)

- Catch-up gateway tipovi: `apps/proxy/src/catchup-gateway-contracts.ts` ↔ `catchupGateway.ts:5-50` (ručno dupliran).
- `/xui-api` base path hardkodovan na 6 mesta (proxy, 4 web modula, `packages/api`).
- Privacy redakcija: fork sa različitim limitima (proxy 6/50/4096 vs web 10/500/20000).
- Player analytics endpointi i config šema; SSO token ugovor.

## 2. Koraci (redosled = redosled PR-ova)

### Korak 0 — Ograde (bez pomeranja koda) · S×4

- **0a** `typecheck` skript u svakom paketu + turbo task; paketi se kompajliraju samostalno pod `strict: true`. Prvo izmeriti broj grešaka, pa popraviti.
  - ✅ **Urađeno 2026-10-06.** Nalaz: paketski `tsconfig`-ovi nikad nisu radili (`@lumen/tsconfig` nije bio zavisnost paketa, a `composite`/`references` su tražili build koji ne postoji). `base.json` je sada source-only (`noEmit`, bez `composite`), svaki paket ima `typecheck` i `@lumen/tsconfig` devDependency. Strict backlog je bio samo 5 grešaka, sve u `@lumen/api` (tipovi, bez promene ponašanja). `pnpm typecheck` sada pokriva 11 projekata umesto 3.
- **0b** `base.json` → `"lib": ["ES2020"]` + mali deljeni `platform-globals.d.ts` (`URL`, `URLSearchParams`, `setTimeout`, `AbortController`, `console`, `atob`, `TextEncoder`/`TextDecoder`, `crypto.randomUUID`) — ovi postoje na svim ciljnim platformama, ali nisu u ES lib-u. DOM je eksplicitni opt-in (samo `player-hls`, privremeno `storage`).
- **0c** ESLint za `packages/*/src`: `no-restricted-globals` (`window`, `document`, `localStorage`, `sessionStorage`, `navigator`, `BroadcastChannel`, `DOMParser`) i `no-restricted-imports` (`react-dom`, `hls.js`, `apps/*`, `@/…`), sa izuzecima za platformske pakete.
- **0d** Obrisati mrtav `packages/storage/src/credentials.ts`. Release skripte koje hardkoduju putanje (`validate-observability-baseline`, `validate-google-cast-readiness`, `validate-pwa-readiness`, `v1-security-privacy-baseline.test`, `design-sync/build-bundle`, root `release:observability:test`) — ažuriraju se u istom PR-u u kom se fajl pomera; ovde samo popisati u checklisti.

### Korak 1 — Sigurnosna mreža testova · M×2

- **1a** session-core: reducer prelazi, persistence, broadcast (B2.1-a).
- **1b** Characterization testovi live↔catch-up toka nad modulima koji se pomeraju (B2.1-b) — fiksiraju sadašnje ponašanje, ne "ispravno".

### Korak 2 — Ugovori i ubrizgani config · M×4

- **2a** Zajednički catch-up gateway ugovor + `/xui-api` konstanta u `@lumen/types` (ili novi `@lumen/contracts`); proxy i web ga importuju umesto kopija.
- **2b** `PlaybackRequest` / `CatchUpSessionMetadata` u `@lumen/types`; adapter čita tipizirane metapodatke umesto side-channel-a (P4.1-a, B2.1-e).
- **2c** `PlayerAdapter`: opcioni capability eventi umesto 9 out-of-band callback-a + adapter factory (P4.1-b). Samo interfejs; `VideoPlayer` se menja minimalno.
- **2d** `PlayerRuntimeConfig` objekat (origin, proxy base path, shadow/gateway hostovi, feature flagovi, `brandShort`, provider host liste) koji web puni iz `import.meta.env`/`window.location` na jednom mestu. Korisnički tekstovi u policy modulima → kodovi poruka, tekst ostaje u webu.

### Korak 3 — Pomeranje, od najmanjeg rizika · S–L

- **3a** `@lumen/catchup-core` sa čistim modulima i njihovim testovima (bez DI). — M
- **3b** `@lumen/catalog` (serije/VOD helperi). — S
- **3c** 🔥 DI catch-up moduli → `catchup-core` (posle 2d): razbiti ciklus `catchupGateway`↔`catchupTransport`, `catchupSource` bez hls.js (ubrizgan `isMseSupported`), module-level state → factory/instance. — L
- **3d** `@lumen/epg` sa ubrizganim XML parserom i base64 dekoderom. — M
- **3e** 🔥 `@lumen/player-hls`: tri adaptera + testovi; `window.location`/`document` ubrizgani. — L
- **3f** Storage: `StorageAdapter` za favorites i podešavanja (`appSettings` podeljen), session-core dobija ubrizgan storage + broadcast transport (P4.3-a). — M
- **3g** Observability: podeliti `playerAnalytics.ts`, čist deo u paket, DOM/rrweb sink ostaje u webu; jedna redakcija za proxy i web, **limiti kao parametri** da se ponašanje ne promeni. — M

### Korak 4 — Session & renderer · M×3

- **4a** Cast reconciliation iz `useGoogleCastSender` u framework-free modul; `LocalRendererAdapter` + `CastRendererAdapter` (P4.3-b).
- **4b** Session ugovor: `seek` vs `progressReported`, rešiti `liveOffsetMs` (P4.1-c).
- **4c** `@lumen/input` `Platform` union (`androidtv`, `tvos`, `vidaa`…) + ubrizgan hint (P4.3-d).

### Korak 5 — 🔥 Razbijanje god-komponenti · L×3

Najrizičnije, zato poslednje (B2.1-c/d). Iz `VideoPlayer.tsx` izvući: fallback politiku, seek watchdog, start-position resolvere, i glavni wiring effect podeliti na manje hook-ove nad `catchup-core` + `player-hls`. Iz `Player.tsx`/`PlayerControls.tsx` izvući grupisanje programa (jedna implementacija umesto dve) i catch-up program playback. Uskladiti sa bilo kojim paralelnim popravkama playera — isti fajlovi.

### Korak 6 — Zatvaranje · S

Docs sync (CLAUDE.md: ukloniti pominjanje re-export shim-ova koji ne postoje; BACKLOG/ROADMAP), CI turbo filteri po aplikaciji (P4.4-c), provera exit kriterijuma.

## 3. Rizici

- **Strict skok je neizmeren** — 0a prvo meri; ako je backlog veliki, uključivati strict po paketu.
- **Ugrađena poslovna pravila** (srpski tekst sa `BRAND_SHORT`, hardkodovane provider host liste) — rešava 2d; bez toga paket nosi EXYU/provider specifičnosti na TV.
- **Module-level state** postaje globalan po bundle-u — factory API u 3c/3f.
- **Konflikti sa popravkama playera** — koraci 3c, 3e i 5 diraju iste fajlove kao reliability rad; ne raditi ih paralelno sa otvorenim player PR-om.
- **Release skripte sa putanjama** — svaki move PR ažurira ih u istom commitu, inače pada `release:qaf035:validate`.

## 4. Exit (nepromenjeno iz jula)

`apps/web` ne sadrži nijedan modul koji TV aplikacija treba; svi paketi se typecheck-uju samostalno; pun regression zelen i ručni smoke live/catch-up/Cast — web se ponaša identično kao pre P4.
