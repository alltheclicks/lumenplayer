import { describe, expect, it, vi } from "vitest";
import { createCatchUpGateway } from "./catchup-gateway.js";
import { createCatchUpRemuxController, type CatchUpRemuxController } from "./catchup-remux.js";

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
      "https://login.example/timeshift/user/pass/1800/2026-03-08:08-30/112.m3u8",
      "https://login.example/timeshift/user/pass/1800/2026-03-08:08-30/112.ts",
    ],
    queryUrls: [
      "https://login.example/streaming/timeshift.php?stream=112&start=1772000000&duration=1800&extension=m3u8",
    ],
    legacyUrls: [],
  },
  channelCapability: {
    hasCatchup: true,
    archiveWindowHours: 72,
    epgCoverageState: "available" as const,
  },
});

const createStubRemuxController = (
  overrides: Partial<CatchUpRemuxController> = {},
): CatchUpRemuxController => ({
  matchesFeatureGate: () => false,
  isRemuxPlaybackRequest: () => false,
  prepareSession: async () => ({
    sessionId: "session-1",
    requestKey: "request-key",
    upstreamUrl: "https://login.example/timeshift/user/pass/1800/2026-03-08:08-30/112.ts",
    tempDir: "/tmp/lumen-catchup-remux/session-1",
    status: "ready",
    processHandle: null,
    playlistPath: "/tmp/lumen-catchup-remux/session-1/index.m3u8",
    initPath: "/tmp/lumen-catchup-remux/session-1/init.mp4",
    segmentDir: "/tmp/lumen-catchup-remux/session-1/segment",
    createdAtMs: 0,
    lastAccessAtMs: 0,
    errorMessage: null,
  }),
  getManifest: async () => ({
    body: "#EXTM3U",
    contentType: "application/vnd.apple.mpegurl; charset=utf-8",
    sessionId: "session-1",
  }),
  getAsset: async () => Buffer.from("asset"),
  parseAssetRequest: () => null,
  sweep: () => {},
  close: async () => {},
  ...overrides,
});

const REMUX_ALLOWED_ENV = {
  LUMEN_CATCHUP_GATEWAY_ALLOWED_MODES: "provider-direct,proxy-normalized,proxy-remuxed",
};

describe("createCatchUpGateway", () => {
  it("returns a stable cached normalized response on repeated resolve", async () => {
    const logger = createLogger();
    const gateway = createCatchUpGateway({
      logger,
      remuxController: createStubRemuxController(),
    });

    const first = await gateway.resolve({
      request: createRequest(),
      requestBaseUrl: "http://localhost:8788/catchup-gateway/resolve",
    });
    const second = await gateway.resolve({
      request: createRequest(),
      requestBaseUrl: "http://localhost:8788/catchup-gateway/resolve",
    });

    expect(first.assetKey).toBe(second.assetKey);
    expect(first.transportMode).toBe("proxy-normalized");
    expect(first.hotStart).toBe(false);
    expect(second.hotStart).toBe(true);
    expect(first.playbackUrl).toContain("/xui-api/");
    expect(first.playbackUrl).toContain("__lumenTransport=normalized");
  });

  it("does not use remux by default even when the remux feature gate matches", async () => {
    const logger = createLogger();
    const prepareSession = vi.fn();
    const gateway = createCatchUpGateway({
      logger,
      remuxController: createStubRemuxController({
        matchesFeatureGate: () => true,
        prepareSession,
      }),
    });

    const result = await gateway.resolve({
      request: createRequest(),
      requestBaseUrl: "http://localhost:8788/catchup-gateway/resolve",
    });

    expect(result.transportMode).toBe("proxy-normalized");
    expect(result.playbackUrl).toContain("__lumenTransport=normalized");
    expect(result.playbackUrl).not.toContain("__lumenTransport=remux-hls");
    expect(prepareSession).not.toHaveBeenCalled();
  });

  it("ignores explicitly allowed remux mode and keeps normalized proxy playback", async () => {
    const logger = createLogger();
    const prepareSession = vi.fn();
    const gateway = createCatchUpGateway({
      logger,
      remuxController: createStubRemuxController({
        matchesFeatureGate: () => true,
        prepareSession,
      }),
      env: REMUX_ALLOWED_ENV,
    });

    const result = await gateway.resolve({
      request: createRequest(),
      requestBaseUrl: "http://localhost:8788/catchup-gateway/resolve",
    });

    expect(result.transportMode).toBe("proxy-normalized");
    expect(result.playbackUrl).toContain("__lumenTransport=normalized");
    expect(result.playbackUrl).not.toContain("__lumenTransport=remux-hls");
    expect(prepareSession).not.toHaveBeenCalled();
  });

  it("ignores debug remux override and does not bootstrap a remux session", async () => {
    const logger = createLogger();
    const prepareSession = vi.fn();
    const gateway = createCatchUpGateway({
      logger,
      remuxController: createStubRemuxController({
        matchesFeatureGate: () => true,
        prepareSession,
      }),
      env: REMUX_ALLOWED_ENV,
    });

    const result = await gateway.resolve({
      request: {
        ...createRequest(),
        debugOverride: {
          enabled: true,
          transportMode: "proxy-remuxed" as const,
        },
      },
      requestBaseUrl: "http://localhost:8788/catchup-gateway/resolve",
    });

    expect(result.transportMode).toBe("proxy-normalized");
    expect(result.playbackUrl).toContain("__lumenTransport=normalized");
    expect(result.playbackUrl).not.toContain("__lumenTransport=remux-hls");
    expect(prepareSession).not.toHaveBeenCalled();
  });

  it("does not consult remux binaries when the env tries to enable remux", async () => {
    const logger = createLogger();
    const checkBinary = vi.fn(() => false);
    const remuxController = createCatchUpRemuxController({
      logger,
      env: {
        LUMEN_PROXY_REMUX_ENABLED: "1",
      },
      checkBinary,
    });
    const gateway = createCatchUpGateway({
      logger,
      remuxController,
      env: REMUX_ALLOWED_ENV,
    });

    const result = await gateway.resolve({
      request: createRequest(),
      requestBaseUrl: "http://localhost:8788/catchup-gateway/resolve",
    });

    expect(result.transportMode).toBe("proxy-normalized");
    expect(result.playbackUrl).toContain("__lumenTransport=normalized");
    expect(result.fallbackReason).toBe("gateway-normalized");
    expect(checkBinary).not.toHaveBeenCalled();
  });

  it("disables provider-direct for mediaking hosts and keeps normalized proxy as floor", async () => {
    const logger = createLogger();
    const gateway = createCatchUpGateway({
      logger,
      remuxController: createStubRemuxController({
        matchesFeatureGate: () => false,
      }),
    });

    const result = await gateway.resolve({
      request: {
        ...createRequest(),
        serverUrl: "http://smart.mediaking.fi:8080",
      },
      requestBaseUrl: "http://localhost:8788/catchup-gateway/resolve",
    });

    expect(result.transportMode).toBe("proxy-normalized");
    expect(result.playbackUrl).toContain("__lumenTransport=normalized");
    expect(result.playbackUrl).not.toContain("/timeshift/user/pass/");
  });

  it("returns failed when platform is disabled by policy", async () => {
    const logger = createLogger();
    const gateway = createCatchUpGateway({
      logger,
      remuxController: createStubRemuxController(),
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
