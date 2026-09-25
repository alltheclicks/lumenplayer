# Catch-up — preskok + audio preklop na granici minuta (za XUI dev)

**Datum:** 2026-06-14
**Server:** `ns3239635` (= `edge6.castcdn.net`, javni IPv4 `79.137.99.121`, SSH na portu `8722`)
**Autor merenja:** Lumen tim (kroz produkcijski player `http://151.241.151.105/`, nalog `fica`)
**Povezano:** `XUI-CATCHUP-SEG0-FSEEK-FIX-REPORT.md` (tvoj seg=0 fix) + `XUI-CATCHUP-SEG0-FSEEK-DEADZONE.md` (originalni Lumen izveštaj)
**Status:** seg=0 dead-zone je **REŠEN** (tvoj `*0.3→0` fix radi, potvrđeno). Ostaje **NOVI, zaseban** bug na granici segmenata. **AŽURIRANO 2026-06-14 (b):** Lumen je probao Opciju A (dinamički `#EXTINF`) na `.121` — **napravila REGRESIJU, odmah rollback-ovana.** Razlog i pravi koren ispod (sekcija 2.5 + 4).

---

## TL;DR

1. **Tvoj seg=0 fix radi.** Potvrđeno kroz player: početak catch-up programa sad svira čisto, bafer pun, bez dead-zone petlje. Otvaranje sadržaja OK.
2. **Preostali simptom (prijavio vlasnik):** na **svakom prelazu minuta (~0:59)** se "preskoči par sekundi sadržaja i preklopi audio prethodnog i novog minuta".
3. **Pravi koren (dokazan merenjem na 4 kanala):** svaki minutni `.ts` ima **A/V start-skew** — audio uvek kreće na PTS `1.400s`, a video na prvom keyframe-u posle reza (`3.2s–5.8s`, GOP-zavisno). `video_span` (55.7–58.5s) ≠ `audio_span` (59.7–60.0s) ≠ `container` (60.0–60.4s). Svaki fajl je **nezavisan timeline** koji se resetuje na granici. To EXTINF **ne dira**.
4. **Opcija A (stvaran `#EXTINF`) NE rešava — pogoršava.** Lumen je stavio `format=duration` (container span) u EXTINF po segmentu → MSE na svakom segmentu pogrešno pozicionira audio timeline → **kumulativni audio drift → totalni desync** (slika i zvuk idu svaki svojim tokom). Fiksni `60` je "ujednačeno pogrešan" pa ga player toleriše kao blagi overlap **samo na granici**. → **Opcija A je odbačena.**
5. **NIJE od Lumen seg=0 fix-a ni od Lumen archive-repair crona** — dokazano da `dump_extra -c copy` čuva PTS bajt-identično. Skew je iz samog XUI snimanja (`tools/archive.php`, ionCube).
6. **Pravo rešenje zahteva remux koji normalizuje A/V** (poravna audio i video na isti početni PTS po programu, kontinuirani timestampi). To `timeshift_shadow.php` **već radi** (fMP4 + `-hls_time` + `DISCONTINUITY`). Pitanje je samo resursna održivost na skali — vidi sekciju 4 + pitanja za XUI dev-a.

---

## 1. Šta je potvrđeno da RADI (tvoj fix)

GUI test kroz produkcijski player: **NOVA BH (stream 530) → "16:00 Zvezde Granda"** (program snimljen POSLE tvog fix-a).

- `timeshift.php` na `.121`: `grep -c '\* 0\.3'` = **0** (fix primenjen), `php -l` čist, backup `timeshift.php.bak.catchup-seg0` postoji.
- Player na startu programa: `readyState=4`, `buffered=[0.54, 120.4]` (pun 120s bafer), **bez dead-zone petlje, bez MEDIA_ERROR-a**.
- `seg=0`, `seg=1`, `seg=2` svi učitani, playhead napreduje od početka.

→ **seg=0 dead-zone je rešen. Hvala.**

---

## 2. Preostali bug — merenja

### 2.1 Simptom (klijent)
Sampler na `<video>` elementu (svakih 250ms) kroz granicu prvog minuta:
- `currentTime` napreduje **savršeno glatko** (55.49 → 78.24, korak 0.25s, **0 backward-jump / 0 forward-skip / 0 stall**, `readyState=4` sve vreme).
- **Dakle problem NIJE u playhead timeline-u** (zato je suptilan) — nego u **poređanju dekodiranih frejmova NA SAMOM SPOJU**: audio se preklopi, video preskoči, dok playhead i dalje teče linearno.

