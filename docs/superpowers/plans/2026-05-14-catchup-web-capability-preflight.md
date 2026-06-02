# Catch-up Web Capability Preflight Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep advertised catch-up channels in the real playback path, but stop endless browser waits and show a clear player-surface message once the current attempt proves web playback is not viable.

**Architecture:** Add a small web capability module with a provider archive matrix, call it at the start of catch-up source resolution, hard-block only channels where catch-up is not advertised, attach provider issue evidence to normal catch-up sources, and let `VideoPlayer` render the blocking overlay after runtime failure or startup timeout. Unknown and risk channels continue through the existing playback path.

**Tech Stack:** React, TypeScript, Vitest, existing Lumen session/catch-up modules.

---

### Task 1: Capability Matrix and Tests

**Files:**
- Create: `apps/web/src/components/player/catchupCapability.ts`
- Create: `apps/web/src/components/player/catchupCapability.test.ts`

- [x] **Step 1: Write failing tests**

Cover confirmed unsupported stream 75, unknown stream 99999, risk stream 165, and deterministic user notice text.

- [x] **Step 2: Verify RED**

Run:

```bash
pnpm vitest run apps/web/src/components/player/catchupCapability.test.ts apps/web/src/components/player/catchupSource.test.ts
```

Expected before implementation: fail with missing `./catchupCapability`.

- [x] **Step 3: Implement minimal capability module**

Create:

- `resolveCatchUpWebCapability(channel)`
- `assertCatchUpWebPlayable(channel)`
- `CatchUpWebCapabilityError`
- `isCatchUpWebCapabilityError(error)`
- `getCatchUpWebCapabilityNotice(errorOrCapability)`

- [x] **Step 4: Verify GREEN**

Run the same Vitest command and confirm the new tests pass.

### Task 2: Resolve Flow Integration

**Files:**
- Modify: `apps/web/src/components/player/catchupSource.ts`
- Test: `apps/web/src/components/player/catchupSource.test.ts`

- [x] **Step 1: Add failing test**

Verify an unsupported channel rejects with `CatchUpWebCapabilityError` and does not call `fetchImpl`.

- [x] **Step 2: Implement source gate**

Call `assertCatchUpWebPlayable(channel)` before timestamp alignment, gateway resolution, shadow validation, or source construction.

- [x] **Step 3: Verify targeted tests**

Run:

```bash
pnpm vitest run apps/web/src/components/player/catchupCapability.test.ts apps/web/src/components/player/catchupSource.test.ts
```

Expected: all targeted tests pass.

### Task 3: User-Facing Fail-Fast Message

**Files:**
- Modify: `apps/web/src/pages/Player.tsx`
- Modify: `apps/web/src/components/player/PlayerControls.tsx`

- [x] **Step 1: Handle typed capability error in `Player.tsx`**

When `playCatchUpProgram` catches `CatchUpWebCapabilityError`, show:

```ts
toast({
  ...getCatchUpWebCapabilityNotice(error),
  variant: 'destructive',
});
```

- [x] **Step 2: Handle typed capability error in `PlayerControls.tsx`**

Use the same notice for live-bar catch-up/timeshift attempts.

- [x] **Step 3: Keep observability intact**

Existing `playback.error` events remain emitted with `status: 'catchup_resolve_failed'`.

### Task 4: Documentation and Verification

**Files:**
- Create: `docs/catchup-web-capability-preflight.md`
- Create: `docs/superpowers/specs/2026-05-14-catchup-web-capability-preflight-design.md`
- Create: `docs/superpowers/plans/2026-05-14-catchup-web-capability-preflight.md`

- [x] **Step 1: Document behavior and matrix**

Record unsupported streams, risk streams, no-remux/no-transcode policy, and update rules.

- [x] **Step 2: Run focused tests**

```bash
pnpm vitest run apps/web/src/components/player/catchupCapability.test.ts apps/web/src/components/player/catchupSource.test.ts
```

- [x] **Step 3: Run typecheck**

```bash
pnpm --filter @lumen/web typecheck
```

- [x] **Step 4: Run lint**

```bash
pnpm --filter @lumen/web lint
```

### Task 5: Player-Surface Blocking Overlay

**Files:**
- Modify: `apps/web/src/components/player/catchupSource.ts`
- Modify: `apps/web/src/components/player/VideoPlayer.tsx`
- Modify: `apps/web/src/components/player/catchupTransport.ts`
- Create: `apps/web/src/components/player/sourceBlockingError.ts`
- Test: `apps/web/src/components/player/catchupSource.test.ts`
- Create: `apps/web/src/components/player/sourceBlockingError.test.ts`

- [x] **Step 1: Verify RED**

Run:

```bash
pnpm vitest run apps/web/src/components/player/catchupSource.test.ts apps/web/src/components/player/sourceBlockingError.test.ts
```

Expected before implementation: fail because unsupported catch-up still throws before source switch and `sourceBlockingError` does not exist.

- [x] **Step 2: Return blocked catch-up source for non-advertised catch-up**

For channels where catch-up is not advertised, return `lumen://catchup-unavailable/...` with `catchUpUnavailable` metadata and an empty fallback plan. Provider codec evidence is not a pre-block after Task 6.

- [x] **Step 3: Render blocking overlay**

Map `source.metadata.catchUpUnavailable` to the existing `VideoPlayer` error overlay and skip load, seek, and play for blocked sources.

- [x] **Step 4: Add live fallback action**

Use plain-language copy that tells the user the issue is provider recording format, not their device or Lumen. Add a button on the overlay that switches back to the same channel live through the existing live-channel selection path.

### Task 6: Runtime Verification Instead of Stale Pre-Block

**Files:**
- Modify: `apps/web/src/components/player/catchupCapability.ts`
- Modify: `apps/web/src/components/player/catchupSource.ts`
- Modify: `apps/web/src/components/player/sourceBlockingError.ts`
- Modify: `apps/web/src/components/player/VideoPlayer.tsx`
- Modify: `apps/web/src/components/player/videoPlaybackSync.ts`
- Modify: `apps/web/src/pages/Player.tsx`

- [x] **Step 1: Stop pre-blocking previously bad provider samples**

Treat matrix entries as provider evidence, not as a hard stop, so HRT 1 and similar streams get a current playback attempt.

- [x] **Step 2: Show provider issue overlay after runtime failure**

Attach `catchUpWebProviderIssue` metadata to normal catch-up sources and map fatal runtime playback failures to the clear TV unazad web-player message.

- [x] **Step 3: Reduce live zap self-restarts**

Disable live-source hard reload retry based only on `currentTime`, because live HLS startup can be valid while `currentTime` is still not moving.

- [x] **Step 4: Add catch-up startup watchdog**

If a provider-evidence catch-up source never reaches usable media during startup, show the same clear overlay and live-channel action instead of waiting for the upstream request to time out.
