# V2 QA Fix Backlog (Small Tasks + Codex Prompts)

Purpose: granular fix backlog based on latest local QA run and manual browser findings.  
Goal: each task is small enough for one focused Codex chat session.

Source evidence:
- `/Users/filip/Documents/Lumen Player/output/playwright/qa-user-sim/QA-REPORT.md`
- `/Users/filip/Documents/Lumen Player/output/playwright/qa-user-sim/TASK-CANDIDATES.md`

## Intake — Untriaged Issues

Use this section for immediate manual bug capture (including late-night mobile checks) before triage.

ID format:
- `BUG-YYYYMMDD-XX` (example: `BUG-20260219-01`)

Template:

```md
### BUG-YYYYMMDD-XX
- Environment:
- Steps:
  1.
  2.
  3.
- Expected:
- Actual:
- Evidence:
- Reporter:
- Timestamp:
- Severity (initial):
- Status: open
```

### BUG-20260219-01
- Environment:
  - `http://localhost:8080/player`, desktop browser, Xtream nalog `fica`
- Steps:
  1. Posle login-a prvi kanal krene automatski.
  2. Prebaci kanal (npr. INFO -> RTS1 -> HRT1) klikom u listi.
  3. Posmatraj da li live playback automatski nastavlja.
- Expected:
  - Posle promene kanala live stream treba odmah da nastavi playback bez dodatnog klika na `Play`.
- Actual:
  - Često ostane prvi frame; playback ne kreće dok se ručno ne klikne `Play`.
- Evidence:
  - Korisnički opis + screenshot set u chatu (2026-02-19).
- Reporter:
  - Filip
- Timestamp:
  - 2026-02-19
- Severity (initial):
  - P1
- Status: converted-to `QAF-006` (live playback start consistency)

### BUG-20260219-02
- Environment:
  - `http://localhost:8080/player`, desktop browser
- Steps:
  1. Otvori live player sa aktivnim kanalom.
  2. Pomeri miš/click van kontrola.
  3. Sačekaj nekoliko sekundi.
- Expected:
  - Overlay kontrole (prev/play/next/favorite/fullscreen) treba auto-hide posle idle perioda.
- Actual:
  - Overlay ostaje stalno vidljiv (osim fullscreen specifičnog ponašanja).
- Evidence:
  - Screenshot iz chata (2026-02-19) prikazuje trajno vidljiv overlay.
- Reporter:
  - Filip
- Timestamp:
  - 2026-02-19
- Severity (initial):
  - P2
- Status: converted-to `QAF-010`

### BUG-20260219-03
- Environment:
  - `http://localhost:8080/player`, live EPG blok (`Sada na programu` / `Sledi na programu`)
- Steps:
  1. Otvori različite live kanale.
  2. Posmatraj tekst u EPG blokovima.
- Expected:
  - Program title/description treba da budu čitljivi i normalizovani na svim kanalima.
- Actual:
  - Na delu kanala pojavljuje se gibberish/random string umesto čitljivog naslova.
- Evidence:
  - Screenshot iz chata (2026-02-19) sa primerom nečitljivog stringa.
- Reporter:
  - Filip
- Timestamp:
  - 2026-02-19
- Severity (initial):
  - P1
- Status: converted-to `QAF-011`

### BUG-20260219-04
- Environment:
  - `http://localhost:8080/player`, desktop browser
- Steps:
  1. Postavi miš iznad video feed-a (ne iznad liste kanala/kategorija).
  2. Scroll wheel down.
  3. Posmatraj ponašanje cele stranice.
- Expected:
  - Glavni player viewport ne treba da vertikalno "beži" van ekrana u standardnom player layout-u.
- Actual:
  - Cela strana može da se scrolluje nadole; player ode delimično van viewport-a i ostane "mrtav prostor".
- Evidence:
  - Screenshot iz chata (2026-02-19) sa pomerenim layout-om i praznim prostorom.
- Reporter:
  - Filip
- Timestamp:
  - 2026-02-19
- Severity (initial):
  - P1
- Status: converted-to `QAF-012`

### BUG-20260219-05
- Environment:
  - Live player fullscreen + catch-up panel (`Gledanje unazad`)
- Steps:
  1. Uđi u fullscreen.
  2. Klikni catch-up (ikona sata).
  3. Posmatraj listu dostupnih programa unazad.
- Expected:
  - Ako kanal ima catch-up podatke, panel treba da prikaže programe; ako nema, fallback poruka treba da bude jasna i konzistentna.
- Actual:
  - Korisnik vidi `Nema dostupnih snimaka` za RTS kanal i nije jasno da li je problem data, filtering ili UI logika.
- Evidence:
  - Screenshot iz chata (2026-02-19) sa otvorenim `Gledanje unazad` panelom.
- Reporter:
  - Filip
- Timestamp:
  - 2026-02-19
- Severity (initial):
  - P2
- Status: converted-to `QAF-013`

### BUG-20260219-06
- Environment:
  - Live player + Picture-in-Picture flow
- Steps:
  1. Pokreni live kanal.
  2. Uđi u Picture-in-Picture.
  3. Vrati se nazad na player.
- Expected:
  - Live playback treba da nastavi bez dodatne ručne interakcije.
- Actual:
  - Posle povratka iz PiP korisnik često mora ručno da klikne `Play`.
- Evidence:
  - Korisnički opis iz chata (2026-02-19).
- Reporter:
  - Filip
- Timestamp:
  - 2026-02-19
- Severity (initial):
  - P1
- Status: converted-to `QAF-014`

### BUG-20260220-01
- Environment:
  - `http://localhost:8080/player`, desktop browser, initial startup na live kanalu (primer: RTS 1)
