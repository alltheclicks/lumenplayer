# TV-002 — isolated TV build environment

Evidence date: 2026-10-21. Implementation host: Buildara, Ubuntu 22.04.5 LTS,
x86_64, kernel 6.8.0-138-generic. Base: `544bed8902e7386a20aff96510868026c4f86970`,
branch `t3/prepare-tv-toolchains`. Task/session: `Codex TV-002-sol-medium-a6d4ab1b-20261021`.

This task installs host tools and exercises disposable SDK samples. None of the
samples is a Klaro application. No device/emulator was connected, installed,
launched or changed. No Mac work, service restart, release, store upload, push or
merge was performed. The live task registry is external to this worker commit.

## Installed environment

All selected tools live below `~/.local/share/klaro-tv-sdk/` (called `$SDK` below).
Use `scripts/tv-env/run <command> ...`; it selects tools for that process only.
Do not source it or add these paths to a shell profile.

| Tool | Pin | Directory below `$SDK` | Observed validation |
|---|---|---|---|
| Node | 22.22.2, Linux x64 | `node-v22.22.2-linux-x64` | `node --version` |
| LG CLI | `@webos-tools/cli` 3.2.6 | `lg-cli` | `ares --version`, template generation, IPK packaging |
| Temurin JDK | 17.0.20.1+1 | `jdk-17.0.20.1+1` | `java -version`, `javac`, `jar`, D8 |
| Tizen-specific Temurin JDK | 8u504-b01 | `jdk8u504-b01` | selected through this SDK's `sdk.info` `JDK_PATH` |
| Android command-line tools | 22.0 / archive 15859902 | `android/cmdline-tools/22.0` | `sdkmanager --version` |
| Android platform | API 36 revision 2 | `android/platforms/android-36` | API stubs compile and manifest link |
| Android build-tools | 36.0.0 | `android/build-tools/36.0.0` | AAPT2 2.20-13193326, D8, zipalign, apksigner |
| Android platform-tools | 37.0.1-15733141 | `android/platform-tools` | `adb version`; no ADB server/device operation |
| Gradle | 8.13 | `gradle-8.13` | version command with isolated JDK; no app Gradle build claimed |
| Tizen SDK web CLI distribution | 10.0 | `tizen-sdk-10.0` | Tizen CLI 2.5.25, `build-web`, WGT packaging |
| Samsung SDB | 4.2.36, supplied by SDK 10.0 | `tizen-sdk-10.0/tools` | `sdb version`; no server/device operation |
| Samsung TV web add-ons | 10.0.0 | SDK-managed `platforms` and resources | verified resource payload staging |
| Samsung TV log-server support | 5.5.0 | SDK-managed TV tooling | verified configuration staging; no log server run |

Initial PATH exposed Node 22.22.2, pnpm 9.15.4 and system Java 8u504;
`ares`, `tizen`, `sdb`, `adb` and `sdkmanager` were absent from PATH. Inspection
also found another project's SDK at `~/sdk/android` (command-line tools 22.0,
platform-tools 37.0.1, API 34/35/36, build-tools 36.0.0, NDKs/CMake) and Temurin
17.0.20.1 at `~/sdk/jdk-17`. These were inspected, not changed or adopted as
Klaro's mutable SDK. The pre-existing `~/sdky4` archive is unrelated.

The wrapper also isolates `ANDROID_USER_HOME` and `GRADLE_USER_HOME` under
`$SDK/state/`. Vendor tools have additional user metadata: LG created
`~/.webos/tv/novacom-devices.json`; Tizen creates `~/.package-manager/` for its
bundled Java, install logs, extraction and repository cache. Tizen's SDK data
directory is `$SDK/tizen-sdk-10.0-data`, as recorded in `sdk.info`. These are
host metadata, never Git artifacts. The CLI also created its default
`~/tizen-sdk-data/cli/logs/` and `~/tizen-sdk-data/profile/profiles.xml` during
sample packaging; the latter refers to the SDK-provided test profiles. No real device entries or owner signing
profiles were configured. The installer can create desktop/menu integration
inside the user's home; it does not require system installation.
Tizen initially used SDK-bundled Corretto 8u242, independently of the wrapper's
Temurin 17 for Android/Gradle. Its package manager hit
`javax.net.ssl.SSLException: SSL peer shut down incorrectly` while refreshing
the certificate repository. A separate Temurin 8u504-b01 is pinned for Tizen via
the launchers' supported `JDK_PATH` setting in this SDK's `sdk.info`; no vendor
JAR or global Java binary is replaced. The package-manager retry result is
recorded below rather than assuming the runtime change fixes the network.
The modern private Java successfully downloaded the certificate repository and
allowed package dependency resolution. The separate certificate GUI/system
dependency blocker below remained.

