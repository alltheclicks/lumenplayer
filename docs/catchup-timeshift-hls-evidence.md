# Catch-up `timeshift_hls` Evidence Flow

Purpose:
- collect provider-facing evidence on the real browser catch-up path
- keep `QAF-034` focused on proof of provider media failure, not the older startup `404`
- define the threshold where `QAF-035` fallback should move from optional to active

## Scope

Use this flow only for the provider's real HLS archive startup chain:
- login host `serv2 /streaming/timeshift.php?...extension=m3u8`
- `302`
- archive host `/timeshift_hls/{user}/{pass}/{duration}/{start}/{stream}.m3u8`

Do not use direct login-host `/timeshift_hls/...` as primary evidence anymore.
That path was the old Lumen startup bug and is already locally fixed.

## CLI probe

Command shape:

```bash
node scripts/catchup/probe-timeshift-hls.mjs \
  --url 'https://serv2.example/streaming/timeshift.php?username=...&password=...&stream=112&start=2026-03-09:08-30&duration=180&extension=m3u8' \
  --output output/catchup/rts1-timeshift-hls.json
```

What it captures:
- manual redirect chain from the original query URL
- final `timeshift_hls` manifest URL
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
- startup follows `serv2 -> 302 -> archive-host /timeshift_hls/...`
- browser playback is stable through the expected window
- CLI probe does not reproduce decode errors on later sampled segments or on the manifest window

Prefer `proxy-normalized` when:
- manifest/asset rewriting is the only browser-specific issue
- decode probes stay clean once the real archive host is reached

Prefer `proxy-remuxed` when any of the following are true:
- browser reaches the real `timeshift_hls` manifest and still fails with `MEDIA_ERR_DECODE` or `PIPELINE_ERROR_DECODE`
- `ffmpeg`/`ffprobe` on later sampled segments reports codec continuity errors such as missing PPS/keyframe dependency issues
- live playback for the same channel remains healthy, which isolates the breakage to archive media packaging

## Provider packet

Minimal provider packet should include:
- original `serv2 /streaming/timeshift.php?...extension=m3u8` URL shape
- final redirected archive-host `timeshift_hls` manifest URL
- affected channel and approximate failure timestamp:
  - `RTS 1` around `2:00`
  - `PINK` around `1:00`
- sampled segment URLs near the failure window
- first decode-error lines from browser and `ffmpeg`

Expected provider ask:
- validate segment independence on later `timeshift_hls` segments
- validate SPS/PPS availability at random-access boundaries
- validate keyframe cadence and playlist cut points after the first minute of playback