- Steps:
  1. Pokreni dev server i otvori `/player`.
  2. Sačekaj inicijalni autoplay/start prvog kanala.
  3. Posmatraj video surface + play/pause stanje.
- Expected:
  - Live kanal treba da krene u playback odmah (ne samo prvi frame), sa konzistentnim play stanjem.
- Actual:
  - Prikaže se samo prvi frame; dugme izgleda kao da je playback aktivan (`pause`), ali video ne ide dok se kanal ne promeni.
- Evidence:
  - Korisnički nalaz “Lumen test v1 #3” (chat, 2026-02-20).
- Reporter:
  - Filip
- Timestamp:
  - 2026-02-20
- Severity (initial):
  - P1
- Status: converted-to `QAF-015` (startup live playback first-frame stall)

### BUG-20260220-02
- Environment:
  - `http://localhost:8080/player`, desktop browser, live channel switching (zapping)
- Steps:
  1. Pokreni live kanal.
  2. Menjaj kanale gore/dole iz liste.
  3. Izmeri subjektivni i/ili instrumentovani start novog streama.
- Expected:
  - Zapping treba da bude responsivan i uporediv sa referentnim IPTV player iskustvom.
- Actual:
  - Puštanje narednog kanala deluje primetno sporo.
- Evidence:
  - Korisnički nalaz “Lumen test v1 #3” (chat, 2026-02-20).
- Reporter:
  - Filip
- Timestamp:
  - 2026-02-20
- Severity (initial):
  - P2
- Status: converted-to `QAF-016` (zapping latency hardening)

### BUG-20260220-03
- Environment:
  - `http://localhost:8080/player`, live shell ispod video površine
- Steps:
  1. Otvori live player sa aktivnim kanalom.
  2. Pogledaj sekcije ispod videa (`Sada na programu`/`Sledi`/`TV unazad`).
  3. Proveri da li je catch-up sekcija renderovana.
- Expected:
  - Catch-up (`TV unazad`) sekcija treba da bude vidljiva kada postoje uslovi za prikaz.
- Actual:
  - Catch-up/TV unazad sekcija nije vidljiva na očekivanom mestu.
- Evidence:
  - Korisnički nalaz “Lumen test v1 #3” (chat, 2026-02-20).
- Reporter:
  - Filip
- Timestamp:
  - 2026-02-20
- Severity (initial):
  - P2
- Status: converted-to `QAF-017` (catch-up visibility regression)

### BUG-20260220-04
- Environment:
  - `http://localhost:8080/player`, live kanal sa potvrđenim catch-up sadržajem na platformi
- Steps:
  1. Otvori live kanal za koji postoji TV unazad.
  2. Proveri catch-up prikaz ispod playera.
  3. Uporedi sa očekivanim emisijama za vraćanje.
- Expected:
  - Catch-up lista treba da bude prikazana kada recordings postoje.
- Actual:
  - Prikazuje se poruka `Još nema emisija za vraćanje` iako kanal ima snimanje.
- Evidence:
  - Screenshot + korisnički nalaz (chat, 2026-02-20).
- Reporter:
  - Filip
- Timestamp:
  - 2026-02-20
- Severity (initial):
  - P1
- Status: converted-to `QAF-018` (catch-up false-empty state)

### BUG-20260220-05
- Environment:
  - `http://localhost:8080/player`, fullscreen `Gledanje unazad` panel
- Steps:
  1. Uđi u fullscreen na live kanalu.
  2. Klikni sat (`Gledanje unazad`).
  3. Posmatraj sadržaj catch-up panela.
- Expected:
  - Fullscreen panel treba da prikaže iste dostupne catch-up stavke kao regular view.
- Actual:
  - Panel je prazan/empty-state i kada postoje recordings.
- Evidence:
  - Screenshot + korisnički nalaz (chat, 2026-02-20).
- Reporter:
  - Filip
- Timestamp:
  - 2026-02-20
- Severity (initial):
  - P1
- Status: converted-to `QAF-018` (shared root-cause with regular catch-up false-empty)

### BUG-20260220-06
- Environment:
  - `http://localhost:8080/player` -> `/vod` ili `/series` -> povratak na `/player`
- Steps:
  1. Pusti live kanal koji nije prvi u `Svi kanali` (npr. OBN1).
  2. Idi na Filmove/Serije.
  3. Vrati se nazad na player.
- Expected:
  - Player treba da pamti poslednji gledani kanal i da se na njega vrati.
- Actual:
  - Player se resetuje na prvi kanal iz `Svi kanali`.
- Evidence:
  - Korisnički nalaz (chat, 2026-02-20).
- Reporter:
  - Filip
- Timestamp:
  - 2026-02-20
- Severity (initial):
  - P1
- Status: converted-to `QAF-019` (restore last watched live channel on return)

### BUG-20260220-07
- Environment:
  - `http://localhost:8080/player`, loading spinner tokom live channel start/switch
- Steps:
  1. Pokreni/promeni live kanal.
  2. Dok je loading spinner aktivan, pokušaj `pause` ili druge player kontrole.
  3. Posmatraj da li su overlay kontrole interaktivne.
- Expected:
  - Loading stanje ne sme blokirati osnovne kontrole playera.
- Actual:
  - Spinner overlay prekriva player i privremeno blokira interakciju.
- Evidence:
  - Korisnički nalaz (chat, 2026-02-20).
- Reporter:
  - Filip
- Timestamp:
  - 2026-02-20
- Severity (initial):
  - P2
- Status: converted-to `QAF-020` (non-blocking loading overlay controls)

### BUG-20260220-08
- Environment:
  - `http://localhost:8080/player`, player shell branding + cast affordance (desktop/mobile)
- Steps:
  1. Otvori player shell i proveri brand tekst.
  2. Proveri poziciju cast ikone.
  3. Uporedi sa očekivanim OTT/player layout-om.
