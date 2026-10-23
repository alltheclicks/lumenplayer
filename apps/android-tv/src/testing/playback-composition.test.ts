import { expect, it } from "vitest";
import { TVPlaybackController } from "@lumen/player-core";
import { createPlaybackController } from "../composition/playback";

it("uses the shared controller and refuses live playback until Media3 is connected", async () => {
  const controller = createPlaybackController();
  expect(controller).toBeInstanceOf(TVPlaybackController);
  await expect(controller.load({ kind: "live", sourceId: "test", channelId: "test", media: { type: "hls", url: "https://example.invalid/test.m3u8" } })).rejects.toThrow("live");
  expect(controller.getSnapshot().state).toBe("idle");
  controller.destroy();
});
