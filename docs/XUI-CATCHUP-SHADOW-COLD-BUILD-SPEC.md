# Shadow hladan build je prespor za duge programe (za XUI dev)

**Datum:** 2026-06-15
**Server:** `ns3239635` (`edge6.castcdn.net`, `79.137.99.121:8722`)
**Autor:** Lumen tim
**Povezano:** `XUI-CATCHUP-SHADOW-RESURSI-ODGOVOR.md` (resursna zelena), `XUI-CATCHUP-TOKEN-ROUTING-ANSWER.md`

> **TL;DR:** Shadow ruta je UKLJUČENA na Lumen produkciji i radi — daje čist fMP4 (nema
> dead-zone, nema boundary overlap). Jedini preostali problem: **hladan build dugog
> programa traje predugo.** JUTRO (PRVA, 4h05min) = **~5 min** dok shadow servira manifest;
> korisnik gleda spinner. Treba: (1) shadow da gradi/servira **prozor** umesto celog
> programa odjednom, i (2) **podići edge6 nginx timeout** za shadow rutu (sad 60s, obara
> legitimne buildove → 504). Detalji i merenja dole.

---

## 1. Šta radi (kontekst — da ne diraš ono što je dobro)

Shadow ruta je uključena u Lumen klijentu (per-host, `edge6`). Kad je keš **topao**:
- `timeshift_shadow.php?token=<redacted>&extension=m3u8` → **200**, fMP4 manifest (`EXT-X-VERSION:7`,
  `EXT-X-MAP` init, `DISCONTINUITY`, ~7s segmenti), za **~100ms**.
- CORS ok (ACAO `*` na manifest+init+m4s). Geoip fix radi (0× 500).
- Stream svira čisto — **dead-zone i boundary overlap su rešeni** (to je bila poenta shadow-a).

→ **Shadow remux je pravo rešenje. Ne diramo format ni A/V normalizaciju.**

---

## 2. Problem: hladan build dugog programa je prespor

Shadow concat-uje **sve archive minute programa** u jedan ffmpeg build pre nego što servira
manifest. Izmereno na `.121` (`/tmp/catchup_shadow.log`, `build → manifest serve` delta):

| program | trajanje | archive fajlova | hladan build |
|---------|----------|-----------------|--------------|
| PRVA "JUTRO" (109) | 4h05min | ~245 | **~5 min** (`16:42:45 → 16:47:59`) |
| (109) drugi pokušaj | 4h05min | 245 | ~4m44s (`12:13:05 → 12:17:49`) |
| RTS1 (112) | 68 min | 68 | ~2 min (`16:35:57 → 16:37:51`) |

Linearno s brojem fajlova. Korisnik klikne program → spinner "Tražim snimak kod
provajdera" → **čeka 2–5 min** → tek onda svira. Neprihvatljivo za UX.

**Lumen NE želi međurešenje "pusti mucav stari put pa prebaci na čist"** — prelaz bi izazvao
novo mucanje (nova MSE sesija). Hoće da hladan shadow build bude brz.

---

## 3. KORENSKI BUG: shadow ignoriše `duration`, gradi do live edge-a

Probali smo da Lumen pošalje uži `duration` da shadow gradi manje. Testirano, sa jasnim
obrascem:

| poslat `duration` | očekivano fajlova | shadow `files=` | odnos |
|-------------------|-------------------|-----------------|-------|
| 14700s (245 min = **pun program**) | 245 | **245** | ✅ 1:1 |
| 3600s (60 min) | 60 | **558** | ❌ 9.3× |
| 900s (15 min) | 15 | **666** | ❌ 44× |

**Obrazac:** kad Lumen pošalje TAČAN program-duration, shadow da tačan broj. Kad pošalje
KRAĆI, shadow svejedno gradi **stotine fajlova** — izgleda **od `start` do KRAJA dostupne
arhive (live edge)**, ignorišući `duration`. (558/666 ≈ minuti od 08:00/05:55 do trenutnog
vremena.)