- Expected:
  - Branding treba da bude `Lumen Player`.
  - Cast ikona treba da bude u player overlay zoni (logična desktop/mobile pozicija).
- Actual:
  - Prikazan je `narodna.tv` branding.
  - Cast ikona je van očekivane player overlay pozicije.
- Evidence:
  - Treći screenshot + korisnički nalaz (chat, 2026-02-20).
- Reporter:
  - Filip
- Timestamp:
  - 2026-02-20
- Severity (initial):
  - P2
- Status: converted-to `QAF-021` (branding + cast icon placement)

### BUG-20260220-09
- Environment:
  - `http://localhost:8080/player`, live playback control bar (desktop/mobile/tv-like usage)
- Steps:
  1. Pusti live kanal.
  2. Pokušaj vraćanje unazad direktno iz live status/progress bara (timeshift behavior).
  3. Vrati se na trenutno `UŽIVO/LIVE`.
- Expected:
  - Catch-up/timeshift treba da bude dostupan direktno iz live progress bara, sa jasnim i brzim povratkom na `UŽIVO`.
- Actual:
  - Live bar trenutno ne pruža očekivani catch-up seek/timeshift UX kao na referentnim OTT playerima.
- Evidence:
  - Screenshot 1 + korisnički opis (chat, 2026-02-20).
- Reporter:
  - Filip
- Timestamp:
  - 2026-02-20
- Severity (initial):
  - P1
- Status: converted-to `QAF-022` (live-bar catch-up/timeshift + return-to-live UX)

### BUG-20260220-10
- Environment:
  - `http://localhost:8080/player`, non-fullscreen player layout ispod video područja
- Steps:
  1. Otvori live kanal u non-fullscreen režimu.
  2. Pokušaj brzo da dođeš do `TV unazad` sekcije.
  3. Testiraj klik na sat ikonu (catch-up) i vizuelni fokus/scroll.
- Expected:
  - Catch-up treba da bude jasno uočljiv i lako dostupan; klik na sat treba da vodi korisnika direktno do relevantne sekcije/panela.
- Actual:
  - `TV unazad` je slabo vidljiv i trenutno nije lako dostupna sekcija iz standardnog non-fullscreen toka.
- Evidence:
  - Screenshot 2 + korisnički opis/predlog (chat, 2026-02-20).
- Reporter:
  - Filip
- Timestamp:
  - 2026-02-20
- Severity (initial):
  - P2
- Status: converted-to `QAF-023` (catch-up discoverability + guided jump from clock control)

### BUG-20260221-01
- Environment:
  - `http://localhost:8080/player`, desktop browser, live layout sa levim kategorijama i listom kanala
- Steps:
  1. Otvori live player i skroluj listu kategorija/buketa.
  2. Uporedi scrollbar za kategorije sa scrollbar-om liste kanala.
  3. Skroluj deo `TV unazad` ispod playera.
- Expected:
  - Scrollbar dizajn treba da bude konzistentan kroz sve player panele.
  - Nema "zalutalog" vertikalnog scrollbar-a preko `TV unazad` zone.
  - Sekcije `Sada na programu`, `Sledi` i `TV unazad` ostaju vidljive i čitljive.
- Actual:
  - Scrollbar za bukete je vizuelno drugačiji od scrollbar-a liste kanala.
  - Pojavljuje se loše prikazan scrollbar u `TV unazad` oblasti, layout izgleda poremećeno.
- Evidence:
  - Annotated screenshot (chat, 2026-02-21) sa obeleženim scrollbar regresijama.
- Reporter:
  - Filip
- Timestamp:
  - 2026-02-21
- Severity (initial):
  - P1
- Status: converted-to `QAF-024` (player scrollbar consistency + TV-unazad overflow containment)

### BUG-20260221-02
- Environment:
  - `http://localhost:8080/player`, desktop browser, scenarij zatvaranja i ponovnog otvaranja taba na live kanalu
- Steps:
  1. Otvori `/player`, pusti live kanal (primer RTS 1), zatvori tab.
  2. Otvori novi tab i ponovo idi na `/player`.
  3. Posmatraj start reprodukcije.
- Expected:
  - Live kanal u novom tabu treba da krene od aktuelnog live edge-a, bez pokušaja nastavka zastarele pozicije.
- Actual:
  - Drugi tab često ostane na crnom ekranu ili statičnom frame-u; deluje kao da pokušava nastavak stare sesije/segmenta.
- Evidence:
  - Korisnički opis + screenshot set (chat, 2026-02-21).
- Reporter:
  - Filip
- Timestamp:
  - 2026-02-21
- Severity (initial):
  - P1
- Status: converted-to `QAF-025` (live restore policy must snap to current live edge on new-tab resume)

### BUG-20260221-03
- Environment:
  - `http://localhost:8080/player`, live kanal, pause/resume flow
- Steps:
  1. Pokreni live kanal.
  2. Klikni pause i sačekaj ~2 minuta.
  3. Klikni play i proveri šta se pušta.
- Expected:
  - Resume politika treba da bude deterministička: ako je od pauze prošlo više od dozvoljenog prozora, player treba da vrati korisnika na `UŽIVO`.
- Actual:
  - Nije jasno koju poziciju player pokušava da pusti; ponašanje deluje nekonzistentno između uređaja/browsera.
- Evidence:
  - Korisnički opis (chat, 2026-02-21).
- Reporter:
  - Filip
- Timestamp:
  - 2026-02-21
- Severity (initial):
  - P2
- Status: converted-to `QAF-026` (pause-resume stale-threshold policy for live playback)

### BUG-20260221-04
- Environment:
  - `http://localhost:8080/player`, live overlay controls (desktop/mobile/PWA)
- Steps:
  1. Otvori player overlay.
  2. Proveri dostupne audio kontrole.
  3. Pokušaj fino podešavanje glasnoće.
