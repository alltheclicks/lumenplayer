# TV-018 — bounded Samsung seek failure

Implemented on Buildara (Linux), 2026-10-23, session
`Codex/TV-018-t3-7c8c9423-20261023`, isolated branch
`t3/tizen-seek-recovery`, worktree `t3-7c8c9423`.
Initial HEAD: `c573ce47bda6bf84f71db268f4ec45c3e95172e9`.
Reviewed TV-006 artifact `0bdb27aacf063b4a3e7e57b9fc06998a4393fc20`
was merged into this branch by fast-forward before implementation.
Final commit/evidence hashes are recorded in the canonical TV-018 registry row.

Only the Tizen adapter directory, `TV-006-samsung.md` and this document are
reserved. No shared/controller/composition/root edits, subagents, SDK/global
mutation, devices, push or deployment. TV-006 status is not changed by this task.
The shell remains unwired/unavailable. Parent integration and review are pending.

## Behavior and deadlines

`operationTimeoutMs` defaults to 30,000 ms and must be finite/positive. Each
public pending stage starts its deadline before enqueueing native work:
load (including queue wait and preparation), play, pause, seek, stop and live
resolution. `returnToLive()` has at most three bounded stages: resolution,
load, play (at most 3 × operationTimeoutMs). The separate native preparation
watchdog (`prepareTimeoutMs`, default 30,000 ms) remains; whichever deadline
fires first applies. A preparation deadline is `tizen_prepare_timeout`; an
otherwise stalled resolver/command is `tizen_operation_timeout`.
Timers bound asynchronous waits when the JS event loop runs; they cannot
preempt a synchronous native method or a blocked/suspended application thread.

A native seek additionally starts an independent watchdog. Caller abort,
replacement, stop or destroy cannot cancel that watchdog while native seek is
unresolved. A public deadline observing an outstanding native seek, or the
native watchdog itself, permanently latches **`tizen_recovery_required`**:

- All still-pending public stages reject with fixed code/message/fatal fields;
  the active session is invalidated and its resolver signal aborted.
- The adapter emits an error snapshot unless already destroyed. No provider
  URL, native exception text or other private detail enters the error.
- Future load/seek calls throw promptly; async play/pause/return-to-live and
  stop reject promptly. They add no native work to the blocked queue.
- Normal caller/session cancellation still rejects immediately with AbortError.
  The independent watchdog can subsequently report recovery-required even if
  the original seek promise has already been cancelled.
- The native queue remains locked. Timeout makes **no** AVPlay calls, including
  getState/getCurrentTime, stop, close, open, suspend or restore.

Normal serialized seeks still wait for their real callback, then read the
position, update state and permit subsequent native commands. A late success
or error after timeout only unlocks the queue for deferred best-effort cleanup.
Retired queued sessions cannot open or autoplay; late listeners/prepare/seek
callbacks cannot revive their state. Duplicate seek callbacks are ignored.
Successful late cleanup does not clear the recovery latch or authorize retry.

## Teardown and lifecycle recovery boundary

`stop()` cancels session work immediately but waits a bounded time for native
cleanup; unresolved seek yields recovery-required rather than an endless wait.
`destroy()` remains synchronous/idempotent, immediately rejects all public work
(including a queued stop), removes subscribers and resets its local snapshot.
It does **not** promise native cleanup completion. After a real late callback,
queued cleanup removes listeners, attempts stop in valid states and close.
Without a callback there is deliberately no native cleanup attempt at all.
The native plane/resource could remain active; this is not a successful stop.

No in-process recovery from a permanently missing seek callback is established.
The supported integration boundary is **full application termination/relaunch**
before creating another owner of that AVPlay singleton. A new adapter/controller,
visibility toggle or foreground transition inside the existing lifecycle is
not recovery. Even a late callback followed by close does not reset this adapter.
Actual native reset behavior on the target TV remains a device gate; this task
neither invokes lifecycle APIs nor promises that restart will repair firmware.

## Official documentation and inference

