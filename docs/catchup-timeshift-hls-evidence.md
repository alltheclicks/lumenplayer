# Catch-up Streaming Evidence Flow

Current QAF-035 no-media note (2026-06-03):

- This file is historical provider evidence.
- Do not run the old local `ffmpeg`/`ffprobe` probe for beta/release alignment.
- `scripts/catchup/probe-timeshift-hls.mjs` now exits before local media-tool probing. Use browser/provider-byte evidence plus `pnpm release:no-media-evidence:scan` instead.

Purpose:
- collect provider-facing evidence on the real browser catch-up path
- keep `QAF-034` focused on proof of provider media failure, not stale URL-shape assumptions
- define the threshold where `QAF-035` fallback should move from optional to active

## Scope

Use this flow only for the provider's real HLS archive startup chain:
- login host `/streaming/timeshift.php?...extension=m3u8`
- `302`
- archive host `/streaming/timeshift.php?token=...`
- manifest assets `/streaming/timeshift.php?token=...&seg=...ts`

Do not use direct `/timeshift_hls/...` as primary evidence. On the current MediaKing/Xtream stack, local probes on 2026-05-15 showed direct `edge6/timeshift_hls` timing out while the tokenized `/streaming/timeshift.php` redirect chain returned a valid manifest quickly.

## CLI probe

Command shape:

```bash
node scripts/catchup/probe-timeshift-hls.mjs \
  --url 'https://serv2.example/streaming/timeshift.php?username=...&password=...&stream=112&start=2026-03-09:08-30&duration=180&extension=m3u8' \
  --output output/catchup/rts1-timeshift-hls.json
```

What it captures:
- manual redirect chain from the original query URL
- final tokenized streaming manifest URL
- manifest segment count and total duration
- sampled segment probes near `0s`, `60s`, `120s`, plus the last segment
- `ffprobe` stream metadata on sampled segments
- `ffmpeg` decode stderr on sampled segments
- `ffmpeg` decode stderr on the final manifest for a longer playback window

Default checkpoints are tuned for the current failures:
- `PINK` around `~1:00`
- `RTS 1` around `~2:00`

Override them when needed:

```bash
node scripts/catchup/probe-timeshift-hls.mjs \
  --url '...' \
  --checkpoint-seconds 0,30,60,90,120 \
  --playlist-seconds 180
```

## Interpretation

`provider-direct` still remains acceptable when all of the following are true:
- startup follows `login host -> 302 -> archive-host /streaming/timeshift.php?token=...`
- browser playback is stable through the expected window
- CLI probe does not reproduce decode errors on later sampled segments or on the manifest window

Prefer `proxy-normalized` when:
- manifest/asset rewriting is the only browser-specific issue
- proxy preserves the provider tokenized redirect instead of converting it to `/timeshift_hls`
- decode probes stay clean once the real archive host is reached

Do not use `proxy-remuxed` as the production path for the partner Xtream launch. If the browser reaches the real tokenized streaming manifest and still fails, first keep the provider-direct path and collect evidence:
- codec tuple from the archive window
- whether the first TS fragment starts mid-GOP or without SPS/PPS
- whether browser playback reaches the first frame when progressive fragment loading is allowed but player recovery stays disabled until real playback progress exists
- whether live playback for the same channel remains healthy

The 2026-05-15 RTS 1 and PRVA probes returned browser-compatible codecs (`H.264 + AAC`) but emitted repeated missing PPS warnings before ffprobe found usable stream metadata. Later Pink/RTS/Nova S runtime probes showed the real browser issue more precisely: before the first rendered frame, fatal media recovery and buffering recovery could interrupt the valid first archive segment and reopen the same `seg=0_...ts` request. For this provider shape, Lumen keeps catch-up on the provider tokenized HLS path, enables progressive fragment startup so the first archive bytes can be parsed early, and disarms media recovery until the video has reached `playing` or emitted time progress. It still does not create server-side media.

RTS 1 catch-up startup on `2026-05-15 05:43` also exposed a player-side abort loop: the archive manifest resolved in about `0.4s`, and the first segment downloaded through the local proxy in about `8.7s`, but the catch-up buffering recovery timer called `recoverMediaError()` every `4s` before the first frame existed. That interrupted the valid first segment and reopened `seg=0_...ts` repeatedly. The player recovery path must stay disabled until the media element has reached `playing` or emitted time progress; the catch-up startup watchdog handles true no-frame startup failures.

Nova S catch-up selection on `2026-05-08 21:30` exposed a separate provider-time issue. MediaKing/CastCDN expects the `start=YYYY-MM-DD:HH-MM` value in local provider time. Including a UTC fallback for this provider can select the program two hours earlier in Europe/Belgrade, for example `21:30` local becoming `19:30`. Lumen therefore emits local-time-only catch-up starts for MediaKing/CastCDN hosts, including when the real upstream host is hidden behind the local `/xui-api/<encoded target>` proxy path. Generic non-MediaKing Xtream providers may still keep the older UTC fallback.

BHT 1 and B92 catch-up tests on 2026-05-15 showed the remaining startup failure was not a codec mismatch and did not require remux/transcode. The tokenized archive manifest returned 60-second TS segments. The first BHT 1 segment (`seg=0`) produced repeated missing H.264 PPS/SPS errors and no usable video stream metadata at startup; the next segment (`seg=1`) probed as H.264/AAC and had usable keyframes. hls.js loaded `seg=1`, then backtracked to `seg=0` because the segment boundary was not marked as an independent discontinuity. Lumen now preserves the provider tokenized manifest but the local proxy injects `#EXT-X-DISCONTINUITY` before `seg=1` for MediaKing/CastCDN archive manifests. This keeps startup progressive and prevents browser backtracking into the known bad first archive fragment.

## Provider packet

Minimal provider packet should include:
- original `serv2 /streaming/timeshift.php?...extension=m3u8` URL shape
- final redirected archive-host tokenized streaming manifest URL
- affected channel and approximate failure timestamp:
  - `RTS 1` around `2:00`
  - `PINK` around `1:00`
- sampled segment URLs near the failure window
- first decode-error lines from browser and `ffmpeg`

Expected provider ask:
- validate segment independence on later tokenized streaming segments
- validate SPS/PPS availability at random-access boundaries
- validate keyframe cadence and playlist cut points after the first minute of playback
- if the provider can change the edge playlist, mark the first usable archive segment after `seg=0` as discontinuous/independent or cut archive HLS at browser-safe random-access points
