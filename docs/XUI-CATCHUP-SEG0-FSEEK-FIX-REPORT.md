# Catch-up `seg=0` dead-zone — rešeno na XUI strani (izveštaj)

**Datum:** 2026-06-14
**Autor analize/fix-a:** Claude (XUI dev strana)
**Povod:** `XUI-CATCHUP-SEG0-FSEEK-DEADZONE.md` (Lumen tim) — catch-up "muca pa krene"
na samom početku programa u web (MSE/hls.js) playeru.
**Status:** **REŠENO.** Fix primenjen na nove instalacije (`deploy.sh` korak 4c) i na
oba živa prod snimajuća servera (`.121` edge6 + `.102` NYC). Na `.121` dokazano 0 grešaka.

---

## TL;DR

1. Lumen je tačno opisao **simptom** (`seg=0` dead-zone, mid-GOP ulaz bez SPS/PPS) ali je
   pogrešno pretpostavio **uzrok** ("server fseek-uje da poravna na program-start sekund").
2. **Pravi uzrok (dokazan de-goto + merenjem):** XtreamUI `timeshift.php` za prvi catch-up
   segment radi `fseek` na **`filesize * 0.3`** — fiksnih **30%** u prvi minutni fajl.
   Lumenov broj `8551556 / 28505124` = **tačno 0.3** na bajt.
3. **Fix (= Lumenova Opcija A):** zameni jedinstveni izraz `* 0.3` → `* 0` → `seg=0` ide od
   offseta 0 (nosi SPS/PPS). Dira ISKLJUČIVO `seg=0` (zbog `if($idx==0)` grananja u kodu).
4. Primenjeno: nove instalacije (deploy korak 4c) + prod `.121` (PRE=60 → **POSLE=0 grešaka**)
   + prod `.102`.
5. **Napomena za `.102`:** nema Lumen archive-repair cron → telo fajla nije re-muxirano →
   za 0 grešaka kao na `.121` treba mu isti cron (Lumenova infra).

---

## 1. Forenzika — kako sam našao uzrok

### 1.1 Tri verzije `timeshift.php` u igri
- `Xtream Decoded/.../timeshift_CLEAN.php` — idealizovana rekonstrukcija (servira ceo minut
  od offseta 0). **NIJE ono što radi na prod-u.**
- `Xtream Decoded/.../xtream-codes-decoded/.../timeshift.php` — verzija sa "HLS REMUX" blokom
  (ffmpeg concat). **Takođe NIJE na prod-u** (neki raniji eksperiment).
- **Živi prod `timeshift.php`** (`md5 8dd36b0a...`, 62676 B) — čisti goto-obfuskovani XC
  original, `fseek`+`stream_get_line` passthrough, **bez** ffmpeg/remuxa. **Ovo radi na prod-u.**

Da ne nagađam, povukao sam **živi** fajl sa `.121`, dekodirao hex/octal string literale i
de-gotovao seg-serving petlju.

### 1.2 De-gotovan kontrolni tok (seg-serving put `?token=<redacted>&seg=N_filesize.ts`)

```php
// validacija seg-a (filename postoji && filesize match), pa:
$offset     = 0;                          // label C4a362d7 — bazni offset za SVE segmente
$contentlen = $file["filesize"];
if ($idx != 0) {                          // label B144a1df @634
    // seg>=1: preskoči, offset OSTAJE 0  ->  fseek(fp, 0)  ->  ceo fajl (ČISTO)
} else {
    // SAMO seg==0:
    $offset     = $file["filesize"] * 0.3;     // label dedd9c4 @567  <<< BUG (fseek na 30%)
    $contentlen = $file["filesize"] - $offset; // label F06b178e @680
}
header("Content-Type: video/mp2t");
header("Content-Length: $contentlen");
$fp = fopen($file["filename"], "r");
fseek($fp, $offset);                      // label b8161a76 @628 — 0 za seg>=1, filesize*0.3 za seg=0
while (!feof($fp)) echo stream_get_line($fp, read_buffer_size);
```

