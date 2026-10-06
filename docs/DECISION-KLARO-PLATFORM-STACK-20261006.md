# ODLUKA — Klaro platforme i tehnološki stack

> Datum: 2026-10-06 · Status: **PRIHVAĆENO** (vlasnik)
> Važi za sve buduće agente. Dopunjuje `DECISION-DOC.md` i `docs/PLAN-MULTIPLATFORM-EXECUTION.md`; gde se razlikuju, važi ovaj dokument.

## Kontekst

Klaro treba da radi na webu (PWA), Samsung, LG, Hisense i ostalim smart TV-ima, Android TV / Google TV / Fire TV, Apple TV, a kasnije i na mobilnim aplikacijama. Do sada postoji samo web player (`apps/web`, React) i proxy. Plan iz jula (`PLAN-MULTIPLATFORM-EXECUTION.md`) je već postavio pravilo "posebna aplikacija po platformi, deljena logika u `packages/*`", ali dve ključne odluke (O-4, O-7) nisu bile formalno zatvorene, a logika je u praksi ostala u `apps/web`.

## Odluke

### D1 — Klijentske aplikacije: React familija svuda

| Grupa | Platforme | Aplikacija | Video engine |
|---|---|---|---|
| Web | telefon, desktop (PWA) | `apps/web` — React (postojeći) | hls.js / MSE |
| TV sa web engine-om | Samsung Tizen, LG webOS, Hisense VIDAA, Titan OS, Vizio i slični | **jedan** `apps/tv-web` — React, poseban build po platformi | AVPlay / webOS media / hls.js (po spike-u) |
| Native TV | Android TV, Google TV, Fire TV, Apple TV | **jedan** react-native-tvos codebase | ExoPlayer/Media3, AVPlayer (native moduli) |
| Mobilne (kasnije) | iOS, Android | isti RN codebase | isto |
| Panel i sajt | panel.klaroplayer.com, klaroplayer.com | React | — |

- **Zatvara O-4:** Android TV = react-native-tvos (ne native Kotlin). Apple TV = isti codebase, tvOS target.
- **Svelte se ne uvodi.** React je jedini UI stack koji deli kod između weba, TV web platformi, Android TV-a i tvOS-a; drugi frejmvork bi bio dodatni paradigm bez dobiti.
- Roku (BrightScript) je van opsega dok tržište ne traži; tada je to zasebna aplikacija bez deljenog koda.

### D2 — Posebna aplikacija po platformi, deljeno jezgro

- **Zatvara O-7:** V2 = posebne TV aplikacije (ne "web build na TV-u", ne samo Cast).
- Deli se: logika (`packages/*`, čist TypeScript), kontrakti (`@lumen/types`), dizajn tokeni.
- Ne dele se vizuelne komponente (I-8 ostaje): TV (daljinski), web (dodir/miš) i RN imaju odvojene UI baze.
- **Dopuna I-1:** dozvoljen je jedan eksplicitno označen paket sa React hook-ovima (npr. `@lumen/react`) koji importuje samo `react` — bez `react-dom`, DOM API-ja i `react-native` — da web, tv-web i RN dele isti sloj stanja (`useSession`, `usePlayer`…). Uvodi se tek kad postoje bar dva potrošača.
- Video engine je uvek native za platformu, iza `PlayerAdapter` kontrakta.

### D3 — Backend za naloge, uređaje, kredite, aktivaciju i panel: Convex

Zamenjuje "nov Postgres backend" iz spec-a naloga i panela (`docs/KLARO-NALOZI-I-PANEL.md`, trenutno nekomitovan u drugom worktree-ju — uskladiti kad uđe u granu).

Pravila:
1. **Uređaji i player aplikacije pričaju samo sa verzionisanim HTTP API-jem `/v1`** (Convex HTTP actions), nikad direktno sa Convex query/mutation funkcijama. Ovo uključuje i PWA (service worker može držati staru verziju). Razlog: store aplikacije se ne mogu odmah ažurirati (I-5).
2. Panel sme da koristi Convex React klijent direktno — deploy-uje se zajedno sa backendom.
3. **Licenca = potpisan token** sa periodom rada bez mreže; format i offline verifikacija žive u framework-free paketu (npr. `@lumen/licence`) koji koriste sve aplikacije. Cilj: uređaji ne zovu server na svako pokretanje.
4. Kredencijali izvora (Xtream/M3U) se čuvaju šifrovani na nivou aplikacije; ključ nije u bazi.
5. **Putanja reprodukcije ostaje van Convexa:** proxy, catch-up, stream i analitika velikog obima ostaju na postojećoj infrastrukturi.
6. EXYU web player ne sme zavisiti od Klaro backenda — licenciranje u `apps/web` ide iza adaptera/brand flag-a (EXYU = Xtream/SSO prijava).
7. Convex komponente koristiti umesto ručnih rešenja gde postoje (rate limiter za kodove/vaučere, aggregate za KPI, cron, workflow/workpool, migrations, email).

### D4 — Effect za serverske integracije (od prve integracije plaćanja)

- Koristi se u Convex actions i Node servisima koji pričaju sa spoljnim sistemima (plaćanje, email, provider paneli) i u **novim** modulima proxy-ja.
- Ne koristi se u deljenim klijentskim paketima (ulazi u bundle svih aplikacija) ni u Convex mutacijama.
- Postojeći proxy hot path (catch-up gateway/remux) se ne prepisuje.

### D5 — Redosled

1. **P4 — izdvajanje jezgra** iz `apps/web` u pakete, pre bilo koje TV aplikacije. Čist refactoring: web se ponaša identično.
2. Paralelno: spike-ovi na pravim uređajima (Tizen/webOS playback + MP2, Hisense VIDAA, ExoPlayer + XUI catch-up).
3. Backend `/v1` + licenca + uparivanje kodom — pre prve store aplikacije (aktivacija je poslovni model).
4. `apps/tv-web` (Samsung, LG, Hisense…), zatim react-native-tvos (Android TV → Apple TV).

## Otvoreno

| # | Pitanje | Kada |
|---|---|---|
| K-1 | Convex Cloud ili self-host; provera EU regiona i lokacije podataka | pre početka backend rada |
| K-2 | Auth rešenje (Convex Auth ili Better Auth komponenta) | početak backend rada |
| K-3 | Minimalne verzije TV platformi (predlog Tizen 4.0+, webOS 4.0+, VIDAA po spike-u) | T5 spike |
| K-4 | Apple App Store review rizik za IPTV player (proizvod bez sadržaja) | pre Apple TV faze |
| K-5 | Spec naloga/panela: 5 predloga iz dizajna čekaju vlasnika | pre panel rada |

## Posledice za druge dokumente

- `PLAN-MULTIPLATFORM-EXECUTION.md` §8: O-4 i O-7 zatvoreni ovim dokumentom; A6.1-a odlučen.
- `DECISION-DOC.md`: tabela platformi i "Cast-centric" update iz februara zamenjeni ovim dokumentom.
- Spec naloga/panela: "Postgres backend" → Convex po D3.
