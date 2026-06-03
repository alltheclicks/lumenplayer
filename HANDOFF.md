# Handoff — Lumen Player

## Session 2026-06-03 — QAF-035 no-media production guard alignment

- Context:
  - active preserved worktree:
    - `/Users/filip/Documents/Lumen-Player-qaf035-production`
  - active branch:
    - `codex/qaf-035-production-web-catchup`
  - active PR:
    - #224 `[codex] Consolidate QAF-035 web catch-up production path`
- Current source of truth:
  - broken catch-up channels must not be fixed with local ffmpeg/ffprobe, server-side transcode/remux, generated HLS, `proxy-remuxed`/`remux-hls`, or XUI-side transcode/remux
  - allowed runtime outcomes are provider-direct/provider bytes, proxy-normalized manifests without media processing, or a clear unsupported/failure overlay
  - the historical March remux/transcode branches and notes below are preserved for audit context only; they are not an accepted beta/release direction
- Current guardrails on PR #224:
  - web catch-up rejects `proxy-remuxed`
  - proxy runtime strips `proxy-remuxed`, rejects direct `remux-hls`, and returns `remux_disabled` from `__remux__` asset endpoints
  - `apps/proxy/src/catchup-remux.ts` hard-disables direct controller calls before binary checks or process spawn
  - `pnpm release:proxy-no-media:validate` statically verifies the hard-disable guard, CI workflow, package script, release artifact, and runbook coverage
  - `pnpm release:proxy-no-media:test` covers controller, gateway, and server behavior
  - `pnpm release:secret-hygiene:validate` now scans release evidence/docs/templates plus `HANDOFF.md`, `BACKLOG.md`, and `docs/V3-QA-FIX-BACKLOG.md`, so current-truth docs cannot reintroduce non-redacted provider credentials
- Current beta state:
  - local/provider/browser/no-media evidence is partial and useful, but final beta signoff remains pending on real provider/XUI owner confirmation, 300-500 user capacity approval, real device target matrix, beta ops/observability, and final go/no-go

## Session 2026-06-02 — QAF-035 production web catch-up PR alignment

- Context:
  - active preserved worktree:
    - `/Users/filip/Documents/Lumen-Player-qaf035-production`
  - active branch:
    - `codex/qaf-035-production-web-catchup`
  - active PR:
    - #224 `[codex] Consolidate QAF-035 web catch-up production path`
  - latest provider-preflight addendum:
    - see current PR #224 head on `codex/qaf-035-production-web-catchup`
- Current state:
  - PR #224 is still draft, but merge state is `CLEAN`
  - GitHub `PR Quality Gate` is green on latest head:
    - `automation-scripts`
    - `web-quality`
  - local QAF worktree is clean and synced with `origin/codex/qaf-035-production-web-catchup`
  - main checkout remains separate and must not be collapsed/pruned until QAF work is explicitly merged or otherwise preserved
- What changed in this alignment pass:
  - transient Xtream HTTP retry/backoff now covers `429`, `502`, `503`, and `504`, with `Retry-After` support
  - QA network reports now include successful Xtream responses, so recovered `429` calls can be treated as warnings instead of false blockers
  - QA global setup and focused playback smoke now fail fast when the QA provider account is rejected instead of surfacing generic `/player` or `channel-select` timeouts
  - standalone provider preflight now exists:
    - `pnpm e2e:provider:preflight`
    - loads env credentials first, otherwise `output/playwright/qa-user-sim/storage-state.json`
    - verifies Xtream auth and non-empty live catalog before browser smoke
    - writes redacted evidence to `output/playwright/provider-qa-preflight/REPORT.md`
  - release smoke/regression matrix now requires `provider-qa` coverage:
    - `SMK-PROVIDER-AUTH-LIVE-CATALOG`
    - `REG-PROVIDER-FOCUSED-PLAYBACK`
  - release readiness review now requires the smoke/regression matrix gate, so final signoff cannot bypass provider-backed smoke evidence
  - go/no-go checklist now has explicit provider auth/live-catalog, provider focused playback, and 300-500-user beta capacity checks
- Current blocker:
  - stored QA provider credentials return `user_info.auth = 0`
  - live browser playback and QA simulation cannot prove beta readiness until a valid QA provider account is available
  - this blocker is now explicit in both QA tooling and release matrix expectations
- Verification completed on latest work:
  - `pnpm release:smoke-matrix:validate`
  - `pnpm release:smoke-matrix:test`
  - `pnpm exec vitest run`
  - `pnpm exec turbo typecheck --force`
  - `pnpm exec turbo lint --force`
  - `pnpm exec turbo build --force`
  - `pnpm e2e:provider:preflight` currently exits `1` with expected blocker `auth_0`
  - GitHub `PR Quality Gate` on current PR #224 head
- Evidence snapshot folder:
  - `/Users/filip/Documents/lumen-alignment-snapshot-20260602-141420`
  - provider preflight addendum:
    - `/Users/filip/Documents/lumen-alignment-snapshot-20260602-141420/provider-preflight-20260602-160449`

## Session 2026-04-03 — shadow `fMP4` provider validation + Lumen-side mitigations

- Context:
  - continued on branch:
    - `codex/qaf-035-shadow-admin-validation`
  - provider/admin `timeshift_shadow.php` on `edge6.castcdn.net` now serves real `fMP4` fallback for problematic streams instead of temporarily leaking stale TS manifests
- Provider state confirmed today:
  - for `HRT 1` (`stream_id=75`) and `RTS 1` (`stream_id=112`), fresh shadow manifests now return:
    - `#EXT-X-MAP`
    - `init.mp4`
    - `.m4s` media segments
    - cache headers:
      - `Cache-Control: no-store, no-cache, must-revalidate, max-age=0`
      - `Pragma: no-cache`
  - OVH log now shows the intended fallback path, for example:
    - `shadow build rejected ... profile=ts reason=decode_fallback`
    - `shadow build stream=... profile=mp4 audio=copy`
    - `manifest serve ... format=mp4`
- Latest runtime observations:
  - decode-stop across old minute boundaries is materially improved:
    - `HRT 1` now starts, seeks past `:59`, and no longer fails in the old TS-only way
    - `RTS 1` shadow also resolves to `fMP4`
  - remaining provider quality issue is now mostly:
    - audio/video desync on `HRT 1`
    - occasional non-fatal stalls/spinners in the browser despite segments existing server-side
- Done in Lumen (local, not yet committed in this handoff slice):
  - added catch-up program navigation helper:
    - `apps/web/src/components/player/catchupProgramNavigation.ts`
  - added auto-advance to the next archived EPG item when a catch-up program reaches `ended`:
    - wired in `apps/web/src/pages/Player.tsx`
    - `VideoPlayer` now receives `onEnded`
  - added catch-up buffering watchdog in `Player.tsx`:
    - if local catch-up playback sits in `buffering` on the same source/position bucket for ~`6s`, Lumen retries the current catch-up source once for that bucket
    - this is intended to break “segment exists but Chrome spins forever” cases such as the observed `~3:49` stall
  - added `hls.js`-side buffering recovery timer in:
    - `apps/web/src/adapters/HlsPlayerAdapter.ts`
    - when `waiting` persists without time progress, the adapter now does a bounded `recoverMediaError()` + `play()` attempt instead of waiting indefinitely
  - focused tests added/updated:
    - `apps/web/src/components/player/catchupProgramNavigation.test.ts`
    - `apps/web/src/adapters/HlsPlayerAdapter.test.ts`
  - local validation now green:
    - `pnpm --filter @lumen/web exec vitest run src/components/player/catchupSource.test.ts src/components/player/catchupTransport.test.ts src/components/player/catchupProgramNavigation.test.ts src/adapters/HlsPlayerAdapter.test.ts`
    - `pnpm --filter @lumen/web typecheck`
- Next exact task:
  - headed Lumen validation on `http://127.0.0.1:8081`
  - verify:
    - `HRT 1` no longer hangs indefinitely around `~3:49`
    - catch-up end really advances into the next archived program instead of stopping
    - note whether A/V desync remains even after the new watchdog

## Session 2026-04-01 — strict `shadow-only` Lumen validation wiring

- Context:
  - continued in `/Users/filip/Documents/Lumen-Player-qaf035-sync`
  - active branch remains:
    - `codex/qaf-035-shadow-admin-validation`
  - goal of this slice was not to reopen the confirmed remux/transcode workaround, but to make the web app validate the provider/admin `timeshift_shadow.php` fix without silently sliding back onto `timeshift_hls` or local proxy remux
- Important clarification captured for future continuation:
  - there are now three distinct catch-up paths for this provider:
    - `proxy-remuxed`
      - Lumen workaround on branch `codex/qaf-035-remux-efficiency-tests`
      - known-good browser fix
      - currently FFmpeg **transcode** (`libx264` + `aac`), not cheap packet-copy remux
      - this is the path that spikes CPU when local proxy/gateway is enabled
    - provider `timeshift_hls`
      - direct provider/browser-oriented HLS path on `edge6:8080`
      - in one real Lumen UI run this was the path that got past `0:59` with a brief `~0.5-1s` visual stall before recovering
      - there was no local `ffmpeg` or proxy remux process running in that observation
    - provider `timeshift_shadow.php`
      - token-based admin validation path on `https://edge6.castcdn.net/streaming/timeshift_shadow.php?token=...`
      - standalone browser/harness evidence already looked materially better than the old provider paths
- Done in code:
  - finished the web-side strict shadow validation gate in:
    - `apps/web/src/components/player/catchupSource.ts`
  - behavior with `VITE_CATCHUP_SHADOW_VALIDATION=1`:
    - resolves the seed request from an existing `streaming/timeshift.php?...` candidate when available
    - otherwise reconstructs the seed generator from the existing `timeshift_hls` + legacy `/timeshift/...` candidates already produced by `XtreamCodesService`
    - follows the real provider redirect/token flow
    - rewrites the final edge token URL onto `timeshift_shadow.php`
    - builds a **shadow-only** transport plan with no fallback attempts
    - throws `catchup_shadow_validation_unavailable` instead of silently falling back to direct `timeshift_hls` or local proxy remux/gateway
  - kept token rewrite logic in:
    - `apps/web/src/components/player/catchupTransport.ts`
    - edge token URLs on `edge6.castcdn.net` still rewrite from `/streaming/timeshift.php?token=...` to `/streaming/timeshift_shadow.php?token=...`
  - added focused tests in:
    - `apps/web/src/components/player/catchupSource.test.ts`
    - asserts:
      - successful shadow token resolve produces a single-attempt `shadow-only` plan
      - failed shadow resolve throws instead of falling back
- Local validation:
  - `pnpm --filter @lumen/web exec vitest run src/components/player/catchupTransport.test.ts src/components/player/catchupSource.test.ts`
  - `pnpm --filter @lumen/web typecheck`
- Manual validation command for the next agent/user:
  - run only the web app, with no local proxy/remux:
    - `cd /Users/filip/Documents/Lumen-Player-qaf035-sync`
    - `LUMEN_DEBUG_PROXY_LOG=1 VITE_XTREAM_SERVER='http://smart.mediaking.fi:8080' VITE_CATCHUP_GATEWAY_ENABLED='0' VITE_CATCHUP_SHADOW_VALIDATION='1' pnpm --filter @lumen/web dev --host 127.0.0.1 --port 8081`
  - expected runtime signal from Lumen:
    - startup seed may still hit `smart.../streaming/timeshift.php?...`
    - actual playback source must become `https://edge6.castcdn.net/streaming/timeshift_shadow.php?token=...`
    - there must be no active local `ffmpeg`/proxy remux process and no playback fallback onto `edge6:8080/timeshift_hls/...`
- Next exact task:
  - run one focused in-app validation from Lumen UI on:
    - `RTS 1` around `02:00`
    - `PINK` around `01:00`
  - record:
    - exact playback URL used by the app
    - whether any brief stall remains around `~0:59-1:01`
    - whether Chrome/WebKit still recover cleanly without local transcode

## Session 2026-03-17 — split branch for XUI shadow validation

- Context:
  - continued in `/Users/filip/Documents/Lumen-Player-qaf035-sync`
  - created a dedicated branch for testing the provider/admin `timeshift_shadow.php` fix without mixing that work into the already-confirmed remux/transcode fallback line
- Branches:
  - preserved confirmed remux/transcode fallback reference at:
    - branch: `codex/qaf-035-remux-efficiency-tests`
    - head: `cab9a41` (`Harden remux fallback and capacity controls`)
  - opened new validation branch from that same head:
    - branch: `codex/qaf-035-shadow-admin-validation`
- Important note:
  - the remux/transcode workaround is still the only locally confirmed browser-safe fallback through Lumen for the Mediaking provider
  - the new branch exists specifically so shadow/XUI validation can proceed without losing track of that known-good fallback state

## Session 2026-03-16 — confirmed web catch-up workaround via proxy remux/transcode (`codex/qaf-035-catchup-remux`)

- Context:
  - continued in `/Users/filip/Documents/Lumen-Player-qaf035-sync`
  - tested real browser flow with:
    - `web`: `http://127.0.0.1:8080`
    - `proxy`: `http://localhost:8789`
    - real credentials: `fica`
  - target was to verify whether the new gateway/remux wiring actually replaces the broken provider-direct browser path at runtime
- Root cause found:
  - gateway resolve already returned `proxy-remuxed`, but the web client kept using the wrong origin for the returned proxied playback URL
  - because of that mismatch, the first media request hit the Vite `/xui-api` proxy instead of the real proxy server with remux handlers
  - practical effect: remux attempt failed immediately and playback silently fell back to the old provider-direct `timeshift_hls` chain
- Done:
  - fixed gateway playback URL normalization in:
    - `apps/web/src/components/player/catchupGateway.ts`
  - added focused client test coverage in:
    - `apps/web/src/components/player/catchupGateway.test.ts`
- Local validation:
  - `pnpm --filter @lumen/web exec vitest run src/components/player/catchupGateway.test.ts src/components/player/catchupSource.test.ts src/components/player/catchupTransport.test.ts src/adapters/HlsPlayerAdapter.test.ts`
- Runtime verification:
  - `RTS 1` catch-up now uses:
    - `POST /catchup-gateway/resolve`
    - `GET http://localhost:8789/xui-api/...__lumenTransport=remux-hls`
    - `GET /xui-api/__remux__/session/.../init.mp4`
    - `GET /xui-api/__remux__/session/.../segment/*.m4s`
  - confirmed the active playback source remains `proxy-remuxed` with `catchUpAttemptIndex=0`
  - `RTS 1` passed the old failure points:
    - seek to `0:55` -> playback continued past `1:07`
    - seek to `1:55` -> playback continued past `2:10`
  - `PINK` also used the same `proxy-remuxed` path and passed the old `~1:00` failure point:
    - seek to `0:55` -> playback continued past `1:10`
  - one non-fatal `MEDIA_ERROR` warning still appeared during the PINK seek test, but playback recovered and continued; no fatal decode stop was observed in this verification slice
- Important implementation note:
  - despite the current naming, this workaround is **not** a cheap packet-copy remux in the proxy today
  - current proxy output is generated by FFmpeg transcoding:
    - video: `libx264`
    - audio: `aac`
    - container/output: browser-safe HLS with fMP4 segments
  - this is why CPU usage spikes during catch-up playback preparation/serving
- Current conclusion:
  - we now have one confirmed browser-safe workaround for this provider:
    - `proxy-remuxed` catch-up via proxy-side FFmpeg transcode
  - this closes the immediate browser playback problem for tested channels, but it is not yet the preferred production form for a small VPS host because CPU cost is materially higher than provider-direct or packet-copy normalization
  - next follow-up should focus on lower-CPU production options, not on reopening the already-fixed browser routing bug

