# Plan: Lumen sopstveni catch-up edge sloj (nezavisan od timeshift.php)

**Datum:** 2026-06-19
**Vlasnička odluka:** catch-up je deo vrednosti Lumen proizvoda — obrada i serviranje moraju
biti NAŠA infrastruktura, ne tuđi deljeni `timeshift.php`.

## Vlasničke odluke (Filip, 19.6.)
1. **MVP edge: 1 dedicirani box, EXYU-only.** Najbrži put do "catch-up radi savršeno".
   Skaliramo kad poraste (dobar problem, plaća ga prihod).
2. **Direktan read sirovih `.ts` sa recording diska** — NE preko `timeshift.php`.
   Potpuna nezavisnost: tuđi fajl se ne dodiruje ni kao izvor.
3. **Tvrdo pravilo:** deljeni `timeshift.php` (TiviMate/Smarters/Hot Player — 1.431+ reg
   usera) se NIKAD ne dira zbog Lumena. (memorija: `no-shared-timeshift-edits`)

## Potvrđene činjenice (živi disk, .121 / ns3239635)
- Arhiva: **`tv_archive/<id>/<YYYY-MM-DD>:<HH-MM>.ts`** — minutni segmenti, ~30MB, 103 kanala,
  13T ukupno. Imenovanje deterministička, Europe/Vienna vreme.
- Dead-zone problem (segment počinje mid-GOP bez SPS/PPS) + A/V skew (audio i video
  počinju na različitom PTS-u) — to je razlog mucanja/desync-a.
- **Naš dead-zone repair cron VEĆ prolazi kroz ove fajlove** (`.lumen_fixed` markeri,
  `/opt/lumen/lumen-archive-repair.sh`, `*/2 * * * *`, `repaired=160 failed=0`). Znači
  pristup i obrada sirovog materijala su DOKAZANI.
- Pristup: `ssh -p 8722 root@79.137.99.121` (vlasnik odobrio). 14T slobodno na /home.

## Arhitektura (MVP)

```
  [XUI recording disk]                [LUMEN EDGE BOX]              [Lumen web]
  tv_archive/<id>/*.ts   --(read)-->  catch-up service      --->   hls.js / MSE
  (NE diramo timeshift.php)           - collect window              čist fMP4/HLS
                                      - remux (SPS/PPS + A/V norm)
                                      - cache + serve
```

**Tri komponente na Lumen edge boxu:**

### A. Collector — čita sirove `.ts` za traženi prozor
- Input: `streamId`, `start` (timestamp), `duration`.
- Mapira na `tv_archive/<id>/<Vienna-time>.ts` fajlove (deterministička imena — isti
  algoritam koji repair cron već koristi: generiši imena za minute u prozoru, `test -f`).
- **Ključno: poštuje `duration`** (start → start+duration), za razliku od shadow buga koji
  je gradio do live edge-a. Ovo rešava spori-hladan-build problem koji shadow nije.
- Pristup sirovim fajlovima: faza 1 = preko SSH/rsync sa recording boxa na edge box; faza
  2 (ako edge i recording dele mrežu) = NFS/direktan mount read-only.

### B. Remuxer — normalizuje A/V, ubacuje SPS/PPS
- `ffmpeg -c copy` + `bsf:v dump_extra` (ubaci SPS/PPS u svaki keyframe — rešava dead-zone)
  + A/V normalizacija (poravnaj audio/video start PTS — rešava desync koji MSE ne može sam).
- Output: fMP4 (init segment + ~7s segmenti + DISCONTINUITY) ILI čist HLS TS — isto što je
  shadow pravio, ali NA NAŠOJ MAŠINI, i sa poštovanim prozorom.
- `-c copy` = jeftino (kopira, ne re-enkoduje) — ~1-3% jezgra po streamu.

### C. Server + keš
- Servira manifest + segmente Lumen klijentu (CORS ok).
- Keš obrađenih prozora (disk), GC po starosti — ali OVAJ PUT GC mora stvarno da radi
  (shadow GC nije radio → 54G mrtvog keša).
- Klijent rutira na ovaj endpoint per-host (`VITE_CATCHUP_*`), nema veze sa `timeshift.php`.

## Šta ostaje iz postojećeg Lumen koda (ne bacamo)
- Klijentske startup popravke (`e0a491a` dead-zone seek, `e16eb18` reseek loop) — i dalje
  korisne kao druga linija.
- TTFRF telemetrija (`cdced5f`) — meri da li edge isporučuje prvi frejm brzo.
- `apps/proxy` transport logika — proširuje se da rutira na novi edge endpoint.
- Dijagnoza uzroka (mid-GOP SPS/PPS + A/V skew) — temelj celog dizajna.

## Šta se NE radi više
- **NE diramo `timeshift.php`** (deljeni). Ni kao izvor — čitamo `tv_archive` direktno.
- **NE shadow na recording boxu** (`timeshift_shadow.php`) — zavisi od XUI dev-a, ima
  nerešen hladan-build, deli CPU sa živim segmenterima. Naš edge je zamena.

## Faze implementacije
1. **PoC remux lokalno:** uzmi par sirovih `tv_archive/109/*.ts` (kopiraj na lokal), dokaži
   da naš remux daje čist A/V-sinhronisan fMP4 koji hls.js svira bez mucanja. Bez servera.
2. **Edge box:** obezbedi dedicirani server (Filip bira provajdera/region). Deploy collector
   + remuxer + serve.
3. **Pristup arhivi:** uspostavi read sirovih `.ts` sa recording boxa na edge (SSH/rsync ili
   mount). Read-only, ne dira XUI.
4. **Klijent routing:** Lumen web rutira catch-up na edge endpoint. Legacy `timeshift.php`
   ostaje samo kao fallback ako edge padne (opciono).
5. **Verifikacija:** EXYU kanal, dug program (4h) → prvi frejm za sekunde, A/V sinhron,
   nema dead-zone. TTFRF telemetrija potvrđuje.

## Otvorena pitanja za Filipa (kad krenemo u fazu 2)
- Koji provajder/region za edge box? (recording flota je OVH/PrimeHost — blizina arhivi
  smanjuje latenciju reada.)
- Da li edge i recording mogu da dele privatnu mrežu (NFS mount) ili idemo SSH/rsync pull?