The SHA-256 values of `.bashrc` and `.profile` were checked before/after Tizen
installation and remained unchanged. Global Node, Java and pnpm selection was
preserved. No system packages or shell-profile edits were made.

## Reproduce and validate

Prerequisites already available on this host: Bash, Python 3, curl, tar, xz,
unzip, zip, ripgrep, standard Linux shared libraries. Do not run setup as root. Allow
several GB of user-owned disk space, plus downloaded archives and retained
samples. The script is Linux x86_64 only; it is not the Mac installer.

1. Read the vendor license references below. The setup flag explicitly accepts
   the Tizen installer terms; Android's own license manager remains interactive.
   The installed environment accepted the standard `android-sdk-license`
   presented during the authorized SDK installation. No account terms or store
   agreements were accepted and no credentials were invented.
2. Run from this checkout:

   ```sh
   scripts/tv-env/setup --accept-licenses
   scripts/tv-env/check
   scripts/tv-env/smoke
   ```

   `sdkmanager --licenses` may offer agreements for uninstalled optional
   packages. Review them; these optional packages are not needed for the sample.
   To use another dedicated root, set `KLARO_TV_SDK_ROOT` consistently for all
   three commands. Tizen's home metadata remains vendor-controlled.
3. The setup script verifies every cached/downloaded archive before extraction,
   uses `npm ci --ignore-scripts` with the committed LG dependency lock, and
   checks installed Android revisions. It never executes SDK updates, replaces
   global runtimes or modifies the repository's root manifest/lockfile. Existing
   SDK directories are reused; version drift fails the check rather than being
   silently accepted. Run only one setup process per SDK root.
4. `downloads.json` contains exact URLs, SHA-256 pins and checksum provenance.
   Node, Temurin, Android CLI and Gradle hashes were compared with official
   published SHA-256 values. Android platform/build/platform-tools archives were
   checked against Google's repository SHA-1 values as well as locally recorded
   SHA-256. Samsung's installer has an internal payload MD5 check; its outer
   SHA-256 was measured locally because no separate vendor SHA-256 was supplied
   in the installer listing. The TV add-on SHA-256 is vendor-published. A locally
   measured hash pins the received bytes; it is not an independent signature.
5. SDK binaries, downloads, sample output, keys and vendor metadata stay outside
   Git. Only documentation, wrappers, archive metadata and the isolated LG npm
   manifest/lock are committed. Retained samples may be removed individually
   after inspection; no automatic broad SDK/home cleanup is provided.

LG's installation page still recommends Node 14.15.1–16.20.2, while the actual
3.2.6 npm package declares `node >=20.0.0`. The isolated Node 22 pin satisfies
the package and passed generation/packaging here. npm reports deprecated
transitive dependencies; they remain vendor dependencies pinned in the lock.
Android tools 22.0 emit a deprecation message for `sdkmanager` in favor of
`android sdk`; the pinned manager still works. This task retains the documented
manager rather than migrating SDK command interfaces incidentally.

### Samsung TV resources and certificate blocker

The selected SDK 10.0 is the current official CLI distribution found during this
task. A first trial of Studio 6.1 installed CLI 2.5.25/SDB 4.2.25 but
`build-web` failed with `NoClassDefFoundError: org/eclipse/core/runtime/Plugin`.
SDK 10.0 fixed that build without patching vendor JARs. The unused trial remains
in `$SDK/tizen-studio-6.1`; it is absent from the wrapper PATH.

The two dependency-free Samsung TV leaf archives are pinned and verified:
`tv-samsung-public-web-add-ons` 10.0.0 (templates, schemas and TV resources),
and `tv-samsung-log-server` 5.5.0 (a configuration file; no server is started).
Install their `data/` payloads into the isolated SDK with:

```sh
scripts/tv-env/setup --accept-licenses
scripts/tv-env/samsung-extensions --accept-licenses
scripts/tv-env/check
scripts/tv-env/smoke
```

This is explicit resource staging from official SDK archives, **not** a complete
Samsung IDE/TV extension registration in Package Manager. The helper verifies
archive hashes, rejects scripts/symlinks/unexpected layouts, refuses conflicting
existing files, and records every staged file/hash in
`$SDK/state/samsung-leaves.json`. It executes no vendor install scripts and
fabricates no Package Manager installation records. The base CLI performs the
build/package operations. Modern host tooling does not upgrade TV API/browser
capabilities. TV resources include older profiles; use the actual device's
supported APIs when implementing the client.

