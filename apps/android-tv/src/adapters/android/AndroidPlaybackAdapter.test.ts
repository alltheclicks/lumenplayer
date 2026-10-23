import { afterEach, describe, expect, it, vi } from "vitest";
import type { TVLivePlaybackRequest, TVPlaybackRequest } from "@lumen/types";
import { TVPlaybackController } from "@lumen/player-core";
import { AndroidPlaybackAdapter, type AndroidPlaybackBridge, type AndroidPlaybackEvent, type ResolveLiveRequest } from "./AndroidPlaybackAdapter";

const live = (channelId = "one"): TVLivePlaybackRequest => ({
  kind: "live", sourceId: "test", channelId,
  media: { type: "hls", url: "https://example.invalid/ephemeral.m3u8" },
});
const archive = (): TVPlaybackRequest => ({ ...live(), kind: "catch-up", startTimeMs: 1_790_000_000_000, durationMs: 90_000 });
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function fixture(resolveLive?: ResolveLiveRequest) {
  const loads: ReturnType<typeof deferred<void>>[] = [];
  const subscribers = new Set<(event: AndroidPlaybackEvent) => void>();
  const bridge: AndroidPlaybackBridge = {
    load: vi.fn(() => { const work = deferred<void>(); loads.push(work); return work.promise; }),
    play: vi.fn(async () => {}), pause: vi.fn(async () => {}), seek: vi.fn(async () => {}),
    returnToLive: vi.fn(async () => {}), stop: vi.fn(async () => {}), release: vi.fn(async () => {}),
    subscribe: (listener) => { subscribers.add(listener); return () => { subscribers.delete(listener); }; },
  };
  const adapter = new AndroidPlaybackAdapter(bridge, resolveLive, 1000);
  cleanup.push(() => adapter.destroy());
  const signal = new AbortController();
  const event = (patch: Partial<AndroidPlaybackEvent> = {}) => {
    const args = vi.mocked(bridge.load).mock.calls.at(-1)!;
    for (const listener of subscribers) listener({ sessionId: adapter.sessionId, generation: args[1], state: "paused", positionMs: 0, durationMs: null, ...patch });
  };
  return { adapter, bridge, loads, signal, event, subscribers };
}
const cleanup: (() => void)[] = [];
afterEach(() => { cleanup.splice(0).forEach((fn) => fn()); vi.useRealTimers(); });

