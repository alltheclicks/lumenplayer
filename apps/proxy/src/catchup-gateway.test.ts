import { describe, expect, it, vi } from "vitest";
import { createCatchUpGateway } from "./catchup-gateway.js";
import { CatchUpRemuxSessionCache } from "./catchup-remuxer.js";

const logger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
};

const createRequest = () => ({
  platform: "web",
  channelId: "hrt-1",
  programId: "program-1",
  streamId: 112,
  startTimestamp: 1_771_873_200,
  durationSeconds: 1_800,
  sourceCandidates: {
    redirectUrls: [
      "http://localhost:8080/xui-api/https%3A%2F%2Flogin.example/timeshift/user/pass/1800/1771873200/112.m3u8",
    ],
    queryUrls: [
      "http://localhost:8080/xui-api/https%3A%2F%2Flogin.example/streaming/timeshift.php?stream=112&start=1771873200&duration=1800",
    ],
    legacyUrls: [],
  },
  channelCapability: {
    hasCatchup: true,
    archiveWindowHours: 168,
    epgCoverageState: "available" as const,
    preferredModeHint: "proxy-remuxed" as const,
  },
});

describe("catch-up gateway resolve", () => {
  it("builds a stable asset identity and dedupes remux preparation", async () => {
    let prewarmCount = 0;
    let releasePrewarmBarrier!: () => void;
    const prewarmBarrier = new Promise<void>((resolve) => {
      releasePrewarmBarrier = () => resolve();
    });

    const gateway = createCatchUpGateway({
      logger,
      remuxSessionCache: new CatchUpRemuxSessionCache(),
      prewarmProxyRemuxAsset: async () => {
        prewarmCount += 1;
        await prewarmBarrier;
      },
    });

    const first = await gateway.resolve({
      request: createRequest(),
      requestBaseUrl: "http://localhost:8788/catchup-gateway/resolve",
      requestHeaders: new Headers(),
    });
    const second = await gateway.resolve({
      request: createRequest(),
      requestBaseUrl: "http://localhost:8788/catchup-gateway/resolve",
      requestHeaders: new Headers(),
    });

    expect(first.assetKey).toBe(second.assetKey);
    expect(first.transportMode).toBe("proxy-remuxed");
    expect(first.playbackUrl).toContain("__lumenTransport=remux-hls");
    expect(first.assetState).toBe("preparing");
    expect(second.assetState).toBe("preparing");
    expect(prewarmCount).toBe(1);

    releasePrewarmBarrier();
    await Promise.resolve();
    await Promise.resolve();

    const third = await gateway.resolve({
      request: createRequest(),
      requestBaseUrl: "http://localhost:8788/catchup-gateway/resolve",
      requestHeaders: new Headers(),
    });

    expect(third.assetState).toBe("ready");
    expect(third.hotStart).toBe(true);
  });

  it("returns failed when the platform is disabled by policy", async () => {
    const gateway = createCatchUpGateway({
      logger,
      remuxSessionCache: new CatchUpRemuxSessionCache(),
      env: {
        LUMEN_CATCHUP_GATEWAY_PLATFORMS: "android-tv",
      },
    });

    const result = await gateway.resolve({
      request: createRequest(),
      requestBaseUrl: "http://localhost:8788/catchup-gateway/resolve",
      requestHeaders: new Headers(),
    });

    expect(result.assetState).toBe("failed");
    expect(result.fallbackReason).toBe("platform-disabled");
    expect(result.playbackUrl).toBe("");
  });
});
