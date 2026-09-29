# Klaro Player — brend i rebrend iz Lumen Player-a

> Datum: 29. septembar 2026 · grana `feat/klaro-player-rebrand` (sa `origin/main` `7b51437`)

## Identitet

| Stavka | Vrednost |
|---|---|
| Naziv proizvoda | **Klaro Player** (kratko: Klaro) |
| Domen | `klaroplayer.com` |
| Glavna poruka | **One setup. Every screen.** |
| Opis | **Add your source once. Your channels, favourites and progress follow you everywhere.** |
| Pozicioniranje | Cross-platform softverski OTT/IPTV media player za televizore, box uređaje, telefone, tablete, web i desktop. **Ne uključuje kanale niti sadržaj** — korisnik dodaje sopstveni izvor (Xtream / M3U). |
| Interni code name | `lumen` (ostaje u paketima, ključevima, env varijablama, deploy putanjama) |

Izvor istine u kodu: `apps/web/src/config/productIdentity.ts` (čiste konstante, deli ga i `vite.config.ts`) → `apps/web/src/config/brand.ts` (`VITE_BRAND_NAME` override za customer buildove, npr. `EXYU.tv`).

## Logo

Odobreni logo fajlovi treba da stoje u `brand/klaro-player/`. **Taj folder na dan rebrenda ne postoji** (ni u radnom stablu, ni u Git istoriji), pa logo i ikonice NISU menjani i nije napravljen privremeni logo.

Trenutno stanje ikonica (`apps/web/public/favicon.svg`, `apple-touch-icon.png`, `pwa-*.png`, `apple-splash-*.png`): to je **EXYU.tv grafika** (commit `8f9198d`), koja nije env-gated — default Klaro build zato i dalje prikazuje EXYU ikonice. U aplikaciji default brend (`HAS_CUSTOM_BRAND=false`) prikazuje generičku plavu Play pločicu umesto logotipa. Kad odobreni fajlovi stignu, treba odlučiti da li ikonice postaju brend-zavisne (Klaro default vs EXYU customer build) — sada su deljene.

## Šta je promenjeno (bezbedne javne promene)

| Mesto | Pre | Posle |
|---|---|---|
| `brand.ts` default `BRAND_NAME` | Lumen Player | Klaro Player (`BRAND_SHORT` = Klaro, wordmark „Klaro “ + „Player“) |
| `<title>`, Helmet naslovi, wordmark, error copy „…niti do X playera“ | Lumen | Klaro (preko `brand.ts`) |
| PWA manifest `name` / `short_name` (default build) | Lumen Player / Lumen | Klaro Player / Klaro |
| PWA manifest `description` + `<meta name="description">` (default build) | Watch live TV channels | One setup. Every screen. Add your source once. … |
| Isto za customer build (`VITE_BRAND_NAME=EXYU.tv`) | Watch live TV channels | **nepromenjeno** |
| `public/sw-push-handlers.js` fallback naslov push notifikacije | Lumen Player | Klaro Player |
| Design-sync bundle (`scripts/design-sync/*`) | Lumen Player | Klaro Player |
| `VISION.md`, `SESSION-ARCHITECTURE.md`, `ROADMAP.md`, `CLAUDE.md` | Lumen Player, planirani `*.lumenplayer.com` | Klaro Player, planirani `*.klaroplayer.com` |

Produkcija `player.exyu.tv` se builduje sa `VITE_BRAND_NAME=EXYU.tv`: naslov, manifest i meta opis su provereno identični pre i posle izmene. Jedina razlika koju EXYU korisnik može videti je fallback naslov push notifikacije bez `title` polja (bio je „Lumen Player“, sada „Klaro Player“) — i to tek posle novog deploy-a.

## Tehnički identifikatori — NISU menjani (potrebna odluka vlasnika)

| Identifikator | Gde | Rizik pri promeni |
|---|---|---|
| localStorage ključevi `lumen-web:v1:*` (kredencijali, favoriti, istorija, layout, managed mode), `lumen:*` (session-core state, analytics, catch-up cache), `VersionedStorage` namespace `lumen` | `apps/web/src/services/*`, `packages/storage`, `packages/session-core` | **Gubitak korisničkih podataka** (odjava, nestali favoriti/progress) bez migracije |
| BroadcastChannel `lumen:session-core:sync` | `packages/session-core` | Tabovi različitih verzija prestaju da se sinhronizuju |
| Cookie `lumen_player_analytics` | `apps/proxy/src/player-analytics.ts` | Prekid kontinuiteta analitike |
| Cast namespace `urn:x-cast:com.lumenplayer.bridge`, `lumen-google-cast-sdk` | `public/receiver.html`, sender | Sender/receiver različitih verzija prestaju da komuniciraju |
| URL parametri `__lumenTransport`, `__lumenProgramId`, …, sentinel `lumen://catchup-unavailable/` | proxy ↔ web | Nekompatibilnost proxy/web verzija tokom deploy-a |
| npm workspace paketi `@lumen/*`, root `lumen-player` | ceo monorepo | Veliki churn, lockfile, turbo filteri, CI i skripte (`pnpm --filter @lumen/web`) |
| Health `service: "@lumen/proxy"` | `apps/proxy/src/server.ts` | Monitoring/provere mogu da ga očekuju |
| Env varijable `LUMEN_*` (proxy, remux, gateway, SSO rate limit, QA, `LUMEN_PWA_SW_MODE`) | proxy, vite, skripte, `/etc/lumen/proxy.env` na VPS-u | Tiho vraćanje na default vrednosti ako se env na serveru ne preimenuje istovremeno |
| Deploy putanje `/var/www/lumen-*`, `/opt/lumen/*`, `lumen-release.txt`, systemd `lumen-uptime-monitor.*`, nginx zone `lumen_sso` / `lumen_replay` / `lumen_analytics` | `scripts/deploy/*` | Pokidan deploy/rollback i rate-limit na produkciji |
| VAPID subject `mailto:ops@lumenplayer.local` | `apps/push-api` | Nizak rizik, ali treba stvarna adresa (npr. na `klaroplayer.com`) — odluka |
| GitHub repo `alltheclicks/lumenplayer`, lokalni folder `Lumen Player` | van koda | Linkovi u docs/PR istoriji, putanje u skriptama i memorijama agenata |
| Test fixture domeni `app.` / `proxy.` / `cast.lumenplayer.com` | `apps/proxy/src/server.test.ts`, `apps/web/src/config/xtream.test.ts` | Bez rizika (primeri), ostavljeni radi minimalnog diffa |
| Release evidence validatori očekuju „Lumen Cast Receiver“ (receiver je već „Cast Receiver“) | `scripts/release/validate-manual-device-qa.mjs`, `scripts/perf/stagingCapacitySmoke.mjs` | Postojeća neusklađenost, nije uvedena rebrendom |

Nativne platforme (iOS/Android/Tizen/webOS/desktop) u repou još ne postoje, pa nema bundle ID-jeva, package name-ova ni signing konfiguracije. Kada se prave, treba ih od starta napraviti pod Klaro identitetom (npr. `com.klaroplayer.*`) — to je odluka vlasnika.

## Istorijski zapisi — namerno nepromenjeni

`HANDOFF*.md`, `BACKLOG.md`, `DECISION-DOC.md`, `docs/**` (izveštaji, planovi, handoff mape), `artifacts/release/**` (potpisani evidence JSON-ovi), `infra/videoteka-shadow/*`: pominju „Lumen“ kao istorijski/interni naziv. Prepisivanje bi falsifikovalo zapise i pokvarilo release validatore.
