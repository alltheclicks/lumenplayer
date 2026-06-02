# Live Web Startup Performance

## Goal

Live channel switching in the browser should feel close to native IPTV clients: the player should start from the current live edge quickly, without waiting on stale buffers or unnecessary full startup retries.

## Browser Constraint

Native players such as TiviMate can read MPEG-TS transport streams directly and decode while bytes are still arriving. The web player runs through MSE and hls.js, so HLS transport must be converted into browser appendable media before the video element can render frames.

For the current partner Xtream streams, live segments are usually about 10 seconds long and several megabytes. If hls.js waits for the whole first segment before transmuxing, startup can look like a 4-6 second cold open even when the edge server responds quickly.

## Current Lumen Behavior

Lumen keeps live HLS on a live-specific hls.js path that matched real browser behavior:

- live HLS uses the main-thread hls.js live transmux path to avoid cold worker attach stalls seen in Chromium
- live HLS enables progressive fragment loading so playback can start before the first large `.ts` segment has fully downloaded
- live HLS seeks once to the first buffered live timestamp when progressive append starts ahead of media element time `0`
- live HLS immediately rebuilds the hls.js attachment once if Chromium reports a startup media error before playback has actually advanced
- live HLS does not prefetch fragments before playback intent is active
- live HLS keeps the proven buffer policy used by the previous player baseline
- catch-up also uses progressive fragment startup for archive playback, but recovery is still guarded until `playing` or real time progress
- live source switches stop the previous local player immediately, remount the media element with a new `loadKey`, and run one guarded startup retry if no frame is visible after the short startup window

The Xtream proxy also sets CORS headers on raw streamed media responses. This matters when the manifest is proxied correctly but segment responses go through the raw streaming path. The proxy asks upstream for identity encoding and strips decoded-body headers before returning API payloads, so browser `fetch()` does not fail on already-decoded Xtream JSON responses.

An earlier aggressive tuning attempt used progressive loading together with live fragment prefetch. It made the Network tab look active, but could leave the media element at `readyState=0` with no rendered frame. The live production path does not use fragment prefetch. It only uses progressive loading plus a one-time live timestamp correction after bytes have been appended. Catch-up uses archive-only prefetch for the first fragment, while media recovery remains disabled until the first successful playback progress signal.

Live channel selection also includes a per-click `loadKey`, and the local web player remounts the media element for each new source/loadKey. That gives every live zap a fresh hls.js MediaSource attachment instead of reusing a stale or slow-starting attachment from the previous channel.

If a live source is selected and the first attach does not produce playback progress quickly, Lumen performs one live-only hard retry after a short startup window with a full media-element flush. It does not loop and it does not create any server-side media asset.

## Verified Local Result

Real browser tests against the partner Xtream server on `2026-05-15`:

- `RTS 1`: about `2.0s` to first rendered frame in rapid browser zapping
- `HRT 1`: about `0.6s`
- `PRVA`: about `1.9s`
- `PINK`: about `1.8s`
- `OBN`: about `0.8s`
- `NOVA S`: about `1.8s`
- `BHT 1`: about `0.7s`
- `BN`: about `1.7s`

Measured with user-like browser clicks in Chromium, through the standalone local proxy.

The same test with the page-level live startup retry delayed to `3s` regressed the larger-segment channels back to roughly `3.7-4.2s`. The `1s` retry is therefore kept because it is the practical browser-side recovery that cuts slow starts nearly in half without server-side media processing.

Direct proxy probes show why some channels remain slower than native clients: manifests usually arrive in about `0.18-0.37s`, but first live `.ts` segments are several megabytes. Examples from the same run: `PRVA` first segment about `6.9 MB`, `PINK` about `5.1 MB`, `NOVA S` about `5.0 MB`, `BN` about `4.8 MB`. Progressive HLS lets the browser start before full segment download, but the browser still has to fetch, transmux, append, and decode enough of the MPEG-TS segment before a frame can render.

## CPU Notes

During local verification, Playwright-launched Chrome renderers can show near or above `100%` CPU while decoding 1080p streams. That is not a clean production signal because Playwright runs with an automation profile and flags such as software/SwiftShader rendering. The local check also confirmed there was only one `<video>` element in the Lumen page after the duplicate-playback fixes.

Normal Chrome should still be watched during manual testing. If a regular non-automation Chrome profile stays pinned at high CPU on one live stream, collect the channel name, resolution, codec, and whether Chrome hardware acceleration is enabled.

## Production Notes

Production web deploy should run with a dedicated Xtream proxy origin. If the browser falls back to direct edge segment requests, startup and CORS behavior can vary by provider edge host.

This change does not transcode or remux. If a provider wants consistently sub-second cold starts in every browser, the best server-side fix is shorter browser-safe HLS segments or LL-HLS/fMP4 packaging. The current Lumen path keeps the existing MPEG-TS HLS streams on the stable browser playback path without extra media processing.