- Expected:
  - Pored mute/unmute mora postojati i volume slider/control za granularno podešavanje zvuka.
- Actual:
  - Dostupan je samo mute/unmute toggle bez punog volume control-a.
- Evidence:
  - Korisnički opis (chat, 2026-02-21).
- Reporter:
  - Filip
- Timestamp:
  - 2026-02-21
- Severity (initial):
  - P2
- Status: converted-to `QAF-027` (full volume control on player overlay)

### BUG-20260221-05
- Environment:
  - `http://localhost:8080/series`, serije grid/listing, Xtream/XUI backend
- Steps:
  1. Otvori sekciju Serije.
  2. Uporedi prikaz kartica sa očekivanim poster/banner podacima sa servera.
  3. Proveri da li se prikazuju realne grafike ili placeholder boje.
- Expected:
  - Player treba da preuzima i prikazuje poster/banner art koje Xtream/XUI isporučuje.
- Actual:
  - Kartice su bez stvarne grafike (placeholder boje/ikonice), iako drugi playeri sa istim serverom prikazuju artwork.
- Evidence:
  - Screenshot iz Serije prikaza (chat, 2026-02-21).
- Reporter:
  - Filip
- Timestamp:
  - 2026-02-21
- Severity (initial):
  - P2
- Status: converted-to `QAF-028` (Xtream series artwork parity + field mapping diagnostics)

### BUG-20260221-06
- Environment:
  - `http://localhost:8080/player`, live/catch-up blue bar kontrola (miš + remote fokus scenariji)
- Steps:
  1. Aktiviraj `TV unazad` kontekst i pređi mišem preko blue bara.
  2. Pokušaj precizno seekovanje levo/desno.
  3. Testiraj fokus ponašanje kada se kontrola aktivira daljinskim.
- Expected:
  - Blue bar treba da ima jasan pointer/handle indikator trenutne pozicije na hover/focus radi lakšeg seek-a.
- Actual:
  - Nema vidljivog pointera; teško je pogoditi tačnu seek zonu.
- Evidence:
  - Korisnički opis + screenshot (chat, 2026-02-21).
- Reporter:
  - Filip
- Timestamp:
  - 2026-02-21
- Severity (initial):
  - P2
- Status: converted-to `QAF-029` (catch-up seek bar affordance + focus-visible pointer)

### BUG-20260221-07
- Environment:
  - `http://localhost:8080/player`, live kanal sa potvrđenim catch-up sadržajem (primer HRT 1), blue bar timeshift
- Steps:
  1. Pokreni live kanal koji ima catch-up.
  2. Klikni emisiju unazad ili pomeri blue bar ~10 minuta unazad.
  3. Posmatraj reprodukciju i eventualni error overlay.
- Expected:
  - Player treba da ode na validan catch-up stream i reprodukuje traženi vremenski offset.
  - Povratak na `UŽIVO` treba da ostane dostupan.
- Actual:
  - Dobija se `Greška u mreži` pri pokušaju catch-up reprodukcije.
- Evidence:
  - Screenshot-ovi sa `Greška u mreži` overlay-om + korisnički opis (chat, 2026-02-21).
- Reporter:
  - Filip
- Timestamp:
  - 2026-02-21
- Severity (initial):
  - P1
- Status: converted-to `QAF-030` (catch-up stream URL/probe hardening + seek execution reliability)

### BUG-20260221-08
- Environment:
  - `http://localhost:8080/player`, lista live kanala
- Steps:
  1. Otvori listu kanala.
  2. Uporedi kanale koji imaju catch-up na serveru.
  3. Proveri postoji li vizuelni indikator snimanja/catch-up podrške.
- Expected:
  - Kanal sa catch-up podrškom treba da ima jasnu ikonicu (npr. sat) u listi kanala.
- Actual:
  - Korisnik nema brz vizuelni signal koji kanali imaju catch-up.
- Evidence:
  - Korisnički opis (chat, 2026-02-21).
- Reporter:
  - Filip
- Timestamp:
  - 2026-02-21
- Severity (initial):
  - P3
- Status: converted-to `QAF-031` (catch-up capability badge in channel list)

## Intake triage snapshot (2026-02-20)

| Intake ID | Lane | Severity | Converted to | Notes |
|---|---|---|---|---|
| BUG-20260219-01 | Bugfix/Playback | P1 | QAF-006 | Mapped under autoplay/live-start reliability fix scope |
| BUG-20260219-02 | Bugfix/UI | P2 | QAF-010 | Overlay auto-hide timeout/regression task |
| BUG-20260219-03 | Bugfix/EPG | P1 | QAF-011 | EPG text normalization regression hardening |
| BUG-20260219-04 | Bugfix/Layout | P1 | QAF-012 | Player page scroll-lock/layout containment |
| BUG-20260219-05 | Bugfix/Catch-up UX | P2 | QAF-013 | Clarify catch-up no-data vs filter/data issue |
| BUG-20260219-06 | Bugfix/Playback | P1 | QAF-014 | PiP return should auto-resume live playback |
| BUG-20260220-01 | Bugfix/Playback | P1 | QAF-015 | Startup first-frame stall despite active play state |
| BUG-20260220-02 | Bugfix/Playback-Perf | P2 | QAF-016 | Slow live zapping/channel switch startup |
| BUG-20260220-03 | Bugfix/Catch-up UX | P2 | QAF-017 | Catch-up (`TV unazad`) section not visible below live player |
| BUG-20260220-04 | Bugfix/Catch-up Data/UI | P1 | QAF-018 | False empty-state iako catch-up postoji za kanal |
| BUG-20260220-05 | Bugfix/Catch-up Data/UI | P1 | QAF-018 | Fullscreen catch-up panel prazno/empty-state iako postoje recordings |
| BUG-20260220-06 | Bugfix/Session Navigation | P1 | QAF-019 | Povratak sa Filmova/Serija resetuje kanal na prvi umesto poslednjeg gledanog |
| BUG-20260220-07 | Bugfix/Player UX | P2 | QAF-020 | Loading spinner blokira player overlay kontrole |
| BUG-20260220-08 | Bugfix/UI Parity | P2 | QAF-021 | Branding `narodna.tv` + nelogična cast ikona pozicija |
| BUG-20260220-09 | Bugfix/Catch-up UX | P1 | QAF-022 | Catch-up/timeshift iz live status bara + lak povratak na `UŽIVO` |
| BUG-20260220-10 | Bugfix/Catch-up UX | P2 | QAF-023 | Non-fullscreen discoverability i brz pristup `TV unazad` sekciji |

