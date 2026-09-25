# Catch-up "muca pa krene" — koren u `seg=0` `fseek`-u (za XUI dev)

**Datum:** 2026-06-14
**Server:** `ns3239635` (= `edge6.castcdn.net`, javni IPv4 `79.137.99.121`, SSH na portu `8722`)
**Autor merenja:** Lumen tim (kroz produkcijski player na `http://151.241.151.105/`, nalog `fica`)
**Status:** koren **dokazan merenjem**. Traži se izmena na serverskoj strani (`timeshift.php`) ili potvrda da je klijentski put dovoljan. **Ništa nije menjano u ovoj analizi osim forward-only cron-a koji popravlja telo arhivskih fajlova (opisan dole) — taj cron je koristan ali NIJE dovoljan sam.**

---

## TL;DR (za onoga ko ima 30 sekundi)

1. Catch-up muca na **samom početku programa** ("muca pa krene"). Live radi savršeno.
2. Koren: prvi HLS segment (`seg=0`) počinje **usred GOP-a, bez SPS/PPS** → hls.js/MSE ne može da dekodira → bafer ostaje prazan → `MEDIA_ERROR` petlja.
3. **Novi nalaz (14.6.):** `timeshift.php` za `seg=0` radi **`fseek` na sredinu prvog minutnog `.ts` fajla** (da poravna na tačan sekund kad program počinje). Taj fseek sleti **iza** bilo kakvog SPS/PPS headera na početku fajla → dead-zone se vraća, čak i ako je telo fajla čisto.
4. Dokaz: isti fajl dekodiran **od offseta 0 = 0 grešaka**, **od fseek offseta = 108 grešaka**.
5. `seg=1, seg=2, ...` su čisti (server ih servira od offseta 0). **Samo `seg=0` fseek-uje.**

---

## Šta Lumen klijent radi (catch-up)

Lumen web player (React + **hls.js 1.6.15**) gađa standardni XUI catch-up put, identično kao bilo koji XC klijent:

```
GET /streaming/timeshift.php?username=<redacted>&password=<redacted>&stream=<id>&start=YYYY-MM-DD:HH-MM&duration=<sec>&extension=m3u8
→ 302 → edge6.castcdn.net/streaming/timeshift.php?token=<redacted>&seg=<idx>_<bytesize>.ts
```

Dobijeni manifest je **VOD** playlist:

```
#EXTM3U
#EXT-X-VERSION:3
#EXT-X-TARGETDURATION:60
#EXT-X-MEDIA-SEQUENCE:0
#EXT-X-PLAYLIST-TYPE:VOD
#EXTINF:60,
…seg=0_28505124.ts
#EXT-X-DISCONTINUITY
#EXTINF:60,
…seg=1_29528972.ts
#EXT-X-DISCONTINUITY
#EXTINF:60,
…seg=2_29842556.ts
…
```

- Jedan segment = jedan minutni arhivski fajl (`#EXTINF:60`).
- `seg=<idx>_<bytesize>` — `bytesize` se **tačno poklapa** sa veličinom fajla na disku (proverili smo za 6 uzastopnih minuta: MATCH). Znači mapiranje segment→fajl je ispravno.
- Player ih traži redom: `seg=0`, `seg=1`, `seg=2`, …

**Klijent ne radi ništa nestandardno.** Isti put koristi bilo koji XC player. Lumen samo dodatno meri šta dobija (telemetrija + Playwright).

---

## Šta Lumen očekuje (i šta mu treba)

Da bi hls.js/MSE mogao da dekodira H.264 u MPEG-TS-u, **prvi paket koji dekoder vidi mora biti praćen SPS+PPS pre prvog slice-a** (ili keyframe koji nosi SPS/PPS odmah ispred sebe). Konkretno, Lumenu treba:

> **Svaki catch-up segment koji klijent dobije mora počinjati tako da SPS/PPS+IDR dođu PRE prvog slice-a, bez obzira da li server čita fajl od offseta 0 ili od fseek offseta.**

Ako server fseek-uje na proizvoljan bajt offset (kao za `seg=0`), taj offset mora pasti **na granicu keyframe-a koji nosi SPS/PPS**, a ne usred GOP-a.

---

## Šta je na Lumen strani već urađeno (catch-up)

1. **Root-cause analiza + telemetrija (deployed):**
   - `catchup.first_frame` event sa `ttfrfMs` (vreme do prvog renderable frejma) — commit `cdced5f`, deployed na VPS.
   - `MEDIA_ERROR` / `catchup.startup_timeout` / `playback.error` se logују preko `/observe`.

