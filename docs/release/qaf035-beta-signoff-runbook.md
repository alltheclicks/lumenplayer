# QAF-035 Beta Signoff Runbook

This runbook is the operator-facing path from the current QAF-035 partial evidence to a real 300-500 user beta signoff. It does not replace the JSON artifacts or validators; it tells the release owner which evidence to gather and where to record it.

## Current Gate Commands

Run these from the QAF-035 production worktree:

```sh
pnpm release:qaf035:validate
pnpm release:go-no-go:validate
pnpm release:smoke-matrix:validate
pnpm release:readiness:validate
pnpm release:provider-owner:validate
pnpm release:beta-capacity:validate
pnpm release:runtime-media:validate
pnpm release:manual-device-qa:validate
pnpm release:design-parity:validate
pnpm release:no-media-scan-artifact:validate
pnpm release:perf-evidence:validate
pnpm release:observability-baseline:validate
pnpm release:beta-ops:validate
pnpm release:security-baseline:validate
pnpm release:beta-closure-plan:validate
pnpm release:qaf035:final
```

`pnpm release:qaf035:validate` must pass while final owner/device blockers are still open. `pnpm release:qaf035:final` must fail until every real-device, provider, capacity, ops, rollback, and no-media-processing owner field is complete.
The final aggregate also directly runs final-mode validation for the concrete go/no-go, smoke/regression, compatibility-matrix, and design-parity artifacts; those artifacts must be complete, approved, and backed by rendered or scanned evidence before the final command can pass.
The individual `pnpm release:*:validate` commands above validate the concrete QAF-035 artifacts, not generic templates. `pnpm release:readiness:validate` must report the current open blocker count until those blockers are genuinely closed.
`pnpm release:no-media-scan-artifact:validate` must pass on the tracked redacted scan-result artifact so the local Chrome Network/CDP evidence hashes, forbidden-pattern list, zero-hit summary, and raw-evidence-untracked policy stay mechanically checked in CI.
`pnpm release:perf-evidence:validate` must pass on the concrete performance artifact so local benchmark coverage and failed-run accounting are checked before final beta performance signoff.
`pnpm release:observability-baseline:validate` must pass on the concrete observability artifact so structured event coverage, playback/cast burst alert rules, beta alert routing, and no-media stop-trigger evidence are checked before signoff.
`pnpm release:security-baseline:validate` must pass on the concrete security/privacy artifact so client storage inventory, credential cleanup, retention evidence, and incident-readiness placeholders are checked before signoff.
`pnpm release:beta-closure-plan:validate` must pass on the concrete closure plan so every open readiness blocker has an owner, gate mapping, artifact refs, validation commands, and no-media-safe completion recipe.

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
- `artifacts/release/readiness/qaf035-go-no-go-20260603.json`
- `artifacts/release/smoke/qaf035-smoke-regression-matrix-20260603.json`
- `artifacts/release/compatibility/qaf035-provider-local-20260602.json`
- `artifacts/release/manual-device-qa/qaf035-manual-device-qa-20260603.json`
- `artifacts/release/design/qaf035-design-parity-20260603.json`
- `artifacts/release/provider/qaf035-provider-owner-signoff-20260603.json`
- `artifacts/release/capacity/qaf035-beta-capacity-20260602.json`
- `artifacts/release/performance/qaf035-performance-evidence-20260603.json`
- `artifacts/release/media-policy/qaf035-runtime-media-policy-20260602.json`
- `artifacts/release/observability/qaf035-observability-baseline-20260603.json`
- `artifacts/release/ops/qaf035-beta-ops-signoff-20260603.json`
- `artifacts/release/security/qaf035-security-privacy-baseline-20260603.json`
- `artifacts/release/readiness/qaf035-beta-closure-plan-20260603.json`

Do not mark the PR ready for beta just because template validators pass. The concrete artifacts above are the release state.

