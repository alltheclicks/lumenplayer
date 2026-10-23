# TV-008 — Android TV Media3 playback bridge

Date: 2026-10-23. Host: Buildara (Linux). Owner:
`Codex/TV-008-t3-d0210996-sol61-medium-20261023`.
Branch: `t3/android-tv-media3-bridge`; immutable base:
`c573ce47bda6bf84f71db268f4ec45c3e95172e9`.
The canonical registry row was claimed under the common Git directory's atomic
registry lock. The worktree's TASKS snapshot was not edited or committed.

## Implementation

- App-local Media3 **1.11.1** ExoPlayer, HLS and DASH dependencies, pinned to the
  same version. Progressive MP4 uses ExoPlayer's built-in extractor support.
  No npm, root manifest/lockfile, shared package, SDK version or provider change.
- `KlaroPlaybackModule` and `KlaroPlaybackSurfaceManager` are registered through
  `KlaroPlaybackPackage` in the existing `MainApplication`. Actual namespace is
  `com.lumen.klaro.tv.playback`, not the provisional `com.lumen.tv` path.
- The existing RN TV **0.87.1-1 New Architecture** remains enabled. This uses
  its legacy-module/component **interop**, matching the shell's manual native
  package approach. It is not a generated TurboModule/Fabric codegen migration.
  `@ReactModule(name = "KlaroPlayback")` is essential: inspection of this RN
  version's `ReactInstance.getNativeModule(Class)` confirms class lookup requires
  the annotation. No custom ShadowNode or old-architecture switch is used.
- The native component is a nonfocusable Android `SurfaceView`; Media3 owns
  its video surface through `setVideoSurfaceView`. App renders it with the
  adapter's session ID in the existing playback area. There is no nested native
  control UI, PlayerView child-layout workaround or additional npm video library.
- The production TS adapter implements the existing `TVPlaybackAdapter` contract.
  Every load receives a fresh per-adapter generation, retains the exact request
  object in snapshots, and filters native events by session and generation.
  Native code replaces/releases the old player per generation, preventing an
  old player's listener from being attributed to a new source.
- `load` resolves on Media3 READY, not on network submission. Only native
  `isPlaying` reports `playing`; a successful promise never invents media success.
  Events include state and media-relative position/duration in **milliseconds**,
  with a 500 ms position tick. Unknown duration is null. Archive startTimeMs stays
  an epoch instant in the request; seeking never passes that epoch to Media3.
- HLS, DASH and progressive MP4 live/catch-up requests are accepted. Seek uses
  finite media-relative milliseconds, clamps known bounds and requires a
  seekable Media3 timeline. A progressive live source may reject seek.
- For a live request, return-to-live calls `seekToDefaultPosition`, then play;
  it requires a live Media3 timeline. For catch-up, the caller must inject
  `ResolveLiveRequest(request, signal)`, returning a **fresh** same-source,
  same-channel live request. The adapter never guesses or rewrites provider URLs.
  Without that resolver, catch-up advertises `returnToLive: false` and rejects
  the operation. Replacing/stopping/destroying/cancelling playback aborts the
  resolver and discards a late result. The shared controller adopts the new
  live request after the transition resolves.
- Both layers bound prepare to 30 seconds. Abort stops native work even after
  READY and drops the adapter's active request; replacement/destroy discards late
  promises/events. Stop clears items and releases the player, and destroy also
  removes JS subscriptions. Native timeout/error promises have code-only errors.
- Native player creation, commands, surface binding and release run on the main
  looper. Host pause pauses a prepared player without automatic resume; an
  unfinished prepare is cancelled/released. Host destroy and RN invalidation
  release all players. Dropping/rebinding the native view releases its old
  session to avoid invisible audio. Audio focus and becoming-noisy handling use
  Android platform facilities, with no Play Services requirement.

## App composition and usage

`createPlaybackController()` still defaults to `UnavailableTVPlaybackAdapter`.
The actual App deliberately passes `createAndroidPlaybackAdapter()` only when
**both** the module and surface manager exist on Android. Older shell APKs and
other platforms retain explicit unavailable behavior. `native-binding.ts` is
an injectable RN boundary; `native.tsx` provides the real NativeModules,
NativeEventEmitter and requireNativeComponent wiring.

The local test screen starts **live HLS only** with the entered URL. The field
is masked, has no fake/default URL, clears when submitted or navigating away,
and is never persisted. Controller subscriptions update native states and
redacted errors; pause/buffering/end labels do not claim active playback.
Back/settings/navigation destroy the controller and remove the surface.

