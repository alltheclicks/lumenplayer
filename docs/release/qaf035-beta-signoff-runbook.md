# QAF-035 Beta Signoff Runbook

This runbook is the operator-facing path from the current QAF-035 partial evidence to a real 300-500 user beta signoff. It does not replace the JSON artifacts or validators; it tells the release owner which evidence to gather and where to record it.

## Current Gate Commands

Run these from the QAF-035 production worktree:

```sh
pnpm release:qaf035:validate
pnpm release:qaf035:final
```

`pnpm release:qaf035:validate` must pass while final owner/device blockers are still open. `pnpm release:qaf035:final` must fail until every real-device, provider, capacity, ops, rollback, and no-media-processing owner field is complete.

## Automated Evidence Refresh

Use valid local provider credentials only through ignored local environment state. Do not paste provider credentials into artifacts, docs, PR text, screenshots, HAR files, or terminal output.

```sh
set -a; source .env.local; set +a; pnpm e2e:provider:preflight
set -a; source .env.local; set +a; E2E_CPU_GUARD=false pnpm e2e:playback:focused
set -a; source .env.local; set +a; pnpm e2e:qa:simulate
```

Expected local evidence locations:

- `output/playwright/provider-qa-preflight/REPORT.md`
- `output/playwright/focused-playback-smoke/REPORT.md`
- `output/playwright/qa-user-sim/QA-REPORT.md`

These are useful provider/browser signals, but they are not real-device signoff.

## Required Artifact Updates

Record final evidence only in the concrete QAF-035 artifacts:

- `artifacts/release/readiness/qaf035-release-readiness-20260602.json`
- `artifacts/release/compatibility/qaf035-provider-local-20260602.json`
- `artifacts/release/manual-device-qa/qaf035-manual-device-qa-20260603.json`
- `artifacts/release/provider/qaf035-provider-owner-signoff-20260603.json`
- `artifacts/release/capacity/qaf035-beta-capacity-20260602.json`
- `artifacts/release/media-policy/qaf035-runtime-media-policy-20260602.json`
- `artifacts/release/ops/qaf035-beta-ops-signoff-20260603.json`

Do not mark the PR ready for beta just because template validators pass. The concrete artifacts above are the release state.

## Real Device Matrix

Each target must have a named owner, exact device/browser versions, evidence refs, media-processing audit evidence, and all release-blocker checks passing.

| Target id | Required device flow |
| --- | --- |
| `desktop-chrome-windows` | Live playback, catch-up controls/seek, player-state navigation. |
| `desktop-safari-macos` | VOD playback, live playback under Safari media policy, broken catch-up failure overlay. |
| `mobile-chrome-android` | Touch live playback, touch catch-up controls, background/foreground resume. |
| `mobile-safari-ios` | Native-HLS live playback, catch-up failure handling, navigation restore. |
| `cast-chromecast` | Cast connect/play, return to local renderer, sanitized cast error observability. |
| `airplay-appletv` | AirPlay connect/play, return local, recoverable AirPlay error handling. |
| `pwa-install-offline` | Install prompt/installed launch, offline shell, online playback recovery. |

Local Playwright, bundled Chromium headless, or the local desktop browser smoke cannot be used as final evidence for these targets.

## No-Transcode / No-Remux Audit

Allowed transport modes are only provider-direct and proxy-normalized. The beta path must not use ffmpeg, ffprobe, transcode, remux, generated HLS, proxy-remuxed, remux-hls, or XUI-side media processing.

For every manual device target:

1. Capture browser/device network evidence for the live/catch-up flow.
2. Scan the captured evidence and logs:

```sh
pnpm release:no-media-evidence:scan -- <capture.har-or-json-or-log>
```

The scanner fails on forbidden strings: `__remux__`, `proxy-remuxed`, `remux-hls`, `ffmpeg`, `ffprobe`, `transcode`, `remux`, `generated HLS`, and `XUI-side`.
It also fails enabled remux runtime flags such as `LUMEN_PROXY_REMUX_ENABLED=1` and XUI server media-processing wording even when the evidence does not use the exact `XUI-side` phrase.
For release evidence, keep the raw capture local/untracked and record a redacted scan-result artifact such as `artifacts/release/media-policy/qaf035-no-media-evidence-scan-20260602.json`.

3. Record the scanner command/output ref in `mediaProcessingAudit.evidenceRef`; final validation requires this field to reference `release:no-media-evidence:scan`.
4. Keep `mediaProcessingAudit.forbiddenHits` empty for pass.
5. If any forbidden hit appears, set that target or check to fail and stop beta readiness.

On the local Lumen machine, also verify:

```sh
pnpm release:proxy-no-media:validate
pnpm catchup:timeshift-hls:test
pnpm release:proxy-no-media:test
pgrep -fl '[f]fmpeg|[f]fprobe'
```

The proxy no-media validator proves the hard-disable guard and CI/package coverage are still present. The disabled catch-up media probe test proves the historical local timeshift probe exits before local ffmpeg/ffprobe probing. The proxy no-media test proves env/debug remux attempts, direct `remux-hls` proxy requests, `__remux__` asset endpoints, and direct remux controller calls do not reach binary checks, process spawn, or remux playback. The process command should produce no active ffmpeg or ffprobe process.

## Provider And Capacity Owner Signoff

The provider/XUI owner must fill `artifacts/release/provider/qaf035-provider-owner-signoff-20260603.json` with:

- Provider owner identity, role, and contact.
- QA/beta account scope and XUI host reference.
- Capacity approval for the 300-500 user beta.
- Rate-limit and escalation path for auth, 429, 5xx, and live-stream failures.
- Explicit commitment that broken catch-up channels will not be resolved with local ffmpeg, server-side transcode/remux, generated HLS, proxy-remuxed, remux-hls, or XUI-side transcode/remux.

The capacity owner must fill `artifacts/release/capacity/qaf035-beta-capacity-20260602.json` with provider capacity, Lumen edge capacity, observability SLO, and rollback/throttle evidence.

## Ops Signoff

Before 300-500 live users, `artifacts/release/ops/qaf035-beta-ops-signoff-20260603.json` must name:

- Observability/SLO owner.
- Alert channel and dashboard.
- Rollback/throttle owner.
- Decision authority.
- Maximum decision time.
- Stop trigger for any media-processing policy violation.

## Final Go / No-Go

The release owner can mark beta ready only when:

1. `pnpm release:qaf035:validate` passes.
2. `pnpm release:qaf035:final` passes.
3. Latest PR checks are green on the final head.
4. Manual device QA has no release-blocker failures.
5. Provider, capacity, ops, runtime media policy, rollback, and readiness signoffs are no longer pending.
6. No evidence contains ffmpeg, ffprobe, transcode, remux, generated HLS, proxy-remuxed, remux-hls, or XUI-side media processing for broken catch-up channels.
