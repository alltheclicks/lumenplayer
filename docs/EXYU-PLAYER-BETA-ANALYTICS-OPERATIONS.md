# EXYU Player Beta Analytics — operations

Lumen šalje first-party beta telemetriju u EXYU ingestion API bez treće strane.
Analytics je best-effort i ne sme blokirati SSO ili playback.

## Tok poverenja

1. EXYU kreira opaque HMAC subject i session UUID, upiše mapiranje u Supabase i
   ubaci opcioni `analytics` blok u šifrovani `lps1` token.
2. Lumen proxy validira token i EXYU destinacije prema svom environment-u.
3. Proxy vraća SPA-u samo opaque subject/session i same-origin rute, a browseru
   postavlja autentifikovan HttpOnly cookie za `/player-analytics`.
4. Browser batch/replay ide u Lumen proxy. Proxy uvek prepisuje identity/session
   vrednosti iz cookie-ja, ponovo rediguje sadržaj i dodaje server-only bearer
   secret kada prosleđuje EXYU-u.

Browser nikada ne dobija `PLAYER_ANALYTICS_INGEST_SECRET`, Supabase user ID,
XUI username ili upstream ingestion destinaciju kao autoritet.

## Runtime environment

U `/opt/lumen/proxy/proxy.env` moraju postojati:

```dotenv
PLAYER_ANALYTICS_INGEST_SECRET=<isti secret kao na exyu.tv>
PLAYER_ANALYTICS_INGEST_URL=https://exyu.tv/api/internal/player-analytics/ingest
PLAYER_ANALYTICS_REPLAY_URL=https://exyu.tv/api/internal/player-analytics/replay
LUMEN_PLAYER_ANALYTICS_RATE_LIMIT_PER_MINUTE=240
LUMEN_PLAYER_REPLAY_RATE_LIMIT_PER_MINUTE=20
```

Secret nije Vite promenljiva i ne sme biti u git-u ili browser bundle-u.

Live VPS je trenutno iza Cloudflare Flexible moda i koristi
`/etc/nginx/snippets/player-app.conf`, ne TLS-origin-only template. Kanonske
deploy kopije su `scripts/deploy/nginx-player-exyu-cloudflare-snippet.conf` i
`scripts/deploy/nginx-player-exyu-zones.conf`; ne zamenjivati live vhost
`nginx-player-exyu.conf` templateom bez zasebne odluke o Cloudflare origin modu.

## Privatnost i replay

- Čuvaju se običan search/feedback tekst, semantički klikovi, navigacija,
  uređaj/browser/OS, QoE, crash i poslednjih 30 događaja.
- Ne čuvaju se credentiali, auth headeri/cookies, media/provider URL-ovi,
  request/response body auth/media poziva, video/audio/canvas sadržaj.
- rrweb drži približno poslednja tri minuta samo u memoriji i uploaduje ih tek
  uz crash ili korisničku prijavu problema.
- Login forma i credential inputi su blokirani/maskirani; video, audio i canvas
  su u `rr-block` zoni. Redakcija se izvršava u browseru, Lumen proxy-ju i EXYU
  API-ju.

## Produkciono stanje 12.7.2026

- EXYU analytics backend: release `20260712164625`, commit `5d73414`
  (funnel/heatmap insights od `40ee6d0`).
- Lumen web/proxy: release `20260712T144323Z-2d2cad6` na grani
  `exyu/player-integration`.
- `panel-new/player-analytics.php` prikazuje opseg 7/30/90 dana, playback funnel,
  semantički heatmap, koordinatni 10×6 heatmap, greške i crash fingerprint grupe.
  Jedan klik može imati najviše jedan `errorFollowup` u prozoru od 30 sekundi.
- Klikovi od release-a `7ca9443` nose normalizovane koordinate, viewport i input
  metodu. Stariji klikovi ostaju vidljivi u semantičkom heatmapu, ali se ne
  retroaktivno pojavljuju u koordinatnoj mreži.
- Novi tab obnavlja opaque subject/session i same-origin rute preko
  `GET /player-analytics/config`. Ruta zahteva postojeći autentifikovan cookie i
  validan Origin; nikada ne vraća XUI podatke, ingestion secret ili upstream URL.
- Kumulativno vreme reprodukcije i funnel pragovi 1/5 minuta ostaju monotoni kroz
  reload iste tab sesije od release-a `7ca9443` nadalje.
- `sw.js` i `registerSW.js` imaju `no-store` i
  `Cloudflare-CDN-Cache-Control: no-store`; javni odgovor mora imati
  `CF-Cache-Status: BYPASS`. Hashovani `/assets/*` ostaju jednogodišnji
  immutable cache.
- Feedback upload čeka replay najviše pet sekundi. Backend dodatno prihvata
  redosled starih/keširanih klijenata u kome feedback ili crash stigne prvi,
  čuva `pendingReplayId` i automatski postavlja strani ključ kada replay stigne.
- Produkcioni signed-in smoke je potvrdio SSO, stvarni live playback, feedback,
  replay, stari redosled, sintetički crash i preuzimanje/dekompresiju crash
  replay-a. Posle finalnog deploy-a nema novih `22P02` ili `23503` storage
  grešaka.

## Produkcioni smoke

Posle Lumen deploy-a proveriti:

1. Login kroz `https://exyu.tv/api/player-sso` sa aktivnim korisnikom.
2. U `panel-new/player-analytics.php` se pojave uređaj, route i `session.started`.
3. Pokretanje kanala popuni `playback.source-selected`, `playing`, QoE i heartbeat.
4. `Prijavi problem` šalje feedback i replay koji se otvara u ugrađenom rrweb
   playeru, bez video slike i bez credentiala/media URL-a.
5. Neautorizovan direktan POST na obe Lumen analytics rute vraća 401, pogrešan
   Origin 403, a analytics kvar ne menja playback ponašanje.
6. Otvaranje novog taba sa sačuvanim player kredencijalima dobija 200 sa
   `/player-analytics/config`, a klik se pojavljuje u semantičkom i koordinatnom
   heatmapu.
7. U semantičkom heatmapu `errorRate` nikada nije veći od 100%.

Admin pregled je na `https://serv.mediaking.fi:85/player-analytics.php`.