2. **Klijentski "head-skip" fix (commit-ovan, NIJE još na produkciji)** — grana `final-road/EX-live-refocus-emptysrc`, commit `e0a491a`:
   - Catch-up "od početka programa" koristi hls.js opcije:
     ```js
     startPosition: 0.1,
     startOnSegmentBoundary: true,   // hls.js 1.6+: snap na prvi buffered keyframe
     ```
   - Cilj: playhead da krene od prvog ispravnog keyframe-a, ne sa bajta 0 (gde je mrtva zona).
   - Scrub (premotavanje usred programa) NE koristi `startOnSegmentBoundary` (povlačio bi korisnika unazad).
   - **Ograničenje (mereno 14.6.):** za `seg=0` koji je dead-zone **od početka do kraja segmenta**, nema nijednog buffered keyframe-a na koji bi se snap-ovao → bafer ostane prazan → fix ne pomaže. Head-skip radi tek kad segment SADRŽI bar jedan ispravan keyframe.

3. **Forward-only cron koji popravlja TELO arhivskih fajlova (deployed na ns3239635, 14.6.):**
   - `/opt/lumen/lumen-archive-repair.sh` — re-mux svakog sveže zatvorenog minutnog fajla:
     ```
     ffmpeg -i <min>.ts -c copy -bsf:v dump_extra=freq=k -mpegts_flags +resend_headers -f mpegts <out>
     ```
   - Forward-only (samo nove minute, bez backfill-a), `nice/ionice`, load guard, atomski `mv`, marker `.lumen_fixed`, owner/perms očuvani. Live snimanje netaknuto, CPU ~1%.
   - **Rezultat:** telo fajla na disku = **0 decode grešaka od offseta 0**. ✓
   - **ALI:** ovo ne rešava `seg=0` fseek (vidi dole). Cron je koristan (čisti `seg=1+` i ceo fajl), ali **nije dovoljan sam**.

---

## Merenja — koren `seg=0` problema

Test: produkcijski player → **NOVA BH (stream 530)** → catch-up **"Zvezde Granda" 14:50** (program koji CEO leži u prozoru koji je cron popravio).

### 1. Fajl na disku je čist
```
tv_archive/530/2026-06-14:14-50.ts   (prvi minut programa)
  size = 28505124, marker .lumen_fixed prisutan, owner xtreamcodes:xtreamcodes
  ffmpeg decode od offseta 0:  0 decode grešaka   ✓ ČIST
```

### 2. Ali klijent za `seg=0` dobije dead-zone
Povučen tačan segment koji player traži (`seg=0_28505124.ts`):
```
content-type: video/mp2t, status 200
NAL scan: prvi slice PRE prvog SPS  →  DEAD-ZONE
ffmpeg decode: 108 grešaka (non-existing PPS / no frame)
veličina: 19953568 (a pri drugom povlačenju 28821340) — MENJA SE, iako je fajl na disku fiksnih 28505124
```
Različita veličina pri svakom fetch-u = server **ne vraća ceo fajl**, vraća **tail od nekog offseta do kraja**.

### 3. Dokaz da je fseek uzrok
Server za `seg=0` vraća ~19953568 bajta od fajla od 28505124 → fseek offset = `28505124 - 19953568 = 8551556`.

Dekodiran isti fajl **od tog offseta**:
```
tail -c +8551557 14-50.ts | ffmpeg -i - -t 2 -f null -   →  108 grešaka   ← DEAD-ZONE
ffmpeg -i 14-50.ts        -t 2 -f null -                 →    0 grešaka   ← ČIST (offset 0)
```

**Zaključak: `fseek` na 8.5MB unutar fajla sleti na proizvoljan TS paket usred GOP-a, IZA SPS/PPS headera koji je na početku fajla → dekoder vidi slice bez SPS/PPS → mrtva zona se vraća.**

### 4. `seg=1, seg=2` su čisti
```
seg=1_29528972:  SPS pre slice  →  CLEAN
seg=2_29842556:  SPS pre slice  →  CLEAN
```
Njih server servira od offseta 0 (ceo minut). **Samo `seg=0` fseek-uje** — jer program počinje na 14:50:**xx** (sekunde nisu poravnate sa granicom minuta), pa server seek-uje unutar prvog minuta da poravna na tačan `start`.

### 5. Klijentski simptom (mereno u browseru)
```
currentTime: 120.83   (playhead odjurio na 2. minut)
buffered:     []       (prazan)
readyState:   2, paused: false
event: playback.error, code: MEDIA_ERROR (ponavlja se)
```

---

## Zašto `dump_extra` cron ne pokriva ovo

`dump_extra=freq=k` upisuje SPS/PPS u bitstream **pre svakog keyframe-a**. Ali:
- Server fseek-uje po **bajt offsetu u MPEG-TS kontejneru** (188-bajtni TS paketi), **ne** po keyframe granici.
- Proizvoljan bajt offset pada usred TS paketa / usred GOP-a, **posle** SPS-a koji je upisan ispred prethodnog keyframe-a.
- Dekoder od tog offseta vidi P-frejmove pre nego što stigne sledeći SPS → dead-zone.

