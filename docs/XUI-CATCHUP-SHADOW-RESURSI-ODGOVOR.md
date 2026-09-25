# Catch-up shadow — odgovor XUI dev-a Lumen timu (200 + resursi)

**Datum:** 2026-06-15
**Server:** `ns3239635` (`edge6.castcdn.net`, `79.137.99.121:8722`), Ubuntu 22.04.5
**Povod:** vaš dokument `XUI-CATCHUP-TOKEN-ROUTING-ANSWER.md` — tražite (1) potvrdu da shadow vraća 200 na token-poziv sa geoip fix-om, (2) odgovor na resurse (tmpfs/RAM, eviction, cena remuxa).

> **TL;DR:** (1) **Shadow ne vraća više 500** — geoip guard je primenjen i potvrđen; poslednji realni token-poziv (stream=112) prošao je ceo lanac do isporuke manifesta. (2) **Glavna premisa o resursima ne važi na ovom serveru:** keš **NIJE na RAM/tmpfs** — `/tmp` je na ext4 disku (878G, 323G slobodno). Eviction **već postoji** u kodu (age-based GC 7200s + cap 4 build-a). Baseline opterećenje je trivijalno (100 segmentera = ~0.8% od kapaciteta CPU-a). **Zelena za uključivanje `edge6` iz vaše strane** — uz jednu sitnicu (stari keš dir, dole). Sve provere read-only, ništa nije menjano.

---

## 1. Shadow vraća 200 (geoip fix radi) ✅

**Geoip guard je primenjen i prisutan** u `timeshift_shadow.php` (mtime 14.6 22:11, `php -l` čist, backup `.bak.catchup-shadow-geoip` od 8.6):

```php
// lin 305-314, shadowGetGeoCountryCode()
/* xc-shadow-geoip-guard */
try {
    $geo = new geoip(GEOIP2_FILENAME);
    $method = STREAM_METHOD_GEO_LOOKUP;
    $data = $geo->$method($ipAddress);
    ...
} catch (\Throwable $e) {
    return '';   // best-effort: prazan country ako mmdb fali/pukne, kao glavni clients_live.php
}
```

**Dokaz iz shadow loga (`/tmp/catchup_shadow.log`):**
- `geo=BZ` → `auth ok` → `channel check ok` → `archive ok files=68` → `shadow build profile=mp4` → **`manifest serve stream=112 source=live format=mp4`** (stream=112, RTS1, token=1). To je uspešna isporuka m3u8 manifesta = HTTP 200.
- `geo=` (prazno) → prolazi bez fatal-a (završava na app-nivou `auth failed` za token=0 `testuser`, što je normalno odbijanje, **ne 500**).
- **0 pojava `500`/uncaught/fatal** u celom logu od kad je fix primenjen.

**Napomena o preciznosti (da ne bude nesporazuma):** log ne ispisuje doslovno "HTTP 200" — `manifest serve` je naš aplikacioni marker da je manifest sastavljen i isporučen. Pre fix-a, isti put bi pukao na `new geoip()` pre nego što uopšte stigne do `auth`. Ako želite tvrdi HTTP-statusni dokaz, pošaljite nam **jedan realan token aktivnog naloga** (ne `testuser`) i odmah ćemo vam vratiti `curl -sI` izlaz sa `200` + `Content-Type: application/vnd.apple.mpegurl`. Trenutno u access logu nema svežih realnih token-poziva (rotiran), pa nemamo živ token za reprodukciju.

→ **Sa naše strane: zeleno za 200.** `edge6.castcdn.net` možete uključiti iz Lumen liste — uz resursnu napomenu dole (koja je manja nego što ste mislili).

---

## 2. Resursi — vaša glavna premisa NE važi na ovom serveru

Vaš dokument kaže: *"keš je na RAM (tmpfs), 1.2GB/program, bez eviction, ~100 live segmentera."* Tri od četiri dela toga ne stoje na `.121`:

### 2a. Keš NIJE na RAM/tmpfs — na DISKU je ✅ (verifikovano)

```
$ df -hT /tmp
/dev/md3  ext4  878G  510G  323G  62%  /
$ mount | grep -E ' /tmp | / '
/dev/md3 on / type ext4 (rw,relatime,stripe=32)   # /tmp NIJE zaseban mount → nasleđuje root ext4
```

`SHADOW_CACHE_ROOT = '/tmp/catchup_shadow_hls/'` (lin 14) leži na `/dev/md3` ext4 disku, **ne na RAM-u**. (Verovatno ste pretpostavili tmpfs jer je to default na Ubuntu 24 — ali edge6 je 22.04 i `/tmp` mu je na root disku.) Server ima **323 GB slobodno** na tom disku. Premisa "ugrožava RAM ~100 segmentera" otpada — keš i RAM su razdvojeni.

RAM stanje radi potpunosti: **125 GB total, ~104 GB available**, 0 swap. Ogroman headroom svejedno.

### 2b. Eviction VEĆ postoji u kodu ✅ (verifikovano)

Hardening koji ste sami dodali (8.6) je na serveru i radi:

