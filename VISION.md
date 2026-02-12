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