## Intake triage snapshot (2026-02-21)

| Intake ID | Lane | Severity | Converted to | Notes |
|---|---|---|---|---|
| BUG-20260221-01 | Bugfix/Layout | P1 | QAF-024 | Scrollbar inconsistency + TV-unazad overflow/visibility regression |
| BUG-20260221-02 | Bugfix/Playback Session | P1 | QAF-025 | New-tab live restore should snap to live edge, not stale segment |
| BUG-20260221-03 | Bugfix/Playback Policy | P2 | QAF-026 | Define stale pause-resume threshold and deterministic live fallback |
| BUG-20260221-04 | Feature/UX | P2 | QAF-027 | Add full volume control (not only mute toggle) |
| BUG-20260221-05 | Bugfix/Data Mapping | P2 | QAF-028 | Series posters/banners missing despite Xtream-provided assets |
| BUG-20260221-06 | Feature/UX | P2 | QAF-029 | Blue bar needs seek handle/pointer on hover/focus |
| BUG-20260221-07 | Bugfix/Catch-up Playback | P1 | QAF-030 | Catch-up seek/open still fails with network error |
| BUG-20260221-08 | Feature/UX | P3 | QAF-031 | Add catch-up clock badge on channels with archive capability |

## Status legend

| Status | Meaning |
|---|---|
| `open` | Ready to start |
| `in-progress` | Active implementation |
| `pending-review` | Code complete, waiting validation |
| `done` | Merged + retested |
| `blocked` | Cannot progress due to external dependency |

## Severity legend

| Severity | Meaning |
|---|---|
| `P0` | Core flow broken / release blocker |
| `P1` | Major regression |
| `P2` | Medium impact, workaround exists |
| `P3` | Minor/cosmetic |

## Active tasks (granular)

Current snapshot:
- `QAF-001..QAF-023` are completed (merged).
- `QAF-024..QAF-031` are open.

| ID | Title | Area | Severity | Status |
|---|---|---|---|---|
| QAF-001 | Fix stale episode context when navigating to TV Uživo | Player Session/Navigation | P0 | done |
| QAF-002 | Add deterministic test for `Series episode -> TV Uživo -> Live shell` | E2E QA | P0 | done |
| QAF-003 | Implement local dev API proxy to remove browser CORS failures | Dev Networking | P0 | done |
| QAF-004 | Ensure catalog hooks use same-origin proxied base in dev | Data Layer | P0 | done |
| QAF-005 | Add network diagnostics panel in QA report for `player_api.php` failures | QA Tooling | P1 | done |
| QAF-006 | Fix live autoplay behavior (`autoplay` mode should actually play) | Player Playback | P1 | done |
| QAF-007 | Separate logo/image failures from stream/API failures in QA scoring | QA Tooling | P2 | done |
| QAF-008 | Improve series detail entry selector reliability in QA flow | E2E QA | P2 | done |
| QAF-009 | Handle broken series posters with robust image fallback | Series UI | P3 | done |
| QAF-010 | Fix player control overlay auto-hide behavior on idle | Player UI/Controls | P2 | done |
| QAF-011 | Fix EPG gibberish text regression in live program blocks | EPG/Data Normalization | P1 | done |
| QAF-012 | Prevent whole player page vertical scroll drift in desktop layout | Player Layout/Scroll Lock | P1 | done |
| QAF-013 | Clarify/fix catch-up panel behavior when no recordings are shown | Catch-up UX/Data | P2 | done |
| QAF-014 | Resume live playback automatically after returning from PiP | Player Playback/PiP | P1 | done |
| QAF-015 | Fix startup live playback first-frame stall (paused=false UI but video not advancing) | Player Playback | P1 | done |
| QAF-016 | Improve live zapping latency (channel switch startup too slow) | Player Playback/Performance | P2 | done |
| QAF-017 | Restore catch-up (`TV unazad`) section visibility under live player when applicable | Catch-up UX/Data | P2 | done |
| QAF-018 | Fix catch-up false-empty states (regular + fullscreen panel) for channels with known recordings | Catch-up UX/Data | P1 | done |
| QAF-019 | Preserve and restore last watched live channel when returning from VOD/Series | Player Session/Navigation | P1 | done |
| QAF-020 | Make live loading spinner overlay non-blocking for essential player controls | Player UX/Controls | P2 | done |
| QAF-021 | Replace `narodna.tv` branding with `Lumen Player` and move cast icon into player-overlay friendly position (desktop/mobile) | UI/Branding/Cast UX | P2 | done |
| QAF-022 | Add live status-bar catch-up/timeshift interaction with explicit `UŽIVO` return action (desktop/mobile/tv UX parity) | Catch-up UX/Playback Controls | P1 | done |
| QAF-023 | Improve non-fullscreen catch-up discoverability (clock action should bring focus/scroll to `TV unazad` section) | Catch-up UX/Navigation | P2 | done |
| QAF-024 | Normalize player scrollbar styling and fix TV-unazad overflow scrollbar artifacts | Player Layout/Scroll UX | P1 | open |
| QAF-025 | Enforce live-edge restore on new-tab/session resume (avoid stale-segment black/static start) | Player Playback/Session Restore | P1 | open |
| QAF-026 | Define and implement pause-resume stale policy for live playback (`resume` vs `snap-to-live`) | Player Playback Policy | P2 | open |
| QAF-027 | Add volume slider control in player overlay (desktop/mobile/PWA) | Player UX/Audio Controls | P2 | open |
| QAF-028 | Fix Xtream series artwork mapping/loading (poster/banner parity with provider) | Series Data/UI | P2 | open |
| QAF-029 | Improve catch-up blue bar seek affordance with handle/pointer + remote focus visibility | Catch-up UX/Controls | P2 | open |
| QAF-030 | Fix catch-up seek playback failures (`Greška u mreži`) using provider-accepted timeshift URL/data path | Catch-up Playback/Networking | P1 | open |
| QAF-031 | Show catch-up capability badge (clock icon) in channel list for archive-enabled channels | Channel List UX | P3 | open |

