# Catch-up dead-zone repair — plan za produkciju

**Status: dokazano na test serveru `.107` (filip-vps-m-3), čeka odluku za produkciju `ns3239635`.**

## Problem (dokazan root cause)

Catch-up "muca pa krene" = svaki minutni arhivski fajl (`tv_archive/<id>/<Y-m-d:H-i>.ts`)
počinje usred GOP-a, ispred SPS/PPS. Browser/HLS.js ne može da dekodira P-frejmove
bez parametarskog seta → baci ceo GOP-head → mucanje.

**Mehanizam (verifikovano na `.107` + nezavisni 4-agent workflow):**
- Live segmenter snima ispravno (`+resend_headers`, SPS na početku segmenta).
- Ali **Zend/ionCube-enkriptovani archive manager** (`TVArchive[<id>]`, `tools/archive.php`)
  reže live stream na **zidni-sat minutnu granicu**. Izvor ima **GOP = 2.0s**, pa 60s rez
  skoro UVEK pada usred GOP-a → minutni fajl počinje ispred SPS/PPS.
- Archive manager je enkriptovan → **ne može se menjati**.
- `timeshift.php` (serving) je čist `fopen`/`fseek` passthrough (NE transkoduje) →
  dead zone prolazi netaknuta do klijenta.
- `+resend_headers` na live segmenteru NE pomaže archive-u (archive radi svoje rezanje posle).

## Fix (bez transkoda, dokazan)

```
ffmpeg -c copy -bsf:v dump_extra=freq=k -mpegts_flags +resend_headers -f mpegts OUT IN
```

- `dump_extra=freq=k` — ubacuje SPS/PPS na svaki keyframe (NE `=all` — to bloata bez koristi).
- `-c copy` — **nula transkoda**, video se ne dira, nula A/V desync rizika, CPU ~nula.
- Rezultat na `.107`: decode greške **30-100 → 0** po fajlu, ceo prozor (preko granica) čist.
- Brzina: ~1s/fajl (2 ffmpeg poziva: repair + 0-error self-check).

## Skripta

`infra/videoteka-shadow/lumen-archive-repair.sh` (kopija deploy-ovana na `.107:/opt/lumen/`).

Bezbednosne mere:
- Preskače otvoreni minut (mtime < 90s) — ne trka se sa writer-om.
- Self-validacija: zameni original SAMO ako after-check == 0 grešaka.
- Atomski temp+mv, čuva owner/perms.
- Idempotent: `.lumen_fixed` marker → re-run preskače popravljene.

Cron: `* * * * * flock -n /opt/lumen/repair.lock /opt/lumen/lumen-archive-repair.sh`

## Plan za produkciju `ns3239635` (ovh-videoteka, Tailscale 100.64.1.34, port 8722)

> **Pristup traži eksplicitno vlasničko imenovanje** (memorijsko pravilo za recording flotu).

Razlike od `.107` (treba proveriti pre deploy-a):
1. **Više kanala** — `.107` ima 1 kanal sa arhivom (45090). Produkcija = ~103 kanala, 24TB.
   Backfill cost skalira linearno (~1s + ~30MB read/write po kanal-minutu). Treba proveriti
   IO headroom (16 CPU pomaže). Za cron je trivijalno (1 minut/kanal/min = paralelizovati).
2. **Postoji shadow v9** — dump_extra cron i shadow rešavaju RAZLIČITE stvari:
   - dump_extra cron → **dead-zone (mucanje) za SVE kanale**.
   - shadow → **MP2 audio** (7 kanala). Shadow je nedovršen (token-handshake puknut, nije routan).
   - **Ne sukobljavaju se.** dump_extra je širi i jednostavniji fix. Shadow ostaje (eventualno)
     samo za MP2 audio, nezavisno.
3. **GOP** — proveriti da je i na produkciji 2.0s (verovatno isti XUI segmenter).
4. **ffmpeg** — produkcija ima isti `bin/ffmpeg` N-92517 (podržava dump_extra, potvrđeno u memoriji).
5. **Disk** — proveriti slobodan prostor (repair piše temp pa mv, prolazno +30MB/kanal).

Koraci (kad vlasnik odobri):
1. SSH read-only: potvrditi GOP=2s, dead-zone prisutan (nalscan na realnom fajlu), disk, CPU.
2. Deploy skriptu u `/opt/lumen/`, test LIMIT=3 (piši u /tmp prvo, pa in-place sa backup-om).
3. Backfill po kanalima (možda batch, ne svi odjednom — IO).
4. Cron (flock).
5. Klijentski test: Playwright catch-up kroz `gw.castcdn.net` (fica nalog) → buffered raste, nema petlje.
6. Klijentski `e0a491a` (head-skip) POSTAJE dovoljan čim arhiva bude čista — push/deploy tada.

## Klijentska strana

`e0a491a` (`final-road/EX-live-refocus-emptysrc`, lokalno, nije na prod): startPosition 0.1 +
startOnSegmentBoundary. Sam za sebe NIJE dovoljan dok arhiva ima dead-zone. **Čim arhiva bude
čista (ovaj fix), head-skip radi i preko granica segmenata → push bezbedan i koristan.**