**Samsung Certificate Extension 2.0.75 is cached and verified, but its GUI
installation is blocked under this task's no-system-packages boundary.**
Its Ubuntu inner archive has vendor SHA-256
`96ed23a2d4cca26309902aebda549294e05f9ebb03a4ef66df9700247c940784`.
The outer archive's locally measured hash is in `downloads.json`.

An attempted Package Manager certificate install resolved `common-eplugin`,
`version-manager`, `ocf-sdk-bridge-plugin` and `webkit-prerequisites` 0.0.6.
Inspection of the last package's vendor `install.sh` showed calls through
`$TSUDO` to `apt -y install` legacy WebKit/GTK `.deb` packages on Ubuntu 22.04.
The process was stopped during download/extraction, before this installation
phase. No such dependency was installed; `/var/log/dpkg.log` still ended with
the previous day's Git update. Do not repeat that aggregate/GUI installation
within this task's scope. Certificate creation is deferred to an authorized
Mac setup/account flow.

The attempt also refreshed isolated WebCLI components. To preserve reproducible
base tools, that SDK directory was retained as
`$SDK/tizen-sdk-10.0-extension-attempt` for diagnosis and a clean SDK 10.0 was
installed again from the pinned installer at the wrapper's selected path.
No files from the interrupted GUI install are selected by the wrapper.
Base setup and resource staging do not call online SDK updates.

Other observed Package Manager pitfalls: `install -f
<certificate-extension.zip>` reports `Cannot extract Tizen Studio image file`
because the outer archive is an extension repository rather than a complete
SDK image. Modifying its default extension server was rejected with `This
modification is not allowed becaused the selection is default extra server.`
Requesting the two internal leaf names through Package Manager returned
`Nothing to install` without registering them; a zero exit alone was not
accepted as evidence. The resource helper above is the bounded alternative.

Real Samsung physical-TV signing still requires Samsung account authentication,
owned author keys, a TV distributor certificate and the TV's DUID/installation
permission. No owner certificate/profile, account or password was created,
requested from storage or copied. SDK test certificates are not a physical-TV
signing identity. No emulator/simulator package was selected or run.

## Disposable package evidence

The final smoke script creates a unique `$SDK/smoke.*` directory and prints its
location. It does not read repository application files or contact a provider.

| Target | Exercise | Evidence boundary |
|---|---|---|
| LG | `ares-generate -t basic`, empty `requiredACG`, `ares-package` | Real IPK container; no TV install, playback or store validation |
| Android/Fire family | Java Activity → `javac` → `jar` → D8 → AAPT2 → zipalign | Unsigned APK with DEX, leanback launcher, optional touchscreen; no Android Gradle/RN app or device execution |
| Samsung | Minimal `tv-samsung` config → `tizen build-web` → `tizen package -t wgt` | WGT signed automatically with SDK-provided test certificates; CLI warns emulator-only; not a physical-TV-ready package |

The sample Android manifest uses min API 25 and target API 28 solely to exercise
the toolchain against the Fire OS 7/API 28 family; compile API is 36. These are
not Klaro support/target/store-policy decisions. There are no GMS, Amazon SDK,
Media3, React Native, application networking or playback dependencies in it.
Unsigned APK verification is expected to fail; alignment and package metadata
must pass. The samples deliberately lack release assets/store requirements.

Final base-tool validation: `scripts/tv-env/check` and
`scripts/tv-env/setup --accept-licenses </dev/null` both exited 0 against the
installed environment (including another `npm ci` and all archive hashes).
`bash -n` passed for each script. `scripts/tv-env/smoke` exited 0; retained
evidence is `$SDK/smoke.cXEAGpgi`: IPK 33,352 bytes, unsigned APK 2,232 bytes,
SDK-test-signed WGT 5,040 bytes. LG archive size changes with generated
timestamps; byte-identical application artifacts are not claimed. Full output
is in `$SDK/check-final.log`, `setup-recheck.log` and `smoke-final.log`.
`samsung-resources-final.log` records 1,757 TV add-on files and one log-server
configuration file staged successfully; their per-file hashes are in the
resource receipt. No SDK Package Manager process or download was left running.
No root application lint/test/build was run because no application source or
root dependencies changed. This validation covers the host tooling only.

## Later Mac/device runbooks — not executed