### 2.2 Koren (server, disk) — `#EXTINF:60` je laž
Manifest (`timeshift.php?…&extension=m3u8`) za svaki segment emituje:
```
#EXTINF:60,
…seg=N_<bytesize>.ts
#EXT-X-DISCONTINUITY
```
Ali stvarno trajanje sadržaja po minutnom fajlu **nije 60s**. Mereno (`ffprobe`, video PTS span = last_pts − first_pts):

**NOVA BH (530), 16:00–16:09:**
| minut | video start PTS | audio start PTS | **video span** | odstupanje vs EXTINF=60 |
|-------|-----------------|-----------------|----------------|--------------------------|
| 16-00 | 1.944 | 1.400 | **60.600** | **+0.600** |
| 16-01 | 3.080 | 1.400 | **57.800** | **−2.200** |
| 16-02 | 1.858 | 1.400 | 59.600 | −0.400 |
| 16-03 | 1.933 | 1.400 | 59.560 | −0.440 |
| 16-04 | 2.200 | 1.400 | 59.120 | −0.880 |
| 16-05 | 2.424 | 1.400 | 59.200 | −0.800 |
| 16-06 | 2.498 | 1.400 | 59.200 | −0.800 |
| 16-07 | 2.488 | 1.400 | 59.680 | −0.320 |
| 16-08 | 1.965 | 1.400 | 58.560 | −1.440 |
| 16-09 | 3.000 | 1.400 | 59.080 | −0.920 |

**PRVA (109), 16:00–16:04 (cross-check, drugi kanal):**
| minut | video start PTS | video span |
|-------|-----------------|------------|
| 16-00 | 3.384 | 57.720 |
| 16-01 | 2.035 | 59.160 |
| 16-02 | 2.536 | 58.800 |
| 16-03 | 2.973 | 58.180 |
| 16-04 | 3.240 | 58.040 |

### 2.3 Tri problema vidljiva iz tabele

1. **Span ≠ 60s, i varira po fajlu** (57.7s do 60.6s). Manifest tvrdi 60 za sve → player na svakoj granici akumulira/koriguje grešku = overlap (kad je span >60, npr 16-00 = +0.6s) ili rupa (kad je <60).
2. **Video start PTS varira** (1.86s–3.38s) i **NE poklapa se sa audio start PTS** (uvek 1.400s). Unutar svakog fajla je **A/V start-skew** (~0.5–2s), koji se resetuje na svakoj granici → audio i video ne počinju u istoj tački na rezу.
3. **Svaki fajl ima nezavisan PTS** koji počinje ~1.4s (ne nastavlja se na prethodni). Player to "rešava" preko `#EXT-X-DISCONTINUITY`, ali pošto su span i A/V skew promenljivi, reset nije čist.

### 2.4 Dokaz da NIJE od Lumen strane
- `dump_extra -c copy` (Lumen archive-repair cron) **čuva PTS bajt-identično**:
  ```
  orig : start_time=1.400000, duration=59.823667
  fixed: start_time=1.400000, duration=59.823667
  ```
- Lumen seg=0 fix dira samo offset čitanja prvog segmenta, ne sadržaj.
- → Skew/span varijacija dolazi iz **XUI archive writer-a** (komanda koja reže live stream na minutne `.ts` fajlove).

### 2.5 Razdvojeno merenje: container vs video vs audio (2026-06-14, sveži minuti, 4 kanala)
Prethodna tabela (2.2) gledala je samo **video PTS span**. Razdvajanjem na **container / video / audio** vidi se PRAVI koren — **A/V start-skew**:

| kanal | minut | container | **video_span** | **audio_span** | video_start | **audio_start** | **A/V skew** |
|-------|-------|-----------|----------------|----------------|-------------|-----------------|--------------|
| 713 (NOVA S) | 22-52 | 60.124 | 55.720 | 60.047 | 5.764 | 1.400 | **4.364** |
| 530 (NOVA BH) | 22-52 | 60.045 | 58.240 | 59.712 | 3.165 | 1.400 | **1.765** |
| 109 (PRVA) | 22-52 | 60.324 | 58.480 | 59.925 | 3.224 | 1.400 | **1.824** |
| 112 (RTS1) | 22-51 | 60.425 | 58.360 | 59.968 | 3.425 | 1.400 | **2.025** |

Tri ortogonalna nalaza, sva tri deterministička preko kanala:
1. **`container ≈ 60.0–60.4s`** → rez je na **wall-clock** minut (skoro tačno 60s realnog vremena po fajlu).
2. **`audio_start = 1.400s` UVEK** (svaki kanal, svaki minut) → audio kreće na fiksnoj tački.
3. **`video_start` varira `3.2–5.8s`** → video čeka **prvi keyframe** posle reza (GOP ~2s, pa kašnjenje zavisi gde je rez pao u GOP-u).
4. **`video_span ≠ audio_span ≠ container`** → **bilo koji JEDAN `#EXTINF` broj je pogrešan za bar dva od tri toka.** Ovo je razlog zašto Opcija A pogoršava (vidi 4).

