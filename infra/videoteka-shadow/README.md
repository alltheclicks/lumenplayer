# Videoteka Catch-up Shadow (MP2→AAC) — Lumen

Server-side fix za kanale čiji audio browser (MSE/HLS.js) ne dekoduje — pre svega
**MP2**. Rešenje transkoduje **samo audio** (`-c:a aac`), video ostaje `copy`.
Izolovano je: zaseban endpoint (`timeshift_shadow.php`), zaseban storage/cache,
**ne dira originalni `timeshift.php` ni jednog ne-Lumen klijenta**.

> Kontekst i merenja: vidi `docs/RELEASE-PLAN-MVP-BETA-FINAL.md` (task **M1.6**) i
> memoriju `videoteka-servers-timeshift-shadow.md`. MP2/no-media konflikt:
> `mp2-audio-no-media-conflict.md`.

## ⚠️ Stanje na produkciji (verifikovano 2026-06-08)

Na glavnom recording serveru **`ns3239635` / ovh-videoteka** (Tailscale `100.64.1.34`)
već postoji **`SHADOW_BUILD_VERSION='v9'`** shadow (1863 lin) — naprednija verzija od
ranog baseline-a sa `mainssl`. v9 **već radi MP2→AAC transcode** (isti pristup:
`-c:a aac -profile:a aac_low -b:a 128k -ac 2 -ar 48000`, video `-c:v copy`) + ima
MP4 lead-gap fix i napredni token/IP hashing. Routovan je u nginx-u (port 8080), ali
**ne prima živi saobraćaj od 13. maja 2026** (poslednji test; Lumen prod klijent ga
trenutno ne gađa).

**v9 nije imao GC** → `/tmp/catchup_shadow_hls/` je narastao na **84 GB** (disk 72%).
**2026-06-08 deploy-ovan GC-patch** (vidi dole) i jednokratno očišćeno → `/tmp` 4K, disk 62%.

## Fajlovi

| Fajl | Šta je |
|---|---|
| `timeshift_shadow.v9.live.php` | **Tačna kopija production v9** (redigovan token, 1863 lin). Baseline — NE menjati, služi za diff/rollback. |
| `timeshift_shadow.v9.gc-patch.php` | **Ono što je STVARNO deploy-ovano 2026-06-08** (v9 + concurrency cap + inline GC; token inline na serveru). 1913 lin. |
| `timeshift_shadow.v9.hardened.php` | Puna hardened verzija: GC/cap **+ dinamička codec-mapa step-aside + token iz env-a**. Za buduće širenje (NIJE deploy-ovano). |
| `probe-codec-map.sh` | Cron skripta za codec-mapu: ffprobe-uje snimane kanale, piše `/tmp/catchup_shadow_codecmap.json`. Potrebna samo za `.hardened` (codec-map step-aside). |

## Merenje codeca (2026-06-08, `ns3239635`, 87 kanala sa arhivom)

- **Audio:** 79 AAC (91% ✅), **7 MP2** (8% ❌ — treba fix), 1 MP3 (Chrome MSE ga svira ✅).
- **Video:** 84 h264 (97% ✅), **3 HEVC** (3% ⚠️ — Chrome desktop/Android NE dekoduju HEVC u MSE; Safari/iOS da).
- MP2 stream_id: `12, 53, 81, 148, 149, 277, 1495`.
- HEVC stream_id: `149, 2927, 30270` (**149 = MP2+HEVC dupli**).

**HEVC se NE transkoduje** (skup video transcode). Za betu: klijent detektuje i prikaže
poruku (M1.6-d). MP2 se rešava server-side (v9 transcode).

## Šta GC-patch dodaje na v9 (ADD-only, ništa postojeće nije obrisano)

Deploy-ovano 2026-06-08. 50 dodatih linija, 0 uklonjenih. Token inline netaknut.

1. **Globalni concurrency cap** (`SHADOW_MAX_CONCURRENT_BUILDS`, default 4): pre nego što
   POKRENE NOVI ffmpeg build, broji aktivne build-ove (sveži `remux.lock` < 300s); iznad
   capa → `503 Retry-After: 5`. **Serviranje iz keša i čekanje na postojeći lock nikad ne
   udaraju u cap** — štiti CPU samo od poplave novih transkoda pod beta opterećenjem.
2. **Inline cache GC** (`SHADOW_CACHE_GC_MAX_AGE`, default 7200s; `SHADOW_CACHE_GC_PROBABILITY`,
   default 1/25): na ~1-od-25 zahteva briše cache prozore starije od max-age koji nemaju svež
   lock. Bounduje `/tmp` rast. Reuse-uje postojeću v9 `shadowRemoveTree()`. **NB:** pošto shadow
   trenutno nema saobraćaj, inline GC se neće okidati sam dok klijent ne počne da gađa endpoint.

## Šta `.hardened` dodatno nosi (za buduće širenje, NIJE deploy-ovano)

