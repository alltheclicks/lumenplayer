import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  TVLivePlaybackRequest,
  TVPlaybackAdapter,
  TVPlaybackCapabilities,
  TVPlaybackRequest,
  TVPlaybackSnapshot,
} from "@lumen/types";
import {
  TVPlaybackController,
  UnsupportedPlaybackCapabilityError,
  clampSeekPositionMs,
  millisecondsToPlayerSeconds,
  playerSecondsToMilliseconds,
} from "./tv-playback-controller";
import { TizenTVPlaybackAdapter } from "../../../apps/tv-web/src/adapters/tizen/TizenTVPlaybackAdapter";
import type { AVPlay } from "../../../apps/tv-web/src/adapters/tizen/avplay";
import { TV_CATALOG_FIXTURE } from "./tv-contract.fixture";

const liveRequest = (channelId: string): TVLivePlaybackRequest => ({
  kind: "live",
  sourceId: "demo-source",
  channelId,
  media: { type: "hls", url: `https://media.example.invalid/${channelId}.m3u8` },
});

const catchUpRequest: TVPlaybackRequest = {
  kind: "catch-up",
  sourceId: "demo-source",
  channelId: "channel-a",
  media: { type: "hls", url: "https://media.example.invalid/archive.m3u8" },
  startTimeMs: 1_797_120_000_000,
  durationMs: 3_600_000,
};

const fullCapabilities: TVPlaybackCapabilities = {
  live: true,
  catchUp: true,
  seek: true,
  returnToLive: true,
  mediaTypes: ["hls"],
};

class FakeAdapter implements TVPlaybackAdapter {
  capabilities = fullCapabilities;
  snapshot: TVPlaybackSnapshot = {
    request: null,
    state: "idle",
    positionMs: 0,
    durationMs: null,
    error: null,
  };
  listeners = new Set<(snapshot: TVPlaybackSnapshot) => void>();
  loads: Array<{ request: TVPlaybackRequest; signal: AbortSignal }> = [];
  seek = vi.fn(async (positionMs: number) => { this.snapshot = { ...this.snapshot, positionMs }; });
  play = vi.fn();
  pause = vi.fn();
  returnToLive = vi.fn();
  stop = vi.fn();
  destroy = vi.fn();

  getCapabilities(): TVPlaybackCapabilities { return this.capabilities; }
  async load(request: TVPlaybackRequest, { signal }: { signal: AbortSignal }): Promise<void> {
    this.loads.push({ request, signal });
    this.snapshot = {
      request,
      state: "playing",
      positionMs: 0,
      durationMs: request.kind === "catch-up" ? request.durationMs : null,
      error: null,
    };
  }
  getSnapshot(): TVPlaybackSnapshot { return this.snapshot; }
  onChange(callback: (snapshot: TVPlaybackSnapshot) => void): () => void {
    this.listeners.add(callback);
    return () => this.listeners.delete(callback);
  }
  emit(snapshot: TVPlaybackSnapshot): void {
    this.snapshot = snapshot;
    this.listeners.forEach((listener) => listener(snapshot));
  }
}

const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
};