→ **Pravi koren = A/V start-skew (1.8s–4.4s) + per-fajl nezavisan PTS.** Svaki minut je zaseban timeline; audio i video u istom fajlu NE počinju u istoj tački, a EXTINF (trajanje segmenta) **ne dira gde audio/video počinju jedan u odnosu na drugog**.

---

## 3. Zašto se dešava (mehanizam)

XUI archive writer (segmenter koji puni `tv_archive/<id>/<Y-m-d:H-M>.ts`) reže na **wall-clock minutnu granicu** (`:00` sekund realnog vremena), a NE na:
- keyframe/GOP granicu (GOP = 2s), niti
- tačno trajanje od 60s sadržaja.

Pošto rez pada na proizvoljnu tačku unutar GOP-a i unutar audio frame-a:
- video poslednjeg GOP-a "viri" preko granice (span >60) ili je odsečen (span <60),
- audio (AAC, 1024 sample/frame @ 48kHz = 21.3ms/frame) se ne poklapa sa video rezom,
- sledeći fajl počinje sa svojim PTS-om od ~1.4s, pa player na DISCONTINUITY ne može tačno da poveže kraj prethodnog sa početkom sledećeg.

Rezultat na klijentu: **na svakoj minutnoj granici audio prethodnog i novog minuta se preklope (~0.5–2s), video preskoči da nadoknadi.**

---

## 4. Predlozi rešenja (za XUI dev-a)

### ❌ Opcija A — stvaran `#EXTINF` po segmentu — PROBANA I ODBAČENA (2026-06-14)
Lumen je implementirao ovo na glavnom `timeshift.php` na `.121` (helper koji upisuje `format=duration` u EXTINF po segmentu, keširan u `.dur` sidecar).

**Rezultat: REGRESIJA, odmah rollback-ovana.** Sa različitim "preciznim ali pogrešnim" EXTINF vrednostima po segmentu, MSE na svakom segmentu **pogrešno pozicionira audio timeline** → **kumulativni audio drift → non-stop preskakanje + totalni desync** (slika ide svojim tokom, audio svojim). Gore nego fiksni `60`.

**Zašto:** `format=duration` = container span, ali to nije ni `video_span` ni `audio_span` (vidi 2.5). EXTINF govori playeru koliko segment **traje**, ali NE dira **gde audio i video počinju jedan u odnosu na drugog** (A/V skew). Pošto je pravi koren A/V skew + per-fajl PTS reset, EXTINF ne može da ga popravi — samo ga može pogoršati dajući MSE-u "tačnije" pogrešne brojeve da akumulira.

→ **Ne idi ovim putem.** Fiksni `#EXTINF:60` je vraćen i ostaje (`.121` stanje potvrđeno: bez `.dur` keša, bez `ffprobe`/`duration` poziva u php-u, seg=0 fix netaknut).

### ⚠️ Opcija B — reži snimak na keyframe/GOP granicu umesto wall-clock
Archive writer da zatvara minutni fajl **na prvom keyframe-u posle `:00`** umesto tačno na `:00`.
- Tada svaki fajl počinje keyframe-om (`video_start` ≈ `audio_start`, skew nestaje), granice GOP-poravnate, bonus: pomaže i originalni dead-zone.
- Mana: dira se snimanje (ionCube `tools/archive.php`) — rizično, i fajlovi nisu tačno 60s. Najinvazivnije.

### ✅ Opcija D (PREPORUKA) — usmeri catch-up na `timeshift_shadow.php` (remux koji već postoji)
`timeshift_shadow.php` na `.121` **već radi pravi remux koji normalizuje A/V**: fMP4 (`-hls_time`, `#EXT-X-DISCONTINUITY`), poravna audio i video na isti početni PTS po programu, kontinuirani timestampi. To je tačno ono što fali glavnom `timeshift.php` (koji je čist `fopen`+`fseek` passthrough, BEZ remuxa — ne može da popravi A/V skew bez remuxa, a remux sirovih bajtova ručno u obfuskovanom PHP-u je rizično i skupo).

Shadow trenutno servira **gotovo nikoga** (~2.000 hitova vs ~8.000.000 na glavni `timeshift.php`). Predlog: shadow ruta postane glavni catch-up put (bar za web/MSE playere koji to traže).

**Ali — Filipova tvrda ograda: ovo NE sme da poždere resurse servera.** `.121` već drži **98 ffmpeg live segmentera** (load ~2–5). Remux po catch-up zahtevu je dodatni ffmpeg posao. Zato pre prebacivanja moramo da znamo da je održivo.

