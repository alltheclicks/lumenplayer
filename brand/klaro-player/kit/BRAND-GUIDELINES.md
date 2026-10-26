# Klaro Player — logo komplet i pravila (v2.0 „Spektar“, 30. 9. 2026)

Vizuelni vodič na jednoj strani: `klaro-brand-guide.html` (živa ikona) / `klaro-brand-guide.png`.
Sve je generisano iz `../_src/`: `klaro_spektar.py` (geometrija, staklo, aura, natpis), `build_kit_spektar.py` (fajlovi), `build_motion_spektar.py` + `motion_frames.mjs` (pokret), `build_guide_spektar.py` (vodič). Fajlove ne menjaj ručno.
Prethodni odobreni komplet (In Sync, dva panela) je arhiviran u `../archive/in-sync/`.

## 1. Znak
Čisto stakleno **K**, a oko njega kruži **spektar od šest boja** kao aura. „Klaro“ znači bistro: slovo je providno i mirno, a boja je svetlo oko njega, kao ambijentalno svetlo iza televizora. Šest boja su svi ekrani na kojima Klaro radi. Spektar je živ: kruži i diše.

- **Tamna podloga:** K je belo staklo, aura se sabira sa podlogom (screen).
- **Svetla podloga:** K je Navy, aura je normalno preklopljena (72 %).
- **Jedna boja:** ravni K bez aure (štampa, vez, gravura, monochrome ikone).

## 2. Konstrukcija (h = visina K)
- K čine tri poteza sa zaobljenim krajevima, spojena u jedan oblik (nije sastavljen od delova).
- Krak kreće sa ose stuba na 0,70 visine, a noga iz kraka na 0,353 njegove dužine. Oba idu pod tačnih 45° i seku se pod pravim uglom.
- Aura je šest kopija K, proširenih za 0,031 h i pomerenih 0,127 h od centra u koracima od 60°. Unutrašnji sloj je zamućen 0,058 h, spoljni 0,139 h (na 50 %).
- Redosled boja je kružni i fiksan: 1 Red (uz stub, levo), 2 Amber, 3 Green, 4 Cyan, 5 Blue, 6 Violet.

## 3. Pokret
| | |
|---|---|
| Petlja | Spektar pravi jedan krug za 8 s, linearno |
| Disanje | Spoljni sjaj 40 → 62 → 40 % za 4 s |
| TV intro (5 s) | Aura se rascveta 0–1,2 s · K ulazi 0,35–1,4 s (skala 0,9 → 1, 24 px naviše) · ime 1,5–2,4 s |
| Smanjen pokret | Uz `prefers-reduced-motion` ide statična ikona |

Fajlovi (`motion/`): `klaro-loop.mp4` (1080², 8 s, petlja) · `klaro-loop-small.mp4/.gif` · `klaro-loop.gif` · `klaro-intro.mp4` (1920×1080, 5 s) · `klaro-intro-storyboard.png` · `klaro-live.svg` / `klaro-live-small.svg` / `klaro-live-transparent.svg` (žive SVG ikone sa SMIL animacijom, za web splash).

## 4. Verzije (`logo/`)
| Verzija | Fajlovi | Upotreba |
|---|---|---|
| Horizontalni | `horizontal/klaro-horizontal-{dark,light,mono-*}` | Sajt, header, dokumenti, prezentacije |
| Složeni | `stacked/…` | Kvadratni formati, splash |
| Znak | `symbol/klaro-symbol-{dark,light,mono-*}` | Avatari, pečat |
| Samo ime | `wordmark/…` | Uski tekstualni konteksti, uvek uz znak na istoj površini |

`dark` = za tamne podloge · `light` = za svetle · `mono-white/black/navy` = jedna boja.
SVG sa aurom koristi filtere i blend modove: radi u pregledačima, ali ne u alatima za štampu. Za štampu uvek koristi `mono-*`. PNG izvozi su renderovani u Chrome-u (znak 1024 px, lockupi 2400 px širine).

