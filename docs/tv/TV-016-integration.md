# TV-016 — combined TV contract and shell integration

Evidence date: 2026-10-23. Host: Buildara (Linux). Session:
`Codex/TV-016-e01ca79f-20261023`. Worktree:
`/home/filip/.t3/worktrees/lumen-player/t3-e01ca79f`, branch
`t3/integrate-tv-shells`. This is local integration and host build evidence;
no device, emulator, installation, release, push or deployment was performed.

## Immutable inputs and result

Initial branch commit: `ed8023913cce0d6a479763be497ddb9d1bb96642`.
The clean child branch locally merged these reviewed inputs, in order:

1. Baseline `ebb93acd6aaace2202b305a15a655b7f06ac32c5` (P4, design and SDK).
2. Shared contracts `6a038cab55c11be274ef9ed3e62566ea725327e3`.
3. Web shell `416bbd54952c3d70a1bcf52393ee07e9975cb910`.
4. Android shell `f61764ab7a9ff3f256a1f65b5fa20d93d109733c`.

Combined source commit: `c05faf29f94ec697f5483c6820b76d13a8ddcc12`.
The following handoff commit adds this evidence and ignores generated Kotlin
session files; it does not alter the built application source. All inputs are
ancestors. The newer initial `TASKS.md` snapshot was preserved unchanged;
the canonical live registry was updated separately, under its directory lock.
Only TV-016 was claimed/updated. No main or `t3/tv-integration` worktree was
modified. `design/` remains byte-identical to the approved baseline.

## Integrated behavior

Both production composition roots now create `TVPlaybackController` from
`@lumen/player-core`, accepting the actual `TVPlaybackAdapter` interface.
Android constructs a discriminated live `TVPlaybackRequest`; the web test flow
uses the same request shape. Both declare the player-core workspace dependency.
No legacy `PlayerAdapter` fixture remains in either shell.

`UnavailableTVPlaybackAdapter` is the shared explicit placeholder. It advertises
no live/catch-up/seek/return-to-live or media-type support. The controller rejects
unsupported requests before calling a platform engine. The shell catches that
failure and keeps its existing localized no-playback screen. There is no source
fetch, fake successful playback, platform adapter, provider credential or new
catalog implementation. The Android URL field remains ephemeral.

A new web playback attempt replaces/destroys the previous controller; Back,
Settings and teardown cancel work and invalidate late completions. Android
replaces the controller on each attempt and destroys it on navigation/unmount,
retaining its UI generation guard. Platform adapters can replace the injected
unavailable adapter in TV-006/007/008 without changing the shared contract.

Consumer tests exercise both production factories with an injected adapter:
exact request identity, abort on teardown, unsubscribe/destroy, catch-up epoch
milliseconds and seek clamping. They also verify all unavailable capabilities,
no network request, idle/no-playing state, and web Back/Settings/teardown ignoring
late completion. These are host tests, not actual React Native or TV execution.

TV web installs `abort-controller@3.0.0` only when the native global is missing:
Chrome 63 predates native AbortController. A consumer check exercises cancellation
with this fallback and verifies preservation of a native implementation. Emitted
JS/CSS checks establish syntax compatibility, not old-TV runtime compatibility.

## Dependency integration failures fixed

One root `pnpm-lock.yaml` now includes both TV apps. Frozen installation passed.
The combined dependency graph exposed two concrete failures:

- App-local ESLint 9.9.0 loaded the root TypeScript ESLint plugin bound to 9.39.2,
  crashing `no-unused-expressions`. Both TV apps now pin ESLint 9.39.2, matching
  the existing root resolution.
- Web React 18 libraries without an explicit React type peer resolved hoisted
  Android React 19 types. Root `pnpm.packageExtensions` declares the missing
  `@types/react` peer for the currently pinned lucide-react, react-helmet-async,
  react-router and react-router-dom versions. pnpm now resolves them against the
  web app's React 18 types, retaining React 19 types for Android. No web source,
  skip-lib-check workaround or React runtime upgrade was introduced.

The converted shell tests also required declarations for their existing reducer
exports; those declarations are now included. TV web adds a `build` script so
root Turbo build includes both platform builds and compatibility checks.

Lockfile SHA-256:
`5d0bc51ce437060169df833fb96b245114d978808cae1a79d968c589099dbbfb`.

## Validation

Long logs are outside the repository in `/tmp/klaro-tv016-logs/`.
Node 22.22.2, pnpm 9.15.4. Commands were executed on Buildara.

