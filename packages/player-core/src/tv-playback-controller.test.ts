import { afterEach, describe, expect, it, vi } from "vitest";
import type {
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
import { TV_CATALOG_FIXTURE } from "./tv-contract.fixture";

const liveRequest = (channelId: string): TVPlaybackRequest => ({
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