Future TV-015 composition should supply an existing source/API-layer live
resolver to `createAndroidPlaybackAdapter(resolveLive)`, pass that adapter to
`createPlaybackController(adapter)`, and render `AndroidPlaybackSurface` with
`sessionId={adapter.sessionId}`. It should pass already-resolved
`TVPlaybackRequest` values to `controller.load`. No catalog, EPG, provider URL
policy or credentials belong in this native bridge. The current URL screen has
no catch-up picker, play/pause/seek controls or return-live button; these APIs are tested
through injected platform calls, not exercised in the screen on a device.

## Privacy and unsupported capabilities

URLs exist only in ephemeral JS requests and Media3's current item. Native
state events contain no URL/request, exception message, stack, headers or source
metadata. RN promise failures do not receive native Throwables. Media3 library
logging is disabled with `Log.setLogLevel(LOG_LEVEL_OFF)`, since upstream error
causes may otherwise include a URL. App and adapter errors use fixed messages
and validated codes. No credentials or functioning media source was supplied.

Explicit limits:

- DRM is rejected; no Widevine, FairPlay or PlayReady license integration.
- WebRTC, RTSP, SmoothStreaming, custom auth headers/cookies, download/offline,
  casting, PiP, background service/session integration and audio/subtitle
  selection are not implemented by this task.
- The adapter accepts HTTP(S). The app source defaults the manifest placeholder
  to `usesCleartextTraffic=false`, but inspection of the **actual debug APK**
  found `usesCleartextTraffic=true`: RN Gradle plugin
  `AgpConfiguratorUtils.kt` overrides it for debug builds. This pre-existing
  behavior was not changed. RN debug AAR also contributes SYSTEM_ALERT_WINDOW
  and ACCESS_LOCAL_NETWORK. Release manifest/HTTP policy is not established by
  this debug build; do not infer HTTPS-only behavior from the source placeholder.
- Decoder/codec/container, HLS/DASH variant handling, live timeline behavior,
  seekability, surface aspect/rotation/overlay behavior, audio focus, actual
  activity recreation, remote/IME input and performance require device evidence.
  No universal Sony/Fire or codec support follows from a successful APK build.
- Existing localization remains a sample, not full locale/RTL acceptance. New
  pause/buffering/end labels use the existing English fallback for other locales.
  Mirrored design exports were inspected read-only and remain unchanged.

## Validation

All logs are local in `/tmp/klaro-tv008-logs/`. No device, emulator, adb server,
Mac exchange, push, merge, production or store action occurred.

- `pnpm install --frozen-lockfile --offline`: exit **0**, existing pnpm cache,
  no copied dependencies or root lockfile edits. About 392 MB of workspace deps.
- `pnpm --filter @lumen/android-tv test`: exit **0**, **33 tests / 4 files**,
  including 28 new adapter/RN-boundary cases and 5 retained shell/consumer tests.
  Injected mocks cover archive/seek milliseconds, real-state-only playing,
  pending/completed and reentrant cancellation before native dispatch,
  generation/session filtering, redaction,
  timeout, pause propagation, stop/release, live-edge command, live resolver
  adoption through the shared controller, failed-live-prepare visibility under
  the previous archive request, and stale/cancelled/mismatched results.
  These are host protocol tests, not Media3 decoding or real playback evidence.
- App `typecheck` and `lint`: final exit **0** each.
- `scripts/tv-env/android-native --check`: exit **0**, installed NDK
  27.1.12297006/CMake 3.22.1 reused, no package download or SDK update.
- First Gradle attempt used `--offline --no-daemon --max-workers=2`: exit **1**,
  specifically missing the three Media3 1.11.1 Maven artifacts.
- Online resolution/build used existing official Google Maven/Maven Central,
  `--no-daemon --max-workers=2 -Pandroid.builder.sdkDownload=false`: exit **0**,
  BUILD SUCCESSFUL in 1m 35s. Only Maven dependencies were resolved; no SDK
  reinstallation, updates, duplicate SDK downloads or signing-file edits.
- Final offline rebuild/runtime dependency report: exit **0**, BUILD SUCCESSFUL
  in **51 seconds**, 58 tasks (17 executed, 41 up-to-date). Command:

  ```sh
  scripts/tv-env/run bash -c 'cd apps/android-tv/android && ./gradlew --offline --no-daemon --max-workers=2 -Pandroid.builder.sdkDownload=false :app:assembleDebug :app:dependencies --configuration debugRuntimeClasspath'
  ```

  Log: `gradle-final-offline.log`. No GMS runtime dependency appears.
