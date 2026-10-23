import { describe, expect, it, vi } from "vitest";
import { buildTarget, createPlatformPlayback, type TVTarget } from "./platform";
import type { AVPlay, AVPlayListener } from "../adapters/tizen/avplay";
import { createShellController } from "../testing/shellState.mjs";

const request = { kind: "live" as const, sourceId: "source", channelId: "channel", media: { type: "hls" as const, url: "https://example.invalid/private.m3u8?token=secret" } };
function dom() {
  const elements: Array<EventTarget & Record<string, unknown>> = [];
  const mount = { textContent: "", appendChild: vi.fn() };
  const document = Object.assign(new EventTarget(), { hidden: false, createElement: vi.fn((tag: string) => {
    const element = Object.assign(new EventTarget(), { tag, src: "", currentTime: 0, duration: Infinity, readyState: 0, paused: true,
      ended: false, seeking: false, error: null, seekable: { length: 0 }, autoplay: false, preload: "", setAttribute: vi.fn(),
      removeAttribute: vi.fn(function () { element.src = ""; }), remove: vi.fn(), load: vi.fn(), pause: vi.fn(),
      play: vi.fn(async () => { element.paused = false; element.dispatchEvent(new Event("playing")); }) });
    elements.push(element as unknown as EventTarget & Record<string, unknown>); return element;
  }) });
  return { document: document as unknown as Document, mount: mount as unknown as HTMLElement, elements };
}
function samsung() {
  let listener: AVPlayListener;
  let seekDone: () => void;
  const api = { open: vi.fn(), close: vi.fn(), setListener: vi.fn(next => { listener = next; }), setDisplayRect: vi.fn(),
    prepareAsync: vi.fn(success => success()), play: vi.fn(), pause: vi.fn(), stop: vi.fn(),
    getState: () => "READY", getDuration: () => 100000, getCurrentTime: () => 0,
    seekTo: vi.fn((_position, done) => { seekDone = done; }) } satisfies AVPlay;
  return { api, listener: () => listener, finishSeek: () => seekDone() };
}