describe("TVPlaybackController", () => {
  const controllers: TVPlaybackController[] = [];
  afterEach(() => controllers.splice(0).forEach((controller) => controller.destroy()));

  const createController = (adapter = new FakeAdapter()) => {
    const controller = new TVPlaybackController(adapter);
    controllers.push(controller);
    return { adapter, controller };
  };

  it("ships a versioned, credential-free source/catalog/EPG fixture in epoch milliseconds", () => {
    const program = TV_CATALOG_FIXTURE.epg[0]!;
    expect(TV_CATALOG_FIXTURE.version).toBe(1);
    expect(TV_CATALOG_FIXTURE.channels[0]?.source).toBe("m3u");
    expect(program.endTimeMs - program.startTimeMs).toBe(3_600_000);
    expect(JSON.stringify(TV_CATALOG_FIXTURE)).not.toMatch(/password|username|https?:\/\//i);
  });

  it("keeps the new channel when an older A load resolves late after switching to B", async () => {
    const adapter = new FakeAdapter();
    const a = deferred<void>();
    adapter.load = vi.fn((request, { signal }) => {
      adapter.loads.push({ request, signal });
      return request.channelId === "A" ? a.promise : Promise.resolve();
    });
    const { controller } = createController(adapter);

    const loadA = controller.load(liveRequest("A"));
    const loadB = controller.load(liveRequest("B"));
    await loadB;
    a.resolve();
    await loadA;

    expect(adapter.loads[0]?.signal.aborted).toBe(true);
    expect(controller.getSnapshot().request?.channelId).toBe("B");
  });

  it("treats caller abort as cancellation and redacts genuine playback failures", async () => {
    const adapter = new FakeAdapter();
    const a = deferred<void>();
    adapter.load = vi.fn((request, { signal }) => {
      adapter.loads.push({ request, signal });
      if (request.channelId === "A") return a.promise;
      if (request.channelId === "B") return Promise.resolve();
      throw new Error("https://provider.invalid/?password=secret");
    });
    const { controller } = createController(adapter);
    const stale = controller.load(liveRequest("A"));
    await controller.load(liveRequest("B"));
    a.reject(new Error("failed https://provider.invalid/live?username=secret&password=secret"));
    await expect(stale).resolves.toBeUndefined();
    expect(controller.getSnapshot().error).toBeNull();

    await expect(controller.load(liveRequest("C"))).rejects.toThrow("Playback request failed");
    expect(controller.getSnapshot().error).toEqual({
      code: "playback_failed",
      message: "Playback request failed",
      fatal: true,
    });
    expect(JSON.stringify(controller.getSnapshot())).not.toContain("secret");
  });

  it("forwards caller-owned abort signals without recording an error", async () => {
    const adapter = new FakeAdapter();
    const waiting = deferred<void>();
    adapter.load = vi.fn((_request, { signal }) => {
      adapter.loads.push({ request: _request, signal });
      return waiting.promise;
    });
    const { controller } = createController(adapter);
    const caller = new AbortController();
    const pending = controller.load(liveRequest("A"), { signal: caller.signal });
    caller.abort();
    expect(adapter.loads[0]?.signal.aborted).toBe(true);
    waiting.reject(new DOMException("Aborted", "AbortError"));
    await expect(pending).resolves.toBeUndefined();
    expect(controller.getSnapshot().error).toBeNull();
  });

  it("clamps seek in milliseconds and rejects a non-finite time", async () => {
    const { adapter, controller } = createController();
    await controller.load(catchUpRequest);
    expect(await controller.seek(3_900_000)).toBe(3_600_000);
    expect(adapter.seek).toHaveBeenCalledWith(3_600_000);
    expect(await controller.seek(-500)).toBe(0);
    await expect(controller.seek(Number.NaN)).rejects.toThrow("finite milliseconds");
    expect(playerSecondsToMilliseconds(12.345)).toBe(12_345);
    expect(millisecondsToPlayerSeconds(12_345)).toBe(12.345);
    expect(clampSeekPositionMs(-1, null)).toBe(0);
    expect(clampSeekPositionMs(5_000, 4_000)).toBe(4_000);
  });

  it("ignores a late successful load and events after caller cancellation", async () => {
    const adapter = new FakeAdapter();
    const waiting = deferred<void>();
    adapter.load = vi.fn(async (request) => {
      await waiting.promise;
      adapter.emit({ ...adapter.snapshot, request, state: "playing" });
    });
    const { controller } = createController(adapter);
    const caller = new AbortController();
    const pending = controller.load(liveRequest("A"), { signal: caller.signal });
    caller.abort();
    const cancelledSnapshot = controller.getSnapshot();
    waiting.resolve();
    await pending;
    expect(controller.getSnapshot()).toBe(cancelledSnapshot);
  });

  it("aborts the previous adapter generation even after its load has completed", async () => {
    const { adapter, controller } = createController();
    await controller.load(liveRequest("A"));
    const previousSignal = adapter.loads[0]!.signal;
    await controller.load(liveRequest("B"));
    expect(previousSignal.aborted).toBe(true);
  });

  it("adopts the live request returned by the adapter and accepts its later events", async () => {
    const adapter = new FakeAdapter();
    const live = liveRequest("channel-a");
    adapter.returnToLive = vi.fn(() => {
      adapter.emit({ ...adapter.snapshot, request: live, durationMs: null, state: "playing" });
    });
    const { controller } = createController(adapter);
    await controller.load(catchUpRequest);
    await controller.returnToLive();
    expect(controller.getSnapshot().request).toBe(live);
    adapter.emit({ ...adapter.snapshot, positionMs: 5000 });
    expect(controller.getSnapshot().positionMs).toBe(5000);
    const current = controller.getSnapshot();
    adapter.emit({ ...current, request: { ...live }, state: "error",
      error: { code: "stale_clone", fatal: true, message: "private" } });
    adapter.emit({ ...current, request: catchUpRequest, state: "error" });
    expect(controller.getSnapshot()).toBe(current);
  });

  it("ignores a return-to-live completion after a newer channel load", async () => {
    const adapter = new FakeAdapter();
    const waiting = deferred<void>();
    adapter.returnToLive = vi.fn(() => waiting.promise);
    const { controller } = createController(adapter);
    await controller.load(catchUpRequest);
    const returning = controller.returnToLive();
    const next = liveRequest("B");
    await controller.load(next);
    adapter.snapshot = { ...adapter.snapshot, request: liveRequest("channel-a") };
    waiting.resolve();
    await returning;
    expect(controller.getSnapshot().request).toBe(next);
  });

  it("sanitizes transition rejection without an adapter error snapshot", async () => {
    const { adapter, controller } = createController();
    await controller.load(catchUpRequest);
    adapter.returnToLive.mockRejectedValue(new Error("https://private.invalid/?password=secret"));
    await expect(controller.returnToLive()).rejects.toMatchObject({
      code: "playback_failed", fatal: true, message: "Playback request failed",
    });
    expect(controller.getSnapshot()).toMatchObject({ request: catchUpRequest, state: "error" });
    expect(JSON.stringify(controller.getSnapshot().error)).not.toContain("secret");
  });

  it("preserves sanitized adapter code/fatal/status on failed live transition and load", async () => {
    const { adapter, controller } = createController();
    await controller.load(catchUpRequest);
    const live = liveRequest("channel-a");
    const native = { code: "provider_unavailable", fatal: false, httpStatus: 503,
      message: "https://private.invalid/secret", nativeToken: "secret" };
    adapter.returnToLive.mockImplementation(async () => {
      adapter.emit({ ...adapter.snapshot, request: live, state: "error", error: native });
      throw new Error("native secret");
    });
    const safe = { code: "provider_unavailable", fatal: false, httpStatus: 503,
      message: "Playback request failed" };
    await expect(controller.returnToLive()).rejects.toMatchObject(safe);
    expect(controller.getSnapshot().request).toBe(live);
    expect(controller.getSnapshot().error).toEqual(safe);
    adapter.emit({ ...adapter.snapshot, request: catchUpRequest, state: "seeking", error: null });
    expect(controller.getSnapshot().request).toBe(live);
    adapter.load = vi.fn(async (request) => {
      adapter.emit({ ...adapter.snapshot, request, state: "error", error: native });
      throw new Error("native secret");
    });
    await expect(controller.load(liveRequest("B"))).rejects.toMatchObject(safe);
    expect(controller.getSnapshot().error).toEqual(safe);
  });

  it.each(["source", "channel", "archive-clone"])("rejects unrelated %s snapshot and events during transition", async (kind) => {
    const { adapter, controller } = createController();
    await controller.load(catchUpRequest);
    const unrelated: TVPlaybackRequest = kind === "archive-clone" ? { ...catchUpRequest }
      : { ...liveRequest(kind === "channel" ? "B" : "channel-a"),
        sourceId: kind === "source" ? "other" : catchUpRequest.sourceId };
    adapter.returnToLive.mockImplementation(async () => {
      adapter.emit({ ...adapter.snapshot, request: unrelated, state: "error",
        error: { code: "unrelated_failure", fatal: true, message: "private" } });
      expect(controller.getSnapshot().request).toBe(catchUpRequest);
      expect(controller.getSnapshot().state).toBe("playing");
      throw new Error("private token");
    });
    await expect(controller.returnToLive()).rejects.toMatchObject({ code: "playback_failed" });
    expect(controller.getSnapshot().request).toBe(catchUpRequest);
    expect(controller.getSnapshot().error?.code).toBe("playback_failed");
  });

  it.each([
    ["replacement", "failure"], ["destroy", "failure"], ["cancellation", "failure"],
    ["replacement", "success"], ["destroy", "success"], ["cancellation", "success"],
  ])("ignores late transition %s / %s", async (action, outcome) => {
    const { adapter, controller } = createController();
    const caller = new AbortController();
    const loading = deferred<void>();
    if (action === "cancellation") adapter.load = vi.fn(() => loading.promise);
    const load = controller.load(catchUpRequest, { signal: caller.signal });
    if (action !== "cancellation") await load;
    const waiting = deferred<void>();
    adapter.returnToLive.mockImplementation(() => waiting.promise);
    const returning = controller.returnToLive();
    if (action === "replacement") await controller.load(liveRequest("B"));
    if (action === "destroy") controller.destroy();
    if (action === "cancellation") caller.abort();
    const snapshot = controller.getSnapshot();
    const listener = vi.fn(); controller.onChange(listener);
    adapter.emit({ ...adapter.snapshot, request: liveRequest("channel-a"), state: "error",
      error: { code: "stale_failure", fatal: true, message: "private" } });
    if (outcome === "failure") waiting.reject(new Error("private late failure"));
    else waiting.resolve();
    await expect(returning).resolves.toBeUndefined();
    loading.resolve(); await load;
    expect(controller.getSnapshot()).toBe(snapshot);
    expect(listener).not.toHaveBeenCalled();
  });

  it("ignores AbortError without publishing a playback failure", async () => {
    const { adapter, controller } = createController();
    await controller.load(catchUpRequest);
    const snapshot = controller.getSnapshot();
    adapter.returnToLive.mockRejectedValue(new DOMException("private", "AbortError"));
    await expect(controller.returnToLive()).resolves.toBeUndefined();
    expect(controller.getSnapshot()).toBe(snapshot);
  });

  it("ignores an older transition failure after a newer transition succeeds", async () => {
    const { adapter, controller } = createController();
    await controller.load(catchUpRequest);
    const waiting = deferred<void>();
    const live = liveRequest("channel-a");
    adapter.returnToLive.mockImplementationOnce(() => waiting.promise).mockImplementationOnce(async () => {
      adapter.emit({ ...adapter.snapshot, request: live, state: "playing" });
    });
    const old = controller.returnToLive();
    await controller.returnToLive();
    const snapshot = controller.getSnapshot();
    waiting.reject(new Error("private stale failure")); await old;
    expect(controller.getSnapshot()).toBe(snapshot);
    expect(snapshot.request).toBe(live);
  });

  it("does not expose malformed native error fields", async () => {
    const { adapter, controller } = createController();
    adapter.returnToLive.mockRejectedValue({ code: "https://private.invalid/secret", fatal: "secret",
      httpStatus: Infinity, message: "secret", stack: "secret", nativeToken: "secret" });
    const rejected = controller.returnToLive().catch((error: unknown) => error);
    expect(await rejected).toMatchObject({ code: "playback_failed", fatal: true,
      message: "Playback request failed" });
    expect(JSON.stringify(await rejected)).not.toContain("secret");
    expect(controller.getSnapshot().error).toEqual({ code: "playback_failed", fatal: true,
      message: "Playback request failed" });
  });

  it("rejects unavailable capabilities before loading", async () => {
    const adapter = new FakeAdapter();
    adapter.capabilities = { ...fullCapabilities, catchUp: false };
    const { controller } = createController(adapter);
    await expect(controller.load(catchUpRequest)).rejects.toBeInstanceOf(UnsupportedPlaybackCapabilityError);
    expect(adapter.loads).toHaveLength(0);
    adapter.capabilities = { ...fullCapabilities, seek: false };
    await expect(controller.seek(1000)).rejects.toBeInstanceOf(UnsupportedPlaybackCapabilityError);
    adapter.capabilities = { ...fullCapabilities, returnToLive: false };
    await expect(controller.returnToLive()).rejects.toBeInstanceOf(UnsupportedPlaybackCapabilityError);
  });

  it("returns to live through the declared adapter capability", async () => {
    const { adapter, controller } = createController();
    await controller.returnToLive();
    expect(adapter.returnToLive).toHaveBeenCalledOnce();
  });

  it("unsubscribes and destroys its adapter on cleanup", async () => {
    const { adapter, controller } = createController();
    const listener = vi.fn();
    controller.onChange(listener);
    await controller.load(liveRequest("A"));
    const callsBeforeDestroy = listener.mock.calls.length;
    controller.destroy();
    expect(adapter.stop).toHaveBeenCalledOnce();
    expect(adapter.destroy).toHaveBeenCalledOnce();
    expect(adapter.listeners.size).toBe(0);
    adapter.emit({ ...adapter.snapshot, state: "error" });
    expect(listener).toHaveBeenCalledTimes(callsBeforeDestroy);
    expect(() => controller.onChange(listener)).not.toThrow();
  });
});


describe("TV-019 real Tizen adapter/controller regression (host callbacks only)", () => {
  afterEach(() => vi.useRealTimers());

  it("publishes recovery-required for the new live request when seek never calls back", async () => {
    vi.useFakeTimers();
    let prepared!: () => void;
    let lateSeek!: () => void;
    const api: AVPlay = {
      open: vi.fn(), close: vi.fn(), setListener: vi.fn(), setDisplayRect: vi.fn(),
      prepareAsync: vi.fn((success) => { prepared = success; }),
      play: vi.fn(), pause: vi.fn(), stop: vi.fn(),
      getState: vi.fn(() => "READY"), getDuration: vi.fn(() => 90_000),
      getCurrentTime: vi.fn(() => 0),
      seekTo: vi.fn((_position, success) => { lateSeek = success; }),
    };
    const live = liveRequest("channel-a");
    const adapter = new TizenTVPlaybackAdapter({
      avplay: api, displayArea: { x: 0, y: 0, width: 1920, height: 1080 },
      operationTimeoutMs: 100, resolveLive: () => live,
    });
    const controller = new TVPlaybackController(adapter);
    try {
      const loading = controller.load(catchUpRequest);
      await vi.advanceTimersByTimeAsync(0); prepared(); await loading;
      const seeking = expect(controller.seek(1000)).rejects.toMatchObject({ name: "AbortError" });
      await vi.advanceTimersByTimeAsync(0);
      expect(controller.getSnapshot().state).toBe("seeking");
      const returning = expect(controller.returnToLive()).rejects.toMatchObject({
        code: "tizen_recovery_required", fatal: true, message: "Playback request failed",
      });
      await vi.advanceTimersByTimeAsync(100); await seeking; await returning;
      expect(controller.getSnapshot()).toMatchObject({
        request: live, state: "error", error: { code: "tizen_recovery_required", fatal: true },
      });
      expect(controller.getSnapshot().request).toBe(live);
      const failed = controller.getSnapshot();
      lateSeek(); await vi.advanceTimersByTimeAsync(0);
      expect(controller.getSnapshot()).toBe(failed);
      expect(api.open).toHaveBeenCalledTimes(1);
      expect(api.play).not.toHaveBeenCalled();
    } finally { controller.destroy(); }
  });
});
