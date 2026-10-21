import { describe, expect, it } from "vitest";
import { NoPlaybackAdapter } from "../composition/no-playback-adapter";

describe("no-real-playback shell adapter", () => {
  it("reports loading and then a clear missing Media3 error without opening a source", async () => {
    const adapter = new NoPlaybackAdapter();
    const states: string[] = [];
    const errors: string[] = [];
    adapter.onStateChange((state) => states.push(state));
    adapter.onError((error) => errors.push(error.code));

    await expect(
      adapter.load({ url: "https://example.invalid/test.m3u8", type: "hls" }),
    ).rejects.toMatchObject({ code: "MEDIA_ADAPTER_NOT_AVAILABLE", fatal: true });

    expect(states).toEqual(["loading", "error"]);
    expect(errors).toEqual(["MEDIA_ADAPTER_NOT_AVAILABLE"]);
    expect(adapter.getState()).toBe("error");
    adapter.destroy();
  });
});