## Session 2026-03-09 — QAF-034/QAF-035 Chromium catch-up triage on provider `timeshift_hls`

- Context:
  - Tested real local stack with `fica` credentials on:
    - `web`: `http://localhost:8080`
    - `proxy`: `http://localhost:8788`
  - Provider deployed a new browser-oriented catch-up endpoint:
    - `/timeshift_hls/{username}/{password}/{duration}/{start}/{stream_id}.m3u8`
    - and token flow equivalent under `/streaming/timeshift_hls.php?token=...`
  - Goal of this session was to verify whether the new provider HLS path removes the old web-only archive failures and whether any remaining bugs are still in Lumen or only in provider output.
- Done:
  - verified that direct login-host `serv2/.../timeshift_hls/...` is not a valid startup path on this provider; `serv2` returns `404` and the real working flow is:
    - `serv2 /streaming/timeshift.php?...extension=m3u8`
    - `302`
    - archive host `.../timeshift_hls/...m3u8`
  - kept proxy-side redirect upgrade in place so the old `serv2` query generator is rewritten onto the archive-host `timeshift_hls` HLS manifest when redirect info becomes available.
  - fixed a real web startup bug in:
    - `apps/web/src/components/player/catchupTransport.ts`
  - behavior change:
    - restored query-first catch-up startup selection ahead of direct login-host redirect manifests
    - this removes the bad Chromium startup loop where web first hit non-existent `serv2/timeshift_hls/...` URLs several times before falling back to the real provider redirect path
  - updated focused tests in:
    - `apps/web/src/components/player/catchupTransport.test.ts`
- Local validation:
  - `pnpm --filter @lumen/web exec vitest run src/components/player/catchupTransport.test.ts`
- Runtime findings after the web startup fix:
  - Lumen no longer wastes startup attempts on `serv2/timeshift_hls/...`; the Chromium request chain is now the correct one:
    - `serv2 /streaming/timeshift.php?...extension=m3u8 -> 302 -> archive host /timeshift_hls/...m3u8`
  - `RTS 1`:
    - old `0:41` failure from raw/archive path is no longer the active symptom on the new provider HLS path
    - playback now reaches the provider `timeshift_hls` HLS, but still stops around `2:00`
    - browser-side failure remains `MEDIA_ERR_DECODE` / `PIPELINE_ERROR_DECODE`
    - direct decode probe on later segments still reports `non-existing PPS 0 referenced` / `no frame!`
  - `PINK`:
    - after the web startup fix, catch-up no longer fails on the old `serv2/timeshift_hls` `404` loop
    - provider HLS manifest + segments load successfully from archive host
    - playback still fails around `1:00` with the same browser decode family (`PIPELINE_ERROR_DECODE`) once playback is forced to continue
  - `LIVE` remains healthy for tested channels (`RTS 1`, `PINK`)
- Current conclusion:
  - one bug really was on our side:
    - wrong primary catch-up startup URL selection for providers where `timeshift_hls` exists only after redirect onto archive host
  - that startup bug is now fixed locally
  - the remaining blocker is still provider media output quality, not Lumen routing:
    - `RTS 1` decode break around `~2:00`
    - `PINK` decode break around `~1:00`
- Next recommended step:
  - continue with provider-facing evidence using the real `serv2 -> redirect -> archive-host /timeshift_hls` flow
  - ask provider to validate segment independence/keyframe boundaries on the later `timeshift_hls` segments, not only the initial startup portion

## Session 2026-03-09 — provider-backed `timeshift_hls` evidence probe (`smart.mediaking.fi`, `fica`)

- Context:
  - continued in `/Users/filip/Documents/Lumen-Player-qaf035-sync`
  - used real provider credentials:
    - server: `http://smart.mediaking.fi:8080`
    - user: `fica`
  - added reusable CLI evidence tool:
    - `scripts/catchup/probe-timeshift-hls.mjs`
  - probed the real query-first catch-up startup on:
    - `RTS 1` (`stream_id=112`)
    - `PINK` (`stream_id=105`)
  - probe input timestamp used:
    - `2026-03-09:15-58` with `duration=240`
- Artifacts:
  - `output/catchup/rts1-timeshift-hls-2026-03-09-1558.json`
  - `output/catchup/pink-timeshift-hls-2026-03-09-1558.json`
- Findings:
  - both channels follow the valid provider startup chain:
    - `http://smart.mediaking.fi:8080/streaming/timeshift.php?...extension=m3u8`
    - `302`
    - `https://edge6.castcdn.net/streaming/timeshift.php?token=...`
    - `200` HLS manifest
  - direct archive-host credentialed `https://edge6.castcdn.net/timeshift_hls/...m3u8` fetch was not a reliable manual evidence path here:
    - both direct attempts timed out
  - provider token manifest itself already contains browser-risk decode evidence on both channels:
    - playlist decode probe on the first `150s` reports repeated `non-existing PPS 0 referenced` + `no frame!`
    - sampled segment probes at `0s`, `60s`, and `120s` all still emit the same H.264 warnings while returning stream metadata
    - a later segment (`seg=90`) is outright invalid for both channels:
      - `ffprobe`: `Invalid data found when processing input`
      - `ffmpeg`: `Error opening input files: Invalid data found when processing input`
  - provider response shape is also suspicious:
    - request asked for `duration=240`
    - returned manifest contains `91` segments / `5460s` total on both channels
- Current conclusion:
  - this is no longer only browser playback evidence; the provider archive media itself is emitting codec continuity errors under direct CLI probing
  - `provider-direct` is not a trustworthy long-term mode for this provider's catch-up path in current form
  - next practical fallback candidate is targeted `proxy-remuxed` validation for this provider / stream set, while keeping the provider evidence packet ready

## Session 2026-03-08 — QAF-035 proxy-side raw archive remux (`codex/qaf-035-catchup-remux`)

- Context:
  - Continued from clean continuation worktree `/Users/filip/Documents/Lumen-Player-qaf035-sync` after re-running the mandatory context check:
    - `git fetch origin --prune`
    - confirmed `origin/main` is still docs-sync baseline `c9ac171` (merged PR `#221`)
    - re-read `BACKLOG.md`, `docs/V3-QA-FIX-BACKLOG.md`, `HANDOFF.md`, `docs/WORKFLOW-LLM-QA.md`, `VISION.md`
    - re-read the raw archive analyses in:
      - `docs/catchup-player-analysis.md`
      - `docs/smarters-archive-raw-analysis-short.md`
  - Locked direction for this slice stayed the same:
    - failing web archive path is a splice-boundary/decode robustness problem, not an HLS refresh problem
    - browser-safe fix belongs in optional proxy/gateway remux, outside `@lumen/session-core`
- Done:
  - implemented ffmpeg-based raw archive remux subsystem in:
    - `apps/proxy/src/catchup-remux.ts`
  - remux subsystem behavior:
    - chooses raw redirect-style catch-up `.ts` as remux upstream, preferring `/timeshift/{user}/{pass}/{duration}/{start}/{stream}.ts`
    - strips local `__lumen*` metadata from the remux request key
    - spawns one ffmpeg job per sanitized catch-up request key
    - writes EVENT HLS + fMP4 assets to `${os.tmpdir()}/lumen-catchup-remux/<sessionId>/`
    - exposes stable proxy asset paths under `/xui-api/__remux__/session/...`
    - sweeps stale sessions by TTL, kills lingering ffmpeg processes, and removes temp dirs
  - rebuilt gateway transport selection in:
    - `apps/proxy/src/catchup-gateway.ts`
  - gateway behavior now:
    - attempts `proxy-remuxed` first only when remux gate matches and bootstrap succeeds
    - downgrades same resolve call to `proxy-normalized` on remux bootstrap/binary failure with specific fallback reason
    - keeps `provider-direct` only as final fallback
    - preserves resolve contract shape while decorating proxy playback URLs with existing metadata params:
      - `__lumenTransport`
      - `__lumenProgramId`
      - `__lumenStreamId`
      - `__lumenStart`
      - `__lumenDuration`
      - optional `__lumenFallbackReason`
  - adapted Fastify proxy integration in:
    - `apps/proxy/src/server.ts`
  - Fastify changes:
    - instantiated shared remux controller alongside catch-up gateway
    - added remux asset handlers before generic `/xui-api/:encodedTarget/*` pass-through
    - intercepts proxied catch-up requests carrying `__lumenTransport=remux-hls` and returns generated HLS manifest body directly
    - keeps existing redirect rewriting, allowlist checks, CORS behavior, and live/non-remux pass-through intact
    - gateway resolve now builds playback URLs from the real request origin instead of fallback `http://localhost`
  - added/updated proxy tests in:
    - `apps/proxy/src/catchup-remux.test.ts`
    - `apps/proxy/src/catchup-gateway.test.ts`
    - `apps/proxy/src/server.test.ts`
- Local validation:
  - `pnpm --filter @lumen/proxy typecheck`
  - `pnpm --filter @lumen/proxy lint`
  - `pnpm --filter @lumen/proxy exec vitest run src/catchup-remux.test.ts src/catchup-gateway.test.ts src/server.test.ts`
  - `pnpm --filter @lumen/web typecheck`
  - `pnpm --filter @lumen/web exec vitest run src/components/player/catchupGateway.test.ts src/components/player/catchupSource.test.ts src/components/player/catchupTransport.test.ts src/components/player/sessionSources.test.ts src/pages/restoreSessionSource.test.ts`
- Status:
  - proxy/gateway now has a clean ffmpeg remux path for flagged web catch-up requests, with same-call downgrade when remux is unavailable
  - live playback logic and current web restore/session metadata slice stayed untouched beyond compatibility validation
  - manual runtime verification with real provider credentials is still pending for this PR before any merge decision

## Session 2026-03-06 — QAF-035 runtime catch-up stall triage (`codex/qaf-035-clean-continuation`)

- Context:
  - Followed up on user-reported RTS 1 catch-up runtime failure: selected `08:30 Jutarnji program` started around `0:15` and reproducibly stalled around `0:40`.
  - Debugged against real local stack (`web` on `:8080`, `proxy` on `:8788`) with Playwright/browser network traces and provider-backed `fica` credentials.
- Done:
  - confirmed the `0:15` start offset came from the existing catch-up guard, but proved it was not the root cause by replaying the same program from `0:00`; decode still failed at ~`0:41`.
  - fixed browser preflight for the gateway resolve contract in `apps/proxy/src/server.ts`:
    - added explicit `OPTIONS /catchup-gateway/resolve`
    - widened catch-up gateway CORS allow-methods to include `POST`
  - changed catch-up startup candidate priority to prefer canonical query-based catch-up URLs ahead of redirect token manifests:
    - `apps/web/src/components/player/catchupTransport.ts`
    - `apps/proxy/src/catchup-gateway.ts`
  - aligned tests for the new query-first behavior:
    - `apps/web/src/components/player/catchupTransport.test.ts`
    - `apps/web/src/components/player/sessionSources.test.ts`
    - `apps/proxy/src/server.test.ts`
    - `apps/proxy/src/catchup-gateway.test.ts`
- Runtime findings:
  - before the proxy fix, browser `POST http://localhost:8788/catchup-gateway/resolve` failed on CORS preflight and web silently fell back to direct transport planning.
  - after the fix, gateway resolve succeeds and web now starts catch-up from the query path (`/streaming/timeshift.php?...extension=m3u8`) instead of choosing redirect token manifests first.
  - despite that improvement, RTS 1 catch-up still reproducibly fails with `MEDIA_ELEMENT_3` / `PIPELINE_ERROR_DECODE` at ~`0:41`.
  - network traces show catch-up playback reaches provider token manifest + first two `seg=` requests successfully, then the browser decode pipeline fails before playback can continue.
  - this points to a provider media/decode issue in the current provider-direct catch-up chain, not a simple restore/session-state bug.
- Local validation:
  - `pnpm --filter @lumen/web typecheck`
  - `pnpm --filter @lumen/web exec vitest run src/components/player/catchupGateway.test.ts src/components/player/catchupSource.test.ts src/components/player/catchupTransport.test.ts src/components/player/sessionSources.test.ts src/pages/restoreSessionSource.test.ts`
  - `pnpm --filter @lumen/proxy exec vitest run src/server.test.ts src/catchup-gateway.test.ts`
- Status:
  - gateway/browser integration is cleaner now: no preflight failure, and canonical query-first startup is in place.
  - the user-visible 40s catch-up stall is **not** fully resolved yet; the remaining blocker appears to require real transport normalization/remux work rather than more metadata/restore tweaks.

## Session 2026-03-06 — QAF-035 restore/session metadata continuity (`codex/qaf-035-clean-continuation`)

- Context:
  - Continued clean PR `#222` slice on top of `codex/qaf-035-clean-continuation` after confirming `origin/main` is on docs-sync baseline `c9ac171` (merged PR `#221`).
  - Scope stayed inside web catch-up gateway/session restore wiring; no seek/chunk-aware preparation or old stacked remux diff was reintroduced.
- Done:
  - introduced canonical session-source helpers in:
    - `apps/web/src/components/player/sessionSources.ts`
    - `apps/web/src/pages/restoreSessionSource.ts`
  - catch-up session metadata now preserves canonical restore fields (`programId`, `startTimestamp`, `durationSeconds`, `fallbackStreamIds`, optional `gateway`) while still carrying runtime attempt metadata needed by current `VideoPlayer`.
  - startup bootstrap on `Player` now normalizes persisted live/catch-up session sources before rendering local playback:
    - stale live restore snaps back to canonical live URL;
    - persisted catch-up rebuilds a fresh transport plan from canonical metadata and reuses gateway playback when available;
    - invalid/stale catch-up restore falls back safely with user notice instead of replaying stale token URLs.
  - retry path now rebuilds live/catch-up sources from canonical metadata instead of cloning stale session URLs.
  - carried forward valid transport follow-ups from old stacked gateway work without remux/chunk-aware scope:
    - manifest-first catch-up startup ordering when both manifest and transport redirects exist;
    - capped catch-up transport plan length to keep persisted session metadata bounded;
    - rebuild path can prepend persisted gateway playback as the first attempt.
  - updated tests:
    - `apps/web/src/components/player/sessionSources.test.ts`
    - `apps/web/src/pages/restoreSessionSource.test.ts`
    - `apps/web/src/components/player/catchupTransport.test.ts`
- Local validation:
  - `pnpm --filter @lumen/web typecheck`
  - `pnpm --filter @lumen/web lint`
  - `pnpm --filter @lumen/web exec vitest run src/components/player/catchupGateway.test.ts src/components/player/catchupSource.test.ts src/components/player/catchupTransport.test.ts src/components/player/sessionSources.test.ts src/pages/restoreSessionSource.test.ts`
  - `pnpm --filter @lumen/proxy typecheck`
- Status:
  - restore/session metadata continuity for gateway-backed catch-up is now wired on the clean continuation branch;
  - live remains on canonical direct rebuild path and gateway stays optional fallback metadata, outside `@lumen/session-core`.

## Session 2026-03-06 — QAF-035 branch reconciliation + clean continuation baseline

- Context:
  - Catch-up work for `QAF-035` had spread across several experimental `codex/` branches over ~10 days, and source-of-truth docs no longer matched the real git graph.
  - Goal of this session was to collapse project state into one documented baseline before continuing more proxy/gateway work.