**Potvrđeno čitanjem koda (confidence: high):**
- `*0.3` se izvršava **samo za `seg=0`** (eksplicitno `if($idx==0)` grananje). `seg≥1` ide od 0.
  → Lumen je tu bio u pravu.
- Seg-serving put **NE koristi HTTP_RANGE** (oba `HTTP_RANGE` su u zasebnoj `default:` VOD grani).
  → Moj fix ne dira VOD/Range put.
- `8551556 / 28505124 = 0.3` (Lumenov broj) = tačno ovaj izraz.

### 1.3 Live merenje na `.121` (read-only)

| fajl (repariran cronom) | decode od offseta 0 | decode od `*0.3` offseta |
|-------------------------|---------------------|--------------------------|
| `530/…21-00`            | **0**               | **62**                   |
| `…20-55`                | 0                   | 50                       |
| `…20-57`                | 0                   | 26                       |
| `…21-02`                | 0                   | 50                       |
| `…21-04`                | 0                   | 69                       |

NAL scan `seg=0` od `*0.3` offseta: `SPS@None, IDR@None`, prvi slice @3671, prvi PPS tek
@128790 → **slice prethodi svakom SPS-u = dead-zone potvrđen**.

---

## 2. Fix

**Zameni jedinstveni `* 0.3` → `* 0`.** Pošto je u grani koja se izvršava samo za `seg=0`,
dira isključivo prvi segment; `seg≥1` ni ne dolazi do te linije.

- = Lumenova **Opcija A** (serviraj `seg=0` od offseta 0), bez remuxa/keyframe-indeksiranja.
- `* 0.3` je **plain ASCII** (samo `"filesize"` ključ je hex-enkodiran), pojavljuje se **tačno
  1×** u celom fajlu (i `0.3` 1× ukupno) → jednoznačna zamena, bez char-po-char escape matchinga.
- **Nuspojava:** korisnik vidi do ~18s "viška" na samom početku programa (tih ~18s = 30%
  minuta XC je preskakao kao lead-in). Za catch-up "od početka" bezopasno.
- `main.tar.gz` timeshift.php ima **identičan** bug (druga obfuskacija, ista logika).

---

## 3. Deliverable za nove instalacije

`ubuntu24-build/patches/catchup-seg0/`:

| fajl | uloga |
|------|-------|
| `patch_timeshift_seg0.py` | idempotentan patcher; `.bak.catchup-seg0`; fail-safe na **tačno 1** pojavu; exit `0`=ok/već, `10`=treba (--check), `1`=greška |
| `apply.sh` | wrapper: poziva patcher, radi `php -l` (vraća backup ako padne), `chown xtreamcodes` |
| `README.md` | forenzika + obrazloženje + verifikacija + rollback |

**Integracija u `deploy.sh` — korak 4c** (posle 4b stream.php SPS/PPS, pre 5 v22f):

```bash
step "4c. Catch-up seg=0 dead-zone fix (timeshift.php fseek *0.3 -> 0)"
bash "$BUILD/patches/catchup-seg0/apply.sh" \
  "$XC/wwwdir/streaming/timeshift.php" || echo "[!] timeshift seg=0 patch preskočen (proveri ručno)"
```

Pozicija je bezbedna: v22f (korak 5) **ne sadrži** `wwwdir/streaming/` pa ne gazi ovaj fajl
(provereno). Role-agnostično (MAIN i LB).

**Lokalna verifikacija:** `bash -n` čist (apply.sh + deploy.sh), patcher primenjen na obe
verzije (prod + main.tar), `php -l` čist, idempotentan, promena = -4 B (".3" uklonjeno).

---

## 4. Primena na produkciju (po odobrenju korisnika — oba servera)

### `.121` edge6 (`ns3239635`, 79.137.99.121)
- `apply.sh` → backup `timeshift.php.bak.catchup-seg0`, `php -l` čist, `chown xtreamcodes`.
- **Bez restarta servisa:** OPcache `validate_timestamps=On`, `revalidate_freq=20` →
  fajl se auto-reload-uje po mtime za ≤20s. (Izbegnut nepotreban prod restart.)
