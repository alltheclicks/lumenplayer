# V1 EXYU pilot — 100 korisnika

## Zaključane odluke

- Javni URL: `https://player.exyu.tv`.
- Pilot pristup: poziv odabranim korisnicima + ručni login postojećim EXYU/XUI podacima.
- Lumen VPS služi samo statički web, `/observe` i `/health`; javni
  `/xui-api` i `/catchup-gateway` su zatvoreni u pilot Nginx profilu.
- Live/VOD/catch-up media ide direktno `gw.castcdn.net` / edge host → korisnikov uređaj.
- Catch-up PTS/DTS/PCR rebase radi korisnikov browser. Shadow ostaje best-effort fallback za codec-normalizaciju koju browser ne može da uradi (npr. MP2→AAC).

## Pre-DNS gate

1. RC commit mora biti čist i svi obavezni testovi zeleni.
2. `apps/web/.env.production` mora imati:
   - `VITE_XTREAM_PROXY_ORIGIN=` (prazno, direktni CDN put),
   - `VITE_OBSERVABILITY_BEACON_URL=https://player.exyu.tv/observe`,
   - `VITE_CATCHUP_CLIENT_REBASE=1`,
   - `VITE_CATCHUP_SHADOW_VALIDATION=1`,
   - `VITE_CATCHUP_GATEWAY_ENABLED=0` (hard off; sprečava automatski
     `edge6` media relay kroz Lumen VPS).
3. Proxy env mora dozvoliti `https://player.exyu.tv` kao CORS origin.
   Kao početnu konfiguraciju kopirati `scripts/deploy/proxy-exyu.env.example` u
   `/opt/lumen/proxy/proxy.env`; `LUMEN_TRUST_PROXY_HOPS=1` je obavezan da
   `/observe` rate-limit razlikuje klijente iza lokalnog Nginx-a.
4. Obezbediti svež QA XUI nalog; credential iz repo/handoff istorije se ne koristi.

## EXYU cohort ulaz

- U EXYU produkcionom env-u postaviti `WEB_PLAYER_URL=https://player.exyu.tv`.
- `WEB_PLAYER_PILOT_EMAILS` sadrži comma-separated listu odabranih naloga.
- `/player` prikazuje V1 CTA samo prijavljenom korisniku sa emailom na listi i
  `user_subscription.is_active=true`.
- Ovo je soft gate linka, ne SSO: direktni Lumen URL i dalje traži validan XUI
  login. Za striktno ograničenje hosta na tačno 100 naloga potreban je launch-ticket tok.

## DNS i TLS

`exyu.tv` već šalje HSTS sa `includeSubDomains`, zato se poddomen ne objavljuje bez ispravnog HTTPS-a.

1. Na VPS-u napraviti `/var/www/letsencrypt` i privremeno uključiti `scripts/deploy/nginx-player-exyu-bootstrap.conf`.
2. Dodati Cloudflare `A` zapis: `player` → `151.241.151.105`, inicijalno DNS-only.
3. Izdati certifikat:

   ```bash
   certbot certonly --webroot -w /var/www/letsencrypt -d player.exyu.tv
   ```

4. Uključiti `scripts/deploy/nginx-player-exyu.conf`, zatim `nginx -t` i reload.
5. Za pilot zadržati DNS-only. Cloudflare proxy uključiti tek uz proverenu
   real-client-IP konfiguraciju na originu; SSL mode mora biti `Full (strict)`,
   nikad `Flexible`.

## Pilot verifikacija

1. `https://player.exyu.tv/` i `/health` vraćaju `200`.
2. Browser je secure context; service worker i PWA install rade.
3. Login sa namenskim EXYU/XUI QA nalogom.
4. DevTools potvrđuje da video segmenti idu direktno na CDN/edge, ne kroz `151.241.151.105` ili `/xui-api/`.
   Zahtevi na `/xui-api/` i `/catchup-gateway/` moraju vraćati `404`.
5. Smoke: live zap, VOD, series, EPG i catch-up na RTS 1, PINK i NOVA S.
6. Catch-up telemetrija: `catchup.rebase` summary/fallback, `catchup.stall`, TTFRF i playback error rate.
   Summary mora pratiti i `maxProcessingMs`, `slowSegments` i
   `maxSegmentBytes`; rebase buffer je ograničen na 96 MB, a fragment preko
   64 MiB automatski ide na fallback bez skeniranja.
7. Ručni uređaji: Chrome/Windows, Safari/macOS, Android Chrome i iOS Safari pre prvog talasa.

## Talasi

- Talas 1: 10 korisnika / 24h.
- Talas 2: 25 korisnika / 24h.
- Talas 3: 50 korisnika / 24h.
- Talas 4: 100 korisnika.

Ne prelaziti u sledeći talas dok nema ponovljivog login/playback incidenta, catch-up fallback burst-a ili neočekivanog VPS media saobraćaja.

## Brzi rollback

- Client rebase problem: postaviti `VITE_CATCHUP_CLIENT_REBASE=0`, rebuild i redeploy prethodnog web artefakta.
- Direktni CDN CORS problem: vratiti poslednji poznati proxy profil samo za mali dijagnostički talas; ne puštati 100 korisnika kroz VPS media relay.
- Aplikacioni problem: vratiti prethodni verzionisani web artefakt i proveriti `/`, `/health` i login pre ponovnog otvaranja pilota.

## Van V1 pilot scope-a

- Supabase SSO i hard allowlist nisu deo soft pilota.
- Ako je potreban stvarni gate od tačno 100 naloga, uvodi se server-side allowlist + jednokratni launch ticket; Xtream lozinka se nikad ne stavlja u URL ili JWT.
