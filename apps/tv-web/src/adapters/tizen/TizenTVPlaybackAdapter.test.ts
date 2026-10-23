import { afterEach, describe, expect, it, vi } from "vitest";
import { TVPlaybackController } from "@lumen/player-core";
import type { TVCatchUpPlaybackRequest, TVLivePlaybackRequest } from "@lumen/types";
import type { AVPlay, AVPlayListener } from "./avplay";
import type { TizenPlaybackOptions } from "./TizenTVPlaybackAdapter";
import { TizenTVPlaybackAdapter } from "./TizenTVPlaybackAdapter";

const live = (channelId = "one"): TVLivePlaybackRequest => ({ kind: "live", sourceId: "demo", channelId, media: { type: "hls", url: "https://example.invalid/live.m3u8" } });
const archive = (): TVCatchUpPlaybackRequest => ({ ...live(), kind: "catch-up", startTimeMs: 1_797_120_000_000, durationMs: 90_000, media: { type: "mp4", url: "https://example.invalid/archive.mp4" } });
const tick = async () => { for (let n = 0; n < 12; n++) await Promise.resolve(); };
function fixture(resolveLive?: (request: TVCatchUpPlaybackRequest, signal: AbortSignal) => TVLivePlaybackRequest | Promise<TVLivePlaybackRequest>, options: Partial<TizenPlaybackOptions> = {}) {
  const preparations: { success: () => void; error: (error: unknown) => void }[] = [];
  const seeks: { target: number; success: () => void; error: (error: unknown) => void }[] = [];
  const listeners: AVPlayListener[] = [];
  let state = "NONE";
  let time = 0;
  const api: AVPlay = {
    open: vi.fn(() => { state = "IDLE"; }), close: vi.fn(() => { state = "NONE"; }),
    setListener: vi.fn((listener) => { listeners.push(listener); }), setDisplayRect: vi.fn(),
    prepareAsync: vi.fn((success, error) => { preparations.push({ success: () => { state = "READY"; success(); }, error }); }),
    play: vi.fn(() => { state = "PLAYING"; }), pause: vi.fn(() => { state = "PAUSED"; }), stop: vi.fn(() => { state = "IDLE"; }),
    getState: vi.fn(() => state), getDuration: vi.fn(() => 120_000), getCurrentTime: vi.fn(() => time),
    seekTo: vi.fn((target, success, error) => { seeks.push({ target, success: () => { time = target; success(); }, error }); }),
  };
  const adapter = new TizenTVPlaybackAdapter({ avplay: api, displayArea: { x: 0, y: 0, width: 1920, height: 1080 }, resolveLive, ...options });
  const signal = new AbortController();
  async function load(request = archive()) {
    const promise = adapter.load(request, { signal: signal.signal });
    await tick(); preparations.at(-1)!.success(); await promise;
  }
  return { api, adapter, signal, preparations, seeks, listeners, load };
}

