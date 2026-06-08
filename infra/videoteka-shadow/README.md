# Videoteka Catch-up Shadow (MP2→AAC) — Lumen

Server-side fix za kanale čiji audio browser (MSE/HLS.js) ne dekoduje — pre svega
**MP2**. Rešenje transkoduje **samo audio** (`-c:a aac`), video ostaje `copy`.
Izolovano je: zaseban endpoint, zaseban storage/cache, **ne dira originalni
`timeshift.php` ni jednog ne-Lumen klijenta**.

> Kontekst i merenja: vidi `docs/RELEASE-PLAN-MVP-BETA-FINAL.md` (task **M1.6**) i
> memoriju `videoteka-servers-timeshift-shadow.md`. MP2/no-media konflikt:
> `mp2-audio-no-media-conflict.md`.

## Fajlovi

| Fajl | Šta je |
|---|---|
| `timeshift_shadow.live.php` | **Tačna kopija** verzije sa servera (md5 `a4ae3c60a79548d1602052346288f812`, 910 linija). Baseline — NE menjati, služi za diff/rollback. |
| `timeshift_shadow.hardened.php` | Hardenovana verzija (concurrency cap + cache GC + dinamička codec-mapa). Ovo se deploy-uje. |
| `probe-codec-map.sh` | Cron skripta: ffprobe-uje snimane kanale, piše `/tmp/catchup_shadow_codecmap.json`. LIVE lista MP2 vs AAC. |

## Merenje codeca (2026-06-08, glavni recording server `ns3239635` / ovh-videoteka)

87 kanala sa arhivom:
- **Audio:** 79 AAC (91% ✅), **7 MP2** (8% ❌ — treba fix), 1 MP3 (Chrome MSE ga svira ✅).
- **Video:** 84 h264 (97% ✅), **3 HEVC** (3% ⚠️ — Chrome desktop/Android NE dekoduju HEVC u MSE; Safari/iOS da).
- MP2 stream_id: `12, 53, 81, 148, 149, 277, 1495`.
- HEVC stream_id: `149, 2927, 30270` (**149 = MP2+HEVC dupli**).

**HEVC se NE transkoduje** (skup video transcode). Za betu: klijent detektuje i prikaže poruku (kao MP2 video-only fallback). Vidi M1.6.

## Razlike hardened vs live (ADD-only, ništa postojeće nije obrisano)

1. **Globalni concurrency cap** (`SHADOW_MAX_CONCURRENT_BUILDS`, default 4): pre nego što
   POKRENE novi ffmpeg build, broji aktivne build-ove (sveži `remux.lock`); iznad capa →
   `503 Retry-After: 3`. Serviranje iz keša nikad ne udara u cap. Sprečava ffmpeg poplavu.
2. **Inline cache GC** (`SHADOW_CACHE_GC_MAX_AGE`, default 7200s): na 1-od-N zahteva (default 1/25)
   briše cache prozore starije od max-age. Bounduje `/tmp` rast. Ne dira prozor koji se gradi.
3. **Dinamička codec-mapa / step-aside**: ako cron-mapa kaže da je stream već AAC/MP3 →
   shadow vrati `409` (`X-Lumen-Shadow: step-aside-safe`) i klijent ide normalnim putem
   (bez nepotrebnog transkoda). `unknown`/stale mapa → fail-open na pravi ffprobe, pa
   kanal koji se prebaci na MP2 i dalje biva uhvaćen pri sledećem build-u.

Sve podešljivo preko env varijabli — nema potrebe za izmenom koda za tuning.

## 🔐 Tajne (token) — NIJE u repo-u

`SHADOW_TOKEN_KEY` (XOR ključ za token URL-ove) **nije committovan**. Hardened verzija
ga čita iz okruženja (`getenv('SHADOW_TOKEN_KEY')`) i odbija da radi ako nije postavljen.
`live.php` u repo-u ima `REDACTED_SEE_SERVER_ENV` umesto prave vrednosti. Originalna
vrednost živi **samo na serveru** (u originalnom `timeshift_shadow.php`, md5 `a4ae3c60…`).

Na serveru postavi token u PHP-FPM pool env (ili non-repo include), npr. u
`/home/xtreamcodes/iptv_xtream_codes/php/etc/...` pool conf:
```
env[SHADOW_TOKEN_KEY] = "<vrednost-sa-servera>"
```
ili izvuci iz postojećeg live shadow-a pre zamene:
```bash
ssh -p 8722 root@<server> "grep -o \"SHADOW_TOKEN_KEY', '[^']*'\" \
  /home/xtreamcodes/iptv_xtream_codes/wwwdir/streaming/timeshift_shadow.php"
```

