# Klaro Player — logo komplet i pravila upotrebe (v1.0, 30. 9. 2026)

Vizuelni vodič na jednoj strani: `klaro-brand-guide.html` / `klaro-brand-guide.png`.
Svi fajlovi se generišu iz `../_src/build_kit.py` (geometrija `../_src/klaro_sync.py`). Ne menjaj ih ručno.

## 1. Znak
**Ideja:** dva ekrana dele jednu liniju. Plavi prelazi preko ramena tamnog, pa sadržaj prelazi sa uređaja na uređaj i ostaje u sinhronizaciji („One setup. Every screen.“).

**Konstrukcija** (x = projektovana širina jednog panela):
- Paneli su paralelogrami sa vertikalnim stranama i ivicama pod tačnih 30°.
- Gornja ivica tamnog i donja ivica plavog panela su **ista linija**.
- Plavi panel je pomeren za 0,88x udesno i do te zajedničke linije.
- Oštri (60°) uglovi imaju R = 0,25x, a tupi (120°) r = 0,10x. Uglovi na spoju ostaju oštri.
- Plava horizontala tangira vrh luka tamnog panela.
- Jedna boja: plavi se odmiče od zajedničke linije za 0,045x (≈ x/22), a spoj se završava oštrim vrhom od 30°.

## 2. Verzije i fajlovi
| Verzija | Fajl (`logo/…`) | Upotreba |
|---|---|---|
| Horizontalni (primarni) | `horizontal/klaro-horizontal-*.svg` | Header, sajt, dokumenti |
| Horizontalni sa sloganom | `horizontal-tagline/…` | Hero, prezentacije, od 200 px širine |
| Složeni | `stacked/…` | Kvadratni formati, splash |
| Znak | `symbol/klaro-symbol-*.svg` | Ikone, avatari, favicon |
| Samo ime | `wordmark/…` | Uski tekstualni konteksti, uvek uz znak na istoj površini |

Varijante po bojama: `colour` (svetla podloga) · `dark` (tamna podloga: tamni panel postaje beo) · `mono-black` · `mono-white` · `mono-navy` · `mono-blue` (plava ima samo znak i horizontalni).
Uz svaki SVG ide PNG (znak 1024 px, lockupi 2400 px širine, providna pozadina). Tekst je pretvoren u krive, pa font nije potreban.

## 3. Slobodan prostor
Oko logotipa ostavi najmanje **½x** (x = širina jednog panela). Lockup fajlovi već imaju tu marginu.

## 4. Minimalne veličine
| Verzija | Ekran | Štampa |
|---|---|---|
| Znak | 16 px | 5 mm |
| Horizontalni | 96 px širine | 25 mm |
| Sa sloganom | 200 px širine | 50 mm |
| Složeni | 64 px širine | 18 mm |

## 5. Boje
| Ime | HEX | RGB | CMYK* | Kontrast (bela / Navy) | Uloga |
|---|---|---|---|---|---|
| Navy | `#0D1729` | 13 23 41 | 68 44 0 84 | 17,9 : 1 / — | Tamni panel, tekst, tamne podloge |
| Blue | `#0669FE` | 6 105 254 | 98 59 0 0 | 4,7 : 1 / 3,8 : 1 | Plavi panel, akcenat, fokus |
| Mist | `#F3F5F9` | 243 245 249 | 2 2 0 2 | — / 16,4 : 1 | Pločica app ikone, svetle podloge |
| White | `#FFFFFF` | 255 255 255 | 0 0 0 0 | — / 17,9 : 1 | Podloga; tamni panel na tamnoj podlozi |

\*CMYK je orijentaciona konverzija. Blue je izvan CMYK opsega i u štampi ispada tamnije. Pre prve štampe treba proof, a Pantone se uparuje na fizičkom vodiču.

**Dozvoljeni parovi:** boja na beloj ili Mist · tamna varijanta na Navy · bela (jedna boja) na Blue, fotografiji ili tamnoj podlozi · crna (jedna boja) na beloj.

## 6. Tipografija
Inter Tight (SIL OFL 1.1, `../_src/fonts/`): „Klaro“ Bold 700, „Player“ Regular 400, slogan Medium 500 velikim slovima sa širokim razmakom. Za UI i dugačak tekst: Inter ili Inter Tight 400/500/600.

## 7. Ikone (`icons/…`)
- **web/**: `favicon.svg` (u tamnom režimu pregledača tamni panel postaje beo), `favicon.ico` (16/32/48), `apple-touch-icon.png`, `icon-192/512.png`, `maskable-512.png`, `site.webmanifest`, `head-snippet.html`.
- **ios/**: `AppIcon-1024-light/dark/tinted.png` (kvadrat bez zaobljenja, sistem dodaje masku).
- **android/**: adaptivna ikona (`ic_launcher_foreground/background/monochrome.png`, 432 px = 108 dp) + `ic_launcher.xml`, `playstore-icon-512.png`.
- **tv/**: baner 16:9 (`tv-banner-1280x720` i `320x180`, tamni i svetli) za Android TV / Google TV / Fire TV, kvadratna 512 za Samsung/LG prodavnice.
- **desktop/**: `macos-1024` (pločica 824 px sa standardnom marginom), `windows.ico` (16–256), `linux-512.png`.

Pločica je Mist (svetla), u tamnom režimu Navy, a znak zauzima 60 % pločice.

## 8. Pokret
Paneli dolaze po normali na zajedničku liniju: odvojeno → spajanje → u sinhronizaciji. Trajanje 600–900 ms, ease-in-out. Kraj je uvek statičan znak. Uz `prefers-reduced-motion` nema animacije.

## 9. Ne raditi
Ne rotirati, ne preslikavati, ne razvlačiti · ne menjati redosled boja (Navy je uvek dole levo) · bez gradijenata, senki, kontura i efekata · ne rastavljati panele (osim u animaciji) · Navy znak ne stavljati na tamnu podlogu (koristi `dark`) · ne kucati ime iznova, uvek koristiti fajl.

## 10. Otvoreno
- Trademark pretraga (znak i ime) pre objave. Poznati rizik: okrenut ili u ogledalu, znak podseća na N/Z.
- Pantone uparivanje za štampu.
- Integracija u `apps/web/public` (favicon, PWA ikone) je odvojen korak. Ikone su sada deljene sa EXYU buildom (vidi `docs/BRAND-KLARO-PLAYER.md`).