## Completion notes (2026-02-20)

- GitHub verification snapshot:
  - merged PRs: `#162`, `#163`, `#164`, `#166`, `#167`, `#168`, `#171`, `#172`, `#173`, `#175`, `#176`, `#177`, `#178`, `#180`, `#184`, `#185`, `#186`
  - all QAF IDs `QAF-001..QAF-023` are completed and merged.
- Completion map:
  - `QAF-001` -> PR `#164` (Greptile final `5/5` after follow-up remediation)
  - `QAF-002` -> PR `#166` (merged)
  - `QAF-003` -> PR `#162` (Greptile `5/5`)
  - `QAF-004` -> PR `#163` (Greptile `5/5`)
  - `QAF-005` -> PR `#176` (Greptile `5/5`)
  - `QAF-006` -> PR `#168` (merged)
  - `QAF-007` -> PR `#177` (Greptile final `5/5` after remediation)
  - `QAF-008` -> PR `#167` (Greptile `5/5`)
  - `QAF-009` -> PR `#180` (Greptile `5/5`)
  - `QAF-010` -> PR `#172` (Greptile `5/5`)
  - `QAF-011` -> PR `#175` (Greptile `5/5`)
  - `QAF-012` -> PR `#173` (Greptile `5/5`)
  - `QAF-013` -> PR `#178` (Greptile final `5/5` after remediation)
  - `QAF-014` -> PR `#171` (Greptile `5/5`)
  - `QAF-015` -> PR `#184` (Greptile `4/5`, allowed no-blocker exception documented on PR)
  - `QAF-016` -> PR `#185` (Greptile `5/5`)
  - `QAF-017` -> PR `#186` (Greptile `5/5`)
- QA gate state after implementation wave:
  - last noted local `run-qa-simulation.sh` rerun in logs is blocked by Playwright loader conflict (`Requiring @playwright/test second time`) in `.codex/worktrees/QA-GATE`.
  - this remains tracked as QA tooling/runtime follow-up after completed wave (`QAF-001..QAF-023`).

---

## Task details + prompt archive (historical)

Sections below are historical archive for `QAF-001..QAF-014` implementation prompts.

### QAF-001
- Problem:
  - On `/player`, episode playback context remains active after user intends to go back to Live TV.
  - Manual symptom: user lands on `Episode Playback` shell instead of live channel shell.
- Scope (small):
  1. Introduce one explicit action for "switch to live mode" that clears on-demand source context.
  2. Wire all `TV Uživo` navigations to use that action before route change.
  3. Keep route as `/player`, but ensure session source is live/null-on-demand.
- Likely files:
  - `/Users/filip/Documents/Lumen Player/apps/web/src/pages/Player.tsx`
  - `/Users/filip/Documents/Lumen Player/apps/web/src/pages/SeriesCategories.tsx`
  - `/Users/filip/Documents/Lumen Player/apps/web/src/pages/VodCategories.tsx`
  - `/Users/filip/Documents/Lumen Player/apps/web/src/pages/SeriesDetail.tsx`
- Acceptance:
  - After playing episode, clicking `TV Uživo` shows live player shell (channel list visible).
  - `Episode Playback` heading no longer persists in that path.

Prompt for new Codex chat:
```md
Implement QAF-001 in /Users/filip/Documents/Lumen Player.

Goal:
- Fix stale episode context when navigating to TV Uživo.

Requirements:
1. Add a deterministic "switch to live mode" behavior (clear on-demand source/session context).
2. Apply it to TV Uživo entry points (Series/VOD/on-demand shells), not just route navigation.
3. Keep fix minimal and safe, no broad refactors.
4. Add/adjust focused tests for this behavior.

Validation:
- Run relevant tests and report exact pass/fail.
- Then run:
  E2E_XUI_USERNAME='fica' E2E_XUI_PASSWORD='fF2024BG2025' ./run-qa-simulation.sh
- Summarize whether "Episode Playback" still appears after TV Uživo path.
```

### QAF-002
- Problem:
  - Existing QA flow has blockers around series detail entry and does not always assert exact context transition.
- Scope (small):
  1. Add a dedicated spec (or dedicated test case) only for this path:
     - open series -> open detail -> play episode -> go to TV Uživo -> assert live shell.
  2. Attach screenshot on each step.
  3. Fail with clear reason codes.
- Likely files:
  - `/Users/filip/Documents/Lumen Player/e2e/qa-user-simulation.spec.ts`
  - or new: `/Users/filip/Documents/Lumen Player/e2e/qa-series-live-context.spec.ts`
- Acceptance:
  - Test reliably reproduces bug pre-fix and passes post-fix.

