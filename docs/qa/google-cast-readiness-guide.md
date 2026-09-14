# Google Cast Readiness Guide

This guide defines the production-ready Google Cast path for QAF-035. Cast final evidence must not rely on `localhost`, plain LAN HTTP, or the default Cast receiver as the production receiver.

## Required Public HTTPS URLs

Prepare a public HTTPS app URL and receiver URL:

```text
https://<staging-or-production-host>/player
https://<staging-or-production-host>/receiver.html
```

The receiver URL must return the tracked `apps/web/public/receiver.html` file over HTTPS. Verify it before testing on real Chromecast hardware.

Current QAF-035 HTTPS tunnel smoke prepared on 2026-06-05:

```text
App URL: https://preservation-thus-opportunities-shortly.trycloudflare.com/player
Receiver URL: https://preservation-thus-opportunities-shortly.trycloudflare.com/receiver.html
Proxy origin: https://fin-edited-contracting-newbie.trycloudflare.com
```

These are Cloudflare quick tunnel URLs, not permanent production URLs. They can be used to prepare a manual Cast test, but final Cast signoff still requires a registered custom receiver app id, a registered Chromecast test device, and real-device evidence.

## Google Cast SDK Developer Console

1. Open the Google Cast SDK Developer Console.
2. Register a Custom Receiver application.
3. Set the receiver URL to the public HTTPS `/receiver.html`.
4. Save the generated receiver application id.
5. Register the Chromecast device used for testing.
6. Wait for registration propagation.
7. Restart the Chromecast device before the first test if it does not discover the custom receiver.

## Sender Configuration

Set the custom receiver id in the web app environment:

```sh
VITE_GOOGLE_CAST_APP_ID=<app_id>
```

Production builds must use `VITE_GOOGLE_CAST_APP_ID`. The default receiver id `CC1AD845` is allowed only as a development fallback when `import.meta.env.DEV` is true.

## V1 Cast Flow

QAF-035 uses the standard sender `loadMedia` flow as the V1 default:

1. Sender requests a Cast session.
2. Sender builds `chrome.cast.media.MediaInfo` from the current session source URL and type.
3. Sender calls `castSession.loadMedia(loadRequest)`.
4. Sender syncs play/pause/seek state with the Cast media session.
5. Sender returns to `local-web` when the Cast session ends.

The custom receiver bridge in `apps/web/public/receiver.html` remains future/custom behavior unless a sender explicitly sends bridge namespace commands. Do not treat the bridge as the required V1 media path.

## Codec Guard

MP2 live audio is unsupported for web beta audio and must not be represented as Cast-supported with audio. When a live source has:

```text
unsupportedAudioCodec: "mp2"
```

the sender must block Cast for that source and show a clear message instead of loading remote playback. AAC and normal channels must not show the MP2 guard.

## Real Device Test Matrix

Record evidence for each run:

```text
owner:
senderDevice:
senderBrowser:
chromecastDevice:
appUrl:
receiverUrl:
castAppId:
testedAt:
status: pending | pass | fail
screenshotOrVideoRef:
notes:
```

Required checks:

- Connect to the custom receiver.
- Play live channel.
- Switch channel while connected.
- Stop Cast.
- Return to local playback.
- Capture error evidence if session start or media load fails.
- Confirm MP2 live source is blocked or warned instead of marked as Cast-supported audio.
- Confirm normal AAC live source can proceed without MP2 warning.

## Evidence And Validation

Update these artifacts after manual testing:

- `artifacts/release/manual-device-qa/qaf035-manual-device-qa-20260603.json`
- `artifacts/release/ops/qaf035-beta-ops-signoff-20260603.json`
- `artifacts/release/observability/qaf035-observability-baseline-20260603.json`

Run the current validators after updating evidence:

```sh
pnpm release:manual-device-qa:validate
pnpm release:beta-ops:validate
pnpm release:observability-baseline:validate
```

MP2 protection also applies to catch-up sources. Show the unsupported reason on the Cast control or after an explicit Cast action; ordinary local channel selection must not produce a Cast toast. The web player continues video-only playback with its MP2 audio notice.