- Verified git state:
  - `main` / `origin/main` are at `a825816` (after merged `QAF-034` batch state).
  - active experimental branches relevant to current catch-up work:
    - `codex/lp-1511-xtream-gateway`
    - `codex/qaf-035-runtime-payload-gate`
    - `codex/qaf-035-catchup-runtime-gate`
    - `codex/disable-demo-fallback-xui`
    - `codex/qaf-035-catchup-gateway`
  - latest gateway branch is stacked on prior experimental history:
    - `codex/qaf-035-catchup-gateway` (`66a608a`) sits on top of `codex/disable-demo-fallback-xui` (`017e9a6`), not directly on `main`
- Accepted carry-forward direction:
  - keep `LP-1511` proxy groundwork as useful foundation
  - keep `QAF-035` Option B gateway direction as target architecture
  - do not carry forward the old stacked branch chain as the new baseline
  - future code work should selectively port validated pieces onto a clean branch from `origin/main`
- Architecture decision locked:
  - catch-up gateway remains optional and outside `@lumen/session-core`
  - shared core keeps session/state/neutral playback contract only
  - provider/browser-specific repair stays in gateway or platform transport layer
- Documentation updates made in this session:
  - `BACKLOG.md`
    - added explicit `QAF-035` active track and noted clean-baseline reset
  - `docs/V3-QA-FIX-BACKLOG.md`
    - added branch reconciliation snapshot, updated next-ready queue, and logged the baseline reset
  - `docs/WORKFLOW-LLM-QA.md`
    - added mandatory experimental-branch stack reset rule
  - `VISION.md`
    - clarified Option B boundary between shared core and optional catch-up gateway
- Clean continuation setup:
  - created clean worktree from `origin/main`:
    - `/Users/filip/Documents/Lumen-Player-qaf035-sync`
  - created clean docs branch for this reconciliation step:
    - `codex/docs-sync-qaf-035-baseline`
- Immediate known follow-up blockers before reusing gateway code:
  - periodic cache sweep in proxy service
  - async catch-up switch error handling in UI
  - PiP cleanup regression
  - stricter gateway response validation
  - `pnpm-lock.yaml` parity for CI

## Session 2026-02-23 — QAF-034 provider catch-up compatibility hardening

- Context:
  - `QAF-034` remained `pending-review` due user-reported runtime failures in real catch-up flow despite earlier fixes.
  - Direct provider probes confirmed this provider rejects epoch-based `start` in `timeshift.php` and accepts formatted `YYYY-MM-DD:HH-MM` start; behavior differs from "epoch-only" guidance.
- Done:
  - extended catch-up URL candidate generation in:
    - `packages/api/src/xtream-codes-service.ts`
    - `packages/api/src/xtream-codes-service.test.ts`
  - provider fallback chain now includes:
    - local-time + UTC formatted `start` variants,
    - duration in minutes first, then seconds fallback,
    - expanded legacy path variants (formatted + epoch start) as final compatibility fallback.
  - improved runtime retry behavior for primary catch-up request in:
    - `apps/web/src/pages/Player.tsx`
    - `apps/web/src/components/player/PlayerControls.tsx`
    - adds bounded same-URL retries before broader stream/offset fallback variants.
  - canonical Xtream server resolution from `server_info` and dev-proxy routing for dynamic host assignment in:
    - `apps/web/src/config/xtream.ts`
    - `apps/web/src/config/xtream.test.ts`
    - `apps/web/src/pages/Login.tsx`
    - `apps/web/src/pages/Player.tsx`
    - `apps/web/vite.config.ts`
- Local validation:
  - `pnpm typecheck` -> pass
  - `pnpm vitest run packages/api/src/xtream-codes-service.test.ts apps/web/src/config/xtream.test.ts` -> pass
- Notes:
  - Existing user-owned changes in series artwork files stayed untouched in this task scope:
    - `apps/web/src/pages/SeriesCategories.tsx`
    - `apps/web/src/pages/SeriesDetail.tsx`
    - `apps/web/src/pages/seriesArtwork.ts`
    - `apps/web/src/pages/seriesArtwork.test.ts`
  - Greptile round is not executed locally; next step is PR + external review/runtime verification on user environment.

---

## Session 2026-02-21 — Docs reconciliation for already merged QAF-024..QAF-031

- Context:
  - Source-of-truth docs were stale against actual merged state on `main`.
  - Verified merged execution order and PR trail from git/PR history before selecting next ready tasks.
- Verified merged sequence:
  - `QAF-024 -> QAF-025 -> QAF-026 -> QAF-027 -> QAF-028 -> QAF-029 -> QAF-030 -> QAF-031`
- PRs already merged on `main`:
  - #198 (`QAF-024`)
  - #199 (`QAF-025`)
  - #200 (`QAF-026`)
  - #201 (`QAF-027`)
  - #203 (`QAF-028`)
  - #204 (`QAF-029`)
  - #205 (`QAF-030`)
  - #206 (`QAF-031`)
- Note:
  - A separate docs-sync PR was open (`#207`) but not merged at session start; this handoff/docs-sync pass supersedes stale planning state in `BACKLOG.md`/`HANDOFF.md`.

---

## Session 2026-02-21 — QAF-032, QAF-033 (ordered batch)

- Context:
  - After reconciliation, next ready queue was `QAF-032 -> QAF-033`.
  - Task flow stayed strict sequential (`1 task -> 1 branch -> 1 PR -> merge`), with latest `main` sync before next task.
- PRs:
  - #209 (`QAF-032`) merged, Greptile final `5/5` after one valid-comment remediation commit
  - #210 (`QAF-033`) merged, Greptile `5/5`
- Done:
  - QAF-032:
    - removed persistent helper copy from primary player rows (`Klikni traku za TV unazad`, `Klik za TV unazad`, `TV unazad`) while keeping contextual live-bar affordance cues (`title`, `aria-label`, focus behavior) in:
      - `apps/web/src/components/player/PlayerControls.tsx`
  - QAF-033:
    - aligned on-demand local overlay with essential live control parity (play/pause, seek timeline, +/-15s seek, audio access, fullscreen, PiP, cast/airplay, retry/back/live-route actions) in:
      - `apps/web/src/pages/Player.tsx`
    - made spinner non-blocking/short-lived for on-demand startup using configurable loading-overlay max window in:
      - `apps/web/src/components/player/VideoPlayer.tsx`
- Local gates per task PR:
  - `pnpm lint`
  - `pnpm typecheck`
  - focused tests:
    - `pnpm --filter @lumen/web exec vitest run src/components/player/liveTimeshift.test.ts src/components/player/controlsIdlePolicy.test.ts src/pages/liveCatchUpVisibility.test.ts` (QAF-032)
    - `pnpm --filter @lumen/web exec vitest run src/pages/playerOnDemandContext.test.ts src/pages/livePauseResumePolicy.test.ts src/components/player/videoPlaybackSync.test.ts` (QAF-033)
- Greptile/check notes:
  - Review start confirmation recorded on both PRs via `Greptile Review` check-run entering `pending`.
  - QAF-032 first pass flagged one valid remaining helper-copy instance; fixed on-task, then final score `5/5`.
  - QAF-033 finalized on first review cycle with `5/5`.
- QA gate (post-batch):
  - Executed:
    - `E2E_XUI_USERNAME='<redacted>' E2E_XUI_PASSWORD='<redacted>' ./run-qa-simulation.sh`
  - Current result:
    - command exits `1` due Playwright loader conflict (`Requiring @playwright/test second time`), captured in:
      - `output/playwright/qa-user-sim/results.json`
    - generated report remains non-actionable (`Scenario status: unknown`, `Scenarios executed: 0`) in:
      - `output/playwright/qa-user-sim/QA-REPORT.md`

---

## Session 2026-02-21 — Intake triage (BUG-20260221-01..08)

- Context:
  - Captured new owner-reported issues from manual web playback testing (layout, live restore, catch-up behavior, series assets, controls UX).
  - Applied workflow triage from `docs/WORKFLOW-LLM-QA.md` and converted intake IDs into next stabilization tasks.
- Intake to QAF conversion:
  - `BUG-20260221-01` -> `QAF-024` (player scrollbar consistency + TV-unazad overflow containment)
  - `BUG-20260221-02` -> `QAF-025` (new-tab live restore should snap to live edge)
  - `BUG-20260221-03` -> `QAF-026` (pause/resume stale-threshold policy)
  - `BUG-20260221-04` -> `QAF-027` (volume slider control)
  - `BUG-20260221-05` -> `QAF-028` (Xtream series artwork mapping parity)
  - `BUG-20260221-06` -> `QAF-029` (blue bar seek handle/pointer affordance)
  - `BUG-20260221-07` -> `QAF-030` (catch-up network-error playback reliability)
  - `BUG-20260221-08` -> `QAF-031` (catch-up clock badge in channel list)
- Documentation updates:
  - `docs/V2-QA-FIX-BACKLOG.md`
    - added `BUG-20260221-01..08` intake records with environment/steps/evidence/severity
    - added triage snapshot `2026-02-21`
    - updated active QAF table (`QAF-024..QAF-031` open; `QAF-018..QAF-023` marked done)
  - `BACKLOG.md`
    - appended `QAF-024..QAF-031` as `planned` in stabilization track with dependencies
- Next ready order (strict queue):
  - `QAF-024 -> QAF-025 -> QAF-026 -> QAF-027 -> QAF-028 -> QAF-029 -> QAF-030 -> QAF-031`
- Note:
  - This session is docs/triage only; no code task branch/PR merge was executed in this step.

---

## Session 2026-02-20 — QAF-021, QAF-022, QAF-023 (ordered batch)

- Context:
  - Executed next ready stabilization tasks in strict source-of-truth order:
    - `QAF-021 -> QAF-022 -> QAF-023`
  - Task flow stayed strict sequential (`1 task -> 1 branch -> 1 PR -> merge`), with latest `main` sync before each next task.
- PRs:
  - #192 (`QAF-021`) merged, Greptile final `5/5` after follow-up remediation commit
  - #193 (`QAF-022`) merged, Greptile `5/5`
  - #194 (`QAF-023`) merged, Greptile `5/5`
- Done:
  - QAF-021:
    - replaced `narodna.tv` branding with `Lumen Player` in live player shell headers
    - moved cast control from side panels to player overlay controls (windowed + fullscreen) in:
      - `apps/web/src/components/player/PlayerControls.tsx`
      - `apps/web/src/pages/Player.tsx`
  - QAF-022:
    - added live status-bar click/tap timeshift interaction with explicit `UŽIVO` return actions in:
      - `apps/web/src/components/player/PlayerControls.tsx`
      - `apps/web/src/components/player/liveTimeshift.ts`
      - `apps/web/src/components/player/liveTimeshift.test.ts`
  - QAF-023:
    - improved non-fullscreen catch-up discoverability by wiring clock action to guided `TV Unazad` section jump with fallback to `/epg` and transient highlight in:
      - `apps/web/src/components/player/PlayerControls.tsx`
      - `apps/web/src/pages/Player.tsx`
      - `apps/web/src/pages/liveCatchUpDiscoverability.ts`
      - `apps/web/src/pages/liveCatchUpDiscoverability.test.ts`
- Local gates per task PR:
  - `pnpm lint`
  - `pnpm typecheck`
  - focused tests:
    - `pnpm --filter @lumen/web exec vitest run src/components/player/controlsIdlePolicy.test.ts src/pages/liveCatchUpVisibility.test.ts` (QAF-021)
    - `pnpm --filter @lumen/web exec vitest run src/components/player/liveTimeshift.test.ts src/components/player/controlsIdlePolicy.test.ts src/pages/liveCatchUpVisibility.test.ts` (QAF-022)
    - `pnpm --filter @lumen/web exec vitest run src/pages/liveCatchUpDiscoverability.test.ts src/pages/liveCatchUpVisibility.test.ts src/components/player/liveTimeshift.test.ts` (QAF-023)
- Greptile/check notes:
  - Review start confirmation recorded on each PR via `Greptile Review` check-run entering `pending`.
  - QAF-021 first Greptile pass returned `4/5` with one valid comment (cast label consistency); fixed in follow-up commit and final re-review returned `5/5`.
  - QAF-022 and QAF-023 finalized with Greptile `5/5` on latest heads.

---

## Session 2026-02-20 — QAF-018, QAF-019, QAF-020 (ordered batch)

- Context:
  - Executed next ready stabilization tasks in strict source-of-truth order:
    - `QAF-018 -> QAF-019 -> QAF-020`
  - Task flow stayed strict sequential (`1 task -> 1 branch -> 1 PR -> merge`), with latest `main` sync before each next task.
- PRs:
  - #188 (`QAF-018`) merged, Greptile `5/5`
  - #189 (`QAF-019`) merged, Greptile final `5/5` after follow-up remediation commit
  - #190 (`QAF-020`) merged, Greptile `5/5`
- Done:
  - QAF-018:
    - reduced catch-up false-empty risk by requesting deeper short-EPG history (`limit=168`) and hardening archive-flag parsing in:
      - `apps/web/src/services/channelEpg.ts`
      - `apps/web/src/services/epgProgramMapper.ts`
      - `packages/api/src/xtream-codes-service.ts`
    - added focused coverage in:
      - `apps/web/src/services/epgProgramMapper.test.ts`
      - `packages/api/src/xtream-codes-service.test.ts`
  - QAF-019:
    - restored last watched live-channel startup selection when returning to `/player` in:
      - `apps/web/src/pages/Player.tsx`
      - `apps/web/src/services/watchHistory.ts`
      - `apps/web/src/pages/restoreLiveChannel.ts`
      - `apps/web/src/pages/restoreLiveChannel.test.ts`
  - QAF-020:
    - made live loading spinner overlay non-blocking for essential controls in:
      - `apps/web/src/components/player/VideoPlayer.tsx`
- Local gates per task PR:
  - `pnpm lint`
  - `pnpm typecheck`
  - focused tests:
    - `pnpm --filter @lumen/web exec vitest run src/services/epgProgramMapper.test.ts src/services/channelEpg.test.ts` (QAF-018)
    - `pnpm --filter @lumen/api exec vitest run src/xtream-codes-service.test.ts` (QAF-018)
    - `pnpm --filter @lumen/web exec vitest run src/pages/restoreLiveChannel.test.ts src/pages/switchToLiveMode.test.ts` (QAF-019)
    - `pnpm --filter @lumen/web exec vitest run src/components/player/videoPlaybackSync.test.ts src/components/player/controlsIdlePolicy.test.ts` (QAF-020)
- Greptile/check notes:
  - Review start was explicitly confirmed on each PR via `Greptile Review` check-run entering `pending`.
  - QAF-019 first Greptile pass returned `4/5` with two valid comments; both remediated on-task, then final re-review returned `5/5`.
  - No valid blocking comments remained before merges.

---

## Session 2026-02-20 — QAF-015, QAF-016, QAF-017 (ordered batch)

- Context:
  - Executed next ready stabilization tasks in strict source-of-truth order:
    - `QAF-015 -> QAF-016 -> QAF-017`
  - Task flow was strict sequential (`1 task -> 1 branch -> 1 PR -> merge`), with latest `main` sync before each next task.
- PRs:
  - #184 (`QAF-015`) merged, Greptile `4/5` (approved exception with explicit rationale)
  - #185 (`QAF-016`) merged, Greptile `5/5`
  - #186 (`QAF-017`) merged, Greptile `5/5`
