# Plan: brz hladan shadow start

## Problem (izmeren)
Shadow daje čist stream (rešava dead-zone + boundary overlap), ALI hladan build
remux-uje **ceo program** odjednom:
- JUTRO = 4h05min → **~5 min** hladan build (`16:42:45 build → 16:47:59 serve`)
- 68-min program → ~2 min
Korisnik vidi "Tražim snimak kod provajdera…" pa dugo čeka, pa tek onda svira.

Vlasnik: NE prelaziti s mucavog na čist (novo mucanje na prelazu). Hoće odmah čist
shadow — samo da hladan build bude brz.

## ⚠️ Ključni nalaz iz testiranja (obara Lumen-only pristup)
Probao sam da Lumen pošalje uži `duration` (900 = 15 min) da shadow gradi manje:
- **Ne radi.** Shadow log: `archive ok files=666` (za "15 min" zahtev) — shadow svejedno
  uzima stotine fajlova. `duration` param se NE mapira u broj fajlova kako Lumen očekuje.
- Shadow interno (`shadowCollectArchiveFiles`, obfuskovan, ima `duration *= 24` i
  `start + index*60` logiku) sam određuje opseg. Lumen ne kontroliše koliko fajlova gradi.
- Build je svejedno premašio i **edge6 nginx 60s timeout** (504 iz nginx-a, ne Lumen proxy).

**Zaključak:** skraćivanje hladnog builda **zahteva izmenu `timeshift_shadow.php`** (XUI dev).
Nije rešivo samo sa Lumen strane.

## Rešenje (dvostrano: XUI dev primarno + Lumen koordinacija)

### Deo A — XUI dev: shadow gradi PROZOR, ne ceo program (PRIMARNO)
`timeshift_shadow.php` da podrži **inkrementalni/prozorski build**:
- Opcija A1 (preporuka): shadow gradi **prvih N minuta odmah** (npr. 15), servira
  manifest, pa **nastavlja build u pozadini** (background extend) i dopunjuje isti
  manifest/keš kako stižu segmenti. Player dobije manifest za par sekundi, nastavak
  se dopunjuje pre nego što ga korisnik stigne.
- Opcija A2: shadow poštuje `duration` kao stvarni prozor (start → start+duration), pa
  Lumen može da traži uži opseg i sam produžava. Traži da se ispravi duration→fajlovi
  mapiranje (trenutno pogrešno — `files=666` za 900s).
- **Plus:** podići edge6 nginx timeout za `/streaming/timeshift_shadow.php` (sad 60s,
  obara i legitimne buildove). Lumen proxy već ima 90s (`f5eafd0`); nginx na edge6 je usko grlo.

### Deo B — Lumen: koordinacija + UX (POSLE A)
- Kad A2 (pravi prozor) postoji: Lumen šalje uži početni `duration`, prati `currentTime`,
  produžava prozor pre kraja (chunked, rastući `duration` od programStart → jedan
  kontinualan manifest, player ne spaja ništa, nema prelaz-mucanja).
- Ako A1 (background extend): Lumen ne menja ništa osim možda progress UX.

### Deo C — Lumen UX (NEZAVISNO, može odmah)
Dok A/B ne legnu, hladan build velikog programa i dalje traje. Bar poboljšati poruku:
"Pripremam snimak visokog kvaliteta… (duže emisije ~1-2 min)" + spinner, da korisnik
zna da nije zaglavljeno. Legacy fallback (`c968044`) ostaje sigurnosna mreža.

## Šta je VEĆ urađeno i radi (kontekst)
- Shadow ruta uključena na .105 (4 commita: graceful fallback, proxy shadow timeout 90s,
  legacy fallback iza shadow-a). Shadow daje čist fMP4 (init+DISCONTINUITY, nema dead-zone
  ni boundary overlap). Dokazano: kad je keš topao, svira 200 za ~100ms.
- Problem je ISKLJUČIVO hladan build velikog programa.

## Redosled / vlasnikova odluka
1. **Deo C (Lumen UX poruka)** — mogu odmah, mali, bezbedan, da čekanje ne izgleda kao bug.
2. **Deo A (XUI dev)** — primarno rešenje; napisati spec za XUI dev-a (prozor/background
   extend + nginx timeout). Bez ovoga, veliki programi ostaju spori.
3. **Deo B (Lumen)** — tek kad A definiše interfejs.

## Šta NE diramo
- Live put, scrub (`mediaOffsetSeconds`).
- Legacy fallback (`c968044`) — sigurnosna mreža ostaje.
- Shadow keš/eviction (već postoji, na disku).

## Verifikacija (po delu)
- A: shadow log `build → serve` delta za prozor = sekunde; nginx ne baca 504.
- B: gledanje preko granice prozora → produži bez mucanja.
- C: poruka se vidi, spinner ne izgleda kao freeze.
- Runtime (.105, Chrome): JUTRO (4h) → prvi frejm za par sekundi, ne 5 min.
