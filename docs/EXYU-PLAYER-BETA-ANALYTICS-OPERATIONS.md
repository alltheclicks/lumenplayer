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

## Produkcioni smoke

Posle Lumen deploy-a proveriti:

1. Login kroz `https://exyu.tv/api/player-sso` sa aktivnim korisnikom.
2. U `panel-new/player-analytics.php` se pojave uređaj, route i `session.started`.
3. Pokretanje kanala popuni `playback.source-selected`, `playing`, QoE i heartbeat.
4. `Prijavi problem` šalje feedback i replay koji se otvara u ugrađenom rrweb
   playeru, bez video slike i bez credentiala/media URL-a.
5. Neautorizovan direktan POST na obe Lumen analytics rute vraća 401, pogrešan
   Origin 403, a analytics kvar ne menja playback ponašanje.

Admin pregled je na `https://serv.mediaking.fi:85/player-analytics.php`.