Prompt for new Codex chat:
```md
Implement QAF-002 in /Users/filip/Documents/Lumen Player.

Create a focused Playwright scenario:
Series -> Series Detail -> Play Episode -> TV Uživo -> Live Player.

Requirements:
- Keep this as an isolated test (small and deterministic).
- Add step-level screenshots and clear blocker messages.
- Do not mix unrelated checks (autoplay, VOD, settings) in this scenario.

Output:
- Updated/added test file
- Updated report output so this scenario result is visible as a separate block.
```

### QAF-003
- Problem:
  - Browser CORS errors for `https://gw.castcdn.net/player_api.php...` from `http://localhost:8080`.
- Scope (small):
  1. Add Vite dev proxy endpoint (`/xui-api` style) targeting Xtream server.
  2. Route dev requests through same-origin proxy.
  3. Keep production behavior unchanged.
- Likely files:
  - `/Users/filip/Documents/Lumen Player/apps/web/vite.config.ts`
  - `/Users/filip/Documents/Lumen Player/apps/web/src/config/xtream.ts`
  - `/Users/filip/Documents/Lumen Player/apps/web/src/services/xtreamService.ts`
- Acceptance:
  - No browser CORS errors for `player_api.php` in local dev.
  - Live/VOD categories fetch via proxied route in dev.

Prompt for new Codex chat:
```md
Implement QAF-003 in /Users/filip/Documents/Lumen Player.

Goal:
- Remove localhost CORS failures by using a Vite dev proxy for Xtream API.

Requirements:
1. Add a same-origin proxy path in vite.config.ts.
2. Ensure Xtream API calls use proxy path in dev only.
3. Preserve existing production behavior.
4. Add concise docs note with exact env/URL behavior.

Validation:
- Start dev server on localhost:8080.
- Confirm requests no longer hit CORS errors in browser console.
```

### QAF-004
- Problem:
  - Some hooks/routes still end up with direct remote requests instead of unified base strategy.
- Scope (small):
  1. Audit all Xtream calls for base URL usage.
  2. Unify with one helper function (dev proxy vs prod direct).
  3. Add unit tests around base URL resolver.
- Likely files:
  - `/Users/filip/Documents/Lumen Player/apps/web/src/config/xtream.ts`
  - hooks/services using Xtream calls
- Acceptance:
  - Single source of truth for Xtream base URL resolution.
  - No mixed direct/proxy calls in dev.

Prompt for new Codex chat:
```md
Implement QAF-004 in /Users/filip/Documents/Lumen Player.

Goal:
- Ensure every Xtream request path uses one centralized base URL strategy.

Requirements:
- Add/extend a single resolver utility for dev/prod API base.
- Refactor callers to use it.
- Add unit tests for resolver behavior.
- Keep PR scope tight and avoid unrelated UI edits.
```

### QAF-005
- Problem:
  - QA report has blockers but needs sharper diagnostics for API failures by endpoint/action.
- Scope (small):
  1. Parse console/request failures into grouped counters:
     - `get_live_categories`, `get_live_streams`, `get_vod_categories`, etc.
  2. Add section `API Failure Breakdown` in QA report.
  3. Keep artifact links unchanged.
- Likely files:
  - `/Users/filip/Documents/Lumen Player/e2e/qa-user-simulation.spec.ts`
  - `/Users/filip/Documents/Lumen Player/scripts/playwright/run-qa-user-sim.mjs`
- Acceptance:
  - Report shows endpoint-level failure counts.

Prompt for new Codex chat:
```md
Implement QAF-005 in /Users/filip/Documents/Lumen Player.

Enhance QA reporting:
- Add endpoint/action-level API failure grouping in QA-REPORT.md
- Keep current timeline and blockers, just enrich diagnostics.

Need:
- Parse requestfailed + console errors
- Group by Xtream action (get_live_categories/get_live_streams/get_vod_categories/...)
- Output a short actionable breakdown
```

### QAF-006
- Problem:
  - In autoplay mode, test shows `video.paused=true` after selecting channel.
- Scope (small):
  1. Trace live channel select flow when mode=`autoplay`.
  2. Ensure `play()` is triggered at correct point after source set and not cancelled.
  3. Add focused unit/integration test for autoplay.
- Likely files:
  - `/Users/filip/Documents/Lumen Player/apps/web/src/pages/Player.tsx`
  - `/Users/filip/Documents/Lumen Player/apps/web/src/pages/liveChannelStartupMode.ts`
  - `/Users/filip/Documents/Lumen Player/apps/web/src/pages/liveChannelStartupMode.test.ts`
- Acceptance:
  - Autoplay mode yields playing state consistently in local flow.

Prompt for new Codex chat:
```md
Implement QAF-006 in /Users/filip/Documents/Lumen Player.

Goal:
- Fix live autoplay mode so selected channel starts playing immediately.

Requirements:
- Diagnose why autoplay path leaves video paused.
- Implement minimal safe fix in Player/source-selection flow.
- Add/extend tests for autoplay manual vs autoplay modes.

Validation:
- Run relevant tests.
- Run QA simulation and confirm autoplay blocker is gone.
```

### QAF-007
- Problem:
  - QA currently mixes non-critical image/logo aborts with critical API/stream failures.
- Scope (small):
  1. Categorize request failures:
     - `critical`: player_api / stream manifest/media
     - `non-critical`: logos/posters/CDN images
  2. Only critical failures should block scenario.
- Likely files:
  - `/Users/filip/Documents/Lumen Player/e2e/qa-user-simulation.spec.ts`
- Acceptance:
  - Report still lists non-critical failures, but blocker decision uses critical-only policy.