## Deploy procedura (izolovan test, bezbedna)

> Pravilo: **ADD-only**. Nikad modify/restart postojećeg. Spremno za instant rollback.

```bash
# 0) Backup live shadow (ako ga menjamo) — original timeshift.php se NE dira NIKAD
ssh -p 8722 root@<recording-server> \
  'cp -a /home/xtreamcodes/iptv_xtream_codes/wwwdir/streaming/timeshift_shadow.php \
        /root/codex-backups/catchup/timeshift_shadow.$(date +%Y%m%d-%H%M%S).bak'

# 1) Postavi hardened verziju kao shadow (vlasništvo xtreamcodes:xtreamcodes)
scp -P 8722 timeshift_shadow.hardened.php \
  root@<recording-server>:/home/xtreamcodes/iptv_xtream_codes/wwwdir/streaming/timeshift_shadow.php
ssh -p 8722 root@<recording-server> \
  'chown xtreamcodes:xtreamcodes /home/xtreamcodes/iptv_xtream_codes/wwwdir/streaming/timeshift_shadow.php'

# 2) php -l provera NA serveru
ssh -p 8722 root@<recording-server> \
  'php -l /home/xtreamcodes/iptv_xtream_codes/wwwdir/streaming/timeshift_shadow.php'

# 3) Codec-map cron skripta
scp -P 8722 probe-codec-map.sh \
  root@<recording-server>:/home/xtreamcodes/iptv_xtream_codes/wwwdir/streaming/probe-codec-map.sh
ssh -p 8722 root@<recording-server> \
  'chmod +x /home/xtreamcodes/iptv_xtream_codes/wwwdir/streaming/probe-codec-map.sh && \
   /home/xtreamcodes/iptv_xtream_codes/wwwdir/streaming/probe-codec-map.sh && \
   cat /tmp/catchup_shadow_codecmap.json | head'

# 4) Cron (zaseban fajl, NE diramo postojeće cronove)
ssh -p 8722 root@<recording-server> \
  'echo "*/30 * * * * xtreamcodes /home/xtreamcodes/iptv_xtream_codes/wwwdir/streaming/probe-codec-map.sh >/dev/null 2>&1" \
        > /etc/cron.d/lumen-shadow-codecmap'

# 5) Nginx routing — DODATI location SAMO ako .php u /streaming/ nije već rutiran.
#    (Tipično XUI već servira sve .php u /streaming/ preko fastcgi — proveriti prvo.)
#    NE menjati postojeće server{} blokove. Ako treba reload: nginx -t && systemctl reload nginx
```

### Rollback (instant)
```bash
# Vrati prethodni shadow iz backup-a (original timeshift.php je netaknut svejedno)
ssh -p 8722 root@<recording-server> \
  'cp -a /root/codex-backups/catchup/timeshift_shadow.<TS>.bak \
        /home/xtreamcodes/iptv_xtream_codes/wwwdir/streaming/timeshift_shadow.php'
# Ukloni cron
ssh -p 8722 root@<recording-server> 'rm -f /etc/cron.d/lumen-shadow-codecmap'
```
Pošto shadow nije rutiran/korišćen od strane postojećih klijenata, gašenje shadow-a
(ili vraćanje originala) **ne utiče ni na jednog postojećeg korisnika**.

## Recording serveri (Tailscale, skok preko `mainssl` 100.96.250.114)

| Server | Tailscale | Arhiva | CPU |
|---|---|---|---|
| `ns3239635` (ovh-videoteka) | 100.64.1.34 | 103 kanala, 24TB | 16 |
| `video-us-can` | 100.64.1.23 | 1 kanal, 395GB | 8 |
| `videoteka-16tb-hetzner` | 100.64.1.14 | (SSH nestabilan) | — |

**Snimanje NIJE na `mainssl`** (`tv_archive` prazan). Shadow mora živeti tamo gde su snimci.

## Otvorena pitanja pre širenja

- Klijentska strana: Lumen treba da gađa `timeshift_shadow.php` (token/credentials format isti kao original) i da hendluje `409 step-aside` → fallback na normalan put.
- Da li shadow ide na sve recording servere ili samo glavni (ovh) za betu.
- Merenje stvarnog CPU troška transkoda pod realnim opterećenjem (očekivano nisko: audio-only, video copy, 16 jezgara).
- HEVC kanali (klijentska detekcija + poruka).