- `aapt2 dump badging`, manifest `aapt2 dump xmltree`, `unzip -t` and
  `apksigner verify` succeeded (exit **0**). Logs: `apk-badging.log`,
  `apk-manifest.log`, `apk-unzip.log`, `apk-signature.log`. ZIP and signature
  validation are host container checks, not install/device verification.
- DEX string-table inspection asserts the app module/package/surface manager
  plus ExoPlayer, HlsMediaSource and DashMediaSource are packaged. No
  `Lcom/google/android/gms/` classes exist. Both ARM ABIs and
  `assets/index.android.bundle` (1,049,460 bytes) are present.

Final ignored artifact:
`apps/android-tv/android/app/build/outputs/apk/debug/app-debug.apk`,
**61,801,395 bytes**, SHA-256
`4cd9f08555119ee4bfaca1696ca70c78820f80bbbb79f11eeaf43f810af3be06`.
Manifest: `com.lumen.klaro.tv.internal`, API **24/36**, leanback launcher,
`allowBackup=false`, INTERNET and Media3 network/wake-lock permissions. Actual
debug cleartext and RN debug permissions are described above. Nonfatal warnings:
RN private feature-flag export fallback, NO_COLOR/FORCE_COLOR, existing Kotlin
deprecations and Gradle 10 deprecation notice.

The final test/typecheck/lint logs are `test-final.log`, `typecheck-final.log` and
`lint-final.log`. `git diff --check` passed; root manifests/lockfile, shared
packages, design mirrors and the local TASKS snapshot have no changes.

The app-local Gradle configuration explicitly tracks `src/adapters/android/`
as bundle inputs. RN 0.87's default `BundleHermesCTask.sources` excludes
`**/android/**`, which also excludes the TS adapter directory: inspection caught
two apparently successful incremental builds retaining the earlier JS bundle.
The explicit input file tree fixes this without changing RN or root configuration.
Final offline build after this input fix: exit **0**, BUILD SUCCESSFUL in
**34 seconds**, 57 tasks (8 executed, 49 up-to-date); log `gradle-input-fix.log`.
The same offline/two-worker/no-SDK-download flags were used. Source-map content
compares byte-for-byte with all three production TS/TSX adapter files, in
addition to DEX and ZIP inspection. Exact checks: `apk-inspection.json` and
`bundle-source-check.json` (all commands exit 0).

During development, an initial TypeScript event-listener variance error was
fixed at the NativeEventEmitter boundary. An attempt to mock RN directly in
Vitest failed on the fork's Flow entry parser (4 failed tests); availability
checks were moved to the injected platform boundary and all 33 tests now pass.
This avoids claiming a Node test executed the Android RN runtime.

Free space on the actual home filesystem was checked before install/build and
during verification: approximately **20–24 GB** available. Builds ran serially,
with Gradle capped at two workers. No shared SDK mutation was performed; the
existing TV-017 release of SDK mutation was respected. Generated app build
output is about 512 MB; ignored debug signing material remains untracked.

## Primary platform references

Consulted during implementation on 2026-10-23:

- [Media3 release/dependency reference](https://developer.android.com/jetpack/androidx/releases/media3)
  — current stable 1.11.1 and module/version selection.
- [ExoPlayer setup/threading/lifecycle](https://developer.android.com/media/media3/exoplayer/hello-world)
  — single application thread, MediaItem prepare/play and release.
- [Media3 live-window semantics](https://developer.android.com/media/media3/exoplayer/live-streaming)
  — positions relative to the window and seekToDefaultPosition.
- [Media3 player events](https://developer.android.com/media/media3/exoplayer/listening-to-player-events)
  — READY versus isPlaying and Player.Listener.
- [Media3 logging API](https://developer.android.com/reference/androidx/media3/common/util/Log)
  — log suppression for credential-bearing upstream errors.
- [React Native New Architecture interop](https://reactnative.dev/blog/2024/10/23/the-new-architecture-is-here)
  and [RN native-platform boundaries](https://reactnative.dev/docs/0.78/native-platform).
  The installed RN TV 0.87.1-1 source was also inspected for this exact runtime's
  class-based module lookup/interop behavior; build success alone is not runtime
  compatibility verification.

## Coordinator follow-up

No root manifest/lockfile/shared-package change is requested. Integrate this
scoped commit and reconcile the coordinator-owned `HANDOFF.md` current entry
and `GRAND_PLAN.md` Android milestone ledger with **implemented/build-checked,
not device-verified** status. TV-015 still owns catalog/EPG and controls.
TV-011 and TV-012 must verify the real surface, playback, live/catch-up/seek/
return-live, background/foreground/Back and secret-free error behavior on the
actual Sony and Fire devices through the Mac. TV-013 prerequisites remain.