## 5. Ikone (`icons/`)
- **app/**: `klaro-icon-dark` (K + PLAYER, glavna), `klaro-icon-light`, `klaro-icon-small-*` (samo K), sve kao SVG + PNG 1024.
- **ios/**: `AppIcon-1024.png`, `-dark`, `-tinted` (siva verzija ikone). Kvadrat bez zaobljenja, sistem dodaje masku.
- **android/**: adaptivna ikona (`ic_launcher_foreground/background/monochrome.png`, 432 px) + `ic_launcher.xml`, `playstore-icon-512.png`.
- **tv/**: baner 16:9 (`tv-banner-1280x720` i `320x180`, tamni i svetli), `tv-icon-512.png`.
- **desktop/**: `macos-1024` (pločica 824 px sa senkom), `windows.ico` (16–256; do 64 px samo K), `linux-512.png`.
- **web/**: `favicon.svg` (samo K), `favicon.ico` (16/32/48), `apple-touch-icon.png`, `icon-192/512.png`, `maskable-512.png`, `site.webmanifest`, `head-snippet.html`.

**Pravilo za natpis:** od 120 px naviše ikona nosi PLAYER. Od 64 px naniže (favicon, taskbar, liste) koristi se samo K sa aurom.

## 6. Minimalne veličine i slobodan prostor
| Verzija | Ekran | Štampa |
|---|---|---|
| App ikona sa PLAYER | od 120 px | — |
| Mala ikona (samo K) | 16–64 px | — |
| Horizontalni sa aurom | od 140 px širine | koristi ravni |
| Horizontalni ravni | od 90 px širine | 25 mm |
| Ravni K | 16 px | 5 mm |

Slobodan prostor oko znaka je pola širine K. Aura je već uračunata u fajlove (prazan rub), pa ništa ne sme da uđe u njihovu ivicu.

## 7. Boje
| Ime | HEX | Uloga |
|---|---|---|
| Night | `#03060D` | Podloga ikone (dno gradijenta), tamne površine |
| Night top | `#121D36` | Podloga ikone (vrh gradijenta) |
| Navy | `#0D1729` | K i tekst na svetloj podlozi |
| Mist | `#F3F5F9` | Svetle podloge |
| White | `#FFFFFF` | Stakleni K, tekst na tamnom |
| Spektar | `#FF2D55` · `#FFC23D` · `#1FE0A0` · `#2FD3FF` · `#0A6CFF` · `#B14DFF` | Samo aura. Nije za tekst ni za popunu slova |

Kontrast: Navy na beloj 17,9 : 1 · bela na Night 20,3 : 1.

## 8. Tipografija
Inter Tight (SIL OFL 1.1, `../_src/fonts/`): „Klaro“ Bold 700, „Player“ Regular 400. U ikoni: PLAYER velikim slovima, težina 620, razmak 0,42 visine slova. Sav tekst u logo fajlovima je pretvoren u oblike. Za UI: Inter ili Inter Tight 400/500/600.

## 9. Ne raditi
- Ne stavljati spektar u slovo (spektar je samo aura).
- Ne stavljati beli stakleni K na svetlu podlogu (koristi `light`, Navy K).
- Ne razvlačiti, ne rotirati, ne preslikavati.
- Ne menjati redosled boja i ne dodavati nove.
- Ne stavljati auru na fotografiju ili šarenu površinu (koristi `mono-white`).
- U ikoni ne pisati ništa osim PLAYER.
- Sjaj se ne štampa: za štampu koristi ravnu verziju.
- Ne ubrzavati petlju ispod 4 s po krugu i ne treperiti.

## 10. Otvoreno
- **Trademark pretraga** za znak i ime pre objave. Poznati rizik: šareni sjaj oko oblika je trend 2025–26 (npr. AI asistenti), pa znak nosi pill-K i fiksan redosled boja.
- **Integracija u aplikaciju:** `apps/web/public` (favicon, PWA ikone, splash sa `klaro-live.svg`). Ikone su sada deljene sa EXYU buildom, pa to treba rešiti posebno (vidi `docs/BRAND-KLARO-PLAYER.md`).
- **Native ikone:** tvOS slojevita ikona (parallax: pozadina · aura · K), iOS 26 Icon Composer slojevi i Samsung/LG specifične veličine prave se kad krenu te aplikacije.