- Done:
  - QAF-015:
    - hardened startup live autoplay recovery path in:
      - `apps/web/src/components/player/VideoPlayer.tsx`
      - `apps/web/src/components/player/videoPlaybackSync.ts`
      - `apps/web/src/components/player/videoPlaybackSync.test.ts`
    - added bounded retry/backoff for startup `paused` stall to prevent first-frame freeze with stale playing intent.
  - QAF-016:
    - reduced live channel switch overhead in:
      - `apps/web/src/adapters/HlsPlayerAdapter.ts`
      - `apps/web/src/adapters/HlsPlayerAdapter.test.ts`
    - removed unnecessary media-element flush during source-switch loads while preserving explicit `stop()` flush semantics.
  - QAF-017:
    - restored desktop `TV Unazad` section visibility (with informative empty state when no entries) in:
      - `apps/web/src/pages/Player.tsx`
      - `apps/web/src/pages/liveCatchUpVisibility.ts`
      - `apps/web/src/pages/liveCatchUpVisibility.test.ts`
- Local gates per task PR:
  - `pnpm lint`
  - `pnpm typecheck`
  - focused tests:
    - `pnpm exec vitest run apps/web/src/components/player/videoPlaybackSync.test.ts` (QAF-015)
    - `pnpm exec vitest run apps/web/src/adapters/HlsPlayerAdapter.test.ts` (QAF-016)
    - `pnpm exec vitest run apps/web/src/pages/liveCatchUpVisibility.test.ts apps/web/src/components/player/catchUpEmptyState.test.ts` (QAF-017)
- Greptile/check notes:
  - Review start was explicitly confirmed on all three PRs via `👀` reaction and `Greptile Review` check-run.
  - QAF-015 final Greptile score was `4/5`; used allowed exception path because summary reported no blocking findings and all local/CI checks were green.
  - QAF-016 and QAF-017 finalized with Greptile `5/5`.

---

## Session 2026-02-19 — QAF-009 (ordered batch)

- Context:
  - Executed the next ready stabilization task in strict order from source-of-truth backlog: `QAF-009`.
  - Git/PR/merge flow was task-scoped (`1 task -> 1 branch -> 1 PR`), with latest `main` sync before execution.
- PRs:
  - #180 (`QAF-009`) merged, Greptile `5/5`
- Done:
  - hardened series poster fallback rendering in:
    - `apps/web/src/pages/SeriesCategories.tsx`
    - `apps/web/src/pages/SeriesDetail.tsx`
  - added deterministic `onError` handling to avoid broken-image artifacts and keep placeholder layout stable in both list and detail flows.
- Local task gates passed:
  - `pnpm lint`
  - `pnpm typecheck`
- Greptile/check notes:
  - Review start explicitly confirmed via `Greptile Review` check-run entering in-progress.
  - Final Greptile summary returned confidence score `5/5` on latest PR head.
  - No valid blocking comments remained before merge.

---

## Session 2026-02-19 — QAF-011, QAF-005, QAF-007, QAF-013 (ordered batch)

- Context:
  - Executed next ready stabilization tasks in strict order with dependency gating:
    - `QAF-011 -> QAF-005 -> QAF-007 -> QAF-013`
  - Git/PR/merge was run task-by-task (no parallel merges), with sync to latest `main` before each next task.
- PRs:
  - #175 (`QAF-011`) merged, Greptile `5/5`
  - #176 (`QAF-005`) merged, Greptile `5/5`
  - #177 (`QAF-007`) merged, Greptile final `5/5` after one remediation commit
  - #178 (`QAF-013`) merged, Greptile final `5/5` after one remediation commit
- Done:
  - QAF-011:
    - hardened live EPG text normalization in:
      - `apps/web/src/services/epgProgramMapper.ts`
      - `apps/web/src/services/epgProgramMapper.test.ts`
    - added robust decoding paths (unpadded/url-safe base64, escaped unicode, percent-encoded values).
  - QAF-005:
    - introduced Xtream network failure capture for QA scenarios via:
      - `e2e/qaNetworkTracker.ts`
      - `e2e/qa-live-autoplay.spec.ts`
      - `e2e/qa-series-live-context.spec.ts`
    - extended QA report action-level failure breakdown in:
      - `scripts/playwright/run-qa-user-sim.mjs`
  - QAF-007:
    - added critical vs non-critical network failure classification and scoring split in:
      - `scripts/playwright/run-qa-user-sim.mjs`
    - propagated critical network failures into blocker/task-candidate outputs.
  - QAF-013:
    - clarified fullscreen catch-up empty-state reasons in:
      - `apps/web/src/components/player/catchUpEmptyState.ts`
      - `apps/web/src/components/player/PlayerControls.tsx`
      - `apps/web/src/components/player/catchUpEmptyState.test.ts`
    - added periodic reason refresh to keep time-dependent empty-state accurate.
- Local gates per task PR:
  - `pnpm lint`
  - `pnpm typecheck`
  - focused tests:
    - `pnpm exec vitest run apps/web/src/services/epgProgramMapper.test.ts` (QAF-011)
    - `pnpm exec vitest run apps/web/src/components/player/catchUpEmptyState.test.ts` (QAF-013)
- Greptile/check notes:
  - Review start was explicitly confirmed on each PR via `Greptile Review` check-run entering in-progress.
  - All valid Greptile comments were remediated on-task before merge.
  - QAF-013 re-review experienced delayed finalization; two pings were posted on latest head before final score arrived (`5/5`), so no fallback/no-score path was used.

---

## Session 2026-02-19 — QAF-014, QAF-010, QAF-012 (ordered batch)

- Context:
  - Source-of-truth execution order from stabilization track continued after already-merged `QAF-002`, `QAF-008`, `QAF-006` on `main`.
  - This batch executed next ready bugfix tasks in order: `QAF-014 -> QAF-010 -> QAF-012`.
- PRs:
  - #171 (`QAF-014`) merged, Greptile `5/5`
  - #172 (`QAF-010`) merged, Greptile `5/5`
  - #173 (`QAF-012`) merged, Greptile `5/5`
- Done:
  - QAF-014:
    - restored live playback resume after PiP exit in `apps/web/src/components/player/VideoPlayer.tsx`
    - added PiP resume decision logic + focused tests in:
      - `apps/web/src/components/player/videoPlaybackSync.ts`
      - `apps/web/src/components/player/videoPlaybackSync.test.ts`
  - QAF-010:
    - enabled deterministic idle auto-hide behavior for non-fullscreen live controls in:
      - `apps/web/src/components/player/PlayerControls.tsx`
      - `apps/web/src/components/player/controlsIdlePolicy.ts`
      - `apps/web/src/components/player/controlsIdlePolicy.test.ts`
  - QAF-012:
    - locked desktop player-route page scroll and constrained shell/player layout overflow in:
      - `apps/web/src/components/layout/AppShell.tsx`
      - `apps/web/src/components/layout/playerRouteLayout.ts`
      - `apps/web/src/components/layout/playerRouteLayout.test.ts`
      - `apps/web/src/pages/Player.tsx`
      - `apps/web/src/index.css`
- Local task gates passed per task PR:
  - `pnpm exec vitest run ...` (task-focused suites)
  - `pnpm lint`
  - `pnpm typecheck`
- Greptile/check notes:
  - Review start confirmation was recorded on each PR via `👀` reaction and/or `Greptile Review` check-run.
  - No valid blocking review comments remained before merge.
- QA gate run (post-batch):
  - command:
    - `E2E_XUI_USERNAME='<redacted>' E2E_XUI_PASSWORD='<redacted>' ./run-qa-simulation.sh`
  - artifacts:
    - `output/playwright/qa-user-sim/QA-REPORT.md` (timestamp `2026-02-19T15:16:59.837Z`)
    - `output/playwright/qa-user-sim/results.json`
  - outcome:
    - script exits with code `1`
    - report summary shows `Scenario status: unknown` / `Scenarios executed: 0`
    - underlying error in `results.json`: Playwright loader conflict (`Requiring @playwright/test second time`) referencing local `.codex/worktrees/QA-GATE` context
  - interpretation:
    - QA gate evidence is currently invalid due tooling/runtime setup issue, not due functional regression signal from executed scenarios.

---

## Session 2026-02-19 — Intake triage alignment (`WORKFLOW-LLM-QA.md`)

- Context:
  - Manual owner-reported playback/UI edge cases were captured as intake bugs (`BUG-20260219-01..06`) in `docs/V2-QA-FIX-BACKLOG.md`.
- Done:
  - Applied formal triage conversion per workflow rules:
    - `BUG-20260219-01` -> `QAF-006`
    - `BUG-20260219-02` -> `QAF-010`
    - `BUG-20260219-03` -> `QAF-011`
    - `BUG-20260219-04` -> `QAF-012`
    - `BUG-20260219-05` -> `QAF-013`
    - `BUG-20260219-06` -> `QAF-014`
  - Expanded stabilization task set in both:
    - `docs/V2-QA-FIX-BACKLOG.md` (active table + triage snapshot + new QAF scopes + updated execution order)
    - `BACKLOG.md` (Post-V1 QA Stabilization Track rows)
- Current execution priority (next batch start point):
  - `QAF-002 -> QAF-008 -> QAF-006 -> QAF-014 -> QAF-010 -> QAF-012`
- Notes:
  - This session was docs/triage alignment only; no code fix merged in this step.

---

## Session 2026-02-19 — QAF-003, QAF-004, QAF-001 + alignment retest

- Upstream batch status (reported + verified on `origin/main`):
  - PR #162 (`QAF-003`) merged, Greptile `5/5`
  - PR #163 (`QAF-004`) merged, Greptile `5/5` after valid-comment fix
  - PR #164 (`QAF-001`) merged, Greptile upgraded from `3/5` to final `5/5` after follow-up fix
  - Docs-sync PR #165 open (`BACKLOG.md`, `HANDOFF.md`)
- Code-level verification:
  - `origin/main` contains all expected QAF files/changes:
    - `apps/web/src/pages/switchToLiveMode.ts`
    - `apps/web/src/pages/switchToLiveMode.test.ts`
    - `apps/web/src/config/xtream.test.ts`
    - proxied Xtream updates in `apps/web/vite.config.ts`, `apps/web/src/services/xtreamService.ts`, `packages/api/src/xtream-codes-service.ts`
- Local alignment action:
  - local `main` fast-forwarded to `origin/main` (`4e34f98` -> `0506862`) using `git pull --rebase --autostash origin main`
- QA retest after alignment:
  - command:
    - `E2E_XUI_USERNAME='<redacted>' E2E_XUI_PASSWORD='<redacted>' ./run-qa-simulation.sh`
  - report:
    - `output/playwright/qa-user-sim/QA-REPORT.md` (timestamp `2026-02-19T13:08:33.082Z`)
  - key outcome:
    - status `passed-with-blockers`, `pass=14`, `blocked=5`
    - CORS improved (`cors=0` in console/network health step), so QAF-003/QAF-004 baseline is effective
    - remaining blockers for next wave:
      - series episode entry selector/path stability
      - episode->live validation path not reached in current scenario
      - manual startup playback step lacking channel-row availability in this run
      - autoplay still paused in autoplay mode
      - residual network failures/429 pressure still present
- Next recommended execution order:
  - QAF-002 -> QAF-008 -> QAF-006 -> QAF-005 -> QAF-007 -> QAF-009

---

## Session 2026-02-18 — LP-0371, LP-0372, LP-0373 (ordered batch)

- PRs: #156 (merged), #157 (merged), #158 (merged)
- Done:
  - LP-0371:
    - aligned `/vod` to Balkan Stream parity in `apps/web/src/pages/VodCategories.tsx` (sticky header, category pills, card metadata rhythm, route-owned mobile nav)
    - aligned fallback VOD catalog parity data in `apps/web/src/hooks/useVodCatalog.ts`
  - LP-0372:
    - aligned `/series` to Balkan Stream parity in `apps/web/src/pages/SeriesCategories.tsx` (sticky header, category pills, dense series cards, route-owned mobile nav)
    - aligned fallback Series catalog parity data in `apps/web/src/hooks/useSeriesCatalog.ts`
    - prevented duplicate app-shell mobile nav on `/series` in `apps/web/src/components/layout/AppShell.tsx`
  - LP-0373:
    - added V1 design parity evidence artifact template + validator:
      - `scripts/release/v1-design-parity-evidence.template.json`
      - `scripts/release/validate-design-parity-evidence.mjs`
      - `scripts/release/v1-design-parity-evidence.test.ts`
    - wired `design-parity-evidence` into required release-readiness gate in:
      - `scripts/release/validate-release-readiness.mjs`
      - `scripts/release/v1-release-readiness-review.template.json`
      - `scripts/release/v1-release-readiness-review.test.ts`
    - added package scripts:
      - `release:design-parity:validate`
      - `release:design-parity:test`
  - Local test gate passed on each task PR:
    - `pnpm lint`
    - `pnpm typecheck`
    - `pnpm build`
  - Task-specific gate checks passed:
    - `pnpm release:design-parity:validate`
    - `pnpm release:design-parity:test`
    - `pnpm release:readiness:test`
  - Visual parity checks:
    - LP-0371 captures: `output/playwright/lp-0371/`
    - LP-0372 captures: `output/playwright/lp-0372/`
    - LP-0373 evidence sweep captures: `output/playwright/lp-0373/`
    - Reference baseline: `docs/design-parity/balkan-stream/reference/*.png`
  - Greptile/check notes:
    - #156: Greptile review start confirmed via check-run, but final confidence score was not returned on latest head after 2 pings (`@greptile-apps`, `@greptileai`); fallback PR note was posted before merge.
    - #157: Greptile review start confirmed via check-run, but final confidence score was not returned on latest head after 2 pings (`@greptile-apps`, `@greptileai`); fallback PR note was posted before merge.
    - #158: Greptile review start confirmed via check-run, but final confidence score was not returned on latest head after 2 pings (`@greptile-apps`, `@greptileai`); fallback PR note was posted before merge.
    - GitHub PR checks were green before merge (`web-quality`, `automation-scripts`).

---

## Session 2026-02-18 — LP-0367, LP-0368, LP-0369, LP-0370 (ordered batch)

- PRs: #150 (merged), #151 (merged), #152 (merged), #153 (merged)
- Done:
  - LP-0367:
    - aligned player video surface/control overlay parity in `apps/web/src/components/player/VideoPlayer.tsx` and `apps/web/src/components/player/PlayerControls.tsx`
    - localized/loading-error-idle presentation and catch-up/control copy rhythm to Balkan Stream parity in `apps/web/src/pages/Player.tsx`
  - LP-0368:
    - aligned EPG presentation parity in `apps/web/src/pages/Player.tsx` for "Sada na programu", "Sledi", "TV Unazad"
    - implemented grouped catch-up date sections + accordion rhythm + CTA treatment matching reference behavior
  - LP-0369:
    - aligned mobile player parity in `apps/web/src/pages/Player.tsx`:
      - quick actions row
      - mobile header/actions zone
      - integrated category discoverability + search + channel list rhythm (without sheet trigger)
  - LP-0370:
    - aligned login parity in `apps/web/src/pages/Login.tsx`:
      - Serbian copy + spacing/iconography hierarchy
      - server status strip parity treatment
      - password visibility UX parity
      - toast-based auth feedback flow
    - localized server display fallback labels in `apps/web/src/config/xtream.ts`
  - Local test gate passed on each task PR:
    - `pnpm lint`
    - `pnpm typecheck`
    - `pnpm build`
  - Visual parity checks run for each task against `docs/DESIGN-PARITY-BALKAN-STREAM.md` (source-of-truth: `/Users/filip/Documents/narodna.tv/balkan-stream`) with Playwright captures in:
    - `output/playwright/lp-0367/`
    - `output/playwright/lp-0368/`
    - `output/playwright/lp-0369/`
    - `output/playwright/lp-0370/`
  - Greptile/check notes:
    - #150: Greptile review start was confirmed via check-run, but final confidence score was not returned on latest head after 2 pings (`@greptile-apps`, `@greptileai`); fallback PR note was posted before merge.
    - #151: Greptile review start was confirmed via check-run, but final confidence score was not returned on latest head after 2 pings (`@greptile-apps`, `@greptileai`); fallback PR note was posted before merge.
    - #152: Greptile review start was confirmed via check-run, but final confidence score was not returned on latest head after 2 pings (`@greptile-apps`, `@greptileai`); fallback PR note was posted before merge.
    - #153: Greptile review start was confirmed via check-run, but final confidence score was not returned on latest head after 2 pings (`@greptile-apps`, `@greptileai`); fallback PR note was posted before merge.
    - GitHub PR checks were green before merge (`web-quality`, `automation-scripts`).