Prompt for new Codex chat:
```md
Implement QAF-007 in /Users/filip/Documents/Lumen Player.

QA scoring change:
- Distinguish critical network failures from cosmetic image/logo failures.
- Only critical failures should mark scenario as blocked.

Keep:
- Full diagnostics in report
- Existing timeline format
```

### QAF-008
- Problem:
  - Step `Series episode -> player on-demand mode` fails with `No series detail card available`.
- Scope (small):
  1. Harden selector strategy for first series item.
  2. Add fallback route open when list is empty but category is loaded.
  3. Improve step diagnostics (loaded item count, selector used).
- Likely files:
  - `/Users/filip/Documents/Lumen Player/e2e/qa-user-simulation.spec.ts`
- Acceptance:
  - Step fails only for real data absence, not selector fragility.

Prompt for new Codex chat:
```md
Implement QAF-008 in /Users/filip/Documents/Lumen Player.

Goal:
- Make series detail entry step robust in QA test.

Requirements:
- Improve selectors for series cards.
- Add fallback logic and better debug notes (item counts/selector path).
- Keep behavior deterministic and avoid long retries.
```

### QAF-009
- Problem:
  - Series image loading can fail visually; current UX fallback is partial.
- Scope (small):
  1. Add `onError` fallback for series poster images.
  2. Render local placeholder state consistently.
  3. Keep layout stable.
- Likely files:
  - `/Users/filip/Documents/Lumen Player/apps/web/src/pages/SeriesCategories.tsx`
  - `/Users/filip/Documents/Lumen Player/apps/web/src/pages/SeriesDetail.tsx`
- Acceptance:
  - Broken image URLs no longer show broken-image icon or blank container.

Prompt for new Codex chat:
```md
Implement QAF-009 in /Users/filip/Documents/Lumen Player.

Goal:
- Add robust image fallback for series posters in list and detail views.

Requirements:
- Use onError fallback to deterministic local placeholder.
- Preserve current card dimensions and visual hierarchy.
- Add minimal tests if existing test setup allows; otherwise provide manual verification checklist.
```

### QAF-010
- Problem:
  - Live player controls overlay does not auto-hide in normal (non-fullscreen) usage.
- Scope (small):
  1. Reproduce idle-timer/control-visibility path in player controls.
  2. Restore deterministic hide-on-idle behavior for overlay controls.
  3. Add focused regression test for visibility timeout.
- Likely files:
  - `/Users/filip/Documents/Lumen Player/apps/web/src/components/player/PlayerControls.tsx`
  - `/Users/filip/Documents/Lumen Player/apps/web/src/pages/Player.tsx`
- Acceptance:
  - Overlay hides after configured idle interval and reappears on interaction.

### QAF-011
- Problem:
  - EPG text intermittently regresses to gibberish on some channels.
- Scope (small):
  1. Capture failing payload examples in mapper tests.
  2. Strengthen normalization/decoding fallback path.
  3. Verify both "Sada na programu" and "Sledi" blocks.
- Likely files:
  - `/Users/filip/Documents/Lumen Player/apps/web/src/services/epgProgramMapper.ts`
  - `/Users/filip/Documents/Lumen Player/apps/web/src/services/epgProgramMapper.test.ts`
  - `/Users/filip/Documents/Lumen Player/apps/web/src/pages/Player.tsx`
- Acceptance:
  - EPG strings are readable for previously failing channels in test fixtures and manual spot-check.

### QAF-012
- Problem:
  - Desktop player page can vertically scroll as a whole and reveal dead space.
- Scope (small):
  1. Lock page-level vertical scroll on player route where layout should be viewport-contained.
  2. Keep intended scroll areas only (channel/category lists, program sections as designed).
  3. Add regression check for body/page overflow behavior.
- Likely files:
  - `/Users/filip/Documents/Lumen Player/apps/web/src/pages/Player.tsx`
  - `/Users/filip/Documents/Lumen Player/apps/web/src/components/layout/AppShell.tsx`
  - `/Users/filip/Documents/Lumen Player/apps/web/src/index.css`
- Acceptance:
  - Wheel scroll over video area does not move whole page out of viewport on desktop player layout.

### QAF-013
- Problem:
  - Catch-up panel in fullscreen is ambiguous when showing "Nema dostupnih snimaka".
- Scope (small):
  1. Differentiate "no catch-up data" vs "fetch/filter failed" in UI state.
  2. Add clear empty-state copy and optional retry where applicable.
  3. Add targeted diagnostics event for catch-up data source result.
- Likely files:
  - `/Users/filip/Documents/Lumen Player/apps/web/src/pages/Player.tsx`
  - `/Users/filip/Documents/Lumen Player/apps/web/src/services/channelEpg.ts`
- Acceptance:
  - User sees explicit reason-state, not generic ambiguous empty panel.

### QAF-014
- Problem:
  - Returning from Picture-in-Picture often leaves live playback paused until manual Play.
- Scope (small):
  1. Reproduce PiP enter/exit transition in local renderer path.
  2. Ensure live playback state is restored/resumed correctly on PiP exit.
  3. Add focused regression test around PiP state handoff.
- Likely files:
  - `/Users/filip/Documents/Lumen Player/apps/web/src/components/player/VideoPlayer.tsx`
  - `/Users/filip/Documents/Lumen Player/apps/web/src/pages/Player.tsx`
- Acceptance:
  - After PiP exit, live playback resumes automatically without extra Play click.

---

## Execution order (historical, completed)

1. QAF-002  
2. QAF-008  
3. QAF-006  
4. QAF-014  
5. QAF-010  
6. QAF-012  
7. QAF-011  
8. QAF-005  
9. QAF-007  
10. QAF-013  
11. QAF-009

Rationale (historical): after merged baseline fixes (`QAF-001/003/004`), priority was deterministic episode-live proof and core playback continuity, then control/layout regressions, then diagnostics/scoring clarity, then catch-up/message polish.
