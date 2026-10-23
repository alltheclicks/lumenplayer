# TV-019 — failed return-to-live propagation

Implemented on Buildara (Linux), 2026-10-23, by
`Codex/TV-019-t3-965ce0b6-sol61-medium-20261023`, branch
`t3/tv-live-error-propagation`, worktree `t3-965ce0b6`.
Initial base: `c573ce47bda6bf84f71db268f4ec45c3e95172e9`.
Owner-authorized local fast-forward merge of TV-018
`c4c8cf43857e90c98c85a766dcf72298d3f622f0` supplied the Samsung
adapter and regression fixture context. No other branch was changed.
The final fix commit is recorded in the canonical TV-019 row.

Only `packages/player-core/src/tv-playback-controller.ts`, its existing test
file and this handoff were edited. Platform adapter, UI, root files and
predecessor task statuses were not changed. Parent review/integration is pending.

## Reproduction and result

Read TV-018's narrow shared request and
`/tmp/klaro-tv018-logs/controller-probe.log`. Added a permanent shared test that
instantiates the actual `TizenTVPlaybackAdapter` with injected AVPlay callbacks:
prepare archive, seek without invoking either callback, request return to live,
then advance the 100 ms host watchdog. Before the fix the test failed with
controller `seeking/catch-up/error:null`, while the adapter had failed its live
request with `tizen_recovery_required`. Evidence:
`/tmp/klaro-tv019-logs/regression-before.log` (exit 1, 12 passed / 1 failed).

The controller now publishes `error` on the exact live request object held by
the adapter, with sanitized `tizen_recovery_required`, `fatal:true` and generic
message. The rejected command carries the same sanitized contract fields.
Late native seek completion does not overwrite that error or reopen/autoplay.
This host test uses no media, SDK or device.

## Request identity and cancellation

Adapter notifications still require the exact currently adopted request object;
matching source/channel alone never admits an event. During return-to-live the
new request's events remain filtered. Only settlement of the current command
can adopt its adapter snapshot.

Failure settlement checks load generation, destruction, the retained generation
signal, and a separate return-to-live operation counter. An older overlapping
transition cannot overwrite a newer transition. Cancelled/replaced/destroyed
operations and AbortError settle without publishing or rethrowing a stale
failure, consistently with load cancellation.

For failure snapshot adoption, the adapter must echo the original request object
or expose a live successor to the original catch-up request with the same source
and channel. A different source/channel, or an archive clone, cannot supply the
request or error snapshot. If the adapter has no attributable error snapshot,
the current controller request is retained and the rejection is sanitized.
This uses the existing adapter command/snapshot contract; it does not introduce
request IDs or loosen asynchronous event filtering. Successful command snapshot
adoption retains the existing contract behavior, now with the operation guard.

The caller's load signal forwarding lifetime is unchanged: forwarding detaches
when load settles; the internal generation signal remains until replacement or
teardown. Cancellation tests abort while the owning load is still pending.
No new cancellation API is introduced.

## Error contract

Both load and return-to-live now reject with a fresh Error containing only the
sanitized PlaybackError fields. Load prefers an error snapshot only when it
echoes the exact request being loaded; otherwise it sanitizes the rejection.
This narrowly preserves code/fatal/status when an adapter publishes a structured
error but rejects with a plain native Error. Native message, cause, stack and
extra properties are never copied. Code must match the existing bounded token
format, fatal must be boolean (otherwise true), and optional HTTP status must
be an integer from 100 through 599. Messages remain `Playback request failed`.

Tests cover real missing-seek-callback recovery, successful adoption and later
identity filtering, failed transition with/without adapter error, structured
load rejection, unrelated source/channel/archive snapshots, replacement,
cancellation and destruction for both late success and late failure, AbortError,
older overlapping transition failure, and malformed/native secret fields.

## Validation

Home filesystem had 23 GiB available before dependency installation.
`pnpm install --frozen-lockfile --offline` exited 0, reused the package store
without copying another worktree's node_modules, and changed no tracked manifests
or lockfiles. Full logs remain local under `/tmp/klaro-tv019-logs/`.

| Check | Result | Log |
|---|---|---|
| Permanent regression before fix | Expected exit 1; stale archive snapshot reproduced | `regression-before.log` |
| First host unit suite | Exit 0; 74 files / 683 tests | `unit.log` |
| First root typecheck | Exit 2; new test helper returned union rather than live subtype; fixed | `typecheck.log` |
| Final root typecheck | Exit 0; 13 tasks | `typecheck-final.log` |
| Root lint | Exit 0; 13 tasks | `lint.log` |
| Final player-core lint | Exit 0 | `player-lint-final.log` |
| Final host unit suite | Exit 0; 74 files / 686 tests (27 controller tests) | `unit-final.log` |
| TV web consumer tests | Exit 0; 49 Vitest tests (35 Tizen) + 2 Node focus tests | `tv-web-test.log` |
| Android TV consumer tests | Exit 0; 2 files / 5 tests | `android-test.log` |
| Scoped whitespace check | Exit 0 | `diff-check.log` |

No device/emulator run, real media, credentials, SDK operations, deployment,
publication or push. No claim of actual Samsung recovery or playback acceptance.
The TV-018 application-restart boundary and TV-013/device gates remain unchanged.
