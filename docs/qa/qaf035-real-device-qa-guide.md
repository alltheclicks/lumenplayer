# QAF-035 Real Device QA Guide

This guide prepares the manual evidence path for the QAF-035 limited beta. Do not use local headless/browser automation as final signoff evidence for these targets. Filip or another named tester must run the device flows on real hardware and record the evidence in `artifacts/release/manual-device-qa/qaf035-manual-device-qa-20260603.json`.

## LAN Setup

1. Start the local Lumen web/proxy stack from the QAF-035 worktree.
2. Find the Mac LAN IP:

```sh
ipconfig getifaddr en0
```

If `en0` is empty, check the active interface:

```sh
ifconfig
```

3. Open the player on each device:

```text
http://<mac-ip>:8080/player
```

4. Keep the tester device and the Mac on the same Wi-Fi/LAN.
5. Disable VPNs that route local network traffic away from the LAN.
6. Allow incoming connections through the macOS firewall for the local dev server/proxy ports used by the stack.
7. If a device cannot connect, verify from the Mac that the web/proxy ports are listening, then retry from another device on the same Wi-Fi.

## HTTPS, PWA, And Cast Scope

LAN HTTP is acceptable only for ordinary local playback checks. Final PWA install/offline and Google Cast evidence must use a public HTTPS deploy, staging URL, or HTTPS tunnel.

Current QAF-035 HTTPS staging smoke prepared on 2026-06-05:

```text
App/player URL: https://preservation-thus-opportunities-shortly.trycloudflare.com/player
Proxy origin: https://fin-edited-contracting-newbie.trycloudflare.com
Evidence JSON: output/playwright/mobile-layout/https-tunnel-smoke.json
Screenshot: output/playwright/mobile-layout/https-tunnel-player-mobile.png
Mobile layout smoke: output/playwright/mobile-layout-smoke/REPORT.md
```

The URLs are Cloudflare quick tunnels and are ephemeral. If either tunnel restarts, update the web runtime env, rebuild the production preview, and refresh this evidence before using it for manual device checks:

```sh
VITE_XTREAM_SERVER='https://gw.castcdn.net:443' \
VITE_XTREAM_PROXY_ORIGIN='https://<proxy-tunnel>.trycloudflare.com' \
VITE_CATCHUP_GATEWAY_ORIGIN='https://<proxy-tunnel>.trycloudflare.com' \
pnpm --filter @lumen/web build

LUMEN_VITE_ALLOWED_HOSTS='.trycloudflare.com' \
pnpm --filter @lumen/web preview -- --host 0.0.0.0 --port 8080
```

Refresh the mobile staging smoke after a tunnel or runtime change:

```sh
E2E_MOBILE_LAYOUT_BASE_URL='https://<app-tunnel>.trycloudflare.com' \
E2E_MOBILE_LAYOUT_PROXY_ORIGIN='https://<proxy-tunnel>.trycloudflare.com' \
E2E_XTREAM_SERVER='https://gw.castcdn.net:443' \
pnpm e2e:mobile:layout
```

The smoke report is not final real-device evidence. It proves the prepared staging URL has a 393px mobile viewport without page-level horizontal overflow, uses the HTTPS proxy origin, and opens `TV Unazad` in-place instead of navigating to EPG.

Use HTTPS evidence for:

- PWA install prompt or Add to Home Screen.
- PWA offline shell and reconnect recovery.
- Google Cast sender and `/receiver.html`.
- Any browser/device policy that refuses insecure origins.

Record the exact HTTPS app URL, receiver URL, tunnel/staging provider, and timestamp in the target evidence. Do not record credentials.

## Device Matrix

Run only the targets that are physically available. Leave unavailable targets as `pending`; do not mark them `pass` from local desktop automation.

| Target id | Device | Required flow |
| --- | --- | --- |
| `desktop-chrome-windows` | Windows desktop, Chrome latest | Login, live start, channel switch, catch-up controls/seek, VOD if available. |
| `desktop-safari-macos` | macOS desktop, Safari latest | Login, live start, VOD, Safari autoplay/media behavior, unsupported catch-up overlay. |
| `mobile-chrome-android` | Android phone, Chrome latest | Login, live start, touch controls, fullscreen/orientation, background/foreground resume. |
| `mobile-safari-ios` | iPhone, Safari latest | Login, live start, controls, native HLS behavior, Add to Home Screen if HTTPS. |
| `tablet` | iPad or Android tablet | Login, live start, controls, fullscreen/orientation, layout sanity. |
| `pwa-install-offline` | Android Chrome and/or iOS Safari installed app | Install, launch installed shell, offline shell, reconnect recovery. HTTPS required. |
| `cast-chromecast` | Chrome sender plus Chromecast | Connect, play, channel switch, stop, return local, error evidence. HTTPS receiver and app id required. |

## Evidence Template

Use this template per device/target. Keep screenshots/videos local or in the approved evidence store, then put the reference path/link into the artifact.

```text
targetId:
owner:
device:
osVersion:
browserVersion:
testedAt:
appUrl:
receiverUrl:
network:
status: pending | pass | fail
screenshotOrVideoRef:
networkEvidenceRef:
noMediaScanArtifactRef:
perCheckEvidenceRef:
checks:
  - id:
    status:
    evidence:
notes:
```

When copying the result into `artifacts/release/manual-device-qa/qaf035-manual-device-qa-20260603.json`, keep the top-level `evidenceIntake` rules intact: every passing target needs real device metadata, screenshot/video evidence, network evidence, a tracked redacted no-media scan artifact, and per-check evidence. Do not use Playwright/headless/local Chromium output as final real-device signoff.

## MP2 Acceptance Checks

For HRT1 or another confirmed MPEG/MP2 live source:

1. Start live playback.
2. Confirm video can continue if the video-only fallback is active.
3. Confirm there is no hidden/background audio loop.
4. Confirm the non-blocking message is visible:

```text
Zvuk nije dostupan za ovaj kanal. Kanal koristi MP2 audio, koji trenutno nije podržan u web browser playback-u. Video može raditi bez zvuka.
```

For normal AAC live channels:

1. Start live playback.
2. Confirm audio/video work normally.
3. Confirm no MP2 warning is shown.

## No Media Processing Audit

Every passing manual target must include no-media-processing evidence. Raw captures stay local/untracked unless separately approved.

```sh
pnpm release:no-media-evidence:scan -- <capture.har-or-json-or-log>
pnpm release:no-media-scan-artifact:validate
```

Passing evidence must show zero forbidden hits for local ffmpeg, ffprobe, transcode, remux, generated HLS, proxy-remuxed, remux-hls, and XUI-side media processing.
