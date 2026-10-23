# TV-006 — Samsung AVPlay adapter

Implemented on Buildara (Linux), 2026-10-23, from
`c573ce47bda6bf84f71db268f4ec45c3e95172e9` on
`t3/tizen-avplay-adapter`, worktree `t3-dcda1237`.
Session: `Codex/TV-006-dcda1237-79c5b0ac-c57d-4a20-802a-d0325e7d07ae`.
Only `apps/tv-web/src/adapters/tizen/` and this handoff are owned/changed.
The canonical TASKS row is updated separately under its lock, never committed
with this implementation. Parent retains manifests, shared contracts and wiring.

## Implementation and limits

`TizenTVPlaybackAdapter.ts` implements the existing `TVPlaybackAdapter` from
`@lumen/types`, with an injected structural `AVPlay` binding from `avplay.ts`.
No app/web imports, provider URL construction, shared contract changes, network
fetch, credentials, DRM setup, transcoding or remuxing are introduced.

- Capabilities: live, catch-up, archive seek; media types `hls` and `mp4`.
  `returnToLive` is true only with an injected `resolveLive`. This is the
  implemented API surface, not a verified codec/device compatibility claim.
  DASH, WebRTC, DRM and non-HTTP(S) input fail explicitly before replacing a
  valid session. Raw TS has no media type in the shared contract; do not label
  TS as MP4 or HLS. Codec/profile/manifest compatibility is delegated to AVPlay;
  platform failure is reported, never replaced with fake playback.
- `load()` closes the previous native resource, opens the provided URL, sets
  listeners/display area and prepares asynchronously. It resolves in contract
  `paused` state (native READY); it does **not** autoplay. Call `play()` after
  load resolves. Loading/buffering alone never reports playing. `playing` means
  the native play command succeeded, not that decoded frames were observed.
- Public and AVPlay times are both **milliseconds**: no seconds multiplier.
  `startTimeMs` is an epoch instant describing the already-resolved archive,
  never an offset passed to `seekTo`. Archive position starts at zero. Duration
  is the smaller positive native duration/request duration, or request duration
  if native duration is unknown. Live duration stays null. Seek rounds to whole
  milliseconds and clamps to zero/duration/the signed 32-bit AVPlay range;
  native `getCurrentTime()` supplies the completion position. Archive duration
  above 2,147,483,647 ms is rejected, rather than overflowing the native API.
- Live seek fails with `tizen_live_seek_unsupported`: no DVR range is present
  in the contract, and no native DVR capability is assumed. The global `seek`
  capability describes archive seek; callers must also inspect request kind.
  Pause/resume uses AVPlay pause/play; live pause continuity is a device gate.
- `returnToLive()` resolves a **new live request** through injected source
  policy, validates source/channel/kind/media, loads it, plays it, and publishes
  its exact request reference before resolving. `TVPlaybackController` then
  adopts that reference. When already live it is a no-op, not a DVR edge jump.
  A resolver failure/mismatch preserves the current archive. A failure after
  valid live loading starts is a playback error, with no silent archive fallback.
- Session identity guards discard obsolete prepare, seek, resolver and platform
  events after replacement, signal abort, stop, completion, error or destroy.
  The caller signal remains subscribed after prepare resolves. Internal resolver
  cancellation is also aborted on direct stop/destroy; the caller signal is
  never mutated. Pending operations reject with `AbortError` on cancellation.
  Signal abort freezes the last snapshot, matching controller behavior;
  explicit stop resets idle. Destroy is idempotent and clears subscriptions.
- Preparation has a 30-second native watchdog, configurable via
  `prepareTimeoutMs`. TV-018 adds a separate 30-second `operationTimeoutMs`
  deadline covering public queue waits, seek completion, commands, load and
  live resolution. Errors contain fixed codes/messages, never native strings
  or URLs. Events map buffering, time, completion and errors into snapshots.
