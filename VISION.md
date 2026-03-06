# Vision — Lumen Player

> Datum: 12. februar 2026

## Šta je Lumen Player

Lumen Player je IPTV player platforma dizajnirana da zameni zastarele MAG/Formuler uređaje modernim, softverskim rešenjem. Koristi PWA-first pristup, session-centric arhitekturu, i Google Cast kao primarni način reprodukcije na TV-u.

Krajnji cilj: **jedan player koji radi svuda** — od browsera na laptopu, preko telefona kao daljinskog, do dedikovanog TV app-a.

## Korisnici

### 1. Single User ("mama u Nemačkoj")
- Besplatno korišćenje, 1–2 uređaja
- Unosi Xtream credentials ili M3U playlist
- Gleda Live TV, VOD, serije
- Koristi Cast da prebaci na TV
- Ne treba joj dashboard — sve radi iz samog playera

### 2. Provider (npr. XUTV)
- Kupuje 2000 licenci za svoje korisnike
- Managed devices — vidi koji uređaji su aktivni
- Dashboard za upravljanje korisnicima i uređajima
- Bulk device provisioning
- Svaki uređaj = 1 licenca (identifikacija kodom, ne MAC adresom)

### 3. Partner (npr. Telekom)
- White-label verzija — svoj branding, svoj hosting
- Custom domeni i app store listinzi
- Sopstvena baza korisnika
- Revenue share ili flat licensing fee

---

## V1 — Web/PWA Player

**Cilj:** Potpuno funkcionalan IPTV player u browseru sa PWA instalacijom.

### Xtream Codes kompatibilnost (100%)
- Live TV streaming (HLS)
- VOD kategorije, film detail (poster, opis, cast), playback
- Series lista, sezone, epizode, playback
- EPG (program guide) — per-channel i bulk XMLTV
- Catch-up TV sa seekable playback

### M3U podrška
- Import via URL (paste link)
- Import via file upload (.m3u / .m3u8)
- Unified channel model — Xtream i M3U kanali se prikazuju identično

### Google Cast (first-class)
- Custom receiver app na `cast.lumenplayer.com`
- Dual-video trik za brz channel zapping
- Telefon/laptop postaje daljinski
- Session se prenosi između local ↔ cast bez gubitka stanja

### Performanse
- 20.000+ kanala bez laganja (virtualizacija liste)
- Debounce na pretrazi
- Lazy loading EPG podataka
- Middleware/cache za velike liste ako je potrebno
- Stariji Samsung TV (2019–2020) mora raditi glatko u Cast receiver-u

### PWA
- Instalacija na desktop i mobile
- Offline fallback stranica
- App icon i splash screen

### UI
- Responsive: desktop sidebar + mobile bottom sheet
- VOD film detail sa TMDB/IMDB metapodacima
- Series detail sa sezonama i epizodama
- EPG grid view (TV guide stil)
- Settings stranica
- Multi-audio i subtitle track selekcija
- Picture-in-Picture

---

## Phase 1 (post-V1) — Dashboard + Device Management

**Cilj:** Web dashboard za upravljanje uređajima i credentials-ima.

**URL:** `app.lumenplayer.com`

### User Management
- Registracija putem email-a
- Single user account (besplatan, 1–2 uređaja)
- Provider account (plaćen, multi-device, bulk management)

### Device Pairing
- Kod format: `ABC-123` (čitljiv, lak za diktiranje)
- TV/uređaj prikazuje kod → korisnik ga unosi u dashboard
- Device = licenca (ne koristi MAC adresu)

### Credential Management
- Unos Xtream credentials per device
- Unos M3U playlist URL per device
- Mogućnost da se iste credentials dodele na više uređaja

### Payment
- Free tier: 1–2 uređaja, osnovne funkcije
- Paid tier: više uređaja, provider features
- Payment processing integracija

---

## Phase 2 — Native Apps

**Cilj:** Dedicirane app store aplikacije za sve platforme.

### TV platforme
- Samsung Tizen Store
- LG WebOS Store
- Android TV / Fire TV (Google Play)
- Apple TV (App Store)

### Mobile platforme
- iOS (App Store)
- Android (Play Store)

### Zajedničko
- PWA ostaje kao fallback (uvek dostupan)
- Ista session arhitektura — svi klijenti dele istu sesiju
- Device = licenca (kod-based identifikacija)
- White-label opcija za partnere (custom branding, sopstveni store listinzi)