Samsung's live [AVPlay API reference](https://developer.samsung.com/smarttv/develop/api-references/samsung-product-api-references/avplay-api.html#AVPlayManager-seekTo)
was rechecked on 2026-10-23 (Firecrawl snapshot:
`/tmp/klaro-tv018-logs/.firecrawl/avplay.md`, seekTo constraint around line 1269).
It requires one of the seek callbacks before other API calls. No documented
missing-callback cancellation/reset exception is established by that section.
Keeping the native lock follows this constraint. The fail-closed latch and full
app lifecycle boundary are our conservative integration policy, not a Samsung
promise of engine recovery or an observed device result.

## Narrow shared-controller request to parent (not implemented)

`packages/player-core/src/tv-playback-controller.ts` propagates the active seek
error snapshot and preserves the recovery code in a subsequent load's snapshot;
these cases pass permanent adapter integration tests. However, the existing
`returnToLive()` awaits the adapter without a failure handler and only adopts
its new request on success. The controller's identity filter discards the new
live request's loading/error snapshots during the transition.

Reproduction: prepare archive, start a seek with no callback, request return to
live with a matching resolver, advance the 100 ms test deadline. The seek is
cancelled on live replacement and returnToLive rejects recovery-required.
The probe produced:

```json
{"adapter":{"state":"error","kind":"live","code":"tizen_recovery_required"},"controller":{"state":"seeking","kind":"catch-up"}}
```

Evidence: `/tmp/klaro-tv018-logs/controller-probe.log`; the temporary probe was
removed after recording the result, avoiding a permanent test that endorses
the shared defect. Parent should add a generation-guarded failure handler for
returnToLive, redact and publish the failed transition's error, preserve request
identity filtering for stale generations, and add a shared regression test.
Also consider preserving sanitized code/fatal fields in `load()`'s thrown error:
its snapshot retains them, but it currently rethrows a plain Error(message).
Until fixed, callers must handle the returnToLive rejection explicitly; the
controller snapshot alone may still display the stale archive state.

## Validation

Actual home filesystem had about 24 GB free before local frozen offline install.
`pnpm install --frozen-lockfile --offline` exited 0 with no tracked dependency
changes. Logs are under `/tmp/klaro-tv018-logs/`.

| Command | Exit | Evidence |
|---|---|---|
| `pnpm --filter @lumen/tv-web test` | 0 | `test-final.log`: 35 Tizen + 14 existing Vitest tests, 2 Node focus tests |
| `pnpm --filter @lumen/tv-web typecheck` | 0 | `typecheck-final.log` |
| `pnpm --filter @lumen/tv-web lint` | 0 | `lint-final.log` |
| `pnpm --filter @lumen/tv-web exec vite build --config src/adapters/tizen/vite.adapter.config.ts --outDir /tmp/klaro-tv018-logs/adapter-build` | 0 | `adapter-build-final.log`, Chrome 63 target |
| `node apps/tv-web/scripts/check-tv-compat.mjs /tmp/klaro-tv018-logs/adapter-build` | 0 | `adapter-compat-final.log` |
| `pnpm --filter @lumen/tv-web build:tizen` | 0 | `shell-build-final.log`, unwired shell and syntax check |
| `git diff --check` | 0 | Scoped source/docs check before commit |

Ten added tests cover absent seek callback; queued play/pause/seek; replacement
load's queue wait; immediate future failures; late success/error and duplicate
callbacks; stop timeout; destroy settling load/stop; caller abort retaining the
native watchdog; normal serialized seeks; stalled live resolver; active-seek
and subsequent-load controller error snapshots. Assertions count all injected
native methods, including getters, to forbid native calls while seek is pending.
Standalone adapter bundle SHA-256:
`95ef6683fb9b8645d7fdc706ed967134b633de33fd4842e6cecc03555854c079`.

No actual device/emulator, media decoding, source access, signing, packaging,
installation or observed playback/restart recovery is claimed. TV-013/TV-009
remain separate gates. This is a local review artifact, not release acceptance.