- Native calls remain serialized during `seekTo`, as required by Samsung.
  TV-018 supersedes the original indefinite-public-wait behavior: any public
  deadline reached during native seek, or its independent native watchdog,
  permanently latches `tizen_recovery_required`, rejects public work, invalidates
  the session and rejects future requests immediately. **The native lock stays
  held until a real callback.** No timeout calls stop/close/getState or reopens
  AVPlay. Late callbacks permit best-effort cleanup only; they cannot resume,
  autoplay or clear the recovery latch. See [TV-018](TV-018-seek-recovery.md).
- Cleanup removes the native listener, stops READY/PLAYING/PAUSED, then always
  attempts close. A failed close retains ownership so the next healthy load
  retries cleanup before opening. `stop()` has a bounded public wait; destroy
  immediately cancels public work, clears subscriptions and queues best-effort
  cleanup. Neither teardown method proves that a pending native seek released
  the singleton. If the callback never arrives, native resources may remain
  until full app termination/relaunch. Do not transfer the singleton to a new
  adapter in that app lifecycle or claim engine recovery from a timeout.

## Exact parent integration request (not applied here)

Keep the existing unavailable composition until a deliberate platform wiring
change is reviewed. No package/lockfile/shared-contract edit is needed.

In the Samsung-only application entry, after its existing cancellation polyfill
initialization, import the factory from
`./adapters/tizen/TizenTVPlaybackAdapter` and inject it into the existing
`createPlaybackController` in `src/composition/playback.ts`:

```ts
const adapter = createTizenTVPlaybackAdapter({
  avplay: samsungWebapis.avplay, // the actual webapis object; preserve method receiver
  displayArea: { x: 0, y: 0, width: 1920, height: 1080 },
  resolveLive: (archive, signal) => sourcePolicy.resolveLive({
    sourceId: archive.sourceId,
    channelId: archive.channelId,
    signal,
  }),
});
const controller = createPlaybackController(adapter);
await controller.load(resolvedRequest);
await controller.play();
```

`samsungWebapis`, `sourcePolicy` and `resolvedRequest` above are parent-owned
bindings, **not new repository APIs**. The resolver must return a real
`TVLivePlaybackRequest` with the same source/channel; reuse the existing shared
source/catalog policy and its secret handling, not an adapter URL template.
Omit `resolveLive` until this binding exists (capability then stays false).
Guard Samsung platform/API availability before instantiation; desktop and LG
must continue to use their own unavailable/real adapter. On Back, Settings,
hidden/app-exit teardown, destroy the controller before removing the media
surface. Recreate and explicitly load on foreground only after the prior native owner
has released the singleton; automatic native suspend/restore is not implemented.
For unresolved seek/recovery-required teardown, use the full app lifecycle
restart boundary described in TV-018. Never overlap native owners; synchronous
controller destruction alone is not proof of native release.

The parent needs these narrow additional changes outside this worker's scope:

1. `apps/tv-web/index.html` or a Samsung-specific generated entry: load Samsung's
   `<script type="text/javascript" src="$WEBAPIS/webapis/webapis.js"></script>`
   before Samsung composition. Avoid loading the Samsung script on webOS.
2. `apps/tv-web/src/main.ts` / `src/composition/playback.ts`: explicit platform
   selection, the source-policy resolver, separate load/play and lifecycle
   teardown; preserve localized unavailable behavior until deliberately wired.
3. Samsung media surface and associated app styles: create exactly one
   `<object type="application/avplayer">` beneath the UI with matching bounds,
   and keep the playback viewport transparent so the native plane is visible.
   Convert CSS/viewport rectangles into Samsung's **1920 × 1080 reference plane**
   (`x * 1920 / viewportWidth`, `y * 1080 / viewportHeight`, similarly width/height),
   round/fit within bounds, and supply them at adapter construction. This
   implementation intentionally has no mutable resize API; stop/recreate for
   layout changes. Remote focus and overlays remain parent UI responsibilities.
4. `apps/tv-web/platforms/tizen/config.xml`: approve only the actual source/API
   origins and required redirect/CDN/manifest/segment/key origins through scoped
   `<access origin="https://example.invalid" subdomains="false" />` entries and
   matching CSP directives, based on the real source topology. Keep real private
   URLs/credentials out of tracked files/logs. Current shell has no access/CSP
   entries; adapter code alone cannot establish network access. Do not replace
   this with wildcard origins or add the obsolete AVPlay privilege. Samsung's
   guide says the AVPlay privilege is unused for TV Web apps since 2015.

