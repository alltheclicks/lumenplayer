# TV-020 — combined adapter integration and internal live playback flow

Date: 2026-10-23. Host: Buildara / Linux. Session:
`Codex/TV020-d9afafcc-sol61-medium-20261023` (Sol 6.1, medium; no subagents).
Worktree: `/home/filip/.t3/worktrees/lumen-player/t3-d9afafcc`, branch
`t3/tv-adapter-integration`. Immutable base:
`efd6f8f5159d017d76b015ccd47454bc61a566e1`.

## Combined source and review

Source commit: `c93a56c41b65a581ee4be06a8de56376f5bbb540`.
Owner-authorized local merges into this branch only:

- `306b3fdd1620ed09afd030690b5a2f7c9548c4aa` → merge `b5007c2`:
  Samsung adapter, TV-018 missing-callback watchdog and TV-019 controller fix.
- `dad6324a1d63fb6b50774a5a8a1ae0868f2ef63c` → merge `ca33dfd`: LG adapter.
- `fab50d801089bd539b44c28bddd805c67c21eb9d` → merge `dad8746`: Android Media3.

No merge conflict, predecessor row change, other branch edit or remote write.
The newer parent documentation and tracked TASKS snapshot survived all merges.
The live TV-020 row alone was claimed/updated under the common Git directory's
atomic mkdir lock. Reservations cover root/config/shared and both clients;
no SDK/design paths were edited. No root dependency correction was necessary.

Reviewed actual adapters, controller, native bridge, Gradle source inputs,
regression tests and TV-006/007/008/017/018/019 evidence. TV-019 preserves
sanitized code/fatal errors across load and failed live transitions, filters
notifications by exact request object, and guards settled operations by
generation/transition identity. Existing actual-Tizen/controller missing-seek
regression and stale-load/live-resolution tests pass in the combined suite.
Android's older consumer assertion expected the pre-TV-019 rejection text;
it now checks the sanitized message plus `MEDIA3_LOAD_FAILED` and `fatal:true`.
No provider diagnostics are accepted as display text.

Samsung's native seek remains serialized until its real callback; watchdogs
never unlock/reset the native engine. The permanent adapter recovery latch is
unchanged. Composition additionally latches restart-required across destroyed
controllers if a seek was unresolved, refuses overlapping owners, and refuses
a new owner if native cleanup/close has not actually released the predecessor.
A late callback cannot bypass the composition latch. No forced reset was added.
New consumer tests cover pending callback, late callback, clean reopen,
idempotent old destruction and failed native close.

## Build target and media wiring

`vite.tizen.config.ts` defines `VITE_TV_TARGET=tizen`; the webOS config defines
`webos`. Plain development defaults to `browser` and the unavailable adapter.
No UA detection selects a platform. `src/composition/platform.ts` connects the
selected adapter to TVPlaybackController. Both generated production bundles
contain the actual adapter and internal test consumer, not just the old shell.

Samsung loads `$WEBAPIS/webapis/webapis.js` before the app module, checks all
used AVPlay methods, preserves their receiver, mounts one
`object[type=application/avplayer]` and uses full-screen 1920×1080 reference
coordinates. The playback graphics/root/surface are transparent. Native object
and controller are removed on Back/Settings/hide/exit, subject to the unresolved
seek engine boundary above. LG requires its webOS/PalmSystem runtime marker,
creates a fresh native HTML video element per load, and releases its source,
listeners and mount on teardown. The media mount lives outside status markup;
status/time events never replace/detach the active element. There is no desktop
HTML media fallback pretending to be a TV platform.

Samsung source permissions are intentionally explicit. Set a JSON array of
**public origin-only** values through `KLARO_TV_SOURCE_ORIGINS` at build time.
The configuration generates exact `access` entries with `subdomains=false` and
the same runtime initial-URL allowlist. Paths, credentials, wildcard origins
and malformed values are rejected without echoing their input. Example with a
nonexistent public test origin (no real source/network request):

