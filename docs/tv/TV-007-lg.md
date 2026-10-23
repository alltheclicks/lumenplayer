# TV-007 — LG webOS native media adapter

2026-10-23, Buildara source/host implementation. Base:
`c573ce47bda6bf84f71db268f4ec45c3e95172e9`, branch `t3/7e266d1f`,
session `Codex/TV-007-7e266d1f-20261023`. Target reported by owner:
LG 60UN71003LB, webOS 5.6.2-21. No device, emulator, source credentials,
network media playback, SDK mutation, push, merge or deployment performed.

Only `apps/tv-web/src/adapters/webos/` and this handoff are delivered.
The canonical registry was claimed under its Git-common-directory lock;
its live file and the worktree TASKS snapshot are not part of this commit.
Root/shared packages, composition and read-only design exports are unchanged.
This is code for coordinator review, not device acceptance or completed M1.

## Platform choice and official references

Use the native HTMLMediaElement path, assigning the supplied HTTP(S) URL to
`src`; no hls.js, MSE engine, Luna media service or legacy NetCast API is needed
for this adapter. LG's [resume guide](https://webostv.developer.lge.com/develop/guides/resuming-media-with-mediaoption)
shows HTML video loading and `currentTime` seeking. The optional proprietary
mediaOption optimization is not used here.