- Next:
  - Continue Balkan parity track in strict order with LP-0371, then LP-0372.

---

## Session 2026-02-18 — LP-0365, LP-0366 (ordered batch)

- PRs: #147 (merged), #148 (merged)
- Done:
  - LP-0365:
    - aligned `/player` desktop category rail parity surface in `apps/web/src/pages/Player.tsx`:
      - active/inactive category state treatment + counter badges
      - VOD CTA card styling/rhythm (`Filmovi`, `Serije`)
      - Xtream account/info block parity behavior (shown only when provider user info exists)
      - bottom action stack parity (`Početna`, `Logout`)
  - LP-0366:
    - aligned `ChannelList` row parity in `apps/web/src/components/player/ChannelList.tsx`:
      - denser number/logo/name/program row rhythm
      - selected row treatment (`bg-primary/15` + ring emphasis)
      - favorites affordance switched to heart parity style
      - subtitle line now prefers current program title (fallback category)
  - Local test gate passed on each task PR:
    - `pnpm lint`
    - `pnpm typecheck`
    - `pnpm build`
  - Visual parity checks run for each task against `docs/DESIGN-PARITY-BALKAN-STREAM.md` (`player-desktop` + `player-mobile`) with Playwright captures in:
    - `output/playwright/lp-0365/`
    - `output/playwright/lp-0366/`
  - Greptile/check notes:
    - #147: Greptile review start was confirmed via check-run, but final confidence score was not returned on latest head after 2 pings (`@greptile-apps`, `@greptileai`); fallback PR note was posted before merge.
    - #148: Greptile review start was confirmed via check-run, but final confidence score was not returned on latest head after 2 pings (`@greptile-apps`, `@greptileai`); fallback PR note was posted before merge.
    - GitHub PR checks were green before merge (`web-quality`, `automation-scripts`).

- Next:
  - Continue Balkan parity track in strict order with LP-0367, then LP-0368.

---

## Session 2026-02-17 — LP-0361, LP-0362, LP-0363, LP-0364 (ordered batch)

- PRs: #142 (merged), #143 (merged), #144 (merged), #145 (merged)
- Done:
  - LP-0361:
    - added canonical Balkan Stream parity acceptance spec (`docs/DESIGN-PARITY-BALKAN-STREAM.md`)
    - froze desktop/mobile reference baseline + manifest hashes (`docs/design-parity/balkan-stream/reference-manifest.json`, `docs/design-parity/balkan-stream/reference/*.png`)
  - LP-0362:
    - aligned global token system to Balkan baseline in `apps/web/src/index.css` (`--sidebar-*`, semantic live/catchup/success tokens, starlight/shimmer utilities)
    - removed non-reference global shell mood paint from `body` and preserved compatibility aliases for follow-up tasks
  - LP-0363:
    - removed divergent non-player shell chrome (desktop icon rail + branded header) in `apps/web/src/components/layout/AppShell.tsx`
    - kept minimal non-player shell with Balkan-style mobile bottom nav pattern
  - LP-0364:
    - rebuilt `/player` desktop into explicit 3-pane structure in `apps/web/src/pages/Player.tsx`:
      - category rail
      - channel panel
      - media + EPG panel ("Sada na programu", "Sledi", "TV Unazad")
  - Local test gate passed on each task PR:
    - `pnpm lint`
    - `pnpm typecheck`
    - `pnpm build`
  - Visual parity checks run each task against `docs/DESIGN-PARITY-BALKAN-STREAM.md` using Playwright captures from source and lumen snapshots.
  - Greptile/check notes:
    - #142: Greptile review started and returned final confidence score `5/5`.
    - #143: after 2 pings (`@greptile-apps`, `@greptileai`) fallback PR note comment was posted before merge; Greptile then returned delayed final confidence score `4/5` for latest head with non-blocking remarks (Tailwind token mapping coverage and utility layer organization scope).
    - #144: Greptile review started and returned final confidence score `5/5`.
    - #145: Greptile review started and returned final confidence score `5/5`.
    - GitHub PR checks were green before merge (`web-quality`, `automation-scripts`); #143 used explicit 2-ping fallback path due delayed Greptile finalization.

- Next:
  - Continue Balkan parity track in strict order with LP-0365, then LP-0366.

---

## Session 2026-02-17 — LP-0354, LP-0356, LP-0357, LP-0003 (ordered batch)

- PRs: #136 (merged), #137 (merged), #138 (merged), #139 (merged)
- Done:
  - LP-0354:
    - refreshed global visual baseline tokens and shell surface styling (`apps/web/src/index.css`)
    - upgraded AppShell sidebar/header hierarchy + mobile nav treatment (`apps/web/src/components/layout/AppShell.tsx`)
  - LP-0356:
    - grouped inline player control-bar actions into transport/utility/action clusters (`apps/web/src/components/player/PlayerControls.tsx`)
    - added reusable player state surface component for loading/error/idle with explicit CTAs (`apps/web/src/pages/Player.tsx`)
  - LP-0357:
    - tuned VOD/Series catalog density and card rhythm (`apps/web/src/pages/VodCategories.tsx`, `apps/web/src/pages/SeriesCategories.tsx`)
    - added deterministic catalog return context via safe `back` query path in detail pages (`apps/web/src/pages/VodDetail.tsx`, `apps/web/src/pages/SeriesDetail.tsx`)
  - LP-0003:
    - added focused `@lumen/core` unit coverage for channel helpers, EPG helpers, and time helpers (`packages/core/src/core.test.ts`)
  - Local test gate passed on each task PR:
    - `pnpm lint`
    - `pnpm typecheck`
    - `pnpm build`
  - Task-specific checks:
    - `pnpm exec vitest run packages/core/src/core.test.ts` (LP-0003)
  - Greptile/check notes:
    - #136: Greptile review started, but final confidence score was not returned on latest head after 2 pings (`@greptile-apps`, `@greptileai`); fallback PR note comment was posted before merge.
    - #137: Greptile review started and returned final confidence score `5/5`.
    - #138: Greptile review started, but final confidence score was not returned on latest head after 2 pings (`@greptile-apps`, `@greptileai`); fallback PR note comment was posted before merge.
    - #139: Greptile review started and returned final confidence score `5/5`.
    - GitHub PR checks were green before merge (`web-quality`, `automation-scripts`; Greptile pending-only tasks were merged with fallback PR note after 2 pings).

- Next:
  - Continue with next open backlog item by order (`LP-0004`).

---

## Session 2026-02-17 — TST-008, TST-009 (ordered batch)

- PRs: #133 (merged), #134 (merged)
- Done:
  - TST-008:
    - added shared EPG mapper/normalization pipeline for Xtream short-EPG payloads (`apps/web/src/services/epgProgramMapper.ts`)
    - normalized malformed provider text (base64 payload values, HTML entities, common mojibake repair) before program rendering
    - wired player-inline EPG and EPG route fallback path to the same mapper (`apps/web/src/pages/Player.tsx`, `apps/web/src/pages/EpgGuide.tsx`)
    - applied same text normalization in XMLTV parsing path (`apps/web/src/services/xmltvEpg.ts`)
    - added focused mapper tests (`apps/web/src/services/epgProgramMapper.test.ts`)
  - TST-009:
    - added resilient shared short-EPG request layer (`apps/web/src/services/channelEpg.ts`) with:
      - in-memory TTL cache
      - in-flight request deduplication
      - paced request gate to reduce burst pressure
      - 429 retry/backoff handling
      - stale-cache fallback when provider remains rate-limited
    - switched both player-inline and EPG route short-EPG calls to the shared resilient layer (`apps/web/src/pages/Player.tsx`, `apps/web/src/pages/EpgGuide.tsx`)
    - added focused resilience tests (`apps/web/src/services/channelEpg.test.ts`)
  - Local test gate passed on each task PR:
    - `pnpm lint`
    - `pnpm typecheck`
    - `pnpm build`
  - Task-specific checks:
    - `pnpm exec vitest run apps/web/src/services/epgProgramMapper.test.ts` (TST-008)
    - `pnpm exec vitest run apps/web/src/services/channelEpg.test.ts apps/web/src/services/epgProgramMapper.test.ts` (TST-009)
  - Greptile/check notes:
    - #133: Greptile review started, but final confidence score was not returned on latest head after 2 pings (`@greptile-apps`, `@greptileai`); fallback PR note comment was posted before merge.
    - #134: Greptile review started, but final confidence score was not returned on latest head after 2 pings (`@greptile-apps`, `@greptileai`); fallback PR note comment was posted before merge.
    - GitHub PR checks were green before merge (`web-quality`, `automation-scripts`; Greptile check-run remained pending without final score).

- Next:
  - Update `docs/V1-TEST-ERROR-BACKLOG.md` statuses for TST-006/TST-007/TST-008/TST-009 from `open` to merged/retest state in next docs pass.

---

## Session 2026-02-17 — TST-006, TST-007 (ordered batch)

