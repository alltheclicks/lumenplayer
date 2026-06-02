# Catch-up Web Capability Preflight Design

## Problem

Some provider catch-up archives are advertised through Xtream but cannot be decoded by browser playback because the archived transport stream contains unsupported codecs or broken signal structure. The old web behavior tried normal catch-up resolution and playback first, which could leave users watching a spinner or a generic playback error.

## Decision

Add a lightweight web-side capability layer around catch-up URL resolution. The layer keeps provider archive evidence but does not pre-block advertised catch-up streams from stale samples. Unknown, risky, and previously bad channels continue to the existing playback path; provider evidence is used for a clear overlay only after the current runtime playback attempt fails.

Blocked catch-up attempts must still switch the session into catch-up context. For non-advertised catch-up, the player receives a non-network `lumen://catchup-unavailable/...` source. For advertised catch-up with provider codec evidence, the player receives the normal source plus `catchUpWebProviderIssue` metadata and renders the same clear overlay only if playback fails.

## Scope

In scope:

- Provider matrix for active catch-up stream IDs with prior browser-incompatible evidence.
- A blocked catch-up `SessionSource` with `catchUpUnavailable` metadata.
- Runtime provider-issue metadata on normal catch-up sources.
- A player-surface overlay for non-advertised catch-up and runtime-confirmed provider issues.
- Documentation for the matrix, behavior, and maintenance rule.

Out of scope:

- Server-side transcode.
- Server-side remux.
- Cold HLS/fMP4 build.
- Claiming a channel is guaranteed playable before a real browser decode.

## Data Flow

1. User selects a catch-up program.
2. `resolveCatchUpPlaybackSource` checks `resolveCatchUpWebCapability(channel)`.
3. If catch-up is not advertised, the function returns a blocked catch-up source with `catchUpUnavailable` metadata.
4. If the stream ID has prior provider issue evidence, the function resolves a normal playback source and attaches `catchUpWebProviderIssue` metadata.
5. UI logs `catchup.requested`, calls `commands.setSource(...)`, and enters the selected catch-up context.
6. `VideoPlayer` maps `catchUpUnavailable` to an immediate overlay, or maps `catchUpWebProviderIssue` to the overlay after runtime playback failure or a catch-up startup timeout without usable media.
7. The existing catch-up resolve and playback flow continues for unknown/risky/provider-issue channels until playback itself fails.

## Compatibility Semantics

- `unsupported`: hard stop only for non-advertised catch-up.
- `unknown`: no hard stop. Used when the stream ID is not in the matrix, has only risk evidence, or has stale provider issue evidence that must be verified by runtime playback.
- `playable`: reserved for a future raw/no-build edge probe. The static matrix deliberately avoids promising success.

## User Experience

The message must be over the player surface, immediate, and explicit:

`TV unazad trenutno nije dostupna u web playeru`

The description names the channel, says this affects only TV unazad in the web player, and explains in plain language that the provider's recorded stream is currently not in a browser-safe format. It must also say it is not the user's device and not Lumen player. The overlay includes a primary action to watch the same channel live.

Runtime timeout rule: if a provider-evidence catch-up source never reaches usable media in the startup window, the player shows the provider-issue overlay instead of waiting for a long upstream 503/timeout. Unknown catch-up sources use the existing fallback plan first.

## Testing

Unit tests cover:

- Known HRT 1 stream 75 provider issue evidence does not block before playback.
- User-facing notice text is deterministic.
- Overlay action label returns the user to the same channel live.
- Unknown stream IDs do not block.
- Risk streams do not block.
- Catch-up source resolution returns a normal source with provider evidence before runtime failure.
- Blocked and runtime provider-issue metadata map to the player overlay error.

## Operations

The matrix is valid for the provider snapshot observed on 2026-05-13. If ingest/source settings change, rerun the archive probe and update code plus `docs/catchup-web-capability-preflight.md` together.