## Official primary documentation consulted

Read live on 2026-10-23 using Firecrawl; cached pages are local under
`/tmp/klaro-tv006-logs/.firecrawl/`.

- [Samsung AVPlay API](https://developer.samsung.com/smarttv/develop/api-references/samsung-product-api-references/avplay-api.html):
  open/prepareAsync/READY, display coordinates, millisecond seek/duration/time,
  signed `long` seek and the restriction against other calls during async seek,
  DVR-range requirement, valid states and stop/close/listener lifecycle.
- [Samsung playback using AVPlay](https://developer.samsung.com/smarttv/develop/guides/multimedia/media-playback/using-avplay.html):
  WebAPI script, AVPlayer object, media display area, CSP and privilege guidance.
- [Samsung networking FAQ](https://developer.samsung.com/smarttv/develop/faq/networking-and-connectivity.html):
  cross-origin server access through config.xml origin entries.
- [Samsung 2019 video specifications](https://developer.samsung.com/smarttv/develop/specifications/media-specifications/2019-tv-video-specifications.html):
  model-family codec/container limits. These are not proof of this unit's behavior.

Target is owner-reported **UE43RU7092UXXH (2019)**, firmware
**T-MSLDEUC-1500.9**. No API/Tizen version is inferred from firmware.

## Host validation

Free space checked on the actual home filesystem: approximately 20 GB before
installation and builds. `pnpm install --frozen-lockfile --offline` reused the
existing pnpm store, exit 0, with no manifest/lockfile edits, SDK download or
SDK mutation. No dependencies were copied from another checkout.

Logs: `/tmp/klaro-tv006-logs/`. Commands run from the repository root:

| Check | Exit | Evidence |
|---|---|---|
| `pnpm --filter @lumen/tv-web typecheck` | 0 | `typecheck-final3.log` |
| `pnpm --filter @lumen/tv-web lint` | 0 | `lint-final3.log` |
| `pnpm --filter @lumen/tv-web test` | 0 | `test-final4.log`; 25 injected Tizen tests + 14 existing Vitest tests and 2 Node focus tests |
| `pnpm --filter @lumen/tv-web exec vite build --config src/adapters/tizen/vite.adapter.config.ts` | 0 | `adapter-build-final3.log`; standalone adapter compiled for Chrome 63, output `/tmp/klaro-tv006-logs/adapter-build/` |
| `node apps/tv-web/scripts/check-tv-compat.mjs /tmp/klaro-tv006-logs/adapter-build` | 0 | `adapter-compat-final.log`; emitted ECMAScript 2018 syntax check |
| `pnpm --filter @lumen/tv-web build:tizen` | 0 | `shell-build.log`; current unavailable shell build, adapter intentionally unwired |
| `git diff --check` | 0 | Final scoped source/docs check |

Injected tests exercise request identity/controller adoption, prepare without
fake autoplay, native play/pause, buffer/time/end/error mapping, invalid inputs,
late callbacks after channel changes/abort/stop/destroy, preparation error and
timeout, native errors without private data, seek clamp/rounding/duration/error,
native-call serialization and deferred cleanup, live rejection and archive/live
transitions including obsolete resolver/preparation, resolver signal abort,
reentrant stop/error retry, aborted replacement cleanup and retry after close failure. Tests simulate callbacks and do
not download, decode or render any media. The standalone build includes the
adapter even though the current shell build does not import it.

No actual device/emulator, installation, signing/package attempt, real source,
media playback, codec/audio/seek quality, remote behavior, AVPlay runtime version
or frame observation was established. All device/emulator work remains Mac-only.
Samsung certificate/source/device gates remain TV-013/TV-009; certificate setup
blocks physical-TV packaging/install, not this source implementation. This
commit is for parent review, not deployment, merge, push or release acceptance.