describe("production TV composition", () => {
  it("defaults development to an honest browser fallback, regardless of UA", async () => {
    expect(buildTarget).toBe("browser");
    const create = createPlatformPlayback({ target: "browser", ...dom() });
    const controller = create();
    await expect(controller.load(request)).rejects.toThrow("live");
    controller.destroy();
  });
  it.each(["tizen", "webos"] as TVTarget[])("reports missing %s API before opening media", target => {
    const host = dom();
    expect(() => createPlatformPlayback({ target, ...host })()).toThrow("Platform API unavailable");
    expect(host.elements).toHaveLength(0);
  });
  it("uses Samsung AVPlay with its receiver, native object and reference display area", async () => {
    const host = dom(); const native = samsung();
    const controller = createPlatformPlayback({ target: "tizen", ...host, avplay: native.api, sourceOrigins: ["https://example.invalid"] })();
    await controller.load(request); await controller.play();
    expect(native.api.open).toHaveBeenCalledWith(request.media.url);
    expect(native.api.open.mock.contexts[0]).toBe(native.api);
    expect(host.elements[0].type).toBe("application/avplayer");
    expect(native.api.setDisplayRect).toHaveBeenCalledWith(0, 0, 1920, 1080);
    controller.destroy(); await Promise.resolve(); await Promise.resolve();
    expect(host.elements[0].remove).toHaveBeenCalled();
  });
  it("rejects unconfigured Samsung source origins before opening native media", async () => {
    const host = dom(); const native = samsung();
    const controller = createPlatformPlayback({ target: "tizen", ...host, avplay: native.api })();
    await expect(controller.load(request)).rejects.toMatchObject({ code: "source_origin_unconfigured" });
    expect(native.api.open).not.toHaveBeenCalled();
    controller.destroy();
  });
  it("rejects overlapping Samsung owners and allows clean teardown/reopen", async () => {
    const host = dom(); const native = samsung();
    const create = createPlatformPlayback({ target: "tizen", ...host, avplay: native.api, sourceOrigins: ["https://example.invalid"] });
    const first = create(); await first.load(request);
    expect(() => create()).toThrow("already owned");
    first.destroy();
    for (let i = 0; i < 12; i++) await Promise.resolve();
    const second = create(); await second.load(request);
    first.destroy();
    expect(() => create()).toThrow("already owned");
    second.destroy();
  });
  it("does not transfer Samsung ownership when native close fails", async () => {
    const host = dom(); const native = samsung();
    const create = createPlatformPlayback({ target: "tizen", ...host, avplay: native.api, sourceOrigins: ["https://example.invalid"] });
    const first = create(); await first.load(request);
    native.api.close.mockImplementation(() => { throw new Error("native cleanup failed"); });
    first.destroy();
    for (let i = 0; i < 12; i++) await Promise.resolve();
    expect(() => create()).toThrow("already owned");
    expect(native.api.open).toHaveBeenCalledOnce();
  });
  it("cannot create a new Samsung owner while an old seek callback is missing, even after it arrives", async () => {
    const host = dom(); const native = samsung();
    const create = createPlatformPlayback({ target: "tizen", ...host, avplay: native.api, sourceOrigins: ["https://example.invalid"] });
    const controller = create();
    await controller.load({ ...request, kind: "catch-up", startTimeMs: 1000, durationMs: 100000 });
    const seek = controller.seek(2000).catch(() => undefined);
    for (let i = 0; i < 8 && !native.api.seekTo.mock.calls.length; i++) await Promise.resolve();
    expect(native.api.seekTo).toHaveBeenCalledOnce();
    const closes = native.api.close.mock.calls.length;
    controller.destroy();
    expect(() => create()).toThrow("restart required");
    expect(native.api.close).toHaveBeenCalledTimes(closes);
    native.finishSeek(); await seek;
    expect(() => create()).toThrow("restart required");
  });
  it.each(["back", "openSettings", "destroy"] as const)("LG shell retains one real media surface across status notifications and releases on %s", async action => {
    const host = dom();
    const shell = createShellController({ createPlaybackController: createPlatformPlayback({ target: "webos", ...host, webOSAvailable: true }) });
    const states: string[] = [];
    shell.subscribe(state => states.push(state.playback));
    const pending = shell.startTest(request.media.url);
    const video = host.elements[0];
    video.readyState = 3;
    video.dispatchEvent(new Event("canplay"));
    await pending;
    expect(shell.getState().playback).toBe("playing");
    video.dispatchEvent(new Event("timeupdate"));
    expect(host.document.createElement).toHaveBeenCalledOnce();
    expect(states).toContain("paused");
    shell[action]();
    expect(video.removeAttribute).toHaveBeenCalledWith("src");
    expect(video.remove).toHaveBeenCalledOnce();
    const state = shell.getState();
    video.dispatchEvent(new Event("playing"));
    expect(shell.getState()).toBe(state);
    expect(JSON.stringify(state)).not.toContain("secret");
    shell.destroy();
  });
  it("masks native errors and rejects non-HTTP URLs without creating a player", async () => {
    const create = vi.fn(); const shell = createShellController({ createPlaybackController: create });
    await shell.startTest("file:///secret");
    expect(create).not.toHaveBeenCalled();
    expect(shell.getState().error).toBe("invalid_url");
    create.mockImplementation(() => { throw new Error(request.media.url); });
    await shell.startTest(request.media.url);
    expect(shell.getState().error).toBe("playback_failed");
  });
  it("LG teardown rejects pending load and prevents stale success from starting playback", async () => {
    const host = dom();
    const shell = createShellController({ createPlaybackController: createPlatformPlayback({ target: "webos", ...host, webOSAvailable: true }) });
    const pending = shell.startTest(request.media.url);
    const video = host.elements[0];
    shell.back(); video.dispatchEvent(new Event("canplay"));
    await pending;
    expect(video.play).not.toHaveBeenCalled();
    expect(shell.getState().screen).toBe("home");
  });
});
