import { afterEach, describe, expect, it, vi } from "vitest";
import type { TVPlaybackRequest, TVLivePlaybackRequest } from "@lumen/types";
import { TVPlaybackController } from "@lumen/player-core";
import { WebOSPlaybackAdapter, type WebOSMediaElement, type WebOSVisibility } from "./WebOSPlaybackAdapter";

class Media extends EventTarget {
  src = "";
  currentTime = 0;
  duration = NaN;
  readyState = 0;
  paused = true;
  ended = false;
  seeking = false;
  error: { code: number; message: string } | null = null;
  autoplay = true;
  preload = "none";
  ranges: Array<[number, number]> = [];
  get seekable() {
    return { length: this.ranges.length, start: (index: number) => this.ranges[index][0], end: (index: number) => this.ranges[index][1] };
  }
  load = vi.fn();
  pause = vi.fn(() => { this.paused = true; });
  play = vi.fn<() => Promise<void>>(() => { this.paused = false; return Promise.resolve(); });
  removeAttribute = vi.fn((name: string) => { if (name === "src") this.src = ""; });
  private removers: Array<() => void> = [];
  listenerCount = 0;
  override addEventListener(type: string, callback: EventListenerOrEventListenerObject | null, options?: boolean | AddEventListenerOptions) {
    super.addEventListener(type, callback, options);
    this.listenerCount++;
    this.removers.push(() => callback && (typeof callback === "function" ? callback(new Event(type)) : callback.handleEvent(new Event(type))));
  }
  override removeEventListener(type: string, callback: EventListenerOrEventListenerObject | null, options?: boolean | EventListenerOptions) {
    super.removeEventListener(type, callback, options);
    this.listenerCount--;
  }
  emit(type: string) { this.dispatchEvent(new Event(type)); }
  invokeStaleCallbacks() { for (const callback of this.removers) callback(); }
  ready(duration = 120) {
    this.duration = duration; this.readyState = 3;
    this.ranges = [[0, Number.isFinite(duration) ? duration : 200]];
    this.emit("loadedmetadata"); this.emit("canplay");
  }
}
class Visibility extends EventTarget {
  hidden = false;
  setHidden(hidden: boolean) { this.hidden = hidden; this.dispatchEvent(new Event("visibilitychange")); }
}
const live = (channelId = "a"): TVLivePlaybackRequest => ({
  kind: "live", sourceId: "fixture", channelId, media: { type: "hls", url: "https://example.invalid/live.m3u8" },
});
const archive = (): TVPlaybackRequest => ({
  ...live(), kind: "catch-up", startTimeMs: 1_700_000_000_000, durationMs: 600_000,
  media: { type: "mp4", url: "https://example.invalid/archive.mp4" },
});
const adapters: WebOSPlaybackAdapter[] = [];
function setup(extra: Partial<ConstructorParameters<typeof WebOSPlaybackAdapter>[0]> = {}) {
  const media: Media[] = [];
  const released = vi.fn();
  const visibility = new Visibility();
  const adapter = new WebOSPlaybackAdapter({
    createMediaElement: () => { const element = new Media(); media.push(element); return element as WebOSMediaElement; },
    releaseMediaElement: released, visibility: visibility as WebOSVisibility, ...extra,
  });
  adapters.push(adapter);
  const controller = new AbortController();
  return { adapter, media, released, visibility, controller };
}
async function loaded(fixture: ReturnType<typeof setup>, request = archive()) {
  const pending = fixture.adapter.load(request, { signal: fixture.controller.signal });
  fixture.media[fixture.media.length - 1].ready();
  await pending;
  return fixture.media[fixture.media.length - 1];
}
afterEach(() => { for (const adapter of adapters.splice(0)) adapter.destroy(); vi.useRealTimers(); });