All device connections, installation, launches and logs must run on the Mac,
including Android/Fire and network-connected TVs. First verify `hostname`,
`pwd`, the approved project/worktree and available Mac tools. No Buildara SDK
directory can be copied wholesale to macOS; install the corresponding official
Mac tools and verify their versions there. Exchange selected application
commits through the approved Mac Git boundary when a real Klaro app exists.
A future device task must record app commit, model, OS/build and exact outcome.

### LG 60UN71003LB — owner-reported webOS 5.6.2-21

On the TV, install/open LG's Developer Mode app, sign in with the developer's
LG account, enable Developer Mode and follow its restart instructions. Confirm
remaining session time and enable Key Server for key enrollment. These are
device mutations requiring the later device task. Session expiry disables
development access and can remove development apps; record the expiry state.

On the Mac, with the TV reachable on the local network:

```sh
ares-setup-device                 # add alias klaro-lg; host private; port 9922, user prisoner
ares-setup-device --list
ares-novacom --device klaro-lg --getkey  # enter TV passphrase privately
ares-install --device klaro-lg /path/to/real-app.ipk
ares-launch --device klaro-lg com.example.actualappid
ares-inspect --device klaro-lg --app com.example.actualappid --open
```

Capture the Web Inspector console/network errors and application logs, plus
launch/remote navigation/media observations. Do not assume a privileged system
log API or legacy `ares-log` is available for TV web apps. App ID is the actual
package manifest ID, not the sample identifier. LG developer-account access,
session/key enrollment and network reachability remain unverified. Seller
Lounge distribution and its review requirements are separate from IPK creation.

### Samsung UE43RU7092UXXH (2019) — firmware T-MSLDEUC-1500.9

Do not derive a Tizen API version from the firmware number alone. Confirm the
2019 TV's platform/API compatibility before selecting app privileges and media
features. On the TV's Apps screen, use the documented `12345` developer-mode
flow, enable Developer Mode, enter the **Mac's reachable development IP** and
restart as instructed. Do not enter Buildara's IP just because it built the WGT.

On the Mac:

```sh
sdb version
sdb devices
sdb connect "$TV_IP":26101
sdb devices
# Create/select a Samsung TV certificate profile privately; enroll the TV DUID
# and permit app installation through the SDK certificate/device tools.
tizen build-web -- /path/to/actual-tv-app
tizen package -t wgt -s "$SAMSUNG_PROFILE" -- /path/to/actual-tv-app/.buildResult
tizen install -n actual-app.wgt -t "$TV_TARGET" -- /path/to/package-directory
tizen run -p "$TIZEN_APPLICATION_ID" -t "$TV_TARGET"
sdb -s "$TV_CONNECTION" dlog > samsung-device.log
```

`TV_TARGET` is the discovered Tizen target name; `TV_CONNECTION` is the SDB
connection selector. Keep them private. The launch ID is the `tizen:application`
ID, not the widget URL or display title. If DLOG access is restricted on the
retail TV, record that failure and use supported Web Inspector/application log
capture instead of promising system logs. Do not expose DUIDs, keys, passwords
or certificate exports in a handoff. Samsung login, TV permission, local access
and real app signing are still required; SDK sample signatures do not satisfy them.

### Sony Android TV — 2022/2023 uncertain; model and OS/build absent

Do not wait for these details to build host tools. During the authorized Mac
device task, establish the exact model, Android API/build and debugging mode.
Enable developer options/USB debugging through that model's settings. Android
11+ wireless debugging pairs through a transient pairing port and then connects
through its displayed debugging port; older builds may use an explicitly
enabled network ADB endpoint. Do not assume port 5555 on every Sony build.

```sh
adb version
adb devices -l
# Wireless-debugging flow only when offered by the TV:
adb pair "$TV_PAIR_ENDPOINT"        # type the pairing code privately
adb connect "$TV_DEBUG_ENDPOINT"
adb devices -l
adb -s "$TV_CONNECTION" shell getprop ro.product.model
adb -s "$TV_CONNECTION" shell getprop ro.build.version.release
adb -s "$TV_CONNECTION" shell getprop ro.build.version.sdk
adb -s "$TV_CONNECTION" install -r /path/to/signed-debug-app.apk
adb -s "$TV_CONNECTION" shell am start -n "$APP_ID/$ACTIVITY"
adb -s "$TV_CONNECTION" logcat -v threadtime > sony-device.log
```

An APK must be signed before installation; use the real development project's
private debug key or an owner-managed release key. The smoke APK is unsigned.
No Play account is needed to build locally; Play distribution and app-signing
enrollment are separate work. Save sanitized evidence, not device selectors.