The closure plan is the next-dev checklist for closing the current 9 open blockers. Keep it in sync with `blockerTriage.items[]`: each open blocker must have a matching closure item with the same `gateIds`, concrete artifact refs, and validation commands. The closure plan must never propose local ffmpeg/ffprobe, server-side transcode/remux, generated HLS, proxy-remuxed/remux-hls, or XUI-side media processing as a catch-up fix.
Each open closure item must also include a final proof command: either the aggregate `pnpm release:qaf035:final` or a concrete artifact validator with `--require-final`. Non-final validation proves current partial state only; final-mode validation is the command that proves the blocker is genuinely closed.

## Real Device Matrix

Each target must have a named owner, exact device/browser versions, evidence refs, media-processing audit evidence, a tracked redacted no-media scan-result artifact, and all release-blocker checks passing.

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

Final design parity evidence also requires rendered files to exist for every desktop/mobile reference and Lumen capture ref in `artifacts/release/design/qaf035-design-parity-20260603.json`; status strings alone are not enough for `--require-final`.

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
Validate that redacted artifact before signoff:

```sh
pnpm release:no-media-scan-artifact:validate
```

3. Record the scanner command/output ref and tracked redacted scan-result artifact in `mediaProcessingAudit.evidenceRef`; final validation requires this field to reference both `release:no-media-evidence:scan` and an `artifacts/release/...no-media...json` artifact that passes `validate-no-media-evidence-scan-artifact.mjs`.
4. Keep `mediaProcessingAudit.forbiddenHits` empty for pass.
5. If any forbidden hit appears, set that target or check to fail and stop beta readiness.

The QAF go/no-go and smoke/regression validators apply the same rule to passing catch-up no-media checks: a passing provider no-media smoke or go/no-go check must cite `release:no-media-evidence:scan` and a tracked redacted no-media scan artifact that validates.

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

The capacity owner must fill `artifacts/release/capacity/qaf035-beta-capacity-20260602.json` with provider capacity, Lumen edge capacity, observability SLO, and rollback/throttle evidence. Final `mediaPath.evidence` and any passing `no-media-processing-verification` check must cite both `release:no-media-evidence:scan` and a tracked redacted no-media scan-result artifact that validates.

The performance owner must finalize `artifacts/release/performance/qaf035-performance-evidence-20260603.json` with numeric startup p95/p99, RSS peak/p95, failed-run rate, and owner approval from an approved release run. Template validation or a passing unit test alone is not final beta performance evidence.

## Ops Signoff

Before 300-500 live users, `artifacts/release/ops/qaf035-beta-ops-signoff-20260603.json` must name:

- Observability/SLO owner.
- Alert channel and dashboard.
- Rollback/throttle owner.
- Decision authority.
- Maximum decision time.
- Stop trigger for any media-processing policy violation.
- Passing `no-media-processing-violation` signal and `no-media-processing-stop-trigger` check evidence that cites `release:no-media-evidence:scan`, a tracked redacted no-media scan-result artifact, and the runtime media policy artifact.

`artifacts/release/observability/qaf035-observability-baseline-20260603.json` must also be finalized with the beta alert owner, alert channel, dashboard, response SLO, and stop-trigger owners. Passing no-media stop-trigger evidence must cite `release:no-media-evidence:scan`, a tracked redacted no-media scan-result artifact, and the runtime media policy artifact.

`artifacts/release/security/qaf035-security-privacy-baseline-20260603.json` must be finalized with the security/privacy incident runbook, owner, response channel, and release-owner approval. Do not mark beta ready from template validation alone.

## Final Go / No-Go

The release owner can mark beta ready only when:

1. `pnpm release:qaf035:validate` passes.
2. `pnpm release:qaf035:final` passes.
3. Latest PR checks are green on the final head.
4. Manual device QA has no release-blocker failures.
5. Provider, capacity, ops, runtime media policy, rollback, and readiness signoffs are no longer pending.
6. No evidence contains ffmpeg, ffprobe, transcode, remux, generated HLS, proxy-remuxed, remux-hls, or XUI-side media processing for broken catch-up channels.
