# TV-005 — Android TV shell and debug APK

Evidence date: 2026-10-21. Implementation host: Buildara. Repository: `alltheclicks/lumenplayer`.
Branch: `t3/android-tv-shell-apk`. Integration base: `ebb93acd6aaace2202b305a15a655b7f06ac32c5`.
The shell sources are under `apps/android-tv/`; the app's local playback files do not include the TV-008 reserved adapter paths.

## Delivered shell

- Added the `@lumen/android-tv` react-native-tvos package with a TV leanback launcher, Klaro app mark, high contrast focus styles, remote-selectable `Pressable` controls and Android Back navigation.
- First launch opens language selection before the home screen. English is the default and persisted per installation in Android `SharedPreferences`; settings remains reachable from Home and Playback. The initial UI resources include English, German, Serbian Latin and Serbian Cyrillic. This is a localization foundation, not the complete locale inventory in `GRAND_PLAN.md`.
- Home opens a two-column playback test layout that collapses to one column below 1100 dp. The source field accepts an HLS URL without logging or persisting it.
- The local composition boundary uses the existing `@lumen/types` `PlayerAdapter`. `NoPlaybackAdapter` is deliberately not a playback mock: it reports loading, then the explicit `MEDIA_ADAPTER_NOT_AVAILABLE` error. No Media3 or real source request is made. The test-only adapter behavior is exercised under `src/testing/`.
- Debug APK generation bundles JavaScript, so the artifact does not require a Metro process when launched. Debug signing uses Gradle's local debug signing flow; no keystore or signing asset is tracked.
- The internal debug application ID is `com.lumen.klaro.tv.internal`. It is not a public package ID decision.

## Pinned build stack and evidence

