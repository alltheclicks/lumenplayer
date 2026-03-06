import { describe, expect, it, vi } from "vitest";
import { createCatchUpGateway } from "./catchup-gateway.js";

const createLogger = () => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
});

const createRequest = () => ({
  platform: "web",
  channelId: "channel-1",
  programId: "program-1",
  streamId: 112,
  startTimestamp: 1_772_000_000,
  durationSeconds: 1_800,
  sourceCandidates: {
    redirectUrls: [
      "https://edge.example/streaming/timeshift.php?token=abc123",
    ],
    queryUrls: [],
    legacyUrls: [],
  },
  channelCapability: {
    hasCatchup: true,
    archiveWindowHours: 72,
    epgCoverageState: "available" as const,
  },
});

describe("createCatchUpGateway", () => {
  it("returns a stable cached asset response on repeated resolve", async () => {
    const logger = createLogger();
    const gateway = createCatchUpGateway({ logger });

    const first = await gateway.resolve({
      request: createRequest(),
      requestBaseUrl: "http://localhost:8788/catchup-gateway/resolve",
    });
    const second = await gateway.resolve({
      request: createRequest(),
      requestBaseUrl: "http://localhost:8788/catchup-gateway/resolve",
    });

    expect(first.assetKey).toBe(second.assetKey);
    expect(first.transportMode).toBe("provider-direct");
    expect(first.hotStart).toBe(false);
    expect(second.hotStart).toBe(true);
    expect(second.playbackUrl).toBe(first.playbackUrl);
  });

  it("supports debug override into proxy-normalized mode", async () => {
    const logger = createLogger();
    const gateway = createCatchUpGateway({ logger });

    const result = await gateway.resolve({
      request: {
        ...createRequest(),
        debugOverride: {
          enabled: true,
          transportMode: "proxy-normalized",
        },
      },
      requestBaseUrl: "http://localhost:8788/catchup-gateway/resolve",
    });

    expect(result.transportMode).toBe("proxy-normalized");
    expect(result.playbackUrl).toContain("/xui-api/");
    expect(result.playbackUrl).toContain("__lumenTransport=normalized");
  });

  it("returns failed when platform is disabled by policy", async () => {
    const logger = createLogger();
    const gateway = createCatchUpGateway({
      logger,
      env: {
        LUMEN_CATCHUP_GATEWAY_PLATFORMS: "android-tv",
      },
    });

    const result = await gateway.resolve({
      request: createRequest(),
      requestBaseUrl: "http://localhost:8788/catchup-gateway/resolve",
    });

    expect(result.assetState).toBe("failed");
    expect(result.fallbackReason).toBe("platform-disabled");
    expect(result.playbackUrl).toBe("");
  });
});