| Command | Exit | Evidence / log |
|---|---|---|
| `pnpm install --lockfile-only` | 0 | Final dependency fix: `lockfile-types.log` |
| `pnpm install --frozen-lockfile` | 0 | `install-types.log` |
| `pnpm lint` | 0 | 13 tasks; `lint-final.log` |
| `pnpm typecheck` | 0 | 13 tasks, including both TV apps and existing web; `typecheck-types.log` |
| `pnpm test:unit` | 0 | 73 files / 636 tests; `unit-final.log` |
| `pnpm build` | 0 | 4 tasks, including Tizen/webOS builds; `build.log` |
| `pnpm release:qaf035:validate` | 0 | 24 checks, current-open-blockers mode; `qaf035.log` |
| `pnpm --filter @lumen/tv-web test` | 0 | 2 Node focus tests + 14 Vitest checks; `tv-web-test.log` |
| `pnpm --filter @lumen/android-tv test` | 0 | 2 files / 5 tests; `android-test.log` |
| `pnpm --filter @lumen/tv-web package:webos` | 0 | Actual IPK; `package-webos.log` |
| `env -u KLARO_TIZEN_PROFILE pnpm --filter @lumen/tv-web package:tizen` | 2, expected | Missing owner-created Samsung TV certificate profile; `package-tizen.log` |

The initial failed typecheck/lint logs are retained (`typecheck.log`,
`typecheck-final.log`, `lint.log`); the final passing logs above supersede them.
Unit/app tests were run after the final application-source changes; the later
package-extension fix changes type-peer resolution only. Final typecheck and
build used the final frozen dependency graph.

QAF035 validation preserves seven expected final release blockers: go/no-go,
smoke matrix, compatibility matrix, design parity, release readiness, capacity
and actual-device QA. This is not a final release acceptance pass.

Both TV web builds pass emitted ECMAScript 2018 / Chrome 63 and legacy CSS
checks. The generated JS is approximately 14.27 kB before compression.

LG artifact (ignored):
`apps/tv-web/artifacts/webos/com.klaroplayer.tv_0.0.1_all.ipk`, 7,976 bytes.
SHA-256: `8a8c3b1e9f4d256e19b7603bc968101ee56081f0d2c95eaa2828431eb814d4cf`.
Samsung WGT was not created; no emulator/test certificate was substituted.

## Android build and SDK coordination

TV-017 released SDK mutation in the canonical registry at
`2026-10-23T09:31:05Z`, explicitly allowing TV-016 to build; installed packages
were reused and no further SDK writes/downloads were planned. Before the build,
local source.properties independently confirmed NDK `27.1.12297006` and CMake
`3.22.1`. TV-017's separate result is `2f3524525aae0985d31c5ec7d62e6e2278d8aada`;
it is not merged here and its reserved scripts were not edited by TV-016.

The build uses the app's Gradle 9.4.1 wrapper, isolated SDK/JDK17 environment,
installed pins, offline dependency resolution and two workers:

```sh
scripts/tv-env/run bash -c 'cd apps/android-tv/android && ./gradlew --offline --no-daemon --max-workers=2 :app:assembleDebug'
```

Build exit: **0**, `BUILD SUCCESSFUL in 1m 34s`, 57 actionable tasks executed.
Full log: `/tmp/klaro-tv016-logs/android-build.log`. Both `arm64-v8a` and
`armeabi-v7a` CMake builds completed; the SDK was not provisioned by this build.
Nonfatal warnings: RN private feature-flag export falls back to file resolution,
NO_COLOR/FORCE_COLOR, existing Kotlin deprecations and Gradle 10 deprecations.

APK (ignored):
`apps/android-tv/android/app/build/outputs/apk/debug/app-debug.apk`,
57,730,256 bytes. SHA-256:
`9f0581954cb4b31d7c8e2e963f91902a1586c9bf2f85a650a8a7e325099b8233`.

`aapt2 dump badging` and `unzip -t` both exit 0; logs `apk-badging.log` and
`apk-unzip.log`. Inspection confirms `com.lumen.klaro.tv.internal`, min API 24,
target/compile API 36, leanback launcher, `arm64-v8a` / `armeabi-v7a`, and
`assets/index.android.bundle` (1,036,472 bytes). The LG IPK is a Debian binary
package with `debian-binary`, `control.tar.gz` and `data.tar.gz` members.

Filesystem space was checked before installation, before the heavy Android
build, during it and after completion: approximately 21–22 GB available on the
actual home filesystem throughout. The new Android build directory occupies
509 MB; workspace pnpm dependencies about 393 MB. Heavy root/Android builds ran
serially. No other worker's files or caches were deleted or copied.

Final checks: `git diff --check` exit 0; design tree unchanged; initial/newer
TASKS snapshot unchanged; no edits to TV-017 scripts; source commit contains
all four requested input commits. Generated Kotlin session files are ignored.

## Remaining gates

Parent/coordinator reviews this combined commit and consumer evidence before
releasing predecessor reservations, approving TV-003/004/005 or enabling any
downstream row. This worker does not change those rows. Implement real platform
playback separately (TV-006/007/008), catalog screens (TV-014/015), owner signing
and device prerequisites (TV-013), and physical acceptance (TV-009/010/011/012).
No device compatibility, remote behavior, persistence or real media playback is
claimed from these host checks.