Reprodukcija:
```
.../streaming/timeshift.php?…&stream=112&start=2026-06-15:08-00&duration=3600&extension=m3u8
# -> 302 -> edge6 token -> timeshift_shadow.php?token=<redacted>
# log: "archive ok stream=112 files=558"   (ocekivali 60)
```

`shadowCollectArchiveFiles($archiveRoot,$streamId,$startTimestamp,$duration)` (ima
`start + index*60` imenovanje + `duration *= 24` negde) ne ograničava petlju na `duration` —
ide do kraja arhive. **To je glavni razlog spore izgradnje:** za 60-min program remux-uje
~9h sadržaja.

→ **Lumen NE može da skrati build slanjem kraćeg `duration` — shadow ga ignoriše.** Mora
`timeshift_shadow.php`.

---

## 4. Šta tražimo (dva dela)

### Deo A (PRIMARNO) — `shadowCollectArchiveFiles` da poštuje `duration`

Najjednostavniji i najefikasniji fix: **ograniči petlju na `duration`**, ne na kraj arhive.
- Trenutno: gradi `start → live edge` (stotine fajlova bez obzira na `duration`).
- Treba: gradi `start → start + duration` (npr. `ceil(duration/60)` minutnih fajlova).
- Tada Lumen može da traži **uži početni prozor** (npr. 15 min → 15 fajlova → build par
  sekundi), pa da **produžava** rastući `duration` od programStart (chunked, jedan
  kontinualan manifest → player ne spaja ništa → nema prelaz-mucanja).

Alternativa ako gore nije izvodljivo (A2 — background extend):
- Shadow gradi prvih N minuta, odmah servira manifest, nastavlja build u pozadini i dopunjuje
  isti keš. Player dobije manifest za par sekundi; ostatak se dogradi pre nego što ga korisnik
  stigne.

**Bilo koji pristup zahteva da `duration` STVARNO ograničava opseg.** To je suština.

### Deo B — nginx timeout (NAPOMENA: Lumen-strana već rešena)

Pri testu sam dobio `504` posle 60s. Pravi uzrok = **`.105` (Lumen VPS) nginx**
`/xui-api/ proxy_read_timeout 60s` — **Lumen ga je već podigao na 120s** (`f5eafd0` proxy +
nginx 120s na .105). Edge6 nginx shadow location je već `proxy_read_timeout 300` (ok).
→ **Nije XUI dev posao.** Ostaje samo da build (Deo A) bude brži od ~120s; ako Deo A skrati
build na prozor (sekunde), nijedan timeout nije problem.

---

## 5. Verifikacija (kad primeniš)

```bash
# build -> serve delta za isti dugi program treba da padne sa ~5min na sekunde:
grep -E "shadow build|manifest serve" /tmp/catchup_shadow.log | grep stream=109 | tail
# nginx ne sme da baci 504 za legitiman build:
curl -sI "https://edge6.castcdn.net/streaming/timeshift_shadow.php?token=<redacted>&extension=m3u8"
# -> 200, ne 504
```

Lumen strana je spremna (shadow ruta + 90s proxy timeout + legacy fallback). Čim shadow
hladan build bude brz (A) i nginx ne obara (B), veliki programi će se otvarati za sekunde.

---

## 6. Status (sažeto)

| stavka | status |
|--------|--------|
| shadow format (fMP4, A/V-norm) | ✅ radi — ne dirati |
| shadow CORS + geoip | ✅ radi |
| Lumen ruta + proxy timeout (90s) + fallback | ✅ deployed |
| `.105` nginx + proxy timeout 60s→120s | ✅ deployed (Lumen-strana, NE XUI dev) |
| **`shadowCollectArchiveFiles` ignoriše `duration` (gradi do live edge → 9× više fajlova)** | ❌ **Deo A — XUI dev (KORENSKI)** |
| Lumen UX poruka tokom čekanja | ✅ deployed (prelazno, dok Deo A ne legne) |