### Fire TV Stick 4K Max — Fire OS 7.7.1.3 / Home 7280112.1

Amazon documents Fire OS 7 as Android 9/API 28. This owner-reported device is
the Android-family target, not Vega. Exact generation/build model is still
missing; do not infer it from the product name alone. An Android build must
avoid mandatory Google Play services and receive independent Fire validation.

On the device, expose Developer Options via the documented About flow if hidden
and enable ADB Debugging. On the Mac, use the Fire device's local IP, accept the
device authorization prompt and list it before installing:

```sh
adb devices -l
adb connect "$FIRE_TV_IP":5555
adb devices -l
adb -s "$FIRE_CONNECTION" shell getprop ro.product.model
adb -s "$FIRE_CONNECTION" shell getprop ro.build.version.sdk
adb -s "$FIRE_CONNECTION" install -r /path/to/signed-debug-app.apk
adb -s "$FIRE_CONNECTION" shell am start -n "$APP_ID/$ACTIVITY"
adb -s "$FIRE_CONNECTION" logcat -v threadtime > fire-device.log
```

Record remote focus/Back, channel switching, codec/audio/DRM behavior,
standby/resume, network recovery and a timed viewing session independently of
Sony. No Amazon account/token was fabricated. Amazon Appstore developer account,
current distribution requirements and production signing are later blockers.

## Remaining prerequisites and handoff

Host tools and sample packages do not close TV-009–012. Missing external inputs
remain: Sony model/OS/build, Fire generation/build-model, each TV's local
reachability/developer-mode state, LG developer login/key enrollment, Samsung
account/certificates/DUID/install permission, and availability of the Mac for
device work. Request these together through the coordinator when starting that
phase; supplied firmware/webOS/Fire software versions need not be asked again.
No actual Klaro client exists in this task's scope. TV-004/005 must consume the
chosen integrated base, create their real packages and choose their project's
compatible Gradle/AGP/React Native versions; the host Gradle pin is not a root
project dependency decision.

## Official sources checked

- [LG CLI installation](https://webostv.developer.lge.com/develop/tools/cli-installation),
  [CLI guide](https://webostv.developer.lge.com/develop/tools/cli-dev-guide),
  [Developer Mode](https://webostv.developer.lge.com/develop/getting-started/developer-mode-app),
  [LG CLI package metadata](https://registry.npmjs.org/@webos-tools/cli/3.2.6).
- [Samsung SDK installation](https://developer.samsung.com/smarttv/develop/getting-started/setting-up-sdk/installing-tv-sdk.html),
  [CLI](https://developer.samsung.com/smarttv/develop/getting-started/using-sdk/command-line-interface.html),
  [TV connection](https://developer.samsung.com/smarttv/develop/getting-started/using-sdk/tv-device.html),
  [certificates](https://developer.samsung.com/smarttv/develop/getting-started/setting-up-sdk/creating-certificates.html),
  [TV extension 10.0.0](https://developer.samsung.com/smarttv/develop/tools/tv-extension/download.html),
  [official SDK 10.0 archive listing](https://download.tizen.org/sdk/Installer/tizen-sdk_10.0/).
- [Android command-line downloads and SDK license](https://developer.android.com/studio#command-tools),
  [SDK manager](https://developer.android.com/tools/sdkmanager),
  [TV manifest requirements](https://developer.android.com/training/tv/start/start),
  [ADB](https://developer.android.com/tools/adb),
  [official repository metadata](https://dl.google.com/android/repository/repository2-3.xml).
- [Amazon Fire OS overview](https://developer.amazon.com/docs/fire-tv/fire-os-overview.html),
  [Fire ADB connection](https://developer.amazon.com/docs/fire-tv/connecting-adb-to-device.html).
- [Node checksums](https://nodejs.org/dist/v22.22.2/SHASUMS256.txt),
  [Temurin release](https://github.com/adoptium/temurin17-binaries/releases/tag/jdk-17.0.20.1%2B1),
  [Temurin 8 release](https://github.com/adoptium/temurin8-binaries/releases/tag/jdk8u504-b01),
  [Gradle 8.13 checksum](https://services.gradle.org/distributions/gradle-8.13-bin.zip.sha256).

Research markdown/metadata cache: `/tmp/klaro-platform-research/` (untracked,
ephemeral). Vendor licenses/NOTICE files accompany installed SDKs. SDK licenses
do not authorize redistribution of SDK binaries or publication of an app.
