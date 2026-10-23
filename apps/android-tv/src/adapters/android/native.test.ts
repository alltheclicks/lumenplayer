import { describe, expect, it, vi } from "vitest";
import { bindAndroidPlayback, type NativePlaybackModule } from "./native-binding";

function host() {
  return {
    platform: "android", module: undefined as NativePlaybackModule | undefined,
    hasSurface: vi.fn(() => true), subscribe: vi.fn(() => vi.fn()),
  };
}
function module(): NativePlaybackModule {
  return {
    load: vi.fn(async () => {}), play: vi.fn(async () => {}), pause: vi.fn(async () => {}),
    seek: vi.fn(async () => {}), returnToLive: vi.fn(async () => {}), stop: vi.fn(async () => {}),
    release: vi.fn(async () => {}), addListener: vi.fn(), removeListeners: vi.fn(),
  };
}
describe("native composition availability (injected RN host)", () => {
  it("keeps old shell APKs unavailable without a native bridge", () => {
    const h = host(); const binding = bindAndroidPlayback(h);
    expect(binding.available).toBe(false); expect(binding.createAdapter()).toBeUndefined();
    expect(h.hasSurface).not.toHaveBeenCalled();
  });
  it("requires the surface registration as well as the module", () => {
    const h = host(); h.module = module(); h.hasSurface.mockReturnValue(false);
    const binding = bindAndroidPlayback(h);
    expect(binding.available).toBe(false); expect(binding.createAdapter()).toBeUndefined();
    expect(h.subscribe).not.toHaveBeenCalled();
  });
  it("does not activate on another platform", () => {
    const h = host(); h.platform = "ios"; h.module = module();
    expect(bindAndroidPlayback(h).available).toBe(false); expect(h.hasSurface).not.toHaveBeenCalled();
  });
  it("wires native calls/events and detaches on release when installed", async () => {
    const h = host(); h.module = module(); const binding = bindAndroidPlayback(h);
    const adapter = binding.createAdapter()!; expect(binding.available).toBe(true);
    const request = { kind: "live", sourceId: "test", channelId: "test", media: { type: "hls", url: "https://example.invalid/live.m3u8" } } as const;
    await adapter.load(request, { signal: new AbortController().signal });
    expect(h.module.load).toHaveBeenCalledWith(adapter.sessionId, 1, request.media.url, "hls");
    expect(h.subscribe).toHaveBeenCalledWith(h.module, expect.any(Function));
    adapter.destroy();
    expect(h.subscribe.mock.results[0].value).toHaveBeenCalledOnce(); expect(h.module.release).toHaveBeenCalledWith(adapter.sessionId);
  });
});
