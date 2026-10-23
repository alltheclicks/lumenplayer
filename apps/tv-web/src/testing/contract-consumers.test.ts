import { afterEach, describe, expect, it, vi } from "vitest";
import { TVPlaybackController, UnsupportedPlaybackCapabilityError } from "@lumen/player-core";
import type { TVPlaybackAdapter, TVPlaybackRequest, TVPlaybackSnapshot } from "@lumen/types";
import { createPlaybackController as web } from "../composition/playback";
import { createPlaybackController as android } from "../../../android-tv/src/composition/playback";
import { ensureCancellation } from "../composition/cancellation";
import { createShellController } from "./shellState.mjs";

const request: TVPlaybackRequest = {
  kind: "live", sourceId: "test", channelId: "test",
  media: { type: "hls", url: "https://example.invalid/no-media.m3u8" },
};

function pendingAdapter() {
  let snapshot: TVPlaybackSnapshot = { request: null, state: "idle", positionMs: 0, durationMs: null, error: null };
  let signal: AbortSignal;
  let finish: () => void;
  const unsubscribe = vi.fn();
  const adapter: TVPlaybackAdapter = {
    getCapabilities: () => ({ live: true, catchUp: true, seek: true, returnToLive: false, mediaTypes: ["hls"] }),
    load: vi.fn((next, options) => {
      signal = options.signal;
      snapshot = { ...snapshot, request: next, state: "loading", durationMs: next.kind === "catch-up" ? next.durationMs : null };
      return new Promise<void>((resolve) => { finish = resolve; });
    }),
    getSnapshot: () => snapshot,
    onChange: () => unsubscribe,
    play() {}, pause() {}, seek: vi.fn(), returnToLive() {}, stop: vi.fn(), destroy: vi.fn(),
  };
  return { adapter, unsubscribe, signal: () => signal, finish: () => finish() };
}

afterEach(() => vi.unstubAllGlobals());

for (const [name, create] of [["web", web], ["android", android]] as const) {
  describe(`${name} production composition consumes TV-003`, () => {
    it("rejects live, catch-up, seek and return-to-live without opening media", async () => {
      const fetch = vi.fn();
      vi.stubGlobal("fetch", fetch);
      const controller = create();
      expect(controller).toBeInstanceOf(TVPlaybackController);
      await expect(controller.load(request)).rejects.toBeInstanceOf(UnsupportedPlaybackCapabilityError);
      await expect(controller.load({ ...request, kind: "catch-up", startTimeMs: 1000, durationMs: 60000 })).rejects.toThrow("catchUp");
      await expect(controller.seek(2000)).rejects.toThrow("seek");
      await expect(controller.returnToLive()).rejects.toThrow("returnToLive");
      expect(controller.getSnapshot()).toMatchObject({ state: "idle", request: null });
      expect(fetch).not.toHaveBeenCalled();
      controller.destroy();
    });

    it("passes the exact request and cancels platform work on screen teardown", async () => {
      const platform = pendingAdapter();
      const controller = create(platform.adapter);
      const pending = controller.load(request);
      expect(platform.adapter.load).toHaveBeenCalledWith(request, { signal: platform.signal() });
      controller.destroy();
      expect(platform.signal().aborted).toBe(true);
      expect(platform.unsubscribe).toHaveBeenCalledOnce();
      expect(platform.adapter.destroy).toHaveBeenCalledOnce();
      platform.finish();
      await pending;
      expect(controller.getSnapshot().state).not.toBe("playing");
    });

    it("preserves catch-up milliseconds and clamps seek at the consumer boundary", async () => {
      const platform = pendingAdapter();
      const controller = create(platform.adapter);
      const archive: TVPlaybackRequest = { ...request, kind: "catch-up", startTimeMs: 1_797_120_000_000, durationMs: 60000 };
      const pending = controller.load(archive);
      platform.finish();
      await pending;
      expect(platform.adapter.load).toHaveBeenCalledWith(archive, { signal: platform.signal() });
      expect(await controller.seek(90000)).toBe(60000);
      expect(platform.adapter.seek).toHaveBeenCalledWith(60000);
      controller.destroy();
    });
  });
}

it.each(["back", "openSettings", "destroy"] as const)("web shell ignores completion after %s", async (operation) => {
  const platform = pendingAdapter();
  const shell = createShellController({ createPlaybackController: () => web(platform.adapter) });
  const pending = shell.startTest(request.media.url);
  shell[operation]();
  const state = shell.getState();
  expect(platform.signal().aborted).toBe(true);
  platform.finish();
  await pending;
  expect(shell.getState()).toBe(state);
});

it("supports the Chrome 63 cancellation fallback without replacing native AbortController", async () => {
  const native = globalThis.AbortController;
  ensureCancellation(globalThis);
  expect(globalThis.AbortController).toBe(native);
  vi.stubGlobal("AbortController", undefined);
  ensureCancellation(globalThis);
  const platform = pendingAdapter();
  const controller = web(platform.adapter);
  const pending = controller.load(request);
  controller.destroy();
  expect(platform.signal().aborted).toBe(true);
  platform.finish();
  await pending;
});