LG documents HTTP(S), HLS, seek and live seek, with stream-specific restrictions
in [Streaming Protocol and DRM](https://webostv.developer.lge.com/develop/specifications/streaming-protocol-drm).
The webOS 5.0 table lists HLS v7; the native HLS implementation does not support
all tags. In particular, PROGRAM-DATE-TIME cannot supply a portable epoch
position; codec/container/PID discontinuities are restricted. Audio/video
segment alignment and playlist correctness need source verification. Those
platform tables are not a claim that this model decodes any given source.
The adapter implements clear `hls` and `mp4` paths only; DASH, WebRTC and any
request carrying `media.drm` are rejected. DRM capability in a platform table
does not mean this adapter implements license/session setup.

LG's [Web API and Web Engine](https://webostv.developer.lge.com/develop/specifications/web-api-and-web-engine)
identifies Chromium 68 for webOS TV 5.x. Actual engine/model behavior remains
TV-010 evidence; emitted code conservatively targets Chrome 63.
[App Lifecycle Management](https://webostv.developer.lge.com/develop/guides/app-lifecycle-management)
documents standard/prefixed visibility events and background suspension.
The adapter subscribes to the available visibility event, pauses and releases
its element on hide, and requires explicit Play to reload on return. It does
not promise persistence across process termination or automatic standby recovery.
[HTML media semantics](https://html.spec.whatwg.org/multipage/media.html#media-elements)
define seconds-based currentTime/duration, seekable ranges, media events and
resource reset; public TV times remain milliseconds.

All references were browsed during this implementation. Research cache is
local under `/tmp/klaro-tv007-logs/.firecrawl/`.

## Behavior and ownership

- `WebOSPlaybackAdapter` implements the existing `TVPlaybackAdapter` unchanged;
  `createWebOSPlaybackAdapter(options)` is the factory export. No app/web or
  server media conversion imports exist.
- Inject `createMediaElement`, optional unmount callback, visibility document,
  optional synchronous live resolver and positive finite load/seek deadlines
  (defaults 30 seconds / 10 seconds). A real HTMLVideoElement satisfies the
  narrow testable media surface. Construction does not access global DOM.
- Every load needs a fresh, empty, exclusively owned element. Old listeners,
  timers and abort subscriptions are removed before pausing, removing src,
  calling load() to reset/release the decoder, and unmounting. Cleanup steps
  are independent if a platform call throws. Only one element remains active;
  do not pool retired elements or supply child source elements. Fresh element
  identity plus session checks prevents queued old events from becoming B's
  events after A→B, including switching to the identical URL. Reuse is rejected.
- Load validates the request, sets autoplay=false/preload=auto, assigns the
  exact source URL and calls native load(). It resolves on canplay/loadeddata
  only at readyState >= HAVE_FUTURE_DATA (3). Metadata alone does not prove
  readiness. Load and returnToLive **do not autoplay**: coordinator calls play()
  explicitly. A resolved play() is not a playing snapshot; only a current media
  playing event while not paused/hidden establishes that state initially;
  seeked can restore that established state when media remains ready/unpaused.
- Snapshot echoes the exact request reference. Finite nonnegative media
  seconds convert to rounded milliseconds; NaN/Infinity duration becomes null.
  Archive duration is a request hint, not substituted for observed duration.
  startTimeMs is the archive's epoch metadata, not a currentTime offset. The
  source layer must supply a URL whose zero is the requested archive start.
- Seek clamps to zero/known media duration, then requires the target in an
  observed seekable range. Empty ranges, DVR window misses and holes are
  rejected. Assignment uses seconds; completion waits for a current seeked
  event near the requested position (250 ms tolerance), with a bounded timeout.
  This does not imply arbitrary seek support for every live/archive stream.
- Return-to-live requires the injected resolver, which must return a validated
  live request for the same source/channel. No URL string substitutions or
  provider protocol assumptions are made. The new request is published before
  resolution so TVPlaybackController adopts it. Explicit play follows return.
- Capabilities describe implemented operations/media families, not codecs,
  licenses, successful media probing or network availability. `returnToLive`
  is false without a resolver. Destroyed adapters expose no media capabilities.
- Caller abort, superseding load, stop and destroy reject pending operations
  with AbortError; caller cancellation clears the adapter to idle without a
  provider error. A pre-aborted load leaves existing media alone. Abort remains
  active after load completion and while suspended. Native MEDIA_ERR_ABORTED
  is a media failure, distinct from caller cancellation. Other media errors,
  load timeout and play failures expose stable sanitized codes/messages.
  Request URLs remain in the request by contract: never serialize snapshots to
  logs or diagnostic reports containing credentials.
- Hide saves observed archive position, cancels pending work and releases media.
  Visible alone does not restart it. Play creates a fresh element, loads and
  restores archive position if still seekable, then calls play. Live reload
  uses the original live URL without restoring an old DVR position. Replacement
  or abort during recovery cannot seek/play a newer channel. A terminated
  process needs app-level restore; transient failures need explicit reload.

## Coordinator integration request (not wired by this task)

No manifest, lockfile or shared-contract changes are requested. Keep the
current unavailable adapter/shell until composition is deliberately changed.
The coordinator owns `apps/tv-web/src/composition/playback.ts` and shell UI.
An integration can import the factory and pass its result to the existing
`createPlaybackController(adapter)`:

```ts
import { createWebOSPlaybackAdapter } from "../adapters/webos/WebOSPlaybackAdapter";

const adapter = createWebOSPlaybackAdapter({
  createMediaElement: () => {
    const video = document.createElement("video");
    // Mount with the approved TV player layout and set any reviewed CORS mode
    // before the adapter assigns src. No additional audio/video decoder.
    mediaMount.appendChild(video);
    return video;
  },
  releaseMediaElement: video => {
    if (video instanceof HTMLElement) video.remove();
  },
  visibility: document,
  resolveLiveRequest: request => liveRequestFor(request.sourceId, request.channelId),
});
const controller = createPlaybackController(adapter);
await controller.load(request);
await controller.play();
// Back to Live TV: await controller.returnToLive(); await controller.play();
// Screen teardown: controller.destroy();
```

`mediaMount`, `liveRequestFor` and `request` above are integration placeholders,
not implemented UI/catalog APIs. Reuse the source/catalog layer for real live
and archive requests. Do not edit design exports or label the no-playback
shell as playable solely because the adapter files have landed. Catalog/EPG
screens and localized error-code presentation remain coordinator/TV-014 work.

## Transport/source checks still required

The adapter accepts HTTP(S) only. Correct server Content-Type, HLS manifest and
segment/key URLs, redirects, token expiry and archive URL semantics must be
verified on the controlled source and actual TV. It does not fetch manifests,
rewrite playlists, inject HTTP auth headers, proxy, remux or transcode. A raw
MPEG-TS URL is not automatically an HLS request. Progressive MP4 seeking depends
on the server/media seekability (including range handling); live HLS seeking
depends on the advertised DVR window.

[LG's CORS FAQ](https://webostv.developer.lge.com/faq/how-to-solve-the-problem-if-cors-occurs)
states that webOS follows CORS. Catalog/EPG fetches and cross-origin media paths
must be checked separately. Native media loading and JS fetch have different
CORS behavior; this adapter does not assert either that every src needs an
anonymous CORS mode or that native HLS bypasses CORS. The coordinator must
choose any crossOrigin mode before src assignment, verify server origin and
credential behavior for the packaged app, redirects and every segment/key,
and avoid disabling security as a workaround. Mixed-content policy, TLS/root
certificate compatibility, cookies and provider-required headers must be tested
on webOS 5.6.2-21. No upstream/provider change is authorized here.

TV-010 still needs Mac-side authorized install with the real controlled source:
launch/remote controls; live/channel switching; archive start/seek/live return;
network loss/reconnect and explicit reload; suspend/standby/resume; sustained
viewing. Record actual model/OS/engine/build, protocols, observed failures and
durations separately. No codec, DRM, source compatibility or media success
claim follows from mocks, desktop tests or a successful package build.

## Host validation and reproducibility

20 GB was free on the actual home filesystem before the build. Existing
TV-016 dependency trees were reused through ignored root/tv-web node_modules
symlinks to `t3-e01ca79f`; no dependencies were copied/installed, no SDK was
written/downloaded. Local logs and temporary configs: `/tmp/klaro-tv007-logs/`.

The plain package commands were attempted and their failures preserved:
`pnpm --filter @lumen/tv-web typecheck` exits 2; `... test` exits 1 because
`src/testing/contract-consumers.test.ts` imports Android composition and this
worktree has no Android node_modules links for @lumen/types/player-core. No
Android or shared dependency tree was changed to fix that environment issue.
The first temporary typecheck config also failed to locate vite/client from
/tmp; its types entry was corrected to the existing absolute Vite path.

Full package includes were then checked using a temporary config extending the
unchanged app tsconfig with absolute aliases only for @lumen/types/player-core
pointing to this worktree's packages, plus the existing Vite types. Likewise,
the temporary Vitest config preserves the app root, node environment and
src/**/*.test.ts include, adding only those same source aliases.

| Check | Exit/result | Local log |
| --- | --- | --- |
| `pnpm --filter @lumen/tv-web exec tsc --noEmit -p /tmp/klaro-tv007-logs/tsconfig.json` | 0, whole tv-web package includes | `typecheck-mapped.log` |
| `pnpm --filter @lumen/tv-web exec vitest run --config /tmp/klaro-tv007-logs/vitest.config.mjs` | 0, 3 files / 43 tests (29 new adapter tests) | `tests-final.log` |
| Node focus tests (first package test run) | 0, 2 tests | `tests.log` |
| `pnpm --filter @lumen/tv-web lint` | 0 | `lint.log` |
| `pnpm --filter @lumen/tv-web build:webos` | 0, existing shell + Chrome63 output checker | `build-webos.log` |
| Separate esbuild adapter bundle target chrome63 + Acorn ecmaVersion2018 | 0; proves adapter syntax, absent from shell bundle | `adapter-build.log`, `adapter.chrome63.js` |

Tests cover generations/stale retained callbacks, cancellation before/during/
after load and during suspension, abort/error distinction, metadata/readiness,
load timeout, media failures before/after load, duration/time conversion,
seek ranges/conversion/clamping/timeout/cancellation/cleanup, live request
adoption through the real controller, stale return/play/resume completion,
visibility recovery, listener unsubscribe, reentrant stop and independent
cleanup when platform teardown calls throw. All media events/decoder behavior
are injected; none is a real playback result.
