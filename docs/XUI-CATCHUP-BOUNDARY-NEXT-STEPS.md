# Catch-up granica minuta — sledeći korak (za XUI dev-a)

**Datum:** 2026-06-14 (b)
**Server:** `ns3239635` (= `edge6.castcdn.net`, `79.137.99.121`, SSH port `8722`)
**Autor:** Lumen tim
**Prethodno:** `XUI-CATCHUP-SEG0-FSEEK-FIX-REPORT.md` (tvoj seg=0 fix — radi) + `XUI-CATCHUP-SEGMENT-BOUNDARY-DRIFT.md` (puna analiza preostalog buga + merenja).

> **TL;DR za žurbu:** seg=0 fix radi → početak catch-up programa je čist. Ostao je blagi audio overlap **na svakoj granici minuta**. Probali smo Opciju A (stvaran `#EXTINF`) — **pogoršala, rollback-ovana.** Pravi koren je **A/V skew + per-fajl PTS reset**, što se rešava SAMO remuxom. Tvoj `timeshift_shadow.php` **već radi taj remux.** Pitanje je samo: **može li shadow da preuzme sav catch-up bez da pojede RAM servera?** Treba nam tvoja procena + (verovatno) keš na disk umesto na `/tmp` (RAM) + eviction.

---

## 1. Šta je rešeno, šta je ostalo

| sloj | status |
|------|--------|
| seg=0 dead-zone (`fseek *0.3 → 0`) | ✅ tvoj fix radi — čist početak |
| telo arhivskog fajla (SPS na bajtu 0) | ✅ Lumen cron na `.121` |
| **granica minuta (audio overlap na ~0:59)** | ⚠️ **ostalo — ovaj dokument** |

---

## 2. Šta NE radi (i ne pokušavaj ponovo)

**Opcija A — stvaran `#EXTINF` po segmentu — PROBANA, ODBAČENA.**

Stavili smo `format=duration` (container span) u EXTINF po segmentu na glavnom `timeshift.php`. Rezultat: **regresija — kumulativni audio drift → totalni desync** (slika i zvuk svaki svojim tokom). **Odmah rollback-ovano.** Stanje `.121` je sada vraćeno: fiksni `#EXTINF:60`, seg=0 fix ostaje, bez `.dur` keša, bez desync-a.

**Zašto A ne može da radi:** EXTINF govori koliko segment **traje**, ali ne dira **gde audio i video počinju jedan u odnosu na drugog**. Merenje na 4 kanala (`.121`, 2026-06-14):

| kanal | container | video_span | audio_span | video_start | **audio_start** | **A/V skew** |
|-------|-----------|------------|------------|-------------|-----------------|--------------|
| 713 | 60.124 | 55.720 | 60.047 | 5.764 | 1.400 | **4.364** |
| 530 | 60.045 | 58.240 | 59.712 | 3.165 | 1.400 | **1.765** |
| 109 | 60.324 | 58.480 | 59.925 | 3.224 | 1.400 | **1.824** |
| 112 | 60.425 | 58.360 | 59.968 | 3.425 | 1.400 | **2.025** |

- `audio_start = 1.400s` **uvek**, `video_start = 3.2–5.8s` (čeka prvi keyframe posle wall-clock reza).
- `video_span ≠ audio_span ≠ container` → **bilo koji jedan EXTINF broj je pogrešan za bar 2 od 3 toka.**
- Pravi koren = **A/V start-skew (1.8–4.4s) + svaki minutni fajl je nezavisan timeline.** To EXTINF ne dira → ne rešava, samo pogoršava.

---

## 3. Predlog: usmeri catch-up na `timeshift_shadow.php` (Opcija D)

`timeshift_shadow.php` na `.121` **već radi pravi remux koji normalizuje A/V**: fMP4, `-hls_time`, `#EXT-X-DISCONTINUITY`, poravna audio i video na isti početni PTS po programu, kontinuirani timestampi. **To je tačno ono što fali** glavnom `timeshift.php` (čist `fopen`+`fseek` passthrough, bez ffmpeg — ne može da popravi A/V skew bez remuxa).