describe("Tizen AVPlay host binding (no media decoding)", () => {
  it("prepares exact request without autoplay; maps play/pause/buffering/time/completion", async () => {
    const f = fixture(); const request = archive(); await f.load(request);
    expect(f.api.open).toHaveBeenCalledWith(request.media.url);
    expect(f.api.setDisplayRect).toHaveBeenCalledWith(0, 0, 1920, 1080);
    expect(f.api.play).not.toHaveBeenCalled();
    expect(f.adapter.getSnapshot()).toMatchObject({ request, state: "paused", durationMs: 90_000 });
    await f.adapter.pause(); expect(f.api.pause).not.toHaveBeenCalled();
    await f.adapter.play(); const events = f.listeners[0];
    events.onbufferingstart!(); expect(f.adapter.getSnapshot().state).toBe("buffering");
    events.onbufferingcomplete!(); expect(f.adapter.getSnapshot().state).toBe("playing");
    events.oncurrentplaytime!(1234); expect(f.adapter.getSnapshot().positionMs).toBe(1234);
    await f.adapter.pause(); events.onbufferingcomplete!(); expect(f.adapter.getSnapshot().state).toBe("paused");
    events.onstreamcompleted!(); await tick(); expect(f.adapter.getSnapshot().state).toBe("ended");
    expect(f.api.stop).toHaveBeenCalled(); expect(f.api.close).toHaveBeenCalled();
  });
  it("rejects unsupported formats, DRM, non-HTTP URLs and invalid time before native access", () => {
    const f = fixture();
    for (const media of [{ type: "dash", url: "https://example.invalid/a" }, { type: "webrtc", url: "https://example.invalid/a" }, { type: "hls", url: "file:///a" }, { type: "hls", url: "https://example.invalid/a", drm: { type: "widevine", licenseUrl: "https://example.invalid/license" } }] as const) {
      expect(() => f.adapter.load({ ...live(), media }, { signal: f.signal.signal })).toThrow();
    }
    expect(() => f.adapter.load({ ...archive(), durationMs: Infinity }, { signal: f.signal.signal })).toThrow();
    expect(f.api.open).not.toHaveBeenCalled();
    expect(f.adapter.getCapabilities()).toEqual({ live: true, catchUp: true, seek: true, returnToLive: false, mediaTypes: ["hls", "mp4"] });
  });
  it("ignores late prepare/events after channel replacement", async () => {
    const f = fixture(); const first = f.adapter.load(live(), { signal: f.signal.signal });
    const rejected = expect(first).rejects.toMatchObject({ name: "AbortError" }); await tick();
    const old = f.listeners[0]; const next = live("two"); const second = f.adapter.load(next, { signal: f.signal.signal });
    await rejected; await tick(); f.preparations[1].success(); await second;
    f.preparations[0].success(); old.onerror!("private URL"); old.oncurrentplaytime!(900); old.onbufferingstart!();
    expect(f.adapter.getSnapshot()).toMatchObject({ request: next, state: "paused", positionMs: 0, durationMs: null });
    expect(f.adapter.getSnapshot().request).toBe(next);
    expect(f.api.play).not.toHaveBeenCalled();
  });
  it.each(["pending", "prepared"])("honors abort throughout %s load lifetime", async (phase) => {
    const f = fixture(); const p = f.adapter.load(live(), { signal: f.signal.signal });
    const rejection = phase === "pending" ? expect(p).rejects.toMatchObject({ name: "AbortError" }) : null;
    await tick(); if (phase === "prepared") { f.preparations[0].success(); await p; }
    const before = f.adapter.getSnapshot(); f.signal.abort(); await tick(); if (rejection) await rejection;
    f.preparations[0].success(); f.listeners[0].onerror!("private");
    expect(f.adapter.getSnapshot()).toEqual(before); expect(f.api.close).toHaveBeenCalled();
    await expect(f.adapter.play()).rejects.toThrow();
  });
  it.each(["callback", "throw", "event"])("redacts %s preparation errors and closes resources", async (mode) => {
    const f = fixture(); if (mode === "throw") vi.mocked(f.api.open).mockImplementation(() => { throw new Error("https://private.invalid/token"); });
    const p = f.adapter.load(archive(), { signal: f.signal.signal }); const rejection = expect(p).rejects.toThrow("Playback request failed");
    await tick();
    if (mode === "callback") f.preparations[0].error("https://private.invalid/token");
    if (mode === "event") f.listeners[0].onerrormsg!("ERROR", "https://private.invalid/token");
    await rejection; await tick();
    expect(f.adapter.getSnapshot()).toMatchObject({ state: "error", error: { fatal: true, message: "Playback request failed" } });
    expect(JSON.stringify(f.adapter.getSnapshot().error)).not.toContain("private"); expect(f.api.close).toHaveBeenCalled();
  });
  it("clamps/rounds ms, retains pause and serializes native play until seek callback", async () => {
    const f = fixture(); await f.load(); const seek = f.adapter.seek(100_000.2); await tick();
    expect(f.seeks[0].target).toBe(90_000); const play = f.adapter.play(); await tick(); expect(f.api.play).not.toHaveBeenCalled();
    f.listeners[0].onbufferingcomplete!(); expect(f.adapter.getSnapshot().state).toBe("seeking");
    f.seeks[0].success(); await seek; await play;
    expect(f.adapter.getSnapshot()).toMatchObject({ state: "playing", positionMs: 90_000 });
    const negative = f.adapter.seek(-900); await tick(); expect(f.seeks[1].target).toBe(0); f.seeks[1].success(); await negative;
    await expect(f.adapter.seek(NaN)).rejects.toThrow();
  });
  it("fails seek errors safely", async () => {
    const f = fixture(); await f.load(); const p = f.adapter.seek(500); const rejected = expect(p).rejects.toThrow("Playback request failed");
    await tick(); f.seeks[0].error("private URL"); await rejected; await tick(); expect(f.adapter.getSnapshot().state).toBe("error");
  });
  it("stop cancels seek immediately, defers native cleanup, ignores old callback before new load", async () => {
    const f = fixture(); await f.load(); const seek = f.adapter.seek(500); const rejected = expect(seek).rejects.toMatchObject({ name: "AbortError" });
    await tick(); const stop = f.adapter.stop(); await rejected;
    const next = live("two"); const p = f.adapter.load(next, { signal: f.signal.signal }); await tick(); expect(f.api.open).toHaveBeenCalledTimes(1);
    f.seeks[0].success(); await stop; await tick(); f.preparations[1].success(); await p;
    expect(f.adapter.getSnapshot()).toMatchObject({ request: next, positionMs: 0 });
  });
  it("destroy is idempotent, cancels preparation, removes subscriptions and ignores late events", async () => {
    const f = fixture(); const listener = vi.fn(); f.adapter.onChange(listener);
    const p = f.adapter.load(live(), { signal: f.signal.signal }); const rejected = expect(p).rejects.toMatchObject({ name: "AbortError" });
    await tick(); f.adapter.destroy(); f.adapter.destroy(); await rejected; await tick(); const calls = listener.mock.calls.length;
    f.preparations[0].success(); f.listeners[0].oncurrentplaytime!(500);
    expect(listener).toHaveBeenCalledTimes(calls); expect(f.adapter.getSnapshot().state).toBe("idle"); expect(f.api.close).toHaveBeenCalledTimes(1);
    await expect(f.adapter.play()).rejects.toThrow();
  });
  it("returns archive to source-resolved live request through controller identity filter", async () => {
    const next = live(); const resolver = vi.fn(() => next); const f = fixture(resolver); const controller = new TVPlaybackController(f.adapter);
    const p = controller.load(archive()); await tick(); f.preparations[0].success(); await p;
    const result = controller.returnToLive(); await tick(); f.preparations[1].success(); await result;
    expect(resolver).toHaveBeenCalled(); expect(controller.getSnapshot()).toMatchObject({ request: next, state: "playing", durationMs: null });
    f.listeners.at(-1)!.oncurrentplaytime!(1200); expect(controller.getSnapshot().positionMs).toBe(1200);
    await expect(f.adapter.seek(10)).rejects.toMatchObject({ code: "tizen_live_seek_unsupported" }); controller.destroy();
  });
  it("cancels a late live resolver on a new channel without opening its URL", async () => {
    let resolve!: (request: TVLivePlaybackRequest) => void; const f = fixture(() => new Promise((done) => { resolve = done; })); await f.load();
    const transition = f.adapter.returnToLive(); const rejected = expect(transition).rejects.toMatchObject({ name: "AbortError" }); await tick();
    const next = live("two"); const p = f.adapter.load(next, { signal: f.signal.signal }); await rejected; await tick(); resolve(live()); await tick();
    f.preparations[1].success(); await p; expect(f.api.open).toHaveBeenCalledTimes(2); expect(f.adapter.getSnapshot().request).toBe(next);
  });
  it("rejects a mismatched live resolver and preserves archive", async () => {
    const f = fixture(() => live("wrong")); await f.load(); await expect(f.adapter.returnToLive()).rejects.toMatchObject({ code: "tizen_invalid_live_request" });
    expect(f.adapter.getSnapshot().request?.kind).toBe("catch-up");
  });
  it("times out a silent preparation and suppresses its late callback", async () => {
    vi.useFakeTimers();
    try {
      const f = fixture(); const p = f.adapter.load(live(), { signal: f.signal.signal });
      const rejected = expect(p).rejects.toMatchObject({ code: "tizen_prepare_timeout" });
      await tick(); await vi.advanceTimersByTimeAsync(30_000); await rejected; await tick();
      f.preparations[0].success(); expect(f.adapter.getSnapshot().state).toBe("error");
      expect(f.api.close).toHaveBeenCalledTimes(1);
    } finally { vi.useRealTimers(); }
  });
  it("handles reentrant stop from a loading subscriber without hanging load", async () => {
    const f = fixture(); f.adapter.onChange((snapshot) => { if (snapshot.state === "loading") void f.adapter.stop(); });
    await expect(f.adapter.load(live(), { signal: f.signal.signal })).rejects.toMatchObject({ name: "AbortError" });
    expect(f.api.open).not.toHaveBeenCalled();
  });
  it("does not invoke native calls when already aborted", async () => {
    const f = fixture(); f.signal.abort();
    await expect(f.adapter.load(live(), { signal: f.signal.signal })).rejects.toMatchObject({ name: "AbortError" });
    expect(f.api.open).not.toHaveBeenCalled();
  });
  it("destroy during seek rejects public work but waits for native completion to close", async () => {
    const f = fixture(); await f.load(); const p = f.adapter.seek(500);
    const rejected = expect(p).rejects.toMatchObject({ name: "AbortError" }); await tick();
    f.adapter.destroy(); await rejected; await tick(); expect(f.api.close).not.toHaveBeenCalled();
    f.seeks[0].success(); await tick(); expect(f.api.close).toHaveBeenCalledTimes(1);
    expect(f.adapter.getSnapshot().state).toBe("idle");
  });
  it("cannot adopt an old live preparation after a channel switch", async () => {
    const f = fixture(() => live()); await f.load(); const p = f.adapter.returnToLive();
    const rejected = expect(p).rejects.toMatchObject({ name: "AbortError" }); await tick();
    const next = live("two"); const load = f.adapter.load(next, { signal: f.signal.signal });
    await rejected; await tick(); f.preparations[1].success(); f.preparations[2].success(); await load;
    expect(f.adapter.getSnapshot().request).toBe(next); expect(f.api.play).not.toHaveBeenCalled();
  });
  it("clamps against shorter native duration and keeps integer seek within fractional duration", async () => {
    const f = fixture(); vi.spyOn(f.api, "getDuration").mockReturnValue(1234.2); await f.load();
    const seek = f.adapter.seek(5000); await tick(); expect(f.seeks[0].target).toBe(1234); f.seeks[0].success(); await seek;
    expect(f.adapter.getSnapshot().durationMs).toBe(1234.2);
  });
  it("preserves cleanup ownership when close fails and retries before a new open", async () => {
    const f = fixture(); await f.load(); vi.mocked(f.api.close).mockImplementationOnce(() => { throw new Error("private"); });
    await expect(f.adapter.stop()).rejects.toThrow();
    const p = f.adapter.load(live("two"), { signal: f.signal.signal }); await tick(); f.preparations[1].success(); await p;
    expect(f.api.close).toHaveBeenCalledTimes(2); expect(f.api.open).toHaveBeenCalledTimes(2);
  });

  it("aborts resolver work on direct stop even when the caller signal stays alive", async () => {
    let resolverSignal: AbortSignal | undefined;
    const f = fixture((_request, signal) => { resolverSignal = signal; return new Promise(() => undefined); });
    await f.load(); const result = f.adapter.returnToLive(); const rejected = expect(result).rejects.toMatchObject({ name: "AbortError" });
    await tick(); await f.adapter.stop(); await rejected;
    expect(resolverSignal?.aborted).toBe(true); expect(f.signal.signal.aborted).toBe(false);
  });

  it("releases the retired native session when a replacement aborts while waiting for seek", async () => {
    const f = fixture(); await f.load(); const seek = f.adapter.seek(500);
    const oldRejected = expect(seek).rejects.toMatchObject({ name: "AbortError" }); await tick();
    const signal = new AbortController(); const p = f.adapter.load(live("two"), { signal: signal.signal });
    const rejected = expect(p).rejects.toMatchObject({ name: "AbortError" });
    signal.abort(); await rejected; await oldRejected; f.seeks[0].success(); await tick();
    expect(f.api.close).toHaveBeenCalledTimes(1); expect(f.api.open).toHaveBeenCalledTimes(1);
  });
  it("does not invalidate a reentrant retry started by an error subscriber", async () => {
    const f = fixture(); await f.load(); let retry: Promise<void> | undefined;
    const next = live("two");
    f.adapter.onChange((snapshot) => { if (snapshot.state === "error") retry = f.adapter.load(next, { signal: f.signal.signal }); });
    f.listeners[0].onerror!("ERROR"); await tick(); f.preparations[1].success(); await retry;
    expect(f.adapter.getSnapshot()).toMatchObject({ request: next, state: "paused" });
  });

});


