import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createCatchUpRemuxController,
  selectCatchUpRemuxCandidate,
} from "./catchup-remux.js";

const logger = {
  info: () => {},
  warn: () => {},
  error: () => {},
};

const createRequest = () => ({
  platform: "web",
  channelId: "channel-1",
  programId: "program-1",
  streamId: 112,
  startTimestamp: 1_772_000_000,
  durationSeconds: 1_800,
  sourceCandidates: {
    redirectUrls: [],
    queryUrls: [],
    legacyUrls: [],
  },
});

const createController = () => {
  const checkBinary = vi.fn(() => true);
  const spawnProcess = vi.fn(() => {
    throw new Error("remux spawn must stay disabled");
  });

  const controller = createCatchUpRemuxController({
    logger,
    env: {
      LUMEN_PROXY_REMUX_ENABLED: "1",
      LUMEN_PROXY_REMUX_STREAM_IDS: "112",
      LUMEN_PROXY_REMUX_PROGRAM_IDS: "program-1",
      LUMEN_PROXY_REMUX_HOSTS: "login.example",
      LUMEN_PROXY_REMUX_STRATEGY: "copy-then-transcode",
    },
    checkBinary,
    spawnProcess,
    tempRootDir: "/tmp/lumen-remux-disabled-test",
  });

  return {
    checkBinary,
    controller,
    spawnProcess,
  };
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe("catch-up remux candidate selection", () => {
  it("prefers the raw redirect .ts candidate over query .m3u8", () => {
    expect(selectCatchUpRemuxCandidate({
      redirectUrls: [
        "https://login.example/timeshift/user/pass/1800/2026-03-08:08-30/112.m3u8",
        "https://login.example/timeshift/user/pass/1800/2026-03-08:08-30/112.ts",
      ],
      queryUrls: [
        "https://login.example/streaming/timeshift.php?stream=112&start=1772000000&duration=1800&extension=m3u8",
      ],
      legacyUrls: [],
    })).toBe("https://login.example/timeshift/user/pass/1800/2026-03-08:08-30/112.ts");
  });
});

describe("catch-up remux controller runtime policy", () => {
  it("does not match the legacy feature gate even when every env filter matches", () => {
    const { controller } = createController();

    expect(controller.matchesFeatureGate({
      request: createRequest(),
      candidateUrl: "https://login.example/timeshift/user/pass/1800/2026-03-08:08-30/112.ts",
    })).toBe(false);
  });

  it("rejects direct session preparation before binary checks or process spawn", async () => {
    const { checkBinary, controller, spawnProcess } = createController();

    await expect(controller.prepareSession({
      upstreamUrl: new URL(
        "https://login.example/timeshift/user/pass/1800/2026-03-08:08-30/112.ts?__lumenTransport=remux-hls",
      ),
      serverKey: "server-1",
      perServerConcurrency: 1,
    })).rejects.toThrow("disabled by the no-media-processing runtime policy");

    expect(checkBinary).not.toHaveBeenCalled();
    expect(spawnProcess).not.toHaveBeenCalled();
  });

  it("rejects manifest generation before binary checks or process spawn", async () => {
    const { checkBinary, controller, spawnProcess } = createController();

    await expect(controller.getManifest({
      upstreamUrl: new URL(
        "https://login.example/timeshift/user/pass/1800/2026-03-08:08-30/112.ts?__lumenTransport=remux-hls",
      ),
      serverKey: "server-1",
      perServerConcurrency: 1,
    })).rejects.toThrow("disabled by the no-media-processing runtime policy");

    expect(checkBinary).not.toHaveBeenCalled();
    expect(spawnProcess).not.toHaveBeenCalled();
  });

  it("parses legacy asset URLs but never serves generated HLS assets", async () => {
    const { controller } = createController();

    const initAsset = controller.parseAssetRequest(
      new URL("http://localhost/xui-api/__remux__/session/session-1/init.mp4"),
    );
    const segmentAsset = controller.parseAssetRequest(
      new URL("http://localhost/xui-api/__remux__/session/session-1/segment/0.m4s"),
    );

    expect(initAsset).toEqual({
      sessionId: "session-1",
      kind: "init",
      segmentIndex: null,
    });
    expect(segmentAsset).toEqual({
      sessionId: "session-1",
      kind: "segment",
      segmentIndex: 0,
    });
    await expect(controller.getAsset(initAsset ?? {
      sessionId: "",
      kind: "init",
      segmentIndex: null,
    })).rejects.toThrow("disabled by the no-media-processing runtime policy");
    await expect(controller.getAsset(segmentAsset ?? {
      sessionId: "",
      kind: "segment",
      segmentIndex: 0,
    })).rejects.toThrow("disabled by the no-media-processing runtime policy");
  });

  it("can identify legacy remux-hls request hints without serving them", () => {
    const { controller } = createController();

    expect(controller.isRemuxPlaybackRequest(
      new URL("https://login.example/timeshift/user/pass/1800/2026-03-08:08-30/112.ts?__lumenTransport=remux-hls"),
    )).toBe(true);
  });
});
