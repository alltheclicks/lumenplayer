# XUI Catch-up SPS/PPS Fix — Spec za developera

**Status:** dokazano merenjem na produkcionoj videoteci (2026-06-11).
**Tip izmene:** jedan bitstream flag na FFmpeg segmenteru. Bez transkoda, bez GPU/hardvera, CPU trošak ~nula.
**Domet:** popravlja catch-up za SVE klijente (web/MSE, native, TV), čini server-side "shadow" remux nepotrebnim.

---

## 1. Problem (jednom rečenicom)

XUI snima catch-up arhivu (`tv_archive/<id>/*.ts`) **bez SPS/PPS (H.264 parameter sets) na početku segmenata**, pa browser MSE / hls.js ne može da dekodira početak svakog segmenta → muca 10–20s dok ne naiđe na inline parametre duboko u segmentu. Live nema problem jer ima kontinuirane parametre.

## 2. Merljiv dokaz (realan Pink/105 arhivski fajl, na samoj videoteci)

FFmpeg na serveru: `N-92517-gd0f5942-Xtream-Codes` (2018 build).

| Stanje | `non-existing PPS` / `no frame` decode greške (prvih 5s) | SPS offset |
|---|---|---|
| **Sirov arhivski `.ts` (kako sad stoji)** | **135** | ~538 KB u segment |
| Isti fajl, remux `-bsf:v dump_extra` | **0** | početak |
| Isti fajl, remux `-mpegts_flags +resend_headers` | **0** | početak |

Komanda za reprodukciju (`$FF` = `/home/xtreamcodes/iptv_xtream_codes/bin/ffmpeg`):

```bash
# baseline (loše):
$FF -v error -i tv_archive/105/<program>.ts -t 5 -f null - 2>&1 | grep -c "PPS\|no frame"   # => 135

# sa dump_extra (čisto):
$FF -y -i tv_archive/105/<program>.ts -c copy -bsf:v dump_extra /tmp/out.ts
$FF -v error -i /tmp/out.ts -t 5 -f null - 2>&1 | grep -c "PPS\|no frame"                    # => 0
```

## 3. Gde tačno izmeniti

Aktivna live-snimanje komanda (viđena u `ps aux` na videoteci):

```
ffmpeg ... -vcodec copy -scodec copy -acodec copy -individual_header_trailer 0 \
  -f segment -segment_format mpegts -segment_time 10 \
  -segment_format_options mpegts_flags=+initial_discontinuity:mpegts_copyts=1 ...
```

**Fali video bitstream filter koji ponavlja SPS/PPS u svaki keyframe.**

- Komanda se sklapa u **panel/streaming PHP sloju** koji pokreće `tools/ffmpeg` po stream-u (admin_live snimanje / `tools/archive.php`). Pošto je `archive.php` ionCube enkriptovan, dev koji ima XUI izvor treba da nađe gde se string `-f segment` / `segment_format_options` sklapa i tu doda flag.

## 4. Izmena (jedna od dve, obe dokazane = 0 grešaka)

**Preporučeno (radi na ovom FFmpeg buildu):**
```
-bsf:v dump_extra
```
Dodati ga u video deo komande (uz `-vcodec copy`). Umeće SPS/PPS/extradata u svaki keyframe.

**Alternativa (ako se preferira muxer-level):**
```
-mpegts_flags +initial_discontinuity+resend_headers+mpegts_copyts
```
(spaja postojeće flag-ove + `resend_headers`).

> Napomena: `-flags +global_header` NE pomaže za `mpegts copy` — pravi je `dump_extra` / `resend_headers`.

## 5. Bitna nijansa (zašto fix MORA na live-snimanje, ne na serviranje)

Pri merenju: kad se već loš fajl samo **re-segmentuje offline**, greške nestaju (ffmpeg pri ponovnom čitanju uhvati parametre). Ali problem nastaje pri **live snimanju u realnom vremenu** — XC reže segment na trenutku kad parametri još nisu prošli. Zato fix mora na komandu koja **snima uživo**, da svaki zapisani segment već nosi SPS/PPS. Serviranje (`timeshift.php`) ne treba dirati.

## 6. Verifikacija posle izmene

```bash
# novi snimak posle fix-a:
$FF -v error -i tv_archive/<id>/<NOV-program>.ts -t 5 -f null - 2>&1 | grep -c "PPS\|no frame"   # mora 0
ffprobe -show_packets ... # prvi SPS offset < 1KB
```

## 7. Domet i migracija

- **Nema transkoda, nema GPU.** Čist `-c:v copy` + bitstream filter; dodaje ~38 bajtova SPS/PPS po keyframe-u. CPU trošak zanemarljiv. Audio se NE dira → nula rizika od A/V desync-a.
- Catch-up arhiva je **7-dnevni klizni prozor**. Od trenutka primene fix-a:
  - **odmah** novi programi rade savršeno na web playeru,
  - za **7 dana** je ceo catch-up prozor ispravan (svi stari loši snimci istekli).
- **Stare snimke NE treba popravljati** — isteknu sami.
- Native playeri rade isto kao i sad (ispravan MPEG-TS sa SPS/PPS na keyframe-u im ne smeta).