The current official [React Native TV project](https://github.com/react-native-tvos/react-native-tvos) publishes `react-native-tvos` as a React Native fork and documents the `react-native` npm alias. The selected exact package is `react-native-tvos@0.87.1-1`, based on React Native 0.87.1, with React 19.2.3. The [React Native environment guide](https://reactnative.dev/docs/set-up-your-environment) recommends JDK 17. TV-002's isolated SDK supplies Node 22.22.2, JDK 17.0.20.1, API 36 and build-tools 36.0.0.

| Component | Pin / selection |
|---|---|
| React Native TV | `react-native-tvos@0.87.1-1` (npm alias as `react-native`) |
| React | `19.2.3` |
| React Native Gradle plugin / codegen | `0.87.1` |
| Node | `22.22.2` via `scripts/tv-env/run` |
| Java | Temurin `17.0.20.1` via `scripts/tv-env/run` |
| Gradle wrapper | `9.4.1` |
| Android compile / target SDK | API `36` / `36` |
| Android minimum SDK | API `24` per the TV fork's current support statement |
| Android build tools | `36.0.0` |
| NDK / CMake | `27.1.12297006` / `3.22.1` |
| JS engine | Hermes compiler `250829098.0.17`; New Architecture enabled |
| Native architectures | `arm64-v8a`, `armeabi-v7a` |

Gradle 8.13, which TV-002 installed for host tooling, is below this RN 0.87 Android Gradle plugin's actual minimum: the first build stopped with “Minimum supported Gradle version is 9.4.1”. The committed wrapper pins 9.4.1 and downloads it into the isolated Gradle user home. RN 0.87 also requires the New Architecture; CMake/Ninja was therefore needed. NDK `27.1.12297006` was automatically installed by Gradle into the isolated Android SDK during the build. CMake 3.22.1 was added to that SDK with:

```sh
scripts/tv-env/run sdkmanager --install 'cmake;3.22.1'
```

On a fresh SDK, install the pinned SDK packages before building (Android SDK license acceptance may be required):

```sh
scripts/tv-env/run sdkmanager --install 'ndk;27.1.12297006' 'cmake;3.22.1'
```

Build and inspect the package on Buildara:

```sh
pnpm install --lockfile=false
pnpm --filter @lumen/android-tv typecheck
pnpm --filter @lumen/android-tv lint
pnpm --filter @lumen/android-tv test
scripts/tv-env/run bash -c 'cd apps/android-tv/android && ./gradlew :app:assembleDebug'
scripts/tv-env/run aapt2 dump badging apps/android-tv/android/app/build/outputs/apk/debug/app-debug.apk
```

The coordinator rebuilt the APK from source commit `d90031f83b996fecf488261786e1f7ee21905d85` after the review corrections below. Buildara produced `apps/android-tv/android/app/build/outputs/apk/debug/app-debug.apk` (58,866,166 bytes, SHA-256 `bb93ae06592c47e80dc2e3b9e06284ef311fcec4c1c5ae4ef622be1fe61c0aed`). `aapt2 dump badging` reports the internal package ID, min API 24, target/compile API 36, ARM ABIs, and both Android and leanback launch activities. The APK contains `assets/index.android.bundle`. The ignored `android/app/build/` directory contains generated build outputs. The worker's earlier APK from `649ba9c` has been superseded.

## Root ownership request

`pnpm-workspace.yaml` already includes `apps/*`; no root package manifest or Turbo change is required. The coordinator owns `pnpm-lock.yaml`: after integrating this branch, regenerate and commit the `apps/android-tv` importer and its pinned dependency graph, then run `pnpm install --frozen-lockfile`. App-local typecheck, lint and test scripts work through pnpm filters. The APK build remains the documented app-local Gradle-wrapper command.

The `scripts/tv-env/` environment checker does not currently verify or provision NDK 27.1.12297006 and CMake 3.22.1. A TV-002 follow-up may add those pinned packages to its isolated SDK setup/check if the coordinator wants that environment reproducible from one setup command. They were not added to the project tree by this task.

## Validation boundary and remaining work

- TypeScript, lint and shell-state tests validate language fallback, Back destinations, loading/playing/error transitions, and the explicit no-playback adapter error.
- The APK build validates Gradle, Android resources, Kotlin SharedPreferences bridge compilation, C++ native libraries, Hermes bundling and debug package creation.
- No Android device, emulator, simulator or adb server was started. D-pad/OK focus order, Android Back behavior and language persistence still need the Mac/device acceptance task. This APK is build evidence only.
- Real playback belongs to TV-008's Media3 adapter; source/catalog/EPG screens belong to TV-015. No real source URL or credentials were supplied or stored.
- App locales are only an initial sample. Complete language coverage, long-copy/RTL checks and on-device readability are open.
- Build tooling emitted non-blocking upstream warnings: Gradle deprecation notices and Metro's fallback resolution warning for a private `ReactNativeFeatureFlags` import in the TV fork's virtualized-lists package.

This task does not request push, merge, deployment, production configuration or store submission.

## Coordinator review — 2026-10-21

The coordinator inspected worker source `649ba9c` and handoff `569e871`,
verified the original artifact hash, and repeated the worker's typecheck,
lint and four tests on Buildara. Review found that Settings opened from
Playback always returned Home, and pending test loads could update the UI
after navigation or overwrite a newer test.

Correction `d90031f` remembers the Settings origin for both the header and
hardware Back paths. Navigation invalidates pending UI requests, stops the
placeholder adapter and resets its view state. The adapter also suppresses
late state/error events after stop/destroy, and its lifetime is scoped to the
App instance. Three additional regression cases cover Settings origin and
stop/destroy during a pending test. Final typecheck, lint, seven tests and
`:app:assembleDebug` all passed; the rebuild completed in 15 seconds. The
rebuilt package metadata and bundled JS were inspected with aapt2/unzip.

Until the coordinator integrates and regenerates the shared lockfile,
dependency installation on this task branch uses `--lockfile=false`. A frozen
install is the later integration gate, not a verified command on this branch.
TV-003 consumption remains a separate integration step. No native runtime,
remote control, language persistence or actual playback behavior was observed;
those checks must run through the Mac/device tasks.