describe("bounded public waits with an unresolved native seek", () => {
  afterEach(() => vi.useRealTimers());
  const recovery = { code: "tizen_recovery_required", fatal: true, message: "Playback request failed" };
  async function seeking() {
    vi.useFakeTimers();
    const f = fixture(undefined, { operationTimeoutMs: 100, prepareTimeoutMs: 50 });
    await f.load();
    const seek = f.adapter.seek(500);
    await tick();
    return { ...f, seek };
  }
  function nativeCalls(api: AVPlay) {
    return [api.open, api.close, api.stop, api.play, api.pause, api.seekTo, api.setListener, api.setDisplayRect, api.prepareAsync, api.getState, api.getDuration, api.getCurrentTime]
      .map((method) => vi.mocked(method).mock.calls.length);
  }
  it("bounds seek and queued commands, preserves native lock, and rejects later work immediately", async () => {
    const f = await seeking();
    const rejected = expect(f.seek).rejects.toMatchObject(recovery);
    const play = expect(f.adapter.play()).rejects.toMatchObject(recovery);
    const pause = expect(f.adapter.pause()).rejects.toMatchObject(recovery);
    const nextSeek = expect(f.adapter.seek(700)).rejects.toMatchObject(recovery);
    const calls = nativeCalls(f.api);
    await vi.advanceTimersByTimeAsync(100);
    await Promise.all([rejected, play, pause, nextSeek]);
    expect(f.adapter.getSnapshot()).toMatchObject({ state: "error", error: recovery });
    expect(() => f.adapter.load(live(), { signal: f.signal.signal })).toThrow(expect.objectContaining(recovery));
    await expect(f.adapter.play()).rejects.toMatchObject(recovery);
    expect(() => f.adapter.seek(900)).toThrow(expect.objectContaining(recovery));
    await expect(f.adapter.returnToLive()).rejects.toMatchObject(recovery);
    await expect(f.adapter.stop()).rejects.toMatchObject(recovery);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(nativeCalls(f.api)).toEqual(calls);
    expect(vi.getTimerCount()).toBe(0);
    f.adapter.destroy();
  });
  it.each(["success", "error"] as const)("bounds replacement load including queue wait and ignores late %s", async (callback) => {
    const f = await seeking();
    const old = expect(f.seek).rejects.toMatchObject({ name: "AbortError" });
    const next = live("two");
    const pending = f.adapter.load(next, { signal: new AbortController().signal });
    const rejected = expect(pending).rejects.toMatchObject(recovery);
    await old;
    await vi.advanceTimersByTimeAsync(100); await rejected;
    expect(f.api.open).toHaveBeenCalledTimes(1);
    expect(f.api.close).not.toHaveBeenCalled();
    const snapshot = f.adapter.getSnapshot();
    if (callback === "success") f.seeks[0].success();
    else f.seeks[0].error("private native token");
    f.listeners[0].onbufferingcomplete!(); f.listeners[0].oncurrentplaytime!(1000);
    await tick();
    expect(f.adapter.getSnapshot()).toEqual(snapshot);
    expect(f.api.open).toHaveBeenCalledTimes(1); expect(f.api.play).not.toHaveBeenCalled();
    expect(f.api.close).toHaveBeenCalledTimes(1);
    expect(() => f.adapter.load(live(), { signal: f.signal.signal })).toThrow(expect.objectContaining(recovery));
    f.adapter.destroy();
  });
  it("never resumes or reads native time from a late callback for the timed-out session", async () => {
    const f = await seeking(); const rejected = expect(f.seek).rejects.toMatchObject(recovery);
    await vi.advanceTimersByTimeAsync(100); await rejected;
    const reads = vi.mocked(f.api.getCurrentTime).mock.calls.length;
    const snapshot = f.adapter.getSnapshot();
    f.seeks[0].success(); f.seeks[0].success(); await tick();
    expect(f.api.getCurrentTime).toHaveBeenCalledTimes(reads);
    expect(f.api.play).not.toHaveBeenCalled(); expect(f.api.close).toHaveBeenCalledTimes(1);
    expect(f.adapter.getSnapshot()).toEqual(snapshot); f.adapter.destroy();
  });
  it("settles stop at the native deadline and keeps cleanup deferred until callback", async () => {
    const f = await seeking(); const rejected = expect(f.seek).rejects.toMatchObject({ name: "AbortError" });
    const stop = expect(f.adapter.stop()).rejects.toMatchObject(recovery); await rejected;
    await vi.advanceTimersByTimeAsync(100); await stop;
    expect(f.adapter.getSnapshot()).toMatchObject({ state: "error", error: recovery });
    expect(f.api.close).not.toHaveBeenCalled();
    f.seeks[0].success(); await tick(); expect(f.api.close).toHaveBeenCalledTimes(1);
    expect(f.adapter.getSnapshot()).toMatchObject({ state: "error", error: recovery });
    f.adapter.destroy();
  });
  it("destroy settles queued stop and load immediately, with no native cleanup before late callback", async () => {
    const f = await seeking(); const rejected = expect(f.seek).rejects.toMatchObject({ name: "AbortError" });
    const stop = expect(f.adapter.stop()).rejects.toMatchObject({ name: "AbortError" });
    const load = expect(f.adapter.load(live(), { signal: new AbortController().signal })).rejects.toMatchObject({ name: "AbortError" });
    f.adapter.destroy(); await Promise.all([rejected, stop, load]);
    await vi.advanceTimersByTimeAsync(1000);
    expect(f.api.close).not.toHaveBeenCalled(); expect(f.adapter.getSnapshot().state).toBe("idle");
    expect(vi.getTimerCount()).toBe(0);
    f.seeks[0].success(); await tick(); expect(f.api.close).toHaveBeenCalledTimes(1);
    expect(f.api.open).toHaveBeenCalledTimes(1); expect(f.api.play).not.toHaveBeenCalled();
  });
  it("caller abort settles seek immediately but cannot cancel native watchdog", async () => {
    const f = await seeking(); const rejected = expect(f.seek).rejects.toMatchObject({ name: "AbortError" });
    f.signal.abort(); await rejected; await tick(); expect(f.api.close).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(100);
    expect(f.adapter.getSnapshot()).toMatchObject({ state: "error", error: recovery });
    expect(() => f.adapter.load(live(), { signal: new AbortController().signal })).toThrow(expect.objectContaining(recovery));
    f.adapter.destroy();
  });
  it("keeps normal seeks serialized and clears both watchdogs after callbacks", async () => {
    const f = await seeking(); const second = f.adapter.seek(800); const play = f.adapter.play();
    await vi.advanceTimersByTimeAsync(20); expect(f.api.seekTo).toHaveBeenCalledTimes(1);
    f.seeks[0].success(); await f.seek; await tick();
    expect(f.api.seekTo).toHaveBeenCalledTimes(2); expect(f.api.play).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(20); f.seeks[1].success(); await second; await play;
    await vi.advanceTimersByTimeAsync(200);
    expect(f.adapter.getSnapshot()).toMatchObject({ state: "playing", positionMs: 800, error: null });
    expect(vi.getTimerCount()).toBe(0); f.adapter.destroy();
  });
  it("bounds a source resolver that never settles without claiming a native recovery", async () => {
    vi.useFakeTimers();
    const f = fixture(() => new Promise(() => undefined), { operationTimeoutMs: 100 }); await f.load();
    const pending = expect(f.adapter.returnToLive()).rejects.toMatchObject({ code: "tizen_operation_timeout" });
    await vi.advanceTimersByTimeAsync(100); await pending;
    expect(f.api.close).toHaveBeenCalledTimes(1); f.adapter.destroy();
  });
  it("exposes recovery through the controller for an active seek and a subsequent load", async () => {
    vi.useFakeTimers(); const f = fixture(undefined, { operationTimeoutMs: 100 }); const controller = new TVPlaybackController(f.adapter);
    const load = controller.load(archive()); await tick(); f.preparations[0].success(); await load;
    const seek = expect(controller.seek(500)).rejects.toMatchObject(recovery);
    await tick(); await vi.advanceTimersByTimeAsync(100); await seek;
    expect(controller.getSnapshot()).toMatchObject({ state: "error", error: recovery });
    await expect(controller.load(live())).rejects.toThrow("Playback request failed");
    expect(controller.getSnapshot()).toMatchObject({ state: "error", error: recovery }); controller.destroy();
  });
});
