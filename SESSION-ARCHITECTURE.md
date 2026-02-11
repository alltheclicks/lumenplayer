# Session-Centric Architecture — Lumen Player

> Datum: 11. februar 2026  
> Status: Usvojeno kao strateški smer  
> Važi uz `DECISION-DOC.md` (ovo je nadogradnja, ne reset arhitekture)

## 1. Cilj

Lumen prelazi sa "device-centric player app" modela na **session-centric** model:

- Playback je jedna centralna sesija (`sessionId`)
- Sesija je nezavisna od UI klijenta i uređaja
- Telefon je controller, TV/Cast/AirPlay su renderer-i
- Casting menja renderer, ne playback sesiju

## 2. Zašto ovaj model

1. PWA-first otpornost na store rizik (Google/Apple/TV store policy)
2. Stabilniji casting i reconnect
3. Phone-as-remote UX kao standard
4. Xtream Codes ostaje čist source stream URL-ova

## 3. Scope i non-goals

### Scope
- Session state model
- Command/event model
- Renderer switching (local -> cast -> local)
- Reconnect/resume mehanizam

### Non-goals
- Menjanje Xtream protokola
- Full multi-user account backend u prvoj iteraciji
- Potpuna eliminacija native app-a od prvog dana

## 4. Ključni koncepti

## 4.1 SessionState

Obavezna polja:
- `sessionId`
- `source` (url + metadata)
- `playback` (`playing|paused|buffering|error`)
- `positionMs` ili `liveOffsetMs`
- `renderer` (`local-web|cast|airplay`)
- `updatedAt`

## 4.2 Commands

Sesija prima komande:
- `setSource`
- `play`
- `pause`
- `seek`
- `switchRenderer`
- `stop`

Pravilo: komande moraju biti **idempotentne**.

## 4.3 Events

Sesija emituje:
- `sessionUpdated`
- `rendererChanged`
- `playbackStateChanged`
- `error`

UI je subscriber, ne source-of-truth.

## 4.4 Adapter slojevi

- **PlayerAdapter**: lokalni video engine (HLS.js / AVPlayer / ExoPlayer / AVPlay)
- **RendererAdapter**: gde se playback izvršava (local/cast/airplay)

> **Napomena — dual-video tehnika za Cast RendererAdapter:**
> Cast receiver koristi dva `<video>` elementa — dok jedan aktivno reprodukuje kanal, drugi u pozadini pre-buffer-uje sledeći kanal. Pri promeni kanala swap-uje se vidljivi element, čime se eliminiše crni ekran tokom zapping-a. Ovo je ključna UX prednost nad AirPlay-em gde ova optimizacija nije moguća (AirPlay kontroliše rendering na receiver strani bez pristupa DOM-u).

Ova dva interfejsa su komplementarna, ne konkurentna.

## 5. Xtream Codes integracija

Xtream ostaje nepromenjen:
- daje stream URL-ove i metadata
- session sloj samo orkestrira: šta se pušta, gde se pušta i od koje pozicije

## 5.1 Hosting i deployment

- Primarni domen: `lumenplayer.com`
- Web app (PWA): `app.lumenplayer.com`
- Cast receiver: `cast.lumenplayer.com/receiver.html`
- Cast receiver je minimalna HTML stranica hostovana na HTTPS, registrovana preko Google Cast Developer Console ($5 jednokratna naknada)

## 6. Stabilnost i reconnect pravila

1. Session state je van React component state-a
2. Controller disconnect ne prekida renderer playback
3. Reconnect vraća UI u aktuelno stanje sesije
4. `switchRenderer` ne sme resetovati aktivni source bez razloga
5. Konflikti komandi rešavaju se "latest command wins" pravilom (MVP)

## 7. PWA-first i native uloga

- PWA je primarni proizvod i fallback kanal distribucije
- Native je capability extension (npr. lock screen kontrole, background behavior)
- Session model mora raditi identično i u PWA i u native wrapperu

## 8. Fazni rollout

### Phase 0A — Session MVP
- `@lumen/session-core` paket
- Session model + commands + events
- Local SessionStore (BroadcastChannel + storage fallback)
- apps/web prebaciti na session-driven UI

### Phase 0B — Cast first-class renderer
- Google Cast receiver + sender flow
- `RendererAdapter` za Cast
- Phone-as-remote UI mode
- Cast receiver app deployed na `cast.lumenplayer.com` sa dual-video pre-buffer za brz zapping

### Phase 0C — AirPlay secondary renderer
- AirPlay kontrolni tok
- Reconnect i fallback pravila
- Device compatibility matrix

### Phase 1 — Mobile packaging
- odluka: Expo vs Capacitor wrapper (pending review)
- fokus na parity sa session modelom, ne na divergirane flow-ove
- Android: MediaSession API za lock screen / notification kontrole (radi i u PWA)
- iOS: MPRemoteCommandCenter za lock screen / Control Center kontrole (zahteva native wrapper — Capacitor ili Expo)
- Live Activity / Dynamic Island (iOS 16.1+, samo native)

### Phase 2 — TV strategy review
- Cast-centric pristup je primary
- dedicated Tizen/WebOS/Android TV app ostaje opcija ako business slučaj to traži

## 9. Otvorene odluke

1. Mobile pristup: Expo ili Capacitor-first
2. Da li dedicated TV app ulazi u v1 ili postaje kasniji expansion
3. Da li session store ostaje local-only u MVP ili prelazi na remote orchestrator

## 10. Veza sa postojećim dokumentima

- `DECISION-DOC.md`: i dalje validan za monorepo i package granice
- `ROADMAP.md`: ažuriran sa 0A/0B/0C
- `BACKLOG.md`: prioriteti prebačeni na session/cast
- `CLAUDE.md`: agent workflow usklađen sa session-first razvojem
