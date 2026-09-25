# Catch-up token-rutiranje na shadow — odgovor Lumen tima (za XUI dev-a)

**Datum:** 2026-06-15
**Server:** `ns3239635` (`edge6.castcdn.net`, `79.137.99.121:8722`)
**Povod:** tvoj nalaz da Lumen player gađa token-put (`timeshift.php?token=`), a ne pretty-path (`/timeshift/.../112.m3u8`) — pa pretty-path kanarinac nije ni bio pozvan.

> **TL;DR:** Tačno — player ide na token-put. **Lumen već ima rešenje za prebacivanje token-puta na shadow, na KLIJENTU.** `nginx` ne mora ništa da dekriptuje ni filtrira. Klijent sam prepiše `timeshift.php?token=<redacted>` → `timeshift_shadow.php?token=<redacted>` (token netaknut), i to **per-host** (kontrolisan blast radius, nula uticaja na ne-Lumen klijente). Tvoj geoip fix je tačno ono što nam je falilo da shadow uopšte ne vrati 500. Detalji + šta nam treba od tebe dole.

---

## 1. Potvrdili smo tvoj nalaz (server + kod)

**Server `.121`:**
- Player gađa `location = /streaming/timeshift.php` (nginx linija 199) sa `?token=<redacted>` — token-put, kao što kažeš.
- Shadow ima **zaseban** `location = /streaming/timeshift_shadow.php` (linija 242), već sa dužim timeout-ima (`proxy_read_timeout 300`, za remux). Spreman.
- `timeshift_shadow.php` ažuriran (mtime 2026-06-14 22:11), `php -l` čist, ima geoip/GeoLite2 reference + `try{}`. **Tvoj geoip fix je prisutan.**

**Lumen kod (`apps/web/src/components/player/catchupTransport.ts`):**
- `rewriteTokenizedCatchUpShadowUrl()` (linija 530) **već radi prebacivanje token-puta na shadow.**

---

## 2. Kako Lumen prebacuje na shadow (ovo rešava tvoju dilemu o blast radius-u)

Lumen NE traži od nginx-a da presreće, dekriptuje ili filtrira token. **Klijent to radi pre slanja:**

```
ako (path == /streaming/timeshift.php)
   && (ima ?token=)
   && (host ∈ SHADOW_TOKEN_HOSTS):
       path → /streaming/timeshift_shadow.php   // token ostaje NETAKNUT
```

- **`SHADOW_TOKEN_HOSTS`** = `edge6.castcdn.net` (hardkodiran) + bilo koji host iz env `VITE_CATCHUP_SHADOW_HOSTS` (comma-separated, **bez code change** — uključuje/isključuje se po hostu kako se shadow verifikuje).
- **Token se ne dira** — `timeshift_shadow.php` ga interno dekriptuje (isti token format kao glavni `timeshift.php`), pa vidi `stream_id=112` i odlučuje sam.

**Posledica za tebe:**
1. **nginx ne mora ništa** — ni da dekriptuje token, ni da filtrira 75/105/112. Klijent već šalje gotov `timeshift_shadow.php?token=<redacted>`.
2. **Nula blast radius-a na ne-Lumen klijente** — oni i dalje gađaju `timeshift.php?token=<redacted>` (token-put se NE menja na serveru). Samo Lumen player, samo za hostove u svojoj listi, ide na shadow.
3. **Filtriranje 75/105/112 (ako ga uopšte želiš) je u shadow PHP-u, ne u nginx-u** — shadow dekriptuje token, vidi stream_id, pa može da vrati ne-kanarinac kanale na stari put interno (`include timeshift.php` logika) ili da remuxuje sve.

→ Od tvoje tri opcije, **odgovor je varijanta (b): shadow interno odlučuje po stream_id-u** — ali rutiranje na shadow **već radi Lumen klijent**, ti samo treba da potvrdiš da shadow radi kad ga klijent pozove.

---

## 3. Šta nam treba od tebe (da uključimo shadow za Lumen)

1. **Potvrdi da shadow radi na token-pozivu** sada kad je geoip fix unutra. Test (token koji player šalje, samo zameni put):
   ```
   curl -sI "https://edge6.castcdn.net/streaming/timeshift_shadow.php?token=<redacted>"
   # očekujemo 200 + m3u8, ne 500
   ```
   Ako vraća 200 — spremni smo da uključimo `edge6.castcdn.net` (već je u Lumen listi).

2. **Resursi — i dalje otvoreno pitanje (ne uključujemo dok ne potvrdiš).** Shadow kešira u **`/tmp` = tmpfs (RAM)**, 1.2GB po programu, folder od 11.6. još stoji = **nema eviction**. `.121` drži ~100 live segmentera. Pre nego što shadow primi pun catch-up saobraćaj:
   - kolika je cena remuxa po programu (CPU-sek/RAM)?
   - treba li keš preseliti sa `/tmp` (RAM) na disk + dodati eviction (TTL/max-size/LRU), da N istovremenih programa ne pojede RAM?
   - **Filipova tvrda ograda: ne sme da optereti CPU/RAM/HDD ni da ugrozi live snimanje.**

3. **Ako je održivo samo za deo saobraćaja** — Lumen može da uključi shadow **per-host** (env `VITE_CATCHUP_SHADOW_HOSTS`), tj. postupno, host po host, kako verifikuješ. Ne mora sve odjednom.

---

## 4. Plan prebacivanja (predlog)

| korak | ko | šta |
|-------|-----|-----|
| 1 | XUI dev | potvrdi shadow vraća 200 na token-poziv (geoip fix radi) |
| 2 | XUI dev | odgovori na resurse (keš na disk + eviction ako treba) |
| 3 | XUI dev | (opciono) shadow filtrira stream_id u PHP-u: kanarinac kanali → remux, ostali → stari put |
| 4 | Lumen | uključi `edge6.castcdn.net` (već u listi) / doda host u `VITE_CATCHUP_SHADOW_HOSTS`, redeploy web |
| 5 | oba | GUI test: RTS1/112 catch-up → granica minuta bez overlap-a, TTFRF < 4s |

**Lumen sa svoje strane ne dira server** — rutiranje je gotovo u klijentu, čeka samo tvoju potvrdu (200 na shadow) + resursnu zelenu.

---

## 5. Sažeto — 3 stvari za tebe

1. **nginx ne treba menjati** za token-rutiranje — Lumen klijent već prepisuje `timeshift.php?token=` → `timeshift_shadow.php?token=` per-host. Token netaknut, shadow ga sam dekriptuje.
2. **Potvrdi shadow vraća 200** na token-poziv (geoip fix) — pa uključujemo `edge6` iz Lumen-a.
3. **Resursi su jedini blocker** — keš je na RAM (tmpfs) bez eviction; reci nam cenu remuxa + treba li keš na disk, da ne ugrozi ~100 live segmentera.