describe("webOS native media adapter (injected platform, no playback evidence)", () => {
  it("uses native URLs, waits for data, echoes the exact request and does not autoplay", async () => {
    const f = setup(); const request = archive();
    const pending = f.adapter.load(request, { signal: f.controller.signal });
    const m = f.media[0];
    expect(m.src).toBe(request.media.url); expect(m.autoplay).toBe(false); expect(m.preload).toBe("auto");
    m.readyState = 1; m.emit("loadedmetadata");
    expect(f.adapter.getSnapshot()).toMatchObject({ state: "loading", durationMs: null });
    m.ready(120.125); await pending;
    expect(f.adapter.getSnapshot()).toMatchObject({ state: "paused", durationMs: 120_125, positionMs: 0 });
    expect(f.adapter.getSnapshot().request).toBe(request); expect(m.play).not.toHaveBeenCalled();
    await f.adapter.play(); expect(f.adapter.getSnapshot().state).toBe("paused");
    m.emit("playing"); expect(f.adapter.getSnapshot().state).toBe("playing");
  });

  it("maps seconds to ms, unknown/Infinity durations to null, never uses epoch as position", async () => {
    const f = setup(); const m = await loaded(f);
    for (const duration of [NaN, Infinity, -1]) {
      m.duration = duration; m.currentTime = 12.3456; m.emit("timeupdate");
      expect(f.adapter.getSnapshot()).toMatchObject({ positionMs: 12346, durationMs: null });
    }
    m.currentTime = NaN; m.emit("timeupdate"); expect(f.adapter.getSnapshot().positionMs).toBe(0);
  });

  it("reports only implemented media types and rejects DRM/protocols without leaking URLs", () => {
    const f = setup(); expect(f.adapter.getCapabilities()).toEqual({ live: true, catchUp: true, seek: true, returnToLive: false, mediaTypes: ["hls", "mp4"] });
    for (const media of [
      { type: "dash", url: "https://example.invalid" }, { type: "webrtc", url: "https://example.invalid" },
      { type: "hls", url: "file:///private" }, { type: "hls", url: "not a URL" },
      { type: "hls", url: "https://example.invalid", drm: { type: "widevine", licenseUrl: "https://example.invalid/license" } },
    ]) {
      expect(() => f.adapter.load({ ...live(), media } as TVPlaybackRequest, { signal: f.controller.signal })).toThrow("Playback request failed");
    }
    expect(f.media).toHaveLength(0);
    expect(() => f.adapter.load({ ...archive(), durationMs: Infinity } as TVPlaybackRequest, { signal: f.controller.signal })).toThrow(RangeError);
  });

  it("replaces A with B, rejects pending A and ignores even retained A callbacks", async () => {
    const f = setup(); const a = f.adapter.load(live("a"), { signal: f.controller.signal });
    const rejection = expect(a).rejects.toMatchObject({ name: "AbortError" });
    const request = live("b"); const b = f.adapter.load(request, { signal: new AbortController().signal });
    f.media[0].invokeStaleCallbacks(); expect(f.adapter.getSnapshot().request).toBe(request);
    expect(f.adapter.getSnapshot().state).toBe("loading");
    f.media[1].ready(Infinity); await b; await rejection;
    f.media[0].invokeStaleCallbacks(); expect(f.adapter.getSnapshot().state).toBe("paused");
    expect(f.media[0].listenerCount).toBe(0); expect(f.media[0].src).toBe("");
  });

  it("distinguishes caller abort from media error and keeps completed-load cancellation alive", async () => {
    const f = setup(); const pending = f.adapter.load(live(), { signal: f.controller.signal });
    const rejected = expect(pending).rejects.toMatchObject({ name: "AbortError" });
    f.controller.abort(); await rejected;
    expect(f.adapter.getSnapshot()).toMatchObject({ request: null, state: "idle", error: null });
    const g = setup(); const m = await loaded(g); g.controller.abort();
    m.invokeStaleCallbacks(); expect(g.adapter.getSnapshot().state).toBe("idle"); expect(m.listenerCount).toBe(0);
  });

  it("does not replace an active request for an already aborted load", async () => {
    const f = setup(); await loaded(f); const previous = f.adapter.getSnapshot().request;
    const aborted = new AbortController(); aborted.abort();
    await expect(f.adapter.load(live(), { signal: aborted.signal })).rejects.toMatchObject({ name: "AbortError" });
    expect(f.adapter.getSnapshot().request).toBe(previous);
  });

  it.each([[1, "webos_media_aborted"], [2, "webos_media_network"], [3, "webos_media_decode"], [4, "webos_media_unsupported"]])(
    "handles asynchronous media error %i and cleans up", async (code, expected) => {
      const f = setup(); const pending = f.adapter.load(live(), { signal: f.controller.signal });
      const rejected = expect(pending).rejects.toMatchObject({ code: expected });
      const m = f.media[0]; m.error = { code, message: "https://private.invalid/?token=secret" }; m.emit("error");
      await rejected; expect(f.adapter.getSnapshot()).toMatchObject({ state: "error", error: { code: expected, fatal: true } });
      expect(JSON.stringify(f.adapter.getSnapshot().error)).not.toContain("secret"); expect(m.listenerCount).toBe(0);
    },
  );

  it("handles errors after ready and synchronous media.load failures", async () => {
    const f = setup(); const m = await loaded(f); m.error = { code: 2, message: "private" }; m.emit("error");
    expect(f.adapter.getSnapshot().error?.code).toBe("webos_media_network");
    const broken = new Media(); broken.load.mockImplementation(() => { throw Error("private"); });
    const g = setup({ createMediaElement: () => broken as WebOSMediaElement });
    await expect(g.adapter.load(live(), { signal: g.controller.signal })).rejects.toMatchObject({ code: "webos_load_failed" });
    expect(broken.listenerCount).toBe(0);
  });

  it("bounds a stalled load and clears timeout on success", async () => {
    vi.useFakeTimers(); const f = setup({ loadTimeoutMs: 50 });
    const pending = f.adapter.load(live(), { signal: f.controller.signal });
    const rejected = expect(pending).rejects.toMatchObject({ code: "webos_load_timeout" });
    await vi.advanceTimersByTimeAsync(50); await rejected;
    expect(f.adapter.getSnapshot().state).toBe("error"); expect(vi.getTimerCount()).toBe(0);
    const g = setup(); await loaded(g); expect(vi.getTimerCount()).toBe(0);
  });

  it("seeks milliseconds, clamps finite duration and waits for seeked", async () => {
    const f = setup(); const m = await loaded(f);
    const seek = f.adapter.seek(45_125); expect(m.currentTime).toBe(45.125);
    expect(f.adapter.getSnapshot().state).toBe("seeking"); m.emit("seeked"); await seek;
    expect(f.adapter.getSnapshot().positionMs).toBe(45125);
    const clamped = f.adapter.seek(900_000); expect(m.currentTime).toBe(120); m.emit("seeked"); await clamped;
    const start = f.adapter.seek(-500); expect(m.currentTime).toBe(0); m.emit("seeked"); await start;
    expect(() => f.adapter.seek(NaN)).toThrow(RangeError);
  });

  it("rejects empty ranges and holes and permits observed live DVR ranges", async () => {
    const f = setup(); const m = await loaded(f, live()); m.duration = Infinity;
    m.ranges = []; expect(() => f.adapter.seek(30000)).toThrow();
    m.ranges = [[10, 20], [30, 40]]; expect(() => f.adapter.seek(25000)).toThrow();
    const seek = f.adapter.seek(35000); m.emit("seeked"); await seek; expect(m.currentTime).toBe(35);
  });

  it("cancels pending seeks on replacement/stop and bounds missing seeked", async () => {
    vi.useFakeTimers(); const f = setup({ seekTimeoutMs: 50 }); const m = await loaded(f);
    const seek = f.adapter.seek(20000); const rejected = expect(seek).rejects.toMatchObject({ name: "AbortError" });
    f.adapter.stop(); await rejected; expect(m.listenerCount).toBe(0); expect(vi.getTimerCount()).toBe(0);
    await loaded(f); const timeout = f.adapter.seek(30000);
    const timeoutRejected = expect(timeout).rejects.toMatchObject({ code: "webos_seek_timeout" });
    await vi.advanceTimersByTimeAsync(50); await timeoutRejected;
    expect(f.adapter.getSnapshot().state).toBe("paused");
  });

  it("returns to actual resolved live request and controller adopts it", async () => {
    const request = live(); const f = setup({ resolveLiveRequest: () => request });
    const controller = new TVPlaybackController(f.adapter);
    const pending = controller.load(archive()); f.media[0].ready(); await pending;
    const returning = controller.returnToLive(); expect(f.media[1].src).toBe(request.media.url);
    f.media[1].ready(Infinity); await returning;
    expect(controller.getSnapshot().request).toBe(request); expect(controller.getSnapshot().durationMs).toBeNull();
    await controller.play(); f.media[1].emit("playing"); expect(controller.getSnapshot().state).toBe("playing");
    controller.destroy();
  });

  it("requires a resolver, validates channel identity and never rewrites an archive URL", async () => {
    const f = setup(); await loaded(f); await expect(f.adapter.returnToLive()).rejects.toMatchObject({ code: "webos_live_resolver_unavailable" });
    const g = setup({ resolveLiveRequest: () => live("wrong") });
    await loaded(g); await expect(g.adapter.returnToLive()).rejects.toMatchObject({ code: "webos_live_request_invalid" });
    expect(g.media).toHaveLength(1);
  });

  it("ignores a late play rejection after channel replacement", async () => {
    const f = setup(); const m = await loaded(f);
    let reject!: (error: Error) => void;
    m.play.mockImplementation(() => new Promise((_, rejectPromise) => { reject = rejectPromise; }));
    const playing = f.adapter.play(); const rejected = expect(playing).rejects.toMatchObject({ name: "AbortError" });
    const pending = f.adapter.load(live("b"), { signal: new AbortController().signal }); f.media[1].ready(); await pending;
    reject(Error("private URL")); await rejected; expect(f.adapter.getSnapshot().error).toBeNull();
  });

  it("reports a current play rejection safely without claiming playing", async () => {
    const f = setup(); const m = await loaded(f); m.play.mockRejectedValue(Error("private URL"));
    await expect(f.adapter.play()).rejects.toMatchObject({ code: "webos_play_failed", fatal: false });
    expect(f.adapter.getSnapshot()).toMatchObject({ state: "error", error: { code: "webos_play_failed" } });
  });

  it("releases on hide and restores archive position only on explicit Play", async () => {
    const f = setup(); const m = await loaded(f); m.currentTime = 42; m.emit("timeupdate");
    f.visibility.setHidden(true); expect(m.src).toBe(""); expect(m.listenerCount).toBe(0);
    expect(f.adapter.getSnapshot().state).toBe("paused");
    await expect(f.adapter.play()).rejects.toMatchObject({ code: "webos_app_hidden" });
    f.visibility.setHidden(false); expect(f.media).toHaveLength(1);
    const playing = f.adapter.play(); const next = f.media[1]; next.ready();
    await Promise.resolve(); expect(next.currentTime).toBe(42); next.emit("seeked"); await playing;
    expect(next.play).toHaveBeenCalledOnce(); expect(f.adapter.getSnapshot().state).not.toBe("playing");
  });

  it("destroys pending load, listeners, resources and does not reuse a retired element", async () => {
    const element = new Media(); const f = setup({ createMediaElement: () => element as WebOSMediaElement });
    const pending = f.adapter.load(live(), { signal: f.controller.signal });
    const rejected = expect(pending).rejects.toMatchObject({ name: "AbortError" });
    f.adapter.stop(); await rejected;
    await expect(f.adapter.load(live(), { signal: f.controller.signal })).rejects.toMatchObject({ code: "webos_element_unavailable" });
    const listener = vi.fn(); f.adapter.onChange(listener); f.adapter.destroy(); f.adapter.destroy();
    f.visibility.setHidden(true); element.invokeStaleCallbacks(); expect(listener).not.toHaveBeenCalled();
    expect(element.listenerCount).toBe(0); expect(f.released).toHaveBeenCalledOnce();
    expect(f.adapter.getCapabilities().mediaTypes).toEqual([]);
  });

  it("continues resource cleanup when individual platform teardown calls fail", async () => {
    const f = setup(); const m = await loaded(f);
    m.pause.mockImplementation(() => { throw Error("pause"); });
    m.removeAttribute.mockImplementation(() => { throw Error("src"); });
    m.load.mockImplementation(() => { throw Error("load"); });
    f.adapter.destroy(); expect(f.released).toHaveBeenCalledOnce(); expect(m.listenerCount).toBe(0);
  });
  it("cancels suspended requests even after completed load, and removes resume subscriptions", async () => {
    const f = setup(); await loaded(f); f.visibility.setHidden(true);
    f.controller.abort(); expect(f.adapter.getSnapshot()).toMatchObject({ request: null, state: "idle", error: null });
    f.visibility.setHidden(false); await expect(f.adapter.play()).rejects.toMatchObject({ code: "webos_no_media" });
    expect(f.media).toHaveLength(1);
  });

  it.each([false, true])("does not seek/play a replacement after resume readiness (same request: %s)", async sameRequest => {
    const f = setup(); const request = archive(); const first = await loaded(f, request); first.currentTime = 40; first.emit("timeupdate");
    f.visibility.setHidden(true); f.visibility.setHidden(false);
    const resuming = f.adapter.play(); const rejected = expect(resuming).rejects.toMatchObject({ name: "AbortError" });
    f.media[1].ready();
    const replacement = f.adapter.load(sameRequest ? request : live("b"), { signal: f.controller.signal });
    f.media[2].ready(); await replacement; await rejected;
    expect(f.media[2].currentTime).toBe(0); expect(f.media[2].play).not.toHaveBeenCalled();
  });

  it("rejects a superseded return-to-live without changing the latest channel", async () => {
    const f = setup({ resolveLiveRequest: () => live() }); await loaded(f);
    const returning = f.adapter.returnToLive(); const rejected = expect(returning).rejects.toMatchObject({ name: "AbortError" });
    const request = live("b"); const replacement = f.adapter.load(request, { signal: new AbortController().signal });
    f.media[1].invokeStaleCallbacks(); f.media[2].ready(); await replacement; await rejected;
    expect(f.adapter.getSnapshot().request).toBe(request);
  });

  it("handles hide during load and a load requested while hidden without claiming readiness", async () => {
    const f = setup(); const pending = f.adapter.load(live(), { signal: f.controller.signal });
    const rejected = expect(pending).rejects.toMatchObject({ name: "AbortError" });
    f.visibility.setHidden(true); await rejected; expect(f.media[0].listenerCount).toBe(0);
    await expect(f.adapter.load(live("b"), { signal: f.controller.signal })).rejects.toMatchObject({ name: "AbortError" });
    expect(f.media).toHaveLength(1); expect(f.adapter.getSnapshot().state).toBe("paused");
    f.adapter.stop(); f.controller.abort(); expect(f.adapter.getSnapshot().request).toBeNull();
  });

  it("unsubscribes listeners and tolerates stop from a loading notification", async () => {
    const f = setup(); const listener = vi.fn(); const unsubscribe = f.adapter.onChange(listener); unsubscribe();
    const off = f.adapter.onChange(snapshot => { if (snapshot.state === "loading") f.adapter.stop(); });
    await expect(f.adapter.load(live(), { signal: f.controller.signal })).rejects.toMatchObject({ name: "AbortError" });
    expect(listener).not.toHaveBeenCalled(); expect(f.media[0].src).toBe(""); off();
  });

  it("waits for an in-flight equal-position seek and preserves established playing after seeked", async () => {
    const f = setup(); const m = await loaded(f); await f.adapter.play(); m.emit("playing");
    m.currentTime = 30; m.seeking = true;
    let settled = false;
    const seek = f.adapter.seek(30000).then(() => { settled = true; });
    m.emit("seeked"); await Promise.resolve(); expect(settled).toBe(false);
    m.seeking = false; m.emit("seeked"); await seek;
    expect(f.adapter.getSnapshot().state).toBe("playing");
  });

});
