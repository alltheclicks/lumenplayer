# TV-004 — shared Samsung/LG web shell

Implementation evidence: 2026-10-21, Buildara, branch `t3/tv-web-shell`, based
on integration commit `ebb93acd6aaace2202b305a15a655b7f06ac32c5`. This handoff
covers only `apps/tv-web/` and this document. It does not include TV device or
emulator validation.

## Delivered

- Added the `@lumen/tv-web` workspace package with local typecheck, lint, test,
  Tizen/webOS build and package scripts. Existing `apps/*` workspace discovery
  includes it; no root manifest, lockfile, Turbo, ESLint or TypeScript config was
  changed.
- Added a small three-column-inspired launch/test shell. The rail and content
  collapse on narrow viewports, following the column-collapse intent in the
  read-only `1d Kolone` export. It is an initial flow, not the later TV-014
  catalog/search/favorites/EPG UI.
- D-pad arrows move focus between visible controls. Enter/Accept triggers the
  focused native button (OK); Escape, Backspace, BrowserBack and legacy key
  codes 10009 (Samsung) / 461 (LG) return to the prior shell screen.
- Settings exposes English, Serbian and Arabic under their native names.
  English is the default; choice persists per device through local storage,
  falls back to English if storage is unavailable, and Arabic sets RTL direction.
  This initial set is a UI foundation, not the full localization coverage from
  `GRAND_PLAN.md` section 9.
- Brand display name is configured through public build variable
  `VITE_BRAND_NAME` and defaults to Klaro Player. `@lumen/tv-web` and existing
  `@lumen/*` names remain unchanged.
- Composition reuses the existing `@lumen/types` `PlayerAdapter` boundary.
  `FixturePlayerAdapter` lives in `src/testing/`, rejects a local
  `fixture://no-playback` marker, performs no network request and never reports
  successful playback. The playback screen explicitly says that no media is
  playing and the platform adapter is not connected.
- `src/config/local-source.example.json` is a placeholder-only example;
  `src/config/local-source.json` and local `.env` files are ignored. The shell
  does not read source credentials or load a source. There are no real
  credentials or usable source URLs in tracked code.
- Tizen and webOS builds target Chrome 63. Every build runs
  `scripts/check-tv-compat.mjs`, which parses emitted JS as ECMAScript 2018 and
  rejects the specified unsupported CSS constructs in emitted CSS.

## Reproduction and results

Install dependencies without changing the shared root lockfile:

```sh
pnpm install --lockfile=false
pnpm --filter @lumen/tv-web typecheck
pnpm --filter @lumen/tv-web lint
pnpm --filter @lumen/tv-web test
pnpm --filter @lumen/tv-web build:tizen
pnpm --filter @lumen/tv-web build:webos
pnpm --filter @lumen/tv-web package:tizen
pnpm --filter @lumen/tv-web package:webos
```

Observed versions: pnpm 9.15.4, Node 22.22.2, TypeScript 5.9.3, Vite 5.4.21,
Acorn 8.15.0, Tizen CLI 2.5.25 / SDK 10.0 and LG CLI 3.2.6. The SDK runner is
`scripts/tv-env/run` from TV-002. The app declares compatible dependency ranges
in its own manifest; the resolved root `pnpm-lock.yaml` is intentionally not
included in this child commit.

Results on this base:

| Check | Result |
|---|---|
| `typecheck` | Passed |
| `lint` | Passed |
| `test` | 7 Node tests passed: D-pad directions, OK/Back key mapping, English default, language persistence, loading→error, fixture never-playing state, playback Back |
| `build:tizen` | Passed; output in `apps/tv-web/dist/tizen/`; Chrome 63 syntax/CSS check passed |
| `build:webos` | Passed; output in `apps/tv-web/dist/webos/`; Chrome 63 syntax/CSS check passed |
| `package:webos` | Passed; `apps/tv-web/artifacts/webos/com.klaroplayer.tv_0.0.1_all.ipk` |
| `package:tizen` | Blocked as designed: no owner-created `KLARO_TIZEN_PROFILE` is available. No SDK test certificate or invented profile was used |

`dist/` and `artifacts/` are ignored generated outputs. The webOS CLI validated
and created a real IPK container. This establishes packaging only: the IPK was
not installed or launched on a TV. The Tizen WGT was not created because its
physical-TV signing profile prerequisite remains under TV-013.

After the coordinator corrections below, the local IPK artifact is 6,684 bytes
with SHA-256
`1dd487ff9b0d9feac5b7bea84af49a94d9d507e57325505c0c40573d3ccfa104`.

## Integration requests and limits

- The coordinator must add the package's workspace dependencies to the shared
  lockfile when integrating this commit: `@lumen/types` (`workspace:*`),
  `@lumen/tsconfig` (`workspace:*`), Vite `^5.4.2`, TypeScript `^5.7.0`,
  ESLint `^9.9.0`, Acorn `8.15.0` and `@types/node` `^22.5.0`. The package-local
  manifest is the authoritative exact request. `pnpm-workspace.yaml` already
  includes `apps/*`; no other root config request is needed.
- TV-003 was active on a separate base while this work was performed. The shell
  intentionally consumes only the existing `PlayerAdapter` type and keeps the
  fixture at the composition boundary. When TV-003 is integrated, coordinate
  only the adapter's consumption change; do not create a second shared contract.
- Device acceptance remains separate. The worker did not exercise a browser
  preview; the coordinator's later browser checks are recorded below. No
  physical TV, simulator, emulator, install, network source, or real playback
  was exercised.
- Samsung packaging awaits TV-013's owner-created certificate/profile. LG
  developer-mode account/key setup is also a later device prerequisite; neither
  blocks the host-side IPK container created here.

## Coordinator review — 2026-10-21

Review of worker commit `99fdcdd112b9a133454188f6cc80a2daf4edd894` reproduced
a language-navigation defect in the T3 collaborative browser: Down on the
native select moved focus to Back and prevented selection. The select is now
an explicit list of language buttons with native names, pressed state and
D-pad navigation. Language changes preserve focus. Home's horizontal actions
now use horizontal focus coordinates. OK/Accept explicitly activates buttons
and suppresses the default click to avoid double activation.

Coordinator reran package typecheck, lint, all seven Node tests, both platform
builds and compatibility checks, and webOS packaging successfully. Samsung
packaging was also rerun and exited 2 with the expected missing-owner-profile
message. No substitute certificate was supplied.

Eight DOM-event browser assertions passed against both the dev server and
the generated `dist/webos/` served over HTTP: Right reaches Settings, Accept
opens it, Down reaches Serbian, Accept selects Serbian and retains focus,
Enter selects Arabic with RTL, Samsung Back returns home, fixture-error screen
renders, and LG Back returns home. These are synthetic keyboard events in the
desktop collaborative browser, not a physical remote or old-TV engine test.
Chrome 63 compatibility evidence remains the build target and emitted-output
check; runtime compatibility still requires TV-009/010.

The code remains on the task branch, without merge/push. Shared lockfile
integration and consumption of TV-003 remain coordinator follow-ups.