```php
define('SHADOW_MAX_CONCURRENT_BUILDS', 4);   // lin 19 — cap na NOVE transcode build-ove
define('SHADOW_CACHE_GC_MAX_AGE', 7200);     // lin 20 — briše stale build dir-ove > 2h
define('SHADOW_CACHE_GC_PROBABILITY', 25);   // lin 21 — GC na ~1/25 zahteva
```

- `shadowMaybeGarbageCollect()` (lin 198): age-based brisanje dir-ova `(now - mtime) > 7200s`, okida se sampled 1/25 zahteva.
- per-build rebuild ako je `playlist.m3u8` stariji od **300s** (svež remux, ne servira ustajao keš).
- concurrency cap: ako je `shadowActiveBuildCount() >= 4` → **`503 Service Unavailable` + `Retry-After: 5`** (lin 1410-1413), tj. novi build-ovi se odbijaju umesto da preopterete CPU. Cache-hit-ovi i lock-wait-ovi nisu pogođeni.

Dakle eviction koji ste tražili je tu — **age-based**, ne LRU/max-size, ali postoji. Nije potreban nov kod za TTL.

### 2c. Cena remuxa / baseline CPU — trivijalno (uz jednu kvalifikaciju)

```
nproc = 16            # kapacitet = 1600% CPU
ffmpeg suma %CPU = 13 # 100 live segmentera UKUPNO troše ~13% (≈0.8 jezgra)
load avg = 1.2 / 1.7 / 2.3 na 16 jezgara, 89% idle
```

Live segmenteri su **`-c copy` remux** (args: `-vcodec copy -acodec copy -f segment`), **ne transkod** — zato 100 njih jedva nešto troši. Headroom za shadow je ogroman.

**Poštena ograda (da ne preuveličamo):** shadow remux build (mp4/aac stitch) JESTE skuplji od `-c copy` live segmentera — radi pravi audio re-enkod. Ali zbog cap-a od **max 4 paralelna build-a**, čak i u najgorem slučaju 4 transkod-grade build-a dele preostalih ~98% kapaciteta CPU-a; to je **procena iz baseline-a, nije izmereno pod realnim catch-up opterećenjem** (u trenutku merenja nije bilo aktivnih build-ova). Kad uključite `edge6`, izmerićemo stvarnu cenu po build-u (CPU-sek + trajanje) i javiti — ali sve ukazuje da 4-cap drži live netaknutim.

---

## 3. Jedina realna sitnica — stari keš dir (lako)

Na disku stoji **1 keš dir od 1.2 GB** (`live_v9_112_1780945200_68`, gradio se 11.6 u 14:37). GC ga nije obrisao jer 4 dana **nije bilo nijednog shadow zahteva** da okine sampled GC (1/25). To NIJE leak u logici — čim shadow primi saobraćaj, prvi-svaki-25. zahtev pokrene GC i obriše sve > 2h. Ali u "shadow miruje" periodu, stari dir-ovi ostaju neograničeno.

**Opcije (na vašu/Filipovu odluku, nisu blocker):**
- (a) **ne dirati** — čim uključite edge6, GC se sam aktivira; 1.2 GB na 323 GB slobodno je zanemarljivo.
- (b) **lagan cron** (kao `xtreamcodes`, svakih 15 min): `find /tmp/catchup_shadow_hls -maxdepth 1 -type d -mmin +120 -exec rm -rf {} +` — GC nezavisan od saobraćaja. Mogu da ga dodam u deploy + napišem kao patch ako želite garanciju da disk nikad ne raste dok shadow miruje.

---

## 4. Sažeto — odgovor na vaše 3 tačke

| vaše pitanje | naš nalaz |
|---|---|
| **shadow vraća 200?** | **Da** — geoip guard primenjen, 0× 500 u logu, stream=112 prošao do `manifest serve`. Za tvrdi HTTP-200 curl pošaljite jedan realan token. |
| **keš na RAM (tmpfs)?** | **Ne** — ext4 disk, 323 GB slobodno. Premisa o RAM-u ne važi na .121. |
| **eviction?** | **Već postoji** — age-based GC 7200s (1/25) + rebuild 300s + cap 4 (503). Nije LRU ali drži /tmp. |
| **cena remuxa / ugrožava ~100 segmentera?** | Baseline trivijalan (13% od 1600%, segmenteri su `-c copy`). Build cap=4 drži live; stvarnu cenu po build-u izmerićemo čim uključite edge6. |
| **resursna ZELENA?** | **Da, sa naše strane** — uključite `edge6.castcdn.net` per-host. Stari 1.2 GB keš dir je sitnica (opcioni cron 3b). |

**Sledeći korak:** uključite `edge6` iz Lumen-a (per-host, kako ste i predvideli). Mi pratimo `/tmp/catchup_shadow.log` + CPU/disk pod prvim realnim saobraćajem i javljamo izmerenu cenu remuxa po build-u. Ako želite garanciju protiv rasta diska dok shadow miruje — recite i dodajemo GC cron (3b).
