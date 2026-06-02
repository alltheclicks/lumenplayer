# Catch-up Web Capability Preflight

## Goal

Lumen web player must not spin forever on catch-up entries that fail in browser playback. The web app keeps provider codec evidence, still attempts current playback when catch-up is advertised, and only shows the blocking overlay after a real playback failure for that catch-up source.

This feature does not transcode, remux, generate HLS, or build any server-side playback asset. It is a browser-side decision layer around the existing catch-up resolve/playback flow.

## Transport Selection

For the current MediaKing/Xtream provider, web catch-up must start from the provider query endpoint:

`/streaming/timeshift.php?username=...&password=...&stream=...&start=YYYY-MM-DD:HH-MM&duration=...&extension=m3u8`

The local proxy must preserve the provider `302` redirect to the tokenized archive URL:

`/streaming/timeshift.php?token=...`

It must not rewrite that redirect into `/timeshift_hls/{user}/{pass}/...`. On 2026-05-15, the direct `edge6/timeshift_hls` path timed out locally, while the tokenized streaming path returned the manifest in about 0.5s and served the first segment through the proxy.

## Runtime Behavior

`resolveCatchUpPlaybackSource` checks `resolveCatchUpWebCapability` before gateway resolution, shadow validation, URL fallback, or player load.

The capability result has three states:

- `unsupported`: hard block only when catch-up is not advertised for the channel. Lumen switches the session to a blocked catch-up source and shows a blocking error overlay across the player surface.
- `unknown`: no hard stop. Lumen continues through the existing resolve and playback path. Prior codec evidence from the provider matrix is carried as `catchUpWebProviderIssue` metadata and is used only if runtime playback fails.
- `playable`: reserved for a future positive raw/no-build probe. The current matrix intentionally does not mark channels as guaranteed playable.

Only non-advertised catch-up stops before playback. Risky or previously bad channels continue because provider sources can change and stale samples must not block current playback.

For a channel that fails at runtime with provider codec evidence, `VideoPlayer` maps `source.metadata.catchUpWebProviderIssue` to the same overlay after the failed attempt. A catch-up startup watchdog also stops provider-evidence streams that never reach usable media, so the user does not wait on a long edge timeout. The overlay offers one action to return to the same channel live.

Catch-up HLS uses progressive fragment startup for the current MediaKing/Xtream archive shape, with `startFragPrefetch` enabled for archive playback only. That lets the browser start parsing the first archive segment as soon as enough bytes arrive. The guardrail is recovery timing: catch-up media recovery and buffering recovery stay disarmed until the video has actually started (`playing` or time progress), so a valid but large first provider segment is not aborted every few seconds. Startup speed still depends on the provider archive segment shape: shorter independent segments with browser-safe H.264/AAC random-access points will start faster than large 60-second TS cuts.

Catch-up also uses a deeper forward buffer than live. Live keeps a shallow buffer for quick zap behavior, while archive playback allows about `90s` forward buffer so 60-second provider TS segments can be downloaded before the next playback boundary. This matters on channels such as OBN where one archive segment can be around `28-30 MB`.

For MediaKing/CastCDN tokenized archive manifests, the proxy also applies a no-media-processing manifest guard: it inserts `#EXT-X-DISCONTINUITY` before `seg=1` when the provider manifest starts with `seg=0` and `seg=1`. This avoids the observed hls.js backtrack from the first usable segment into the non-random-access `seg=0` fragment. The media bytes are still provider bytes; Lumen does not remux or transcode them.

For MediaKing/CastCDN hosts, catch-up URL generation uses provider-local `start=YYYY-MM-DD:HH-MM` only. UTC fallback is intentionally suppressed for this provider family, including when the upstream host is reached through the local `/xui-api/<encoded target>` proxy. This prevents a Europe/Belgrade archive click such as `21:30` from falling back to the UTC-equivalent `19:30` program.

## User Message

For channels that fail at runtime with provider issue evidence, the user sees a full player overlay. The exact UI copy lives in `apps/web/src/components/player/catchupCapability.ts`.

> TV unazad trenutno nije dostupna u web playeru
>
> [Channel] trenutno ne može da se gleda unazad u web browseru. Live kanal radi normalno. Problem je u formatu snimka koji šalje provajder, a browser taj format ne može pouzdano da pusti. Nije do vas, uređaja ili Lumen playera.
>
> Gledaj [Channel] uživo

## Provider Issue Matrix

Observed from the active provider archive scan on 2026-05-13 around 14:42 Europe/Belgrade.

| Stream ID | Channel | Reason | Browser issue |
| ---: | --- | --- | --- |
| 53 | KANAL 5 | `unsupported=audio:mp2` | H.264 video with MP2 audio |
| 54 | SITEL | `unsupported=audio:mp2` | H.264 video with MP2 audio |
| 81 | HBO | `unsupported=audio:ac3` | H.264 video with AC3 audio |
| 169 | NICKELODEON | `unsupported=audio:mp2` | H.264 video with MP2 audio |
| 260 | AMC | `unsupported=audio:mp2` | H.264 video with MP2 audio |
| 530 | NOVA BH | `unsupported=audio:mp3;unstable_params` | H.264 video with MP3 audio |
| 587 | NICK JR. | `unsupported=audio:mp2` | H.264 video with MP2 audio |
| 713 | CINESTAR TV ACTION | `unsupported=audio:mp2` | H.264 video with MP2 audio |
| 1495 | PRVA WORLD | `unsupported=audio:mp2` | H.264 video with MP2 audio |
| 2927 | RTS 1 (Ultra HD) | `unsupported=video:hevc` | HEVC video |
| 14219 | MAX SPORT 2 | `internal_ts_break=1;audio=undetected` | Archive signal is not browser-safe |
| 29952 | ARENA PREMIUM 1 BH | `unsupported=audio:mp2` | H.264 video with MP2 audio |

## Risk Matrix

These channels are not blocked. They stay playable through the normal resolve path.

| Stream ID | Channel | Risk | Behavior |
| ---: | --- | --- | --- |
| 5 | EUROSPORT 2 | `unstable_params` | Allow playback attempt |
| 165 | RTV 1 | `internal_ts_break=3` | Allow playback attempt |

## Maintenance Rule

When the provider fixes a channel source or ingest profile, update `UNSUPPORTED_PROVIDER_ARCHIVE_STREAMS` and this document in the same change. A channel should only be removed from the unsupported matrix after a fresh archive probe confirms browser-safe video/audio for the current archive files.

HRT 1 (`stream_id=75`) was removed from the unsupported matrix after a fresh 2026-05-15 archive probe returned H.264 video with AAC audio for the tested archive window. Keep it on the normal playback path unless a new current probe proves a browser-incompatible archive format again.

Current production policy:

- Good target: H.264 video + AAC audio + stable parameters + clean TS.
- Fast target: short independent archive segments, ideally a few seconds per segment with keyframes/SPS/PPS at segment boundaries.
- MediaKing/CastCDN time target: provider-local catch-up `start`, no UTC fallback.
- MediaKing/CastCDN current web guard: start archive playback at `75s` and mark `seg=1` as a discontinuity in the proxied manifest to avoid browser backtracking to `seg=0`.
- Runtime issue overlay: HEVC video, MP2/AC3/MP3 audio, missing audio, or confirmed archive signal corruption after the current playback attempt fails.
- Do not solve this with server-side transcode or remux.

## Future Extension

The next stronger version should replace the static matrix with a no-build raw capability endpoint on the Xtream edge. That endpoint should inspect existing archive `.ts` files and return `playable`, `unsupported`, or `unknown` without creating media assets.