**Lumen merenja shadow-a na `.121` (2026-06-14, da kontekstualizuju pitanja):**
- Shadow **kešira** generisani HLS: `owGenerateHls(...)` → `cacheDir = /tmp/catchup_shadow_hls`, jedan ffmpeg poziv **po programu** (ne po segmentu), lock-stampede zaštita (`filemtime($lock) < 300` → čeka umesto paralelnog remuxa istog programa). **Dobro.**
- **ALI keš je na `/tmp` = tmpfs (RAM):** trenutno **1.2GB** u jednom program-folderu od **11.6.** (3 dana star, još tu) → **nema TTL/eviction po vremenu**. Na skali (svi korisnici) to je glavni resursni rizik — RAM, ne CPU.
- `/tmp/catchup_shadow_hls` i seg fajlovi (`seg_%05d.ts`/`.m4s`) idu u tmpfs.

**Pitanja za XUI dev-a (Opcija D):**
1. **Koliko je shadow remux skup po zahtevu** (CPU-sek/RAM po programu), i kako keš radi — koji je TTL/eviction? (Vidim da keširani folder od 11.6. još stoji 3 dana = curi na tmpfs.)
2. **Da li shadow može da podnese pun produkcioni catch-up saobraćaj** na `.121` (+`.102`) **bez ugrožavanja 98 live segmentera?** Konkretno: keš na `/tmp` (tmpfs/RAM) sa 1.2GB po programu × N istovremenih programa — da li treba premestiti keš na disk i dodati eviction (npr. LRU, max-size, TTL)?
3. **Ako jeste održivo uz keš** — koja je čista tačka prebacivanja: nginx rewrite glavnog `/timeshift/` na shadow, ili da glavni `timeshift.php` interno delegira na shadow za `m3u8`?

**Ako resursno NIJE održivo za sve korisnike:** alternativa je da ostane kako je sada (seg=0 fix → čist početak; blagi overlap na granici ostaje, ali **bez desync-a**), pa shadow ruta **samo za web/MSE playere** koji je eksplicitno traže (npr. preko zasebnog query param / user-agent grananja).

---

## 5. Kako reprodukovati (za XUI dev-a)

Na `.121`, izmeri span vs EXTINF za bilo koji repariran kanal:
```bash
FP=/usr/local/bin/ffprobe
d=/home/xtreamcodes/iptv_xtream_codes/tv_archive/530
for M in 16-00 16-01 16-02 16-03 16-04; do
  f="$d/2026-06-14:$M.ts"
  vspan=$($FP -v error -select_streams v -show_entries packet=pts_time -of csv=p=0 "$f" \
    | awk 'NR==1{a=$1}{b=$1}END{printf "%.3f", b-a}')
  astart=$($FP -v error -select_streams a -show_entries packet=pts_time -of csv=p=0 "$f" | head -1)
  echo "$M  video_span=$vspan  audio_start=$astart  (manifest claims EXTINF:60)"
done
```
Span ≠ 60 i audio_start ≠ video_start = dokaz drift-a.

Klijentski (kroz player): pusti bilo koji catch-up program, pusti da playhead pređe ~60s; na granici se čuje audio preklop (currentTime ostaje gladak — problem je u sadržaju, ne u timeline-u).

---

## 6. Trenutni status (kontekst)

| sloj | status |
|------|--------|
| seg=0 dead-zone (`fseek *0.3`) | ✅ REŠEN (tvoj fix, prod `.121`+`.102`) |
| telo arhivskog fajla (SPS na bajtu 0) | ✅ Lumen archive-repair cron na `.121` (radi, ~158 repaired/tick) |
| stvaran `#EXTINF` po segmentu (Opcija A) | ❌ PROBANO → REGRESIJA → rollback. Fiksni `60` vraćen. Ne ići ovim putem. |
| **granica minuta (A/V skew + per-fajl PTS)** | ⚠️ **OVO — preostali bug.** Rešenje = remux koji normalizuje A/V (Opcija D = shadow, ili B = keyframe rez). |

**Glavno pitanje za XUI dev-a:** da li `timeshift_shadow.php` (koji već radi A/V-normalizujući remux) može da preuzme produkcioni catch-up saobraćaj bez ugrožavanja resursa (vidi 3 pitanja u Opciji D)? Ako ne — ostaje status quo (čist početak, blagi overlap na granici, bez desync-a) + shadow samo za web/MSE playere na zahtev.

**Stanje `.121` posle Opcija-A eksperimenta (potvrđeno 2026-06-14):** rollback čist — `timeshift.php`: `*0.3`=0 (seg=0 fix ostao), `EXTINF`/`duration`/`ffprobe`=0 (helper uklonjen), `php -l` čist, 0 `.dur` keš fajlova. Bez desync-a. `timeshift_shadow.php` netaknut (plaintext, `php -l` čist).