---

## Cross-Platform Playback Core (V1 -> Phase 2)

> Ažurirano: 6. mart 2026 (QAF-034 / QAF-035 catch-up arhitekturno razdvajanje)

Osnova treba da bude ista na svim platformama: isti session model, isti Xtream domain model, isti playback observability ugovor.  
Razlika po platformi sme da postoji u transport sloju, ali provider/browser-specifični repair ne sme da zarobi shared player core.

### Potvrđeni runtime obrazac (TiviMate)
- Live: login host (`iptvmedia.pro:8080`) vraća `302` na edge/archive host (`l2.mediaking.fi`) sa tokenom.
- Catch-up: `/timeshift/{user}/{pass}/{duration}/{start}/{stream}.ts` na login hostu vraća `302` na tokenizovan URL (`edge*.castcdn.net/streaming/timeshift.php?token=...`).
- Player radi više brzih retry pokušaja i menja `start` minut kada prvi pokušaj ne krene.
- Redirect/token flow je deo normalnog rada i mora biti first-class scenario.

### Arhitekturna pravila koja važe za sve klijente
- `@lumen/session-core` ostaje jedini source of truth za playback state i komande.
- Deljeni core drži source/session model i neutralni playback contract, ali ne sme da postane XUI repair engine.
- Svaki klijent mora da podrži:
  - 302 redirect chain bez gubitka auth/token parametara
  - host affinity (login host -> final edge/archive host)
  - fallback nazad na live kada archive ne postoji

### Catch-up gateway boundary (Option B)
- Provider-specific catch-up workaround logika (`PTS/DTS` surgery, continuity repair, FFmpeg/remux odluke, browser/container workarounds) ne ulazi u `@lumen/session-core`.
- Catch-up gateway je opcioni sloj izvan shared core-a:
  - može da se uključi ili isključi po platformi, serveru, kanalu i programu
  - može da odluči `provider-direct | proxy-normalized | proxy-remuxed`
  - može da radi asset-based preparation/cache bez vezivanja za korisničku sesiju
- Web i budući native klijenti treba da vide samo:
  - `transportMode`
  - `playbackUrl`
  - observability metadata
- Live i standardni VOD ostaju na najjeftinijem postojećem putu dok catch-up gateway nije potreban.

### Platform-specific transport (adapter-only razlike)
- Web/PWA:
  - mora imati same-origin proxy kada browser ograničenja to zahtevaju (CORS/mixed-content).
  - `https` app + `http` stream je browser-level rizik; mora postojati kontrolisan fallback/proxy put.
  - kada provider-direct nije browser-safe ili nije dovoljno stabilan za catch-up, web može da koristi opcioni gateway sloj bez curenja te logike u core.
- Native (Android TV, Tizen, WebOS, tvOS, iOS/Android):
  - nema browser CORS model, ali isti redirect/token/fallback semantički ugovor ostaje obavezan.
  - platformski player adapter može direktno da prati 302 i preuzima segmente.

### HTTP + HTTPS kompatibilnost (production requirement)
- Sistem mora da radi sa providerima koji koriste:
  - samo `http`
  - samo `https`
  - kombinovan login/edge model (`http` login -> `https` edge i obrnuto)
- Ovo nije opcija po platformi, nego globalni compatibility cilj za ceo Lumen stack.

### Observability kao zajednički ugovor
- Jedinstveni događaji i polja za sve klijente:
  - `catchup.requested`, `catchup.redirect`, `catchup.retry`, `catchup.fallback`, `playback.error`
  - obavezno beležiti: streamId, start, duration, attempt, status, finalHost, errorCode
- QA i produkcioni troubleshooting treba da budu mogući istim signalima na web i native klijentima.

---

## Ključni tehnički zahtevi

| Zahtev | Detalj |
|--------|--------|
| Performanse | Stariji Samsung 2019–2020 moraju raditi glatko |
| Velike liste | 20k+ kanala — virtualizacija, lazy loading, opcioni middleware cache |
| Metadata | TMDB/IMDB za filmove i serije (posteri, opisi, ocene) |
| Session model | Playback state živi u sesiji, ne u UI-u |
| Multi-renderer | Local, Cast, AirPlay — isti session, različiti rendereri |
| Licensing | Kod-based (ne MAC), dashboard za upravljanje |
| Offline | PWA offline fallback, cached channel lista |