```sh
KLARO_TV_SOURCE_ORIGINS='["https://example.invalid"]' pnpm --filter @lumen/tv-web build:tizen
```

List every approved initial source and redirect/CDN/manifest/segment/key origin
from the real source topology. Runtime checking covers the initial URL; platform
network enforcement and source/CORS/TLS/redirect behavior still need device
verification. The default build has **no source origins** and reports a localized
configuration error rather than broadening network access. This is a concrete
source prerequisite, alongside the missing Samsung signing profile.
No real origin, source protocol or URL transformation was guessed.

## Internal test scope and lifecycle

The home screen accepts an HTTP(S) live HLS URL in a password field with
autocomplete disabled. Submission clears the field immediately; navigation,
hide and pagehide clear it and tear down playback. URL retention is only in the
active in-memory request/native player as required to play; the shell state,
preferences, diagnostics and errors do not store/serialize/log it. Only language
is persisted. Load then explicit play uses the existing live request contract;
Back stops/destroys playback. Settings returns to a clean home screen.

English, Serbian Latin and Arabic resources cover status, invalid URL, missing
platform API, unsupported browser, missing Samsung source permission, restart
requirement and sanitized playback failure. Existing language selection and RTL
shell behavior are retained. This is a minimal engineering screen, not full
localization coverage or design parity. Design exports are unchanged.

Return-to-live remains adapter-injected source policy: no resolver is invented
for this live-only flow and no archive URL is rewritten. Web adapter return-live
capability remains false without a resolver. Catalog/EPG/archive picker and full
controls remain TV-014/015. Native Android integration is the supplied Media3
bridge/surface/flow; this task does not introduce a second source protocol.

## Host validation

Full logs, scripts and summarized JSON: `/tmp/klaro-tv020-logs/` (local only).
Free space was checked on the actual target filesystem: about 24 GB initially,
23 GB after builds. Independent dependencies were installed with
`pnpm install --frozen-lockfile --offline` (exit 0); no copied dependency tree or
cross-worktree node_modules symlink. Heavy builds ran serially; Turbo/Gradle
were capped at two workers. Existing TV-017 NDK 27.1.12297006/CMake 3.22.1 were
checked read-only and reused. No SDK download/update/global install occurred.

| Check | Final result | Log |
|---|---|---|
| Root lint, `--concurrency=2` | exit 0, 13 tasks | `lint-final.log` |
| Root typecheck, `--concurrency=2` | exit 0, 13 tasks | `typecheck-final.log` |
| Root unit, `--maxWorkers=2` | exit 0, 79 files / 757 tests | `unit-final.log` |
| Root build, `--concurrency=2` | exit 0, 4 tasks; both TV targets/Chrome63 compatibility | `build-final.log` |
| QAF035 validator | exit 0, existing final-release blockers remain | `qaf035.log` |
| TV web tests | exit 0, 92 Vitest + 2 Node tests | `web-test-final.log` |
| Android client tests | exit 0, 33 tests / 4 files | `android-test-final.log` |
| Latest TV config lint/typecheck | exit 0 | `web-lint-final.log`, `web-typecheck-final.log` |
| webOS package, `--no-minify` | exit 0 | `webos-package-final.log` |
| Samsung package | expected exit 2: missing owner-created `KLARO_TIZEN_PROFILE` | `tizen-package.log` |
| Pinned native SDK check | exit 0, no mutation | `sdk-native.log` |
| Android Gradle offline debug | exit 0, 1m42s, 57 executed tasks | `android-gradle.log` |
| APK ZIP, manifest/badging, v2 signature | exit 0 | `apk-zip.log`, `apk-manifest.log`, `apk-badging.log`, `apk-signature.log` |
| Bundle/package inspection | exit 0 | `artifacts.json`, `package-inspection.json` |
| Configured-origin Samsung build | exit 0, exact origin entry; output outside repo | `tizen-configured.log` |

Exact Android build command:

```sh
scripts/tv-env/run bash -c 'cd apps/android-tv/android && ./gradlew --offline --no-daemon --max-workers=2 -Pandroid.builder.sdkDownload=false :app:assembleDebug'
```

APK inspection confirms `com.lumen.klaro.tv.internal`, API24/36, leanback
launcher, ARM64/ARMv7, bundled Hermes JS, native playback module/surface manager
and ExoPlayer classes, with no GMS class prefix. RN debug manifest has
`usesCleartextTraffic=true`, as already observed in TV-008; no policy was changed.
The APK asset equals the generated bundle byte-for-byte. Source-map contents
match all three production Android adapter TS/TSX files and the integrated
TV-019 shared controller. Explicit Gradle adapter input tracking remains present,
avoiding RN's default `**/android/**` exclusion/stale bundle problem.

Inspection caught ares-package's default second minification changing the
already validated JS. Packaging now uses its installed `--no-minify` option;
IPK JS/CSS bytes equal the final checked Vite assets. No SDK file was edited.

Initial root checks failed on the new DOM test mock's structural TypeScript
cast and the obsolete Android error-text assertion (1/753 failed). Both were
corrected; full initial failures are retained in `typecheck.log` / `unit.log`,
and final passes are separate. An initial package equality assertion also
caught the second-minification behavior before the packaging correction.

Synthetic T3 browser checks used generated production bundles with injected
platform/media mocks and public nonexistent URLs, not real media. LG checks:
selected webOS build, masked/cleared input, playing/buffering rendering, stable
video identity, Settings/hide cleanup and ignored late events. Configured Samsung
checks: selected Tizen build, AVPlayer object, reference rectangle, exact URL
handoff, one open, Back cleanup; a focused check with the generated stylesheet
confirms transparent root/body/surface. Plain browser development rejects
playback honestly and retains Arabic/RTL/navigation. Evidence JSON:
`browser-lg-final.json`, `browser-tizen-final.json`, `browser-tizen-css.json`.

## Exact final artifacts

Generated files remain ignored/local; these hashes identify this run, not a
reproducibility guarantee for ZIP/signing timestamps.

| Artifact | Bytes | SHA-256 |
|---|---:|---|
| `apps/android-tv/android/app/build/outputs/apk/debug/app-debug.apk` | 60754349 | `ea6a22c22c96c83ecba787816c1da2118e7f5d36c70eed255e6222dc3399e802` |
| `apps/tv-web/artifacts/webos/com.klaroplayer.tv_0.0.1_all.ipk` | 11954 | `29195c58b556b84327a5f7b0e0b75447625180bd1875f990bcb44fe04f3152b0` |
| `apps/tv-web/dist/tizen/assets/index-jokRBtF2.js` | 28662 | `9e0a81c17c972f48e3bde24730ccb44ea5b1e5be2741c6b5c2776fdc11b480d8` |
| `apps/tv-web/dist/webos/assets/index-D5tuIL2G.js` | 27676 | `98e98c6d8d51ef991881d2cdc7aa965fd325c0b8c212d400e380b2fa3da8bcda` |

APK bundled JS SHA-256: `b05c4461ab5fdbbe5366dff7f5142089fc8ec448ae9b6cf0cc01932781f5bd45`.

## Remaining gates

No TV/Android device/emulator was accessed, installed or run. No real source,
media fetch/decoding, audible/video playback, sustained playback, firmware seek
recovery, standby/resume, remote keyboard behavior or codec compatibility is
proven. Samsung still needs owner signing and approved source/CDN origins;
all platforms need private controlled media and Mac/device access. LG and Android
packages are internal host-build artifacts, not release/device acceptance.
QAF035 validation preserves its recorded open final-release blockers.

No catalog/design completion, task `done`, push, deployment, main-branch merge,
store operation or source/provider mutation is claimed. Review the combined
branch before downstream integration; keep TV-009/010/011/012/013 and TV-014/015
status decisions with the coordinator.