Dakle popravka tela fajla pomaže `seg=1+` (čitaju se od 0), ali **`seg=0` ostaje pokvaren dok god server fseek-uje mid-GOP**.

---

## Predlozi rešenja (za odluku XUI dev-a)

Poređani od najmanje do najviše invazivnog po serveru:

### Opcija A — server NE fseek-uje `seg=0` (preporuka Lumen tima)
Za `seg=0`, neka `timeshift.php` servira **ceo prvi minutni fajl od offseta 0** (kao što već radi za `seg=1+`), umesto fseek-a na tačan `start` sekund.
- **Posledica:** korisnik vidi do ~59s "viška" na samom početku programa (od početka minuta do tačnog program-start sekunda). Za catch-up "od početka" to je bezopasno — gledalac svejedno gleda od početka.
- **Najmanje rizično:** ne dira A/V, ne transkoduje, koristi isti put kao ostali segmenti.
- Idealno u kombinaciji sa cron-om koji već čisti telo fajla (offset 0 je čist).

### Opcija B — fseek samo na keyframe granicu
Ako se tačno poravnanje na program-start MORA zadržati, neka server pri fseek-u za `seg=0` **pomeri offset unazad/unapred na najbliži keyframe** (TS paket koji nosi SPS/PPS+IDR), umesto na proizvoljan bajt. Tako prvi paket koji klijent dobije nosi headere.
- Zahteva da server zna gde su keyframe granice (skeniranje ili index). Komplikovanije.

### Opcija C — `+resend_headers` / re-emit na timeshift HLS putu
Ranije dogovorena gate-2 lokacija (`includes/stream.php`, `-f segment` muxer). **NAPOMENA:** mereno je da catch-up ide kroz `timeshift.php` (čist `fopen`+`fseek`+passthrough, BEZ ffmpeg-a), NE kroz live segmenter. Zato `+resend_headers` na segmenteru **verovatno NE pokriva** ovaj fseek slučaj. Treba potvrda da li postoji HLS put koji prolazi kroz muxer za catch-up.

### Opcija D — klijentska zakrpa (Lumen, paralelno)
Lumen može da pokuša da preskoči `seg=0` mrtvu zonu na klijentu (`startOnSegmentBoundary` već postoji), ali — kako je mereno — kad je **ceo `seg=0` dead-zone** (nijedan keyframe se ne dekodira), nema na šta da se snap-uje pa bafer ostane prazan. Klijentska zakrpa pomaže samo ako server isporuči bar jedan ispravan keyframe u `seg=0` (tj. tek posle opcije A/B/C). **Lumen ovo ne može sam da reši dok server isporučuje potpuno headerless prvi segment.**

---

## Kako reprodukovati (za XUI dev-a)

```bash
# 1. Manifest (302 → edge):
curl -s "https://gw.castcdn.net/streaming/timeshift.php?username=<redacted>&password=<redacted>&stream=530&start=2026-06-14:14-50&duration=2940&extension=m3u8"

# 2. Skini seg=0 (token iz manifesta), proveri SPS pre slice:
curl -s "<edge6 seg=0 url>" -o seg0.ts
ffmpeg -hide_banner -v error -i seg0.ts -t 2 -f null -   # >0 grešaka = dead-zone

# 3. Uporedi sa fajlom na disku (na ns3239635, ssh -p 8722):
F=/home/xtreamcodes/iptv_xtream_codes/tv_archive/530/2026-06-14:14-50.ts
ffmpeg -v error -i "$F" -t 2 -f null -                    # 0 grešaka (offset 0 je čist)
full=$(stat -c%s "$F"); got=$(stat -c%s seg0.ts); off=$((full-got))
tail -c +$((off+1)) "$F" | ffmpeg -v error -i - -t 2 -f null -   # 108 grešaka (fseek offset = dead-zone)
```

---

## Kontekst / reference (Lumen interno)

- `apps/web/src/adapters/HlsPlayerAdapter.ts` (~775–820): catch-up hls.js config (`startPosition`, `startOnSegmentBoundary`, buffer policy).
- Cron + analiza tela fajla: `infra/videoteka-shadow/` + memory `prod-ns3239635-deadzone-cron`.
- Prethodna root-cause analiza (SPS/PPS dubina, shadow eksperimenti): `docs/XUI-CATCHUP-SPS-PPS-FIX-SPEC.md`, memory `catchup-seg0-no-sps-pps`.
- `timeshift.php` na boxu: `/home/xtreamcodes/iptv_xtream_codes/wwwdir/streaming/timeshift.php` (plaintext PHP, obfuskovan goto/hex; `fopen`+`fseek`+passthrough, bez ffmpeg).

**Pitanje za XUI dev-a:** da li možeš da potvrdiš gde u `timeshift.php` se računa fseek offset za `seg=0`, i da li je izvodljiva Opcija A (servirati prvi segment od offseta 0)?