- PRs: #130 (merged), #131 (merged)
- Done:
  - TST-006:
    - restored explicit post-login discoverability for Movies/Series/Catch-up in `/player` shell contexts (desktop + mobile) via shared quick-entry actions in `apps/web/src/pages/Player.tsx`
    - aligned shell navigation labels for clarity (`VOD` -> `Movies`, `EPG` -> `Catch-up`) in `apps/web/src/components/layout/AppShell.tsx`
  - TST-007:
    - introduced persisted explicit live channel startup mode (`autoplay` vs `manual`) in `apps/web/src/services/appSettings.ts`
    - added settings UI control for live channel startup behavior in `apps/web/src/pages/Settings.tsx`
    - enforced deterministic live startup behavior across channel selection paths (list, numeric zap, next/prev, initial bootstrap) in `apps/web/src/pages/Player.tsx`
    - added focused autoplay-mode test coverage:
      - `apps/web/src/pages/liveChannelStartupMode.ts`
      - `apps/web/src/pages/liveChannelStartupMode.test.ts`
  - Local test gate passed on each task PR:
    - `pnpm lint`
    - `pnpm typecheck`
    - `pnpm build`
  - Task-specific checks:
    - `pnpm exec vitest run apps/web/src/pages/liveChannelStartupMode.test.ts` (TST-007)
  - Greptile/check notes:
    - #130: Greptile review started and returned final confidence score `5/5`.
    - #131: Greptile review started, but final confidence score was not returned on latest head after 2 pings (`@greptile-apps`, `@greptileai`); fallback PR note comment was posted before merge.
    - GitHub PR checks were green before merge (`web-quality`, `automation-scripts`; Greptile check-run remained pending without final score on #131).

- Next:
  - Continue with next open V1 test backlog item by priority (`TST-008` before `TST-009` if sticking to strict order).

---

## Session 2026-02-17 — LP-0352, LP-0353 (ordered batch)

- PRs: #127 (merged), #128 (merged)
- Done:
  - LP-0352:
    - added explicit on-demand `backPath` metadata from VOD/Series playback actions (`apps/web/src/pages/VodDetail.tsx`, `apps/web/src/pages/SeriesDetail.tsx`)
    - extended on-demand context resolver with safe explicit-path handling and season/episode-aware fallback paths (`apps/web/src/pages/playerOnDemandContext.ts`)
    - kept series playback context deterministic by syncing season/episode query params before handoff to `/player`
  - LP-0353:
    - tuned virtualized channel row density and selected-state styling in `apps/web/src/components/player/ChannelList.tsx`
    - added active-channel auto-scroll rhythm without removing virtualization
    - added direct favorites affordance/toggle per row (desktop + mobile `ChannelList` wiring in `apps/web/src/pages/Player.tsx`)
  - Local test gate passed on each task PR:
    - `pnpm lint`
    - `pnpm typecheck`
    - `pnpm build`
  - Greptile/check notes:
    - #127: Greptile review started and returned final confidence score `5/5`.
    - #128: Greptile review started, but final confidence score was not returned on latest head after 2 pings (`@greptileai`, `@greptile-apps`); fallback PR note comment was posted before merge.
    - GitHub PR checks were green before merge (`web-quality`, `automation-scripts`; Greptile check-run eventually completed without final score for #128).

- Next:
  - Pick next prioritized item from `BACKLOG.md` outside completed V1-UI hardening block.

---

## Session 2026-02-17 — LP-0350, LP-0351 (ordered batch)

- PRs: #124 (merged), #125 (merged)
- Done:
  - LP-0350:
    - restored dark-first visual token baseline in `apps/web/src/index.css`
    - added explicit `.light` overrides and synchronized theme class toggling in `apps/web/src/services/appSettings.ts`
    - added first-paint theme bootstrap in `apps/web/index.html` to avoid initial shell mood mismatch
  - LP-0351:
    - added persistent shell route wrapper in `apps/web/src/App.tsx`
    - added shared layout nav shell (`apps/web/src/components/layout/AppShell.tsx`) for desktop sidebar + mobile bottom nav
    - removed redundant page-level back/nav controls and shell wrappers in routed pages (`Player`, `VOD`, `Series`, `EPG`, `Settings`)
  - Local test gate passed on each task PR:
    - `pnpm lint`
    - `pnpm typecheck`
    - `pnpm build`
  - Greptile/check notes:
    - #124: Greptile review started and returned final confidence score `5/5`.
    - #125: Greptile review check-run started, but final confidence score was not returned after 2 pings (`@greptile-apps`, `@greptileai`); fallback PR note comment was posted before merge.
    - GitHub PR checks were green before merge (`web-quality`, `automation-scripts`; Greptile remained pending on #125).

- Next:
  - Continue with next V1-UI item by order (`LP-0352`), then `LP-0353`.

---

## Session 2026-02-17 — TST-005 (single-task PR + docs sync)

- PR: #121 (merged)
- Done:
  - Fixed mixed channel-shell UX while on-demand content is playing:
    - added context-aware on-demand navigation resolver for VOD vs Series episode playback
    - updated `Player` desktop/mobile shell rendering to switch between live channel-shell and on-demand shell
    - stabilized on-demand return routes to detail-aware paths when IDs are present (`/vod/:vodId`, `/series/:seriesId`) with safe catalog fallbacks
  - Added focused on-demand context unit test:
    - `apps/web/src/pages/playerOnDemandContext.ts`
    - `apps/web/src/pages/playerOnDemandContext.test.ts`
  - Local test gate passed:
    - `pnpm exec vitest run apps/web/src/pages/playerOnDemandContext.test.ts apps/web/src/components/player/videoPlaybackSync.test.ts`
    - `pnpm lint`
    - `pnpm typecheck`
    - `pnpm build`
  - Greptile/check notes:
    - Greptile review check-run started and completed on latest PR head.
    - Final Greptile confidence score: `5/5`.
    - GitHub PR checks were green before merge (`web-quality`, `automation-scripts`, `Greptile Review`).

- Next:
  - No remaining `open`/`triaged` `TST-*` items in `docs/V1-TEST-ERROR-BACKLOG.md`.

---

## Session 2026-02-16 — TST-004 (single-task PR + docs sync)

- PR: #119 (merged)
- Done:
  - Fixed VOD `All` catalog truncation in Xtream fetch path:
    - added `getAllVODStreams()` aggregation across VOD categories with controlled batch concurrency
    - added resilient partial-result behavior (`Promise.allSettled` on category fetches + safe fallback handling)
    - deduplicated merged results by `stream_id`
  - Updated VOD catalog hook to use aggregated source for `All` selection:
    - `apps/web/src/hooks/useVodCatalog.ts`
  - Added focused service tests:
    - `packages/api/src/xtream-codes-service.ts`
    - `packages/api/src/xtream-codes-service.test.ts`
  - Local test gate passed:
    - `pnpm vitest run packages/api/src/xtream-codes-service.test.ts`
    - `pnpm lint`
    - `pnpm typecheck`
    - `pnpm build`
  - Greptile/check notes:
    - Greptile review check-run started and completed on latest PR head.
    - Final Greptile confidence score: `5/5`.
    - GitHub PR checks were green before merge (`web-quality`, `automation-scripts`, `Greptile Review`).

- Next:
  - Continue with next V1 test backlog item by priority (`TST-005`).

---

## Session 2026-02-16 — TST-003 (single-task PR + docs sync)

- PR: #117 (merged)
- Done:
  - Fixed VOD startup handoff play/pause oscillation risk in `VideoPlayer`:
    - keep pending autoplay startup guard active for recoverable (non-fatal) playback-start errors
    - clear pending autoplay guard only on fatal playback errors
  - Added focused autoplay-clear policy unit test:
    - `apps/web/src/components/player/videoPlaybackSync.ts`
    - `apps/web/src/components/player/videoPlaybackSync.test.ts`
  - Local test gate passed:
    - `pnpm vitest run apps/web/src/components/player/videoPlaybackSync.test.ts`
    - `pnpm lint`
    - `pnpm typecheck`
    - `pnpm build`
  - Greptile/check notes:
    - Greptile review check-run started on #117.
    - After 2 pings (`@greptile-apps`, `@greptileai`) final score was not returned; required PR note comment posted before merge.
    - GitHub PR checks were green before merge (`web-quality`, `automation-scripts`).

- Next:
  - Continue with next V1 test backlog item by priority (`TST-004`).

---

## Session 2026-02-16 — TST-002 (single-task PR + docs sync)

- PR: #115 (merged)
- Done:
  - Fixed stale blocking `Playback error` overlay during live channel switching:
    - show blocking overlay only for fatal playback errors
    - clear stale player error when adapter returns to `playing`
  - Added focused playback error gating unit test:
    - `apps/web/src/components/player/videoPlaybackSync.ts`
    - `apps/web/src/components/player/videoPlaybackSync.test.ts`
  - Local test gate passed:
    - `pnpm vitest run apps/web/src/components/player/videoPlaybackSync.test.ts`
    - `pnpm lint`
    - `pnpm typecheck`
    - `pnpm build`
  - Greptile/check notes:
    - Greptile review check-run started on #115.
    - After two pings (`@greptile-apps`, `@greptileai`), final review summary posted with confidence `4/5` (safe-to-merge, no blocking findings).
    - GitHub PR checks were green before merge (`web-quality`, `automation-scripts`, `Greptile Review`).

- Next:
  - Continue with next V1 test backlog item by priority (`TST-003`).

---

## Session 2026-02-16 — TST-001 (single-task PR + docs sync)

- PR: #113 (merged)
- Done:
  - Fixed live startup playback/session sync race in `VideoPlayer`:
    - keep playback intent during initial source startup
    - ignore transient adapter `paused` state while startup autoplay is pending
    - avoid eager `play()` call while adapter state is still `loading`
  - Added focused startup guard unit test:
    - `apps/web/src/components/player/videoPlaybackSync.ts`
    - `apps/web/src/components/player/videoPlaybackSync.test.ts`
  - Local test gate passed:
    - `pnpm vitest run apps/web/src/components/player/videoPlaybackSync.test.ts`
    - `pnpm lint`
    - `pnpm typecheck`
    - `pnpm build`
  - Greptile/check notes:
    - Greptile review check-run started on #113.
    - After 2 pings (`@greptile-apps`, `@greptileai`) final score was not returned; required PR note comment posted.
    - GitHub PR checks were green before merge (`web-quality`, `automation-scripts`).

- Next:
  - Continue with next V1 test backlog item by priority (`TST-002`).

---

## Session 2026-02-16 — LP-0346 (single-task PR)

- PR: #111 (merged)
- Done:
  - Added V1 final release readiness review gate:
    - `scripts/release/v1-release-readiness-review.template.json`
    - `scripts/release/validate-release-readiness.mjs`
    - `scripts/release/v1-release-readiness-review.test.ts`
  - Added package scripts:
    - `release:readiness:validate`
    - `release:readiness:test`
  - Local test gate passed:
    - `pnpm lint`
    - `pnpm typecheck`
    - `pnpm build`
  - Task-specific checks:
    - `pnpm release:readiness:validate`
    - `pnpm release:readiness:test`
  - Greptile/check notes:
    - Greptile review check-run started on #111; final response was delayed and pinged 2x per process.
    - Required PR note comment was posted after ping window, then Greptile returned final confidence score `5/5`.
    - GitHub PR checks were green before merge (`web-quality`, `automation-scripts`).

- Next:
  - Execute V1 real-device validation cycle (smoke/regression + compatibility + perf + security evidence finalization).
  - After V1 validation pass, choose next implementation track from BACKLOG Phase 1 or Phase 2 items.

---

## Session 2026-02-16 — LP-0343, LP-0344, LP-0345 (ordered batch)

- PRs: #107 (merged), #108 (merged), #109 (merged)
- Done:
  - LP-0343: Added V1 performance evidence artifact gate:
    - `scripts/release/v1-performance-evidence.template.json`
    - `scripts/release/validate-performance-evidence.mjs`
    - `scripts/release/v1-performance-evidence.test.ts`
  - LP-0344: Added production observability baseline for web + cast receiver:
    - new web observability service + threshold alert rules (`apps/web/src/services/observability.ts`)
    - focused observability tests (`apps/web/src/services/observability.test.ts`)
    - instrumentation across playback/cast paths in `Player.tsx`, `VideoPlayer.tsx`, `useGoogleCastSender.ts`
    - cast receiver event/error + threshold breadcrumbs in `apps/web/public/receiver.html`
  - LP-0345: Added V1 security/privacy baseline review gate:
    - `scripts/release/v1-security-privacy-baseline.template.json`
    - `scripts/release/validate-security-privacy-baseline.mjs`
    - `scripts/release/v1-security-privacy-baseline.test.ts`
  - Local test gate passed on each task PR:
    - `pnpm lint`
    - `pnpm typecheck`
    - `pnpm build`
  - Task-specific checks:
    - `pnpm release:perf-evidence:validate`
    - `pnpm release:perf-evidence:test`
    - `pnpm release:observability:test`
    - `pnpm release:security-baseline:validate`
    - `pnpm release:security-baseline:test`
  - Greptile/check notes:
    - #107: final confidence `5/5` after iterative validator hardening
    - #108: Greptile start delay handled via ping loop; final confidence `5/5`
    - #109: delayed final response after two pings; intermediate `4/5` feedback fixed in follow-up commit; final confidence `5/5`
    - GitHub PR checks green before each merge

- Next:
  - Execute V1 real-device validation cycle (smoke/regression + compatibility + perf + security evidence finalization).
  - After V1 validation pass, choose next implementation track from BACKLOG Phase 1 or Phase 2 items.

---

## Session 2026-02-16 — LP-0340, LP-0341, LP-0342 (ordered batch, follow-up hardening)

- PRs: #103 (merged), #104 (merged), #105 (merged)
- Done:
  - LP-0340: Added typed V1 go/no-go checklist model + evaluation helpers with dedicated tests:
    - `scripts/release/v1-go-no-go.ts`
    - `scripts/release/v1-go-no-go.test.ts`
  - LP-0341: Hardened V1 smoke/regression matrix coverage:
    - added missing offline regression case in `scripts/release/v1-smoke-regression-matrix.template.json`
    - validator now requires smoke + regression coverage for every required release tag (`scripts/release/validate-smoke-regression-matrix.mjs`)
    - added matrix tests in `scripts/release/v1-smoke-regression-matrix.test.ts`
  - LP-0342: Extended compatibility execution task to be target-aware:
    - target profile template: `scripts/release/v1-compatibility-targets.template.json`
    - `compatibility-matrix-task` now supports `--targets`, per-target run records, ambiguity-safe updates, and explicit `matchMode` semantics (`any`/`all`)
    - added focused tests in `scripts/release/compatibility-matrix-task.test.ts`
  - Local test gate passed on each task PR:
    - `pnpm lint`
    - `pnpm typecheck`
    - `pnpm build`
  - Task-specific checks:
    - `pnpm vitest run scripts/release/v1-go-no-go.test.ts`
    - `pnpm release:smoke-matrix:validate`
    - `pnpm release:smoke-matrix:test`
    - `pnpm release:compat-matrix:test`
  - Greptile/check notes:
    - #103: initial 4/5, addressed comments, final 5/5
    - #104: final 5/5
    - #105: remained 4/5 after multiple review rounds; merged by explicit exception because no remaining actionable correctness issues and all checks were green

- Next:
  - LP-0343 (Performance evidence artifact)
  - LP-0344 (Observability baseline)
  - LP-0345 (Security/privacy baseline review)

---

## Session 2026-02-16 — LP-0340, LP-0341, LP-0342 (ordered batch)

- PRs: #98 (merged), #99 (merged), #100 (merged)
- Done:
  - LP-0340: Added V1 go/no-go checklist template with explicit pass/fail criteria per feature area and validator (`scripts/release/v1-go-no-go.template.json`, `scripts/release/validate-go-no-go.mjs`).
  - LP-0341: Added V1 smoke/regression matrix template and validator with required coverage checks (`scripts/release/v1-smoke-regression-matrix.template.json`, `scripts/release/validate-smoke-regression-matrix.mjs`).
  - LP-0342: Added compatibility matrix execution task CLI (init/set/status/finalize) with run-record guardrails (`scripts/release/compatibility-matrix-task.mjs`).
  - Local test gate passed on each task PR:
    - `pnpm lint`
    - `pnpm typecheck`
    - `pnpm build`
  - Greptile/check notes:
    - Greptile review check-run started and completed on each PR.
    - All valid Greptile comments were fixed and review threads resolved.
    - Final confidence score was not posted by Greptile on #98/#99/#100 after ping attempts; each PR has explicit note comment and BACKLOG sync note.
    - GitHub PR checks were green before each merge.

- Next:
  - LP-0343 (Performance evidence artifact)
  - LP-0344 (Observability baseline)
  - LP-0345 (Security/privacy baseline review)

---

## Session 2026-02-16 — LP-0327, LP-0328, LP-0329 (ordered batch)

- PRs: #94 (merged), #95 (merged), #96 (merged)
- Done:
  - LP-0327: Added deterministic 20k/50k performance harness for time-to-first-channel with percentile interpolation and p95 `<3s` assertion (`perf:ttfc`).
  - LP-0328: Added RSS memory-cap benchmark for the same 20k/50k pipeline with absolute + baseline-delta guard (`perf:rss`).
  - LP-0329: Optimized Cast receiver bridge path for older devices:
    - serialized bridge command execution to avoid preload/swap race conditions
    - skipped redundant swap/preload work, added timeout-safe readiness flow
    - added lightweight `[lumen-cast-perf]` profiling breadcrumbs for preload/swap command latency
  - Local test gate passed on each task PR:
    - `pnpm lint`
    - `pnpm typecheck`
    - `pnpm build`
  - Task-specific perf checks:
    - `pnpm perf:ttfc`
    - `pnpm perf:rss`
  - Greptile/check notes:
    - #94: Greptile pass on final HEAD, no comments
    - #95: initial Greptile infra failure (`Can't reach database server`), rerun succeeded with no comments
    - #96: Greptile pass, no comments
    - GitHub PR checks green before each merge

- Next:
  - LP-0340 (Define V1 go/no-go checklist)
  - LP-0341 (Build V1 smoke/regression test matrix)
  - LP-0342 (V1 compatibility matrix execution task)

---

## Session 2026-02-15 — LP-0332, LP-0333, LP-0334 (ordered batch)

- PRs: #90 (merged), #91 (merged), #92 (merged)
- Done:
  - LP-0332: Added push subscription persistence keyed by user/device with subscribe/unsubscribe endpoint service and Settings sync wiring.
  - LP-0333: Added `@lumen/push-api` sender backend with VAPID env config, queue/retry delivery flow, and append-only delivery logging.
  - LP-0334: Added service worker `push` + `notificationclick` handlers and deep-link routing into app paths.
  - Local test gate passed on each task PR:
    - `pnpm typecheck`
    - `pnpm lint`
  - Greptile/check notes:
    - Greptile bot was pinged on each PR but did not return review comments in this repository setup.
    - GitHub PR checks were green before each merge.

- Next:
  - LP-0327 (Performance test: time-to-first-channel < 3s with 20k dataset)
  - LP-0328 (Performance test: memory cap < 200MB RSS with 20k dataset)

---


## Session 2026-02-15 — LP-0011, LP-0330, LP-0331, LP-0326 (ordered batch)

- PRs: #85 (merged), #86 (merged), #87 (merged), #88 (merged)
- Done:
  - LP-0011: Lazy-loaded `/player` route with `React.lazy` + `Suspense` fallback, producing a dedicated Player chunk.
  - LP-0330: Added web push compatibility spike in `/settings` (runtime capability evaluator + iOS/Android/TV matrix).
  - LP-0331: Added two-step push opt-in UX (pre-permission screen + user-gesture native prompt) with explicit unsupported-device fallback copy.
  - LP-0326: Extended `@lumen/demo-data` with benchmark dataset generator (`20k` channels / `50k` EPG defaults), plus `nowMs` and `minEpgPerChannel` options for deterministic and denser scenarios.
  - Local test gate passed on each task PR:
    - `pnpm lint`
    - `pnpm typecheck`
    - `pnpm build`
  - Greptile/check comments:
    - #85: checks green, no actionable Greptile comments
    - #86: checks green, no actionable Greptile comments
    - #87: addressed 1 Greptile comment (effect overlap) in follow-up commit; final checks green
    - #88: addressed determinism/density feedback in follow-up commit; one final ID-collision comment marked false-positive with rationale on PR thread

- Next:
  - LP-0327 (Performance test: time-to-first-channel < 3s with 20k dataset)
  - LP-0328 (Performance test: memory cap < 200MB RSS with 20k dataset)

---


## Session 2026-02-15 — LP-0322, LP-0323, LP-0107, LP-0325 (ordered batch)

- PRs: #80 (merged), #81 (merged), #82 (merged), #83 (merged)
- Done:
  - LP-0322: Hardened subtitle track selection reliability (native add/remove/change track events + active subtitle label hints in controls).
  - LP-0323: Completed Picture-in-Picture support UX polish (keyboard/remote shortcuts, renderer guards, PiP hint consistency).
  - LP-0107: Finalized Google Cast sender flow correctness (fixed cast->session playback sync direction) and surfaced Cast errors via player toasts.
  - LP-0325: Added production PWA icon/splash asset set (favicon, apple-touch, 192/512/maskable icons, iOS startup splash variants) and wired them in app head + manifest assets.
  - Local test gate passed on each task PR:
    - pnpm lint
    - pnpm typecheck
    - pnpm build
  - Greptile/check comments:
    - #80: Greptile/checks green, no actionable comments
    - #81: addressed 2 Greptile comments in follow-up commit; final checks green
    - #82: addressed 1 Greptile comment in follow-up commit; final checks green
    - #83: Greptile/checks green, no actionable comments

- Next:
  - LP-0011 (Code-splitting: lazy load Player page)
  - LP-0330 (Web Push compatibility spike)

---


## Session 2026-02-15 — LP-0111, LP-0010, LP-0324 (ordered batch)

- PRs: #76 (merged), #77 (merged), #78 (merged)
- Done:
  - LP-0111: Added AirPlay sender control flow in web player:
    - `VideoPlayerHandle` now exposes AirPlay support/availability/connection APIs + picker trigger
    - `/player` now wires AirPlay state and picker controls (desktop, mobile, on-demand UI)
    - session renderer now switches `local-web <-> airplay` based on AirPlay connection state
  - LP-0010: Wired existing `usePWA` hook into `/settings`:
    - added install app card with real install prompt button when available
    - added iOS/Android fallback guidance and online/offline indicator
  - LP-0324: Added offline fallback page for PWA navigation failures:
    - new `apps/web/public/offline.html`
    - Workbox navigation runtime caching with `precacheFallback` to `/offline.html`
  - Local test gate passed on each task PR:
    - `pnpm lint`
    - `pnpm typecheck`
    - `pnpm build`
  - Greptile/check comments:
    - #76: one Greptile inline comment addressed in follow-up commit, final checks green
    - #77: Greptile check green, no bot comments returned
    - #78: Greptile check green, no bot comments returned

- Next:
  - LP-0325 (PWA app icon + splash screen assets)
  - LP-0011 (Code-splitting: lazy load Player page)

---

## Session 2026-02-15 — LP-0108, LP-0109, LP-0110 (ordered batch)

- PRs: #70 (merged), #71 (merged), #72 (merged)
- Done:
  - LP-0108: Added Cast receiver entrypoint at `apps/web/public/receiver.html` (deploy path `/receiver.html`) with CAF init + dual-video bridge namespace (`urn:x-cast:com.lumenplayer.bridge`) and preload/swap/playback command handling.
  - LP-0109: Updated Cast sender sync so renderer switching (`cast <-> local-web`) keeps session continuity:
    - periodic remote position/playback sync from Cast media session back into `SessionStore`
    - disconnect flow now snapshots latest Cast position before switching renderer back to local
  - LP-0110: Added explicit phone-as-remote mode in `/player` when renderer is remote:
    - dedicated remote control panel (play/pause, channel prev/next, on-demand seek, switch-to-local action)
    - local overlays/controls now render only for `local-web` renderer mode
  - Local test gate passed on each task PR:
    - `pnpm lint`
    - `pnpm typecheck`
    - `pnpm build`
  - Greptile/check comments:
    - Greptile was pinged on each PR (`@greptileai`, `@greptile-apps`), no bot comments were returned on the latest HEAD commits
    - GitHub PR checks were green before merge (Greptile status stayed in-progress without comment payload)

- Next:
  - LP-0111 (AirPlay control flow)
  - LP-0010 (PWA install UI)

---

## Session 2026-02-15 — LP-0318, LP-0319, LP-0320, LP-0321 (ordered batch)

- PRs: #61 (merged), #62 (merged), #63 (merged), #64 (merged)
- Done:
  - LP-0318: Added EPG grid page (`/epg`) with horizontal timeline (TV guide style) and player entry points (desktop + mobile)
  - LP-0319: Implemented XMLTV bulk EPG import + caching service (TTL + account signature) and wired EPG grid to prefer cached XMLTV with fallback to per-channel EPG
  - LP-0320: Added settings page (`/settings`) for theme/language/player preferences, applied runtime theme switching, and wired player prefs (`autoplay`, `defaultVolume`, `preferNativeHls`)
  - LP-0321: Added multi-audio track selection end-to-end (adapter discovery/switch + player handle APIs + controls UI)
  - Local test gate passed on each task PR:
    - `pnpm lint`
    - `pnpm typecheck`
    - `pnpm build`
  - Greptile/check comments:
    - #61: no actionable comments
    - #62: addressed XMLTV query invalidation/order feedback and refresh handling
    - #63: addressed theme apply UX feedback and wired `preferNativeHls` into playback adapter setup
    - #64: addressed audio-track sync feedback (native selection consistency, event-driven track updates, HLS listener lifecycle, selected-index hardening)
    - GitHub PR checks green before every merge

- Next:
  - LP-0322 (Subtitle track selection in player)
  - LP-0323 (Picture-in-Picture support)

---


## Session 2026-02-13 — LP-0314, LP-0315, LP-0316, LP-0317 (ordered batch)

- PRs: #55 (merged), #56 (merged), #57 (merged), #58 (merged)
- Done:
  - LP-0314: Virtualized `/player` channel lists (desktop sidebar + mobile sheet) with `@tanstack/react-virtual`
  - LP-0315: Added 200ms debounce for live channel search filtering in `Player.tsx`
  - LP-0316: Implemented category-targeted lazy catalog loading (VOD/Series) and paginated grid rendering (`Load more`)
  - LP-0317: Switched EPG to per-active-channel lazy loading (removed eager full-list EPG generation)
  - Local test gate passed on each task PR:
    - `pnpm lint`
    - `pnpm typecheck`
    - `pnpm build`
  - Greptile/check comments:
    - #55: confidence 5/5, no actionable comments
    - #56: confidence 5/5, no actionable comments
    - #57: confidence 4/5 overview, no actionable comments
    - #58: confidence 5/5, no actionable comments
    - GitHub PR checks green before every merge

- Next:
  - LP-0318 (EPG grid view)
  - LP-0319 (XMLTV bulk EPG import + caching)

---

## Session 2026-02-13 — LP-0310, LP-0311, LP-0312, LP-0313 (ordered batch)

- PRs: #50 (merged), #51 (merged), #52 (merged), #53 (merged)
- Done:
  - LP-0310: Implemented session-based VOD playback end-to-end
    - moved `SessionProvider` to app scope
    - wired `VodDetail` play action to dispatch session source + playback
    - updated `/player` to render and control on-demand session sources
  - LP-0311: Added series catalog page (`/series`) with categories + search and player entry points
  - LP-0312: Added series detail page (`/series/:seriesId`) with metadata, seasons, and episodes
  - LP-0313: Added episode playback via session from series detail (`Play Episode`) and episode-aware on-demand player overlay
  - Local test gate passed on each PR:
    - `pnpm lint`
    - `pnpm typecheck`
    - `pnpm build`
  - Greptile/check comments:
    - #50: review 5/5, no comments
    - #51: initial 4/5 (broken detail link) fixed in follow-up commit, final review 5/5
    - #52: initial 4/5 (style URL sanitization + type note) fixed in follow-up commits, final review 5/5
    - #53: review 5/5, no comments
    - GitHub PR checks green before every merge

- Next:
  - LP-0314 (virtualize channel list with `@tanstack/react-virtual`)
  - LP-0315 (debounce search input)

---

## Session 2026-02-13 — LP-0306, LP-0307, LP-0308, LP-0309 (ordered batch)

- PRs: #45 (merged), #46 (merged), #47 (merged), #48 (merged)
- Done:
  - LP-0306: Added dedicated M3U import UI (`/import/m3u`) with URL paste + file upload and persisted imported playlists in app storage
  - LP-0307: Unified Xtream + imported M3U channels into shared `PlayerChannel` model and updated playback source resolution for M3U URLs
  - LP-0308: Added VOD categories catalog page (`/vod`) with category filters, search, and responsive poster grid
  - LP-0309: Added VOD movie detail page (`/vod/:vodId`) with plot/cast/director/genre/rating/metadata and TMDB deep-link support
  - Local test gate passed on each task PR:
    - `pnpm lint`
    - `pnpm typecheck`
    - `pnpm build`
  - Greptile/check comments:
    - Greptile was pinged on each PR (`@greptile-apps`), but no bot review/comments were returned on latest HEAD commits
    - GitHub PR checks were green before each merge

- Next:
  - LP-0310 (VOD player using session)
  - LP-0311 (Series list + categories page)

---

## Session 2026-02-13 — LP-0014, LP-0015, LP-0304, LP-0305 (ordered batch)

- PRs: #40 (merged), #41 (merged), #42 (merged), #43 (merged)
- Done:
  - LP-0014: Added repo-level flat ESLint config (`eslint.config.mjs`) + package lint scripts (`turbo lint` now covers workspace packages)
  - LP-0014: Addressed Greptile performance note in `Player.tsx` watch-history effect by keying on `currentChannelId` only
  - LP-0015: Updated PR quality gate workflow to run `pnpm lint`, `pnpm typecheck`, `pnpm build`
  - LP-0304: Extended `HttpClient` with `getText()` and added `XtreamCodesService.getXMLTVEPG()` (`/xmltv.php` bulk EPG endpoint)
  - LP-0305: Added `parseM3U(content)` in `@lumen/api` and exported parser from package index
  - Local test gate passed on each task PR:
    - `pnpm lint`
    - `pnpm typecheck`
    - `pnpm build`
  - Greptile/check comments:
    - #40: initial 4/5 feedback addressed in follow-up commit; final review 5/5
    - #41: review 5/5
    - #42: review 5/5
    - #43: review 5/5

- Next:
  - LP-0306 (M3U playlist import UI)
  - LP-0307 (unified channel model for Xtream + M3U)

---

## Session 2026-02-13 — LP-0302, LP-0303 (Xtream series API batch)

- PRs: #37 (merged), #38 (merged)
- Done:
  - LP-0302: Added get_series_info endpoint via XtreamCodesService.getSeriesInfo(seriesId)
  - LP-0302: Added new series metadata response types in @lumen/types (XtreamSeriesInfo, XtreamSeriesEpisode)
  - LP-0303: Added series episode stream URL builder getSeriesEpisodeStreamUrl(episodeId, extension?)
  - LP-0303: Addressed Greptile API consistency feedback by aligning getVODStreamUrl default extension to mp4
  - Local test gate passed on each task PR:
    - pnpm lint
    - pnpm typecheck
    - pnpm build
  - Greptile/check comments:
    - #37: Greptile was pinged, no bot review/comments were returned
    - #38: 1 Greptile comment (confidence 4/5) addressed in follow-up fix commit, no additional bot review on latest HEAD

- Next:
  - LP-0304 (XMLTV EPG endpoint)
  - LP-0305 (M3U parser package)

---

## Session 2026-02-13 — LP-0208, LP-0209, LP-0210, LP-0301 (batch + ordered merge)

- **PRs:** #32 (merged), #33 (merged), #34 (merged), #35 (merged)
- **Done:**
  - LP-0208: Wired `WatchHistoryStorage` in web app and track watch entries on channel switch/unmount
  - LP-0209: Wired app-level `WebStorageAdapter + VersionedStorage` for favorites/credentials and aligned watch-history storage backend
  - LP-0210: Removed shim layer files in `apps/web/src` and switched to direct `@lumen/*` imports
  - LP-0301: Added `get_vod_info` endpoint via `XtreamCodesService.getVODInfo(vodId)` and added `XtreamVODInfo` type (with `tmdb_id`)
  - Local test gate passed on each task PR:
    - `pnpm lint`
    - `pnpm typecheck`
    - `pnpm build`
  - Greptile/check comments:
    - Greptile was pinged on each PR (`@greptileai` + `@greptile-apps`), no bot review/comments were returned

- **Next:**
  - LP-0014 (in-progress) final cleanup/validation
  - LP-0015 (planned) CI pipeline: typecheck + lint + build

---
## Session 2026-02-13 — LP-0008, LP-0009, LP-0012, LP-0207 (unwired package batch + keyboard wiring)

- **PRs:** #27 (merged), #28 (merged), #29 (merged), #30 (merged)
- **Done:**
  - LP-0008: Integrated `NumericChannelInput` into `/player`:
    - digit accumulation (`0-9`) with 2s auto-select
    - on-screen numeric preview with matched channel feedback
  - LP-0009: Integrated `IdleTimer` into fullscreen controls:
    - replaced manual hide timer with package timer + grace period
    - auto-hide behavior tied to fullscreen/catch-up/seeking state
  - LP-0012: Implemented `HlsPlayerAdapter` (`PlayerAdapter` contract from `@lumen/types`) and wired `VideoPlayer` through adapter lifecycle
    - initial Greptile pass reported integration issues (duplicate listeners/direct element control)
    - follow-up fix pass refactored `VideoPlayer` to single adapter ownership and session sync through adapter callbacks
  - LP-0207: Wired `WebKeyCodes` for keyboard/remote navigation in `/player`:
    - channel up/down via arrows/page keys
    - play/pause controls via smart/media keys
    - fullscreen enter/exit via enter/esc/back/exit keys
    - numeric channel input routed through WebKeyCodes digit map
  - Local test gate passed for each task PR:
    - `pnpm lint`
    - `pnpm typecheck`
    - `pnpm build`
  - Greptile/check comments:
    - #27, #28, #30: no comments
    - #29: comments addressed in fix pass, final review no comments
- **Next:**
  - LP-0208 (wire `WatchHistoryStorage`)
  - LP-0209 (wire `WebStorageAdapter` + `VersionedStorage`)

---

## Session 2026-02-13 — LP-0106, LP-0007 (renderer abstraction + seek engine integration)

- **PRs:** #24 (merged), #25 (merged)
- **Done:**
  - LP-0106: Added `RendererAdapter` abstraction in `@lumen/types`:
    - introduced `RendererType` (`local-web|cast|airplay`)
    - introduced `RendererSnapshot`
    - introduced `RendererAdapter` interface (connect/load/play/pause/seek/stop/error/state contract)
    - aligned `SessionRenderer` in `@lumen/session-core` to shared `RendererType`
  - LP-0007: Integrated `SeekEngine` (`@lumen/player-core`) into `PlayerControls` catch-up flow:
    - long-press/hold on rewind/forward now uses exponential seek progression from engine
    - quick tap behavior preserved for fixed-step jumps (10s/30s)
    - hold preview position is rendered in progress UI and committed back via session `seek` on release
    - cleanup added for pointer cancel/leave and mode transitions
  - Local test gate passed per PR:
    - `pnpm lint`
    - `pnpm typecheck`
    - `pnpm build`
  - Greptile/check comments: none reported on PRs at merge time
- **Next:**
  - LP-0008 (NumericChannelInput integration for digit channel zapping)
  - LP-0009 (IdleTimer integration for controls auto-hide grace period)

---

## Session 2026-02-13 — LP-0104e, LP-0104f, LP-0105, LP-0112 (session continuity batch)

- **PRs:** #19 (merged), #20 (merged), #21 (merged), #22 (merged)
- **Done:**
  - LP-0104e: Refactored `PlayerControls.tsx` to read session state directly and dispatch session commands (`play`, `pause`, `seek`, `setSource`) without callback-heavy prop plumbing
  - LP-0104f: Refactored `VideoPlayer.tsx` into a session-driven renderer (binds source/playback from session and reports playback position back to session store)
  - LP-0105: Hardened reconnect/resume on reload in `Player.tsx`:
    - do not auto-select first channel when persisted session source exists
    - added fallback channel resolution by source title
    - accept numeric-string `streamId` metadata during hydration
  - LP-0112: Added idempotency tests for `SessionStore` commands (`play`, `pause`, `seek`, `switchRenderer`, `stop`, `setSource`) in `packages/session-core/src/session-store.idempotency.test.ts`
  - Added package test command for `@lumen/session-core` and workspace `vitest` dependency
  - Local test gate passed for each task PR:
    - `pnpm lint`
    - `pnpm typecheck`
    - `pnpm build`
  - Additional test validation for LP-0112:
    - `pnpm --filter @lumen/session-core test` (6/6 passed)
  - Greptile/check comments: none reported on PRs at merge time
- **Next:**
  - LP-0106 (RendererAdapter abstraction) as follow-up after session local flow is stabilized
  - LP-0015 (CI pipeline: typecheck + lint + build) remains `planned`

---

## Session 2026-02-13 — LP-0104a, LP-0104b, LP-0104c, LP-0104d (session wiring batch)

- **PRs:** #12 (merged), #13 (merged), #14 (merged), #15 (merged)
- **Done:**
  - LP-0104a: Added `useSession(store)` hook (`useSyncExternalStore`) for reactive `SessionState` subscription
  - LP-0104b: Added `useSessionCommands(store)` typed dispatch helpers (`setSource`, `play`, `pause`, `seek`, `switchRenderer`, `stop`)
  - LP-0104c: Added `SessionProvider` + session context (`store`, `session`, `commands`) and wrapped `/player` route in provider
  - LP-0104d: Refactored `Player.tsx` to session-driven source-of-truth:
    - removed local state for `currentChannel`, `isPlaying`, `catchUpProgram`, `catchUpPosition`, `progress`
    - derive active channel/catch-up mode from session source metadata
    - dispatch session commands for channel switch, play/pause, and seek
  - Local test gate passed per PR:
    - `pnpm lint`
    - `pnpm typecheck`
    - `pnpm build`
  - Greptile/check comments: none reported on PRs at merge time
- **Next:**
  - LP-0104e (PlayerControls refactor: remove prop/callback plumbing, read session directly)
  - LP-0104f (VideoPlayer as pure session renderer + position reporting)

---

## Session 2026-02-13 — LP-0101, LP-0102, LP-0103 (session core batch)

- **PRs:** #8 (merged), #9 (merged), #10 (merged)
- **Done:**
  - LP-0101: Created `@lumen/session-core` package scaffold (`package.json`, `tsconfig.json`, `src/index.ts`)
  - LP-0102: Defined session contracts:
    - `SessionState`, `SessionSource`, renderer/playback/error types
    - command types: `setSource`, `play`, `pause`, `seek`, `switchRenderer`, `stop`
    - event types: `sessionUpdated`, `rendererChanged`, `playbackStateChanged`, `error`
  - LP-0103: Implemented `SessionStore` with:
    - command dispatch + idempotent state transitions
    - event emission (`sessionUpdated`, `rendererChanged`, `playbackStateChanged`, `error`)
    - `BroadcastChannel` cross-tab sync (`latest command wins` via `updatedAt`)
    - localStorage persistence + hydration on reload
  - Local test gate passed on each PR:
    - `pnpm lint`
    - `pnpm typecheck`
    - `pnpm build`
  - Greptile/check comments: none reported on PRs at merge time
- **Next:**
  - LP-0104a -> LP-0104b -> LP-0104c (session hooks + provider)
  - then LP-0104d/0104e/0104f refactor of Player flow to session-driven architecture

---

## Session 2026-02-12 — LP-0205 + LP-0206 deduplicate @lumen/core utils

- **Done:**
  - LP-0205: Replaced inline `formatDuration` in `PlayerControls.tsx` with import from `@lumen/core`
  - LP-0206: Replaced inline search filtering in `Player.tsx` with `filterChannels` from `@lumen/core`
    - Category + favorites filtering kept inline (app-specific logic not in package)
  - `pnpm typecheck` passes
  - All Phase 0A-cleanup "remove duplicate code" tasks now **done** (LP-0203–LP-0206)
- **Next:**
  - Session core: LP-0101 → LP-0102 → LP-0103

---

## Session 2026-02-12 — Codex batch: LP-0202, LP-0203, LP-0204

- **PRs:** #3 (merged), #4 (merged), #2 (merged)
- **Done:**
  - LP-0202: Wired catch-up seek to real `playerRef.seek()` — was cosmetic only
  - LP-0203: Replaced inline `useFavorites` localStorage logic with `@lumen/storage` imports
  - LP-0204: Replaced inline channel mappers in `useXtreamChannels.ts` with `@lumen/api` mappers
  - All 3 passed Greptile review ("no comments" on first or second round)
  - `pnpm typecheck` + `pnpm build` pass on main after merge
- **Note:** Codex updated BACKLOG/HANDOFF on old structure (pre-V1 restructure); merged docs overwritten with our V1-aligned versions

---

## Session 2026-02-12 — LP-0201 volume/mute fix

- **Commit:** `b036414`
- **Done:**
  - Completed `LP-0201` only (bugfix scope)
  - Wired `PlayerControls` volume slider to real player volume API (`setVolume`)
  - Wired mute toggle and mute state transitions to real player mute API (`setMuted`)
  - Added explicit `setMuted(muted: boolean)` to `VideoPlayerHandle` for deterministic mute sync
  - Updated `BACKLOG.md`: `LP-0201` status -> `done`
- **Validation / test gate:**
  - `pnpm lint` failed due Turbo internal crash (tooling issue, not code lint errors)
  - `pnpm --filter @lumen/web lint` passed (1 existing warning in `apps/web/src/components/ui/button.tsx`)
  - `pnpm --filter @lumen/web typecheck` passed
  - `pnpm --filter @lumen/web build` failed in existing PWA service-worker generation step (`vite-plugin-pwa`/workbox early-exit)
- **PR:**
  - Branch pushed: `codex/lp-0201-volume-mute-fix`
  - PR link prepared by git: `https://github.com/alltheclicks/lumenplayer/pull/new/codex/lp-0201-volume-mute-fix`
  - `gh pr create` blocked in this environment (`gh auth login` required)

---

## Session 2026-02-12 — Vision + Backlog + Consistency fixes

- **Commit:** (pending)
- **Done:**
  - Created `VISION.md` — product vision covering V1 (Web/PWA), V1.5 (Dashboard), V2 (Native Apps)
  - Defined 3 user personas: Single User, Provider, Partner (white-label)
  - Restructured `ROADMAP.md`:
    - Cast + AirPlay + PWA + Performance acceptance are now **part of V1** (not separate phases after V1)
    - Phase 1 = Dashboard (was 1.5), Phase 2 = Native TV + Mobile (consolidated)
    - Removed Phase 0A-V1/0B/0C naming confusion — now V1-Content, V1-Cast, V1-AirPlay, V1-PWA, V1-Perf
  - Updated `BACKLOG.md` with 44 tasks total in the new V1/Phase1/Phase2 scope:
    - LP-0301–LP-0304: Xtream API kompletnost
    - LP-0305–LP-0307: M3U podrška
    - LP-0308–LP-0310: VOD UI
    - LP-0311–LP-0313: Series UI
    - LP-0314–LP-0317: Performanse velikih listi
    - LP-0318–LP-0319: EPG
    - LP-0320–LP-0323: UI features
    - LP-0324–LP-0325: PWA (offline fallback, app icon)
    - LP-0326–LP-0329: Performance acceptance (benchmark, time-to-first-channel, memory cap, Cast device profiling)
    - LP-1501–LP-1506: Dashboard
    - LP-2005–LP-2006: TV (Fire TV, Apple TV)
    - LP-2007–LP-2013: Mobile + Infra (Expo/Capacitor decision, iOS, Android, lock-screen, licensing, white-label)
  - Moved LP-0010 (PWA improvements) from "Other" into V1-PWA section
  - Moved LP-0011 (code-splitting) into V1-PWA section
  - Moved LP-0013 (demo-data guard) into Foundation/Quality
  - Removed old "Phase 1 — Mobile" section (merged into Phase 2)
  - Updated `CLAUDE.md` — VISION.md in "Read first" list, Key Files, and Workflow step 1
  - Fixed ROADMAP ↔ BACKLOG ↔ VISION alignment:
    - Cast is now V1 exit criteria (was separate phase)
    - Dashboard = Phase 1 (was 1.5), before Native (was Phase 1)
    - Mobile backlog tasks added to Phase 2 (were missing)
    - Performance acceptance tasks added (were missing)

- **Next:**
  - Prioriteti ostaju isti: Session MVP (LP-0101–LP-0103), bugfixes (LP-0201–LP-0202)
  - V1 taskovi su `idea` status — kreću posle session refaktora

- **Risks/Blockers:**
  - Isti kao prethodno (nema novih)

---

## Session 2026-02-12 — Sync after baseline fixes

- **Commit:** (pending)
- **Done:**
  - Added ESLint flat config for web app: `apps/web/eslint.config.mjs`
  - `pnpm --filter @lumen/web lint` now executes successfully (warning-only output)
  - Implemented namespace-safe clear for storage:
    - `StorageAdapter` extended with optional `listKeys()`
    - `WebStorageAdapter` now supports `listKeys()`
    - `VersionedStorage.clear()` now removes only namespaced keys (no global clear)
  - Synced backlog statuses/notes:
    - `LP-0014` -> `in-progress`
    - Added `LP-0211` -> `done`
    - Clarified `LP-0209` scope/dependency

- **Next:**
  - Finish `LP-0014` at repo level if needed (shared lint policy)
  - Execute quick wins: `LP-0201`, `LP-0202`, `LP-0203`

- **Risks/Blockers:**
  - `apps/web` still uses raw localStorage in hooks/services (full `LP-0209` not done)
  - No automated tests yet for new storage behavior

## Session 2026-02-12 — Deep Codebase Audit

- **Commit:** (no code changes — audit only)
- **Done:**
  - Deep analysis of entire codebase with 4 parallel Opus 4.6 agents
  - Discovered 2 bugs: volume controls cosmetic (LP-0201), catch-up seek cosmetic (LP-0202)
  - Discovered 4 code duplications between packages and apps/web (LP-0203–LP-0206)
  - Discovered 3 entire packages unwired: `@lumen/player-core`, `@lumen/input`, most of `@lumen/storage`
  - Split LP-0104 into 6 sub-tasks (LP-0104a through LP-0104f) — original was too large
  - Added 10 new tasks (LP-0201–LP-0210) for cleanup, bugfixes, and wiring
  - Added dependency graph (Depends on column) to all tasks
  - Full audit notes recorded at bottom of BACKLOG.md

- **Next (recommended order):**
  1. **Quick wins (no dependencies, can go first or parallel):**
     - LP-0201, LP-0202 (bugfixes)
     - LP-0203–LP-0206 (remove duplicates)
     - LP-0014, LP-0015 (ESLint + CI)
  2. **Session core (sequential chain):**
     - LP-0101 → LP-0102 → LP-0103 (greenfield package)
  3. **Session wiring (sequential, after step 2):**
     - LP-0104a → LP-0104b → LP-0104c → LP-0104d → LP-0104e → LP-0104f
  4. **Package wiring (after 0104d+):**
     - LP-0007, LP-0008, LP-0009, LP-0012

- **Risks/Blockers:**
  - LP-0104d (Player.tsx refactor) is the riskiest task — touches the entire playback flow
  - Mobile strategy still open (Expo vs Capacitor)
  - No tests exist — refactoring without tests increases risk
  - apps/web tsconfig has `strict: false` — may hide type issues

- **Key insight:**
  - apps/web was copied from player-standalone but packages were also extracted from it
  - Result: same code exists in TWO places (package + inline in web app)
  - The "brownfield" feeling comes from this duplication — packages are ready but not used

---

## Session 2026-02-11

- **Commit:** (pending)
- **Done:**
  - Added `SESSION-ARCHITECTURE.md` as strategic source for session-centric model
  - Updated `DECISION-DOC.md` with addendum linking to session strategy
  - Replaced `ROADMAP.md` with 0A/0B/0C phases (Session MVP -> Cast -> AirPlay)
  - Replaced `BACKLOG.md` with session/cast-first priorities + `pending-review` for old plan tasks
  - Updated `CLAUDE.md` so future agents read `SESSION-ARCHITECTURE.md` before implementation

- **Next:**
  - Implement LP-0101 (`@lumen/session-core` scaffold)
  - Implement LP-0102 (session contracts)
  - Decide Mobile Phase 1 direction: Expo vs Capacitor

- **Risks/Blockers:**
  - Mobile strategy still open (Expo vs Capacitor)
  - TV expansion depends on cast-centric adoption metrics

- **Source files:**
  - Strategy: `SESSION-ARCHITECTURE.md`
  - Base architecture: `DECISION-DOC.md`
  - Active plan: `ROADMAP.md`
  - Tasks: `BACKLOG.md`
  - Agent rules: `CLAUDE.md`

## Session 2026-02-10

- **Commit:** (initial setup — see git log)
- **Done:**
  - Full monorepo scaffolding (Turborepo + pnpm)
  - 7 @lumen/* packages created with source code:
    - `@lumen/types` — all shared types (Channel, Program, Xtream*, PlayerAdapter, StorageAdapter, etc.)
    - `@lumen/core` — EPG utils, time formatting, channel filtering
    - `@lumen/demo-data` — mock channels + EPG generator
    - `@lumen/api` — XtreamCodesService with HttpClient DI + mappers
    - `@lumen/player-core` — SeekEngine (ported from SmartTV) + IdleTimer
    - `@lumen/storage` — WebStorageAdapter, VersionedStorage, credentials, favorites, watch history
    - `@lumen/input` — Samsung/LG/Web key codes, NumericChannelInput, platform detect
  - apps/web copied from player-standalone with re-export shims
  - `pnpm build` — passes (Vite production build succeeds)
  - `pnpm typecheck` — passes (zero type errors)
  - `pnpm dev` — works on localhost:8080
  - Documentation: CLAUDE.md, BACKLOG.md, ROADMAP.md, this HANDOFF.md
  - predlogtemp.md moved to docs/workflow-proposal.md

- **Next:**
  - Create GitHub remote repo and push
  - LP-0003 through LP-0006: unit tests for shared packages
  - LP-0007: integrate SeekEngine into apps/web
  - LP-0012: implement HlsPlayerAdapter

- **Risks/Blockers:**
  - apps/web has `strict: false` in tsconfig — some packages may expose stricter types than the app expects
  - No tests yet — packages are untested beyond typecheck

- **Source files:**
  - Architecture: `DECISION-DOC.md`
  - Task list: `BACKLOG.md`
  - Phase plan: `ROADMAP.md`
  - Dev guide: `CLAUDE.md`

## Sync note (2026-04-03, shadow validation branch)

- Branch: `codex/qaf-035-shadow-admin-validation`
- Shadow validation mode now bypasses stale live startup restore from persisted session/watch-history and prefers the first catch-up-enabled channel on boot.
- Reason: persisted `INFO KANAL` (`stream_id=1526`) was repeatedly restoring on `127.0.0.1:8081`, returning `403`, and making the validation build look broken before HRT1/RTS1 testing even started.
- Current verified boot after the patch:
  - local session source initializes to `RTS 1` (`stream_id=112`)
  - `GET /live/.../112.m3u8 -> 302 -> 200`
  - `playback.started` is emitted
- Current server-side shadow status:
  - HRT1 shadow now serves `fMP4` (`#EXT-X-MAP`, `init.mp4`, `.m4s`) and crosses old `:59` boundary, but user still reports A/V desync
  - RTS1 shadow is substantially improved but may still show minor boundary glitches depending on program window
- Lumen-side follow-up (same branch, uncommitted as of latest session):
  - catch-up now prefetches the next EPG program shortly before the current one ends
  - prefetched shadow result is cached briefly and reused on transition to reduce the 5-10s cold-start delay when jumping to the next program