3. **Dinamička codec-mapa / step-aside**: ako cron-mapa (`probe-codec-map.sh` →
   `/tmp/catchup_shadow_codecmap.json`) kaže da je stream već browser-safe (AAC/MP3 audio +
   non-HEVC video) → shadow vrati `409` i Lumen klijent ide normalnim (jeftinijim) putem
   (M1.6-c već hendluje `409 step-aside`). `unknown`/stale mapa → fail-open na pravi build,
   pa kanal koji se prebaci na MP2 i dalje biva uhvaćen.
4. **Token iz env-a** (`getenv('SHADOW_TOKEN_KEY')`) umesto inline — da se NE commit-uje u git.
   Zahteva `env[SHADOW_TOKEN_KEY]` u php-fpm pool conf-u + reload FPM-a (zato nije u GC-patch-u).

## 🔐 Tajne (token) — NIJE u repo-u

`SHADOW_TOKEN_KEY` (XOR ključ za token URL-ove) **nije committovan**. Sve `.php` kopije u
repou imaju `REDACTED_SEE_SERVER_ENV`. Prava vrednost živi **samo na serveru** (inline u
production `timeshift_shadow.php`). GC-patch je zato i odabran za prvi deploy — ne dira token.

Izvuci token sa servera kad zatreba (npr. za `.hardened` env postavku):
```bash
ssh -p 8722 root@<server> "grep -o \"SHADOW_TOKEN_KEY', '[^']*'\" \
  /home/xtreamcodes/iptv_xtream_codes/wwwdir/streaming/timeshift_shadow.php"
```

## Deploy procedura — GC-patch (urađeno 2026-06-08)

> Pravilo: **ADD-only**, instant rollback, original `timeshift.php` se NIKAD ne dira.

```bash
SD=/home/xtreamcodes/iptv_xtream_codes/wwwdir/streaming
SRV=100.64.1.34   # ns3239635, skok preko mainssl 100.96.250.114, port 8722

# 1) Backup živog v9
cp -p $SD/timeshift_shadow.php /root/codex-backups/catchup/<TS>-pre-gc-patch/timeshift_shadow.php.v9-orig

# 2) Patch na KOPIJI (gc_patch.py ubacuje 3 const + 2 fn + GC poziv + cap; token netaknut)
cat $SD/timeshift_shadow.php > /tmp/cand.php; chmod 644 /tmp/cand.php
python3 gc_patch.py /tmp/cand.php
php -l /tmp/cand.php            # mora: No syntax errors

# 3) Atomska zamena (očuvaj owner xtreamcodes:xtreamcodes, perm 644)
cat /tmp/cand.php > $SD/.stage; chown xtreamcodes:xtreamcodes $SD/.stage; chmod 644 $SD/.stage
mv -f $SD/.stage $SD/timeshift_shadow.php

# 4) Verifikacija
php -l $SD/timeshift_shadow.php
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:8080/streaming/timeshift_shadow.php  # 400 = OK (kontrolisan)

# 5) Jednokratno očisti stari /tmp cache (oslobađa GB)
#    (briše samo dirove starije od 7200s bez svežeg locka)
```

### Rollback (instant)
```bash
cp -p /root/codex-backups/catchup/<TS>-pre-gc-patch/timeshift_shadow.php.v9-orig \
  $SD/timeshift_shadow.php
chown xtreamcodes:xtreamcodes $SD/timeshift_shadow.php
```
Pošto shadow trenutno ne servira saobraćaj postojećim klijentima, vraćanje **ne utiče ni na
jednog korisnika**.

## Sledeći koraci (NISU urađeni — čekaju odluku)

- **Periodičan GC cron** (`*/30` poziva standalone GC skriptu) — za period dok shadow nema
  saobraćaja, da `/tmp` ne naraste ponovo (inline GC se okida samo na saobraćaju).
- **`.hardened` deploy** (codec-map step-aside + token iz env-a) — kad se odluči da se shadow
  ponovo uključi za betu i da Lumen klijent gađa ovaj host (`VITE_CATCHUP_SHADOW_HOSTS`).
- Codec-map cron (`probe-codec-map.sh` → `/etc/cron.d/...`) — preduslov za codec-map step-aside.
- Merenje CPU troška transkoda pod realnim beta opterećenjem (očekivano nisko: audio-only,
  video copy, 16 jezgara).

## Recording serveri (Tailscale, skok preko `mainssl` 100.96.250.114, port 8722)

| Server | Tailscale | Arhiva | CPU |
|---|---|---|---|
| `ns3239635` (ovh-videoteka) | 100.64.1.34 | 103 kanala, 24TB | 16 |
| `video-us-can` | 100.64.1.23 | 1 kanal, 395GB | 8 |
| `videoteka-16tb-hetzner` | 100.64.1.14 | (SSH nestabilan) | — |

**Snimanje NIJE na `mainssl`** (`tv_archive` prazan). Shadow mora živeti tamo gde su snimci.