Shadow trenutno servira **gotovo nikoga** (~2.000 hitova vs ~8.000.000 na glavni `timeshift.php`).

### ⚠️ ALI — pre nego što ga uključimo za sve, moramo da rešimo resurse

**Tvrda ograda vlasnika: ovo NE sme da optereti CPU/RAM/HDD servera.** `.121` već drži **98 live ffmpeg segmentera** (load ~2–5). Šta smo izmerili na shadow-u:

- ✅ **CPU verovatno OK:** remux je `-c copy` (bez transkoda), jedan ffmpeg **po programu** (ne po segmentu), ima lock-stampede zaštitu (`filemtime($lock) < 300` → ne pokreće paralelni remux istog programa).
- 🔴 **RAM je rizik:** keš ide na **`/tmp` = tmpfs (RAM)**. Trenutno **1.2GB za JEDAN program** (`/tmp/catchup_shadow_hls/live_v9_112_...`), folder od **11.6. još stoji 14.6.** → **nema TTL/eviction**. Na skali (N istovremenih programa × ~1GB u RAM) → rizik od OOM → može da obori i live segmentere.
- HDD: trenutno nula (sve na tmpfs).

**Zato Opcija D nije „uključi i gotovo". Uslovljena je da prvo dodaš: keš na DISK umesto `/tmp` (RAM) + eviction (TTL ili max-size/LRU).** Bez toga D pojede RAM.

### Pitanja za tebe (ovo nam treba da odlučimo)

1. **Koliko je shadow remux skup po zahtevu** (CPU-sek + RAM po programu)? Kako keš radi — koji je TTL/eviction? (Vidimo folder od 11.6. još stoji = curi na tmpfs.)
2. **Može li shadow da podnese pun produkcioni catch-up saobraćaj** na `.121` (i `.102`) **bez ugrožavanja 98 live segmentera?** Konkretno: treba li keš premestiti sa `/tmp` (RAM) na disk i dodati eviction (LRU / max-size / TTL)?
3. **Ako jeste održivo uz keš** — koja je čista tačka prebacivanja: nginx rewrite glavnog `/timeshift/` na shadow, ili da glavni `timeshift.php` interno delegira na shadow za `m3u8`?

---

## 4. Ako shadow NIJE održiv za sve

Dve alternative:

- **(D-uslovni) shadow samo za web/MSE playere** koji ga eksplicitno traže (zaseban query param / user-agent grananje). Native/TV idu starim putem (gde overlap manje smeta), web dobija čist remux. Manje opterećenje (samo deo saobraćaja).
- **(status quo) ostavi kako je sada:** seg=0 fix → čist početak; blagi overlap na granici ostaje, ali **bez desync-a** — gledljivo. Najjeftinije, ništa ne menjamo.

**Alternativa B (rez na keyframe granicu umesto wall-clock u archive writer-u)** takođe rešava koren, ali dira ionCube `tools/archive.php` (rizičnije) i ne pomaže 7-dnevni backlog. Razmatraj samo ako shadow otpadne.

---

## 5. Stanje `.121` sada (verifikovano 2026-06-14 b)

Rollback Opcije A je čist:
- `timeshift.php`: `*0.3`=0 (seg=0 fix ostao), `EXTINF`/`duration`/`ffprobe`/`.dur`=0 (helper uklonjen), `php -l` čist.
- `timeshift_shadow.php`: netaknut, plaintext, `php -l` čist.
- Bez desync-a. Korisnik može da gleda; ostao samo blagi overlap na granici.

---

## 6. Šta tražimo od tebe (sažeto)

1. Odgovori na 3 pitanja iz sekcije 3 (cena remuxa, održivost na skali, tačka prebacivanja).
2. Ako je održivo: dodaj keš-na-disk + eviction, pa uključi shadow rutu (za sve, ili samo web).
3. Ako nije: kažeš nam, ostajemo na status quo + shadow samo za web playere na zahtev.

Mi sa Lumen strane **ne diramo server dalje** dok ne kažeš — čekamo tvoju procenu resursa.