describe("Android Media3 adapter (injected platform, no media decoding)", () => {
  it("loads live and emits playing only from Media3 events, not load success", async () => {
    const f = fixture(); const request = live();
    const task = f.adapter.load(request, { signal: f.signal.signal });
    expect(f.adapter.getSnapshot().state).toBe("loading");
    f.event(); f.loads[0].resolve(); await task;
    expect(f.adapter.getSnapshot().state).toBe("paused");
    f.event({ state: "playing", positionMs: 1234 });
    expect(f.adapter.getSnapshot()).toMatchObject({ request, state: "playing", positionMs: 1234 });
    expect(f.adapter.getSnapshot().request).toBe(request);
    expect(f.bridge.load).toHaveBeenCalledWith(f.adapter.sessionId, 1, request.media.url, "hls");
  });
  it("preserves archive epoch/duration ms and forwards relative seek ms with bounds", async () => {
    const f = fixture(); const request = archive(); const task = f.adapter.load(request, { signal: f.signal.signal });
    f.event({ durationMs: 90_000, positionMs: 10_250 }); f.loads[0].resolve(); await task;
    expect(f.adapter.getSnapshot().request).toBe(request);
    await f.adapter.seek(20_123); expect(f.bridge.seek).toHaveBeenLastCalledWith(f.adapter.sessionId, 1, 20_123);
    await f.adapter.seek(100_000); expect(f.bridge.seek).toHaveBeenLastCalledWith(f.adapter.sessionId, 1, 90_000);
    await f.adapter.seek(-10); expect(f.bridge.seek).toHaveBeenLastCalledWith(f.adapter.sessionId, 1, 0);
    await expect(f.adapter.seek(NaN)).rejects.toThrow("milliseconds");
  });
  it("rejects already-aborted loads without allocating native work", async () => {
    const f = fixture(); f.signal.abort();
    await expect(f.adapter.load(live(), { signal: f.signal.signal })).rejects.toMatchObject({ name: "AbortError" });
    expect(f.bridge.load).not.toHaveBeenCalled();
  });
  it.each(["abort", "destroy"])("does not dispatch native work after reentrant %s from loading", async (action) => {
    const f = fixture();
    f.adapter.onChange((snapshot) => {
      if (snapshot.state !== "loading") return;
      if (action === "abort") f.signal.abort(); else f.adapter.destroy();
    });
    await expect(f.adapter.load(live(), { signal: f.signal.signal })).rejects.toMatchObject({ name: "AbortError" });
    expect(f.bridge.load).not.toHaveBeenCalled();
  });
  it("cancels pending native prepare and discards its late success/events", async () => {
    const f = fixture(); const task = f.adapter.load(live(), { signal: f.signal.signal });
    const check = expect(task).rejects.toMatchObject({ name: "AbortError" });
    f.signal.abort(); await check;
    f.event({ state: "playing" }); f.loads[0].resolve(); await Promise.resolve();
    expect(f.adapter.getSnapshot().state).not.toBe("playing");
    expect(f.bridge.stop).toHaveBeenCalledWith(f.adapter.sessionId, 1);
  });
  it("keeps the completed-load abort binding and stops playback after ready", async () => {
    const f = fixture(); const task = f.adapter.load(live(), { signal: f.signal.signal });
    f.loads[0].resolve(); await task; f.signal.abort(); f.event({ state: "playing" });
    expect(f.bridge.stop).toHaveBeenCalledWith(f.adapter.sessionId, 1);
    expect(f.adapter.getSnapshot().state).not.toBe("playing");
  });
  it("ignores older generations and other player sessions", async () => {
    const f = fixture(); const first = f.adapter.load(live(), { signal: f.signal.signal });
    const check = expect(first).rejects.toMatchObject({ name: "AbortError" });
    const second = f.adapter.load(live("two"), { signal: new AbortController().signal }); await check;
    f.event({ generation: 1, state: "error", errorCode: "MEDIA3_2004" });
    f.event({ sessionId: "another", state: "playing" }); f.loads[0].resolve();
    expect(f.adapter.getSnapshot().state).toBe("loading");
    f.loads[1].resolve(); await second;
    f.event({ state: "playing" }); expect(f.adapter.getSnapshot().state).toBe("playing");
  });
  it("reports redacted prepare failures and stops the failed generation", async () => {
    const f = fixture(); const task = f.adapter.load(live(), { signal: f.signal.signal });
    const check = expect(task).rejects.toThrow("Android playback operation failed");
    f.loads[0].reject(new Error("https://user:private@example.invalid/?token=secret")); await check;
    expect(JSON.stringify(f.adapter.getSnapshot().error)).not.toMatch(/private|secret|https/);
    expect(f.adapter.getSnapshot().state).toBe("error");
    expect(f.bridge.stop).toHaveBeenCalledWith(f.adapter.sessionId, 1);
  });
  it("times out prepare, clears native work and ignores late success", async () => {
    vi.useFakeTimers(); const f = fixture(); const task = f.adapter.load(live(), { signal: f.signal.signal });
    const check = expect(task).rejects.toThrow("Android playback operation failed");
    await vi.advanceTimersByTimeAsync(1001); await check; f.loads[0].resolve(); f.event({ state: "playing" });
    expect(f.adapter.getSnapshot().error?.code).toBe("MEDIA3_LOAD_TIMEOUT");
  });
  it("sanitizes event errors and invalid platform times", async () => {
    const f = fixture(); const task = f.adapter.load(live(), { signal: f.signal.signal }); f.loads[0].resolve(); await task;
    f.event({ state: "error", errorCode: "https://private/secret", positionMs: NaN, durationMs: -1 });
    expect(f.adapter.getSnapshot()).toMatchObject({ state: "error", positionMs: 0, durationMs: null, error: { code: "MEDIA3_PLAYBACK_FAILED" } });
  });
  it("forwards play/pause and retains platform background pause without auto-resume", async () => {
    const f = fixture(); const task = f.adapter.load(live(), { signal: f.signal.signal }); f.loads[0].resolve(); await task;
    await f.adapter.play(); await f.adapter.pause(); f.event({ state: "paused" });
    expect(f.bridge.play).toHaveBeenCalledTimes(1); expect(f.bridge.pause).toHaveBeenCalledTimes(1);
    expect(f.adapter.getSnapshot().state).toBe("paused");
  });
  it("returns within live using Media3's default live position", async () => {
    const f = fixture(); const task = f.adapter.load(live(), { signal: f.signal.signal }); f.loads[0].resolve(); await task;
    await f.adapter.returnToLive(); expect(f.bridge.returnToLive).toHaveBeenCalledWith(f.adapter.sessionId, 1);
  });
  it("resolves fresh live media after archive and lets shared controller adopt its request", async () => {
    const next = live(); const resolver = vi.fn(async () => next); const f = fixture(resolver);
    const controller = new TVPlaybackController(f.adapter); cleanup.push(() => controller.destroy());
    const task = controller.load(archive()); f.loads[0].resolve(); await task;
    const transition = controller.returnToLive(); await Promise.resolve();
    expect(f.bridge.load).toHaveBeenCalledTimes(2); f.loads[1].resolve(); await transition;
    expect(controller.getSnapshot().request).toBe(next);
    f.event({ state: "playing" }); expect(controller.getSnapshot().state).toBe("playing");
  });
  it("publishes failed live prepare under the controller's current archive request", async () => {
    const next = live(); const f = fixture(async () => next);
    const controller = new TVPlaybackController(f.adapter); cleanup.push(() => controller.destroy());
    const request = archive(); const task = controller.load(request); f.loads[0].resolve(); await task;
    const transition = controller.returnToLive(); const check = expect(transition).rejects.toMatchObject({ message: "Playback request failed", code: "MEDIA3_LOAD_FAILED", fatal: true });
    await Promise.resolve(); f.loads[1].reject(new Error("private provider diagnostic")); await check;
    expect(controller.getSnapshot()).toMatchObject({ request, state: "error" });
    expect(controller.getSnapshot().error?.message).not.toContain("private");
  });
  it("does not invent a live URL when no resolver is installed", async () => {
    const f = fixture(); const task = f.adapter.load(archive(), { signal: f.signal.signal }); f.loads[0].resolve(); await task;
    expect(f.adapter.getCapabilities().returnToLive).toBe(false);
    await expect(f.adapter.returnToLive()).rejects.toThrow("resolver"); expect(f.bridge.load).toHaveBeenCalledTimes(1);
  });
  it("discards delayed live resolution after a channel change", async () => {
    const resolution = deferred<TVLivePlaybackRequest>(); const f = fixture(() => resolution.promise);
    const first = f.adapter.load(archive(), { signal: f.signal.signal }); f.loads[0].resolve(); await first;
    const transition = f.adapter.returnToLive();
    const second = f.adapter.load(live("two"), { signal: new AbortController().signal });
    resolution.resolve(live()); await transition; f.loads[1].resolve(); await second;
    expect(f.bridge.load).toHaveBeenCalledTimes(2); expect(f.adapter.getSnapshot().request?.channelId).toBe("two");
  });
  it("aborts live resolution when the owning load signal is cancelled", async () => {
    const resolution = deferred<TVLivePlaybackRequest>(); let signal!: AbortSignal;
    const f = fixture((_request, value) => { signal = value; return resolution.promise; });
    const task = f.adapter.load(archive(), { signal: f.signal.signal }); f.loads[0].resolve(); await task;
    const transition = f.adapter.returnToLive(); f.signal.abort(); expect(signal.aborted).toBe(true);
    resolution.resolve(live()); await transition; expect(f.bridge.load).toHaveBeenCalledTimes(1);
  });
  it("rejects resolver channel mismatch", async () => {
    const f = fixture(async () => live("wrong")); const task = f.adapter.load(archive(), { signal: f.signal.signal });
    f.loads[0].resolve(); await task; await expect(f.adapter.returnToLive()).rejects.toThrow("different channel");
  });
  it("stops and releases idempotently and detaches listeners on destroy", async () => {
    const f = fixture(); const task = f.adapter.load(live(), { signal: f.signal.signal }); f.loads[0].resolve(); await task;
    await f.adapter.stop(); expect(f.adapter.getSnapshot().request).toBe(null);
    f.event({ state: "playing" }); expect(f.adapter.getSnapshot().state).toBe("idle");
    f.adapter.destroy(); f.adapter.destroy(); expect(f.bridge.release).toHaveBeenCalledTimes(1); expect(f.subscribers.size).toBe(0);
    await expect(f.adapter.play()).rejects.toThrow("destroyed");
  });
  it.each(["webrtc", "drm", "invalid-url", "invalid-ms"])("rejects unsupported %s without native work", async (variant) => {
    const f = fixture(); const request = archive();
    if (variant === "webrtc") request.media.type = "webrtc";
    if (variant === "drm") request.media.drm = { type: "widevine", licenseUrl: "https://example.invalid/license" };
    if (variant === "invalid-url") request.media.url = "file:///private";
    if (variant === "invalid-ms" && request.kind === "catch-up") request.durationMs = Infinity;
    await expect(f.adapter.load(request, { signal: f.signal.signal })).rejects.toThrow(); expect(f.bridge.load).not.toHaveBeenCalled();
  });
});
