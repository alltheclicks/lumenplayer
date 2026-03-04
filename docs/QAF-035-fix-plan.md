# QAF-035 Fix Plan: Catch-up playback — host affinity 401 bug + post-start stall fallback

**Datum:** 2026-02-24
**Branch:** `codex/qaf-035-catchup-runtime-gate` (PR #215)
**Status:** Plan spreman za review

---

## Context

Drugi agent se mučio 2 dana na QAF-035. Catch-up playback tehnički radi, ali ima dva kritična buga koji izazivaju nepotrebne retry kaskade, spor startup (~47s), i prekidanje radećeg stream-a. Live playback radi dobro.

**Dokaz iz `.playwright-cli/console-after-manifest-priority.log`:**
- `12:39:17` — catch-up zahtev
- `12:39:19` → `12:39:53` — 7+ retry ciklusa sa 502 na segmentima (svaki retry zahteva 3 network error-a pre fallback-a)
- `12:40:04` — playback konačno startuje (47s posle zahteva!)
- `12:40:45` — sistem UBIJA radeći stream i prebacuje na novi pokušaj
- `12:40:46` → `12:40:47` — rapid 401 kaskada na edge host-u
- `12:40:58` — ponovo startuje (54s ukupno haosa)

---

## Bug 1: Host affinity rewrite na credential-path URL → 401 Unauthorized

### Problem

Sistem zapamti redirect `serv2.mediaking.fi → oveu.mediaking.fi` i potom prepisuje SVE catch-up URL-ove na edge host. Ali credential-path URL-ovi (`/timeshift/user/pass/duration/start/381.m3u8`) MORAJU ići kroz login server da dobiju redirect/token. Edge host (`oveu.mediaking.fi`) prima samo token-bazirane zahteve (`timeshift.php?token=...`).

### Evidencija

Log linija 77: `401 @ .../xui-api/http%3A%2F%2Foveu.mediaking.fi%3A8080/timeshift/fica/fF2024BG2025/3600/2026-02-21:18-31/381.m3u8`

### Root cause u kodu

- `catchupTransport.ts` → `dedupeAttempts()` (linija 318): `applyKnownCatchUpHostAffinity(attempt.url)` — slepo rewrite-uje sve URL-ove
- `VideoPlayer.tsx` → `switchToCatchUpFallbackIfAvailable()` (linije 748-750): isti problem — host affinity se primenjuje bez obzira na tip URL-a

### Predloženi fix

1. **Nova funkcija `isCredentialPathCatchUpUrl(url)`** u `catchupTransport.ts`
   - Detektuje regex pattern `/timeshift/{user}/{pass}/{digits}/` (credential-path)
   - Koristi postojeći `parseTargetUrl()` za proxy-aware parsing (radi i sa `/xui-api/` URL-ovima)

2. **Nova funkcija `shouldApplyHostAffinityToAttempt(url, strategy)`** u `catchupTransport.ts`
   - Vraća `false` za strategije: `redirect-primary`, `start-offset`, `stream-fallback`, `legacy`
   - Dodatno proverava URL pattern za `primary-retry` (jer može biti baziran na credential-path redirect URL-u)
   - Vraća `true` samo za `primary-query` i token-bazirane URL-ove

3. **Gate u `dedupeAttempts()`** — `catchupTransport.ts` linija 318
   ```
   Pre:  applyKnownCatchUpHostAffinity(attempt.url)
   Posle: shouldApplyHostAffinityToAttempt(url, strategy) ? applyKnownCatchUpHostAffinity(url) : url
   ```

4. **Gate u `switchToCatchUpFallbackIfAvailable()`** — `VideoPlayer.tsx` linije 742-750
   - Dodati `shouldApplyHostAffinityToAttempt(nextAttempt.url, nextAttempt.strategy)` proveru
   - Ako nije safe → `preferredFinalHost = null`, URL ostaje originalni

---

## Bug 2: Stall monitor ubija radeći stream posle 12s

### Problem

Nakon uspešnog starta, hls.js dobija tranzijentne 502 greške na nekim segmentima. Stall monitor (interval 1s, prag 12s) detektuje da `currentTime` ne napreduje i triggeruje fallback — ubija savršeno dobar stream koji bi se sam oporavio.

### Evidencija

41s gap između `playback.started` i `catchup.retry` (12:40:04 → 12:40:45). To je tačno: buffer trajanje (~29s) + stall prag (12s) = 41s.

### Predloženi fix

5. **Nova konstanta `CATCH_UP_RUNTIME_POST_START_STALL_THRESHOLD_MS = 30_000`** u `VideoPlayer.tsx`

6. **Dinamički prag u stall monitoru** — `VideoPlayer.tsx` linije 1527-1534
   - Ako `progress.lastPositionSeconds > 5.0` (značajan playback napredak) → koristi 30s prag
   - Inače → ostaje 12s prag (startup faza, gde brzo treba skočiti na sledeći pokušaj)

---

## Fajlovi za izmenu

| Fajl | Izmene |
|------|--------|
| `apps/web/src/components/player/catchupTransport.ts` | Dodati `isCredentialPathCatchUpUrl()`, `shouldApplyHostAffinityToAttempt()`, gatovati `dedupeAttempts()` |
| `apps/web/src/components/player/VideoPlayer.tsx` | Import nove funkcije, gate u `switchToCatchUpFallbackIfAvailable()`, post-start stall threshold |
| `apps/web/src/components/player/catchupTransport.test.ts` | Testovi za nove funkcije + plan building sa aktivnim affinity |
| `apps/web/src/components/player/videoPlaybackSync.test.ts` | Test za 30s threshold |

**Napomena:** Postojeći test `'applies remembered host affinity while building the next catch-up plan'` treba ažurirati — sada se `initialAttempt` (redirect-primary) NEĆE rewrite-ovati na edge host, samo `primary-query` hoće.

---

## Očekivani uticaj

| Metrika | Pre fixa | Posle fixa |
|---------|----------|------------|
| 401 greške u retry lancu | Da (na svaki credential-path pokušaj posle prvog redirect-a) | Ne |
| Startup vreme | ~47s (mnogo pokušaja propadne zbog 401) | ~10-15s (samo legitimni 502 pokušaji) |
| Post-start prekidanje | Da (posle ~41s radeći stream se ubije) | Ne (30s tolerance daje hls.js vreme za recovery) |
| Broj retry pokušaja | 7-10+ pre prvog uspešnog starta | 2-4 (legitimnih, bez 401 šuma) |

---

## Verifikacija

1. `pnpm typecheck` — TypeScript provera
2. `pnpm vitest run apps/web/src/components/player/catchupTransport.test.ts apps/web/src/components/player/catchupRuntimeGate.test.ts apps/web/src/components/player/videoPlaybackSync.test.ts` — unit testovi
3. `pnpm lint` — ESLint
4. `pnpm dev` + ručni test: izabrati catch-up program (NOVA S, 3 dana unazad) i proveriti:
   - Nema 401 grešaka u konzoli
   - Startup vreme < 15s
   - Nakon starta, nema prekidanja stream-a u prvih 60s

---

## Codex review notes (2026-02-24)

- Plan je dobro postavljen i gadja pravi root cause za `401` kaskadu.
- Bug 1 treba raditi prvo. Credential-path URL ne sme host-affinity rewrite na edge host.
- Predlog: `shouldApplyHostAffinityToAttempt(url, strategy)` bazirati primarno na URL tipu, ne na strategiji.
  - `credential-path` -> uvek bez affinity rewrite.
  - token/final URL -> affinity rewrite dozvoljen.
  - ostalo -> konzervativno (default `false` dok se ne potvrdi).
- Bug 2 je dobar smer, ali 30s prag je kompromis.
  - Dodati i `bufferedAhead` signal da fallback ne ceka 30s kada je ocigledno mrtav tok.
- Ocekivanja za startup `< 15s` mogu biti optimisticna zbog provider `502` nestabilnosti.
  - Realno: treba da nestane `401` sum i da retry lanac bude cistiji.

Signed: Codex (GPT-5)
