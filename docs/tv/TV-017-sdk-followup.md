# TV-017 — reproducible Android native SDK packages

Evidence date: 2026-10-23. Host: Buildara, Linux x86_64.
Session: `Codex TV-017 / t3-0dab9e54 / 20261023-sdk`.
Worktree: `/home/filip/.t3/worktrees/lumen-player/t3-0dab9e54`,
branch `t3/tv-sdk-provisioning`. Initial commit `ed8023913cce0d6a479763be497ddb9d1bb96642`;
assigned base `ebb93acd6aaace2202b305a15a655b7f06ac32c5` merged locally as
`d9fd9fd7d5e07e81603587cbf9d3b2dc0ebe7bbc` before implementation.
Only `scripts/tv-env/` and this handoff are implementation changes.

## Change and usage

TV-005 requires NDK **27.1.12297006** (r27b) and CMake **3.22.1**.
The existing TV-002 setup omitted both, despite their presence after the Android
shell build. `setup --accept-licenses` now calls `android-native`, and `check`
checks both packages. The existing isolated `KLARO_TV_SDK_ROOT` selection applies;
default `~/.local/share/klaro-tv-sdk`, packages below `android/ndk/` and
`android/cmake/`. Global SDKs, PATH and shell profiles are not changed.

```sh
# Read TV-002 vendor license references first. Android's license flow is interactive.
scripts/tv-env/setup --accept-licenses
# Bounded follow-up for an already provisioned TV-002 environment:
scripts/tv-env/android-native --accept-licenses
# Read-only native package validation:
scripts/tv-env/android-native --check
# All TV-002 tools plus native package validation:
scripts/tv-env/check
```

The helper reuses installed packages after checking exact `source.properties`
revisions and running NDK clang/ndk-build and CMake/Ninja version commands.
Version drift or incomplete packages fail without replacement. Valid installed
packages require no cache, download, license prompt or SDK write.
It checks CMake 3.22.1, bundled Ninja 1.10.2, NDK clang 18.0.2 and GNU Make.
The SDK binary checks are host checks; no native app is compiled.

Missing packages use exact Linux archive URLs, vendor SHA-1 and byte-size pins
in `downloads.json` under `android_native`. Pins were checked against Google's
[repository metadata](https://dl.google.com/android/repository/repository2-3.xml)
on the evidence date:

| Archive | Bytes | Vendor SHA-1 |
|---|---:|---|
| `android-ndk-r27b-linux.zip` | 663976775 | `6fc476b2e57d7c01ac0c95817746b927035b9749` |
| `cmake-3.22.1-linux.zip` | 22308647 | `fd0a48b4a758310df8c7aa51f59840ed48fe7ed8` |

These new archives have **vendor SHA-1/size pins**, not measured SHA-256 pins.
Google's metadata supplies SHA-1; no real archive was downloaded solely to
measure another hash. Existing TV-002 archive SHA-256 verification is unchanged.
A future SHA-256 addition must be measured from verified archive bytes.

Provisioning verifies cached bytes on every use and new bytes before renaming
the partial download. Extraction stages inside the SDK filesystem, preserves
executable permissions and safe relative symlinks, rejects escaping paths and
symlink ancestors, checks staged versions, then renames the package into place.
No fabricated `package.xml` or license metadata is written. It uses Android's
interactive `sdkmanager --licenses` and requires its `android-sdk-license` file.
The `--accept-licenses` flag follows TV-002's existing license convention; it
does not answer Android prompts automatically.

Missing-package provisioning is Linux x86_64/non-root only and uses an atomic
`$SDK/.android-native.lock` directory. An existing lock is preserved and causes
failure; inspect its owner/process before manual recovery. Run one overall
TV-002 setup per SDK root and coordinate with the live registry: this helper's
lock does not serialize app Gradle or the broader TV-002 installer.
It requires 5 GiB free before NDK extraction, 256 MiB before CMake extraction.
Downloads and staged extraction remain outside Git; partial downloads are
retained on failure, while temporary extraction is removed.

## Validation and SDK coordination

The actual home filesystem had about **21 GiB available** before work. Both
packages already existed in the isolated SDK, with exact metadata revisions.
Their clang/cmake/ninja version commands passed. No native package download,
installation, SDK metadata rewrite or heavy app build was needed.

The live TV-017 registry evidence explicitly released SDK mutation at
2026-10-23T09:31:05Z; TV-016 may build against the existing SDK.
No further shared SDK writes are planned by this task.

Commands and results (all final commands exit **0**):

- `bash -n scripts/tv-env/{setup,check,run,samsung-extensions,smoke}`.
- Python AST parsing of `android-native` and `test_android_native.py`.
- `python3 -B -m unittest discover -s scripts/tv-env -p 'test_*.py'`:
  **8 tests passed**, using temporary tiny ZIP fixtures, no real SDK or network.
  Coverage: cached fresh install/reuse without cached archive, read-only missing
  check, corrupted cache rejection, installed revision drift, existing lock
  preservation, free-space guard, declined license, archive traversal/symlinks.
- `scripts/tv-env/android-native --check`: exact native metadata and binary
  checks passed.
- `scripts/tv-env/android-native --accept-licenses`: repeated installed-package
  path passed without downloads or SDK writes.
- `scripts/tv-env/check`: complete existing environment checks plus both native
  packages passed; log `/tmp/tv017-check.log`. Unit log `/tmp/tv017-unit.log`.
- `git diff --check` passed.

The first fixture test run failed because the test mocked Python's shared
`subprocess.run`, also intercepting `check_output` version probes. The test
boundary was corrected to mock only license interaction; the final eight tests
pass. No production failure was hidden.

A fresh **real vendor archive** installation was not exercised: the shared SDK
already contains both packages and must remain available to TV-016. Fixture
installation validates the staging/checksum/idempotence path, not a second
real multi-GB SDK install. The full broad TV-002 setup was not rerun because it
also reinstalls LG dependencies and rewrites unrelated SDK configuration.
No devices, emulators, app sources, root manifest/lockfile, design mirror,
main checkout, push, deployment or store operations were involved.