- **DOKAZ kroz disk na repariranom fajlu (`713/16-32`): seg=0 PRE(*0.3)=60 → POSLE(0)=0 grešaka.**
- php-fpm master = `xtreamcodes` (XC jezgro fix netaknuto).

### `.102` NYC (`nycdedi.exedata.net`, 66.45.243.102)
- `apply.sh` → backup, `php -l` čist, `chown xtreamcodes`. Isti OPcache auto-reload.
- **UPOZORENJE:** `.102` **nema Lumen archive-repair cron** (`/opt/lumen` ne postoji — on je
  samo na `.121`). Ima dump_extra na `stream.php` (SPS u toku), ali bez crona telo fajla nije
  re-muxirano da SPS bude na bajtu 0 → snimak počinje mid-GOP.
- Zato su `.102` seg=0 brojke od offseta 0 **MEŠANE** (neki kanali 0–6, neki 90–248 grešaka).
  Fix je i dalje **ispravan** (ulazak na 30% je nedvosmisleno gori), ali za **0 grešaka kao na
  `.121`** `.102` treba isti Lumen cron.

| `.102` stream | filesize | PRE (*0.3) | POSLE (0) |
|---------------|----------|------------|-----------|
| 30240 | 151 MB | 200 | **5** |
| 29085 | 16 MB | 48 | **0** |
| 39930 | 22 MB | 60 | **6** |
| 29102 | 19 MB | 80 | 248 |
| 29090 | 19 MB | 85 | 188 |

→ Bez Lumen crona telo nije čisto na bajtu 0, pa offset 0 nije uvek savršen. **Preporuka:
prekopirati `/opt/lumen/` archive-repair cron i na `.102`** (Lumenova infra — nije postavljano
bez dogovora).

---

## 5. Tri komplementarna sloja (mentalni model)

Za potpuno čist web catch-up potrebna su sva tri:

| sloj | šta radi | gde |
|------|----------|-----|
| `dump_extra` na `stream.php` | SPS/PPS u bitstream pred svakim keyframe-om (SPS **u toku**) | `patches/catchup-spspps/` — prod oba |
| Lumen archive-repair cron | re-mux telo da SPS bude na **bajtu 0** | `/opt/lumen/` — **samo .121** |
| **seg=0 fseek fix (OVO)** | prvi segment kreće od **bajta 0** umesto 30% | `patches/catchup-seg0/` — prod oba + deploy 4c |

---

## 6. Rollback

Oba servera:
```bash
cp /home/xtreamcodes/iptv_xtream_codes/wwwdir/streaming/timeshift.php.bak.catchup-seg0 \
   /home/xtreamcodes/iptv_xtream_codes/wwwdir/streaming/timeshift.php
# OPcache pokupi za ≤20s; restart nije nužan.
```
Patcher + apply na prod-u: `/root/catchup-seg0/`.

---

## 7. Verifikacija (kako proveriti da radi)

```bash
# 1. izvor više nema *0.3 (treba 0):
grep -c '\* 0\.3' /home/xtreamcodes/iptv_xtream_codes/wwwdir/streaming/timeshift.php
# 2. php sintaksa čista:
/home/xtreamcodes/iptv_xtream_codes/php/bin/php -l .../timeshift.php
# 3. pravi test: seg=0 iz manifesta, decode mora dati 0 grešaka (kao seg=1):
#    curl <seg=0 url> -o seg0.ts; ffmpeg -v error -i seg0.ts -t 2 -f null -   # 0 grešaka
```

---

## 8. Šta od Lumenovog dokumenta treba korigovati

- **Opcija A je usvojena** i bila je tačna preporuka.
- **Koren NIJE "seek na program-start sekund"** — to je hardkodiran `filesize * 0.3`.
  fseek offset se NE računa iz `start` parametra; uvek je 30% prvog minutnog fajla.
- **Opcija B (fseek na keyframe granicu) i C (remux) nisu potrebne** — Opcija A pokriva sve.
- **Opcija D (klijentski head-skip) sada može da radi:** kad `seg=0` kreće od bajta 0 i telo je
  čisto (Lumen cron), dead-zone je nula; `startOnSegmentBoundary` ima na šta da se snap-uje.
