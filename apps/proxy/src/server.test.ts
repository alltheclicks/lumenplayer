import { createServer } from "node:http";
import path from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createCatchUpRemuxController } from "./catchup-remux.js";
import {
  createProxyServer,
  parseAllowedHosts,
  parseAllowedCorsOrigins,
  resolveCorsAllowOrigin,
} from "./server.js";

const encodeTarget = (value: string): string => encodeURIComponent(value);

const logger = {
  info: () => {},
  warn: () => {},
  error: () => {},
};

const createTempRootDir = (label: string): string => (
  path.join(process.cwd(), ".tmp-remux-tests", `${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`)
);

const REMUX_ALLOWED_ENV = {
  LUMEN_CATCHUP_GATEWAY_ALLOWED_MODES: "provider-direct,proxy-normalized,proxy-remuxed",
};

const createCompletedSpawn = () => ({
  spawnProcess: ({
    playlistPath,
    segmentDir,
  }: {
    ffmpegBin: string;
    profile: "copy" | "transcode";
    upstreamUrl: string;
    playlistPath: string;
    segmentDir: string;
  }) => {
    const kill = vi.fn();
    const completion = (async () => {
      await mkdir(segmentDir, {
        recursive: true,
      });
      await writeFile(path.join(path.dirname(playlistPath), "init.mp4"), "init-body");
      await writeFile(path.join(segmentDir, "00000.m4s"), "segment-zero");
      await writeFile(path.join(segmentDir, "00001.m4s"), "segment-one");
      await writeFile(playlistPath, [
        "#EXTM3U",
        "#EXT-X-VERSION:7",
        "#EXT-X-PLAYLIST-TYPE:EVENT",
        "#EXT-X-MAP:URI=\"init.mp4\"",
        "#EXTINF:6.000,",
        "segment/00000.m4s",
        "#EXTINF:6.000,",
        "segment/00001.m4s",
        "#EXT-X-ENDLIST",
      ].join("\n"));

      return {
        code: 0,
        signal: null,
        stderrMessage: null,
      } as const;
    })();

    return {
      handle: {
        kill,
        pid: 1001,
      },
      completion,
    };
  },
});

const createTestRemuxController = () => createCatchUpRemuxController({
  logger,
  env: {
    LUMEN_PROXY_REMUX_ENABLED: "1",
  },
  checkBinary: () => true,
  spawnProcess: createCompletedSpawn().spawnProcess,
  tempRootDir: createTempRootDir("server"),
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("parseAllowedHosts", () => {
  it("parses and normalizes comma-separated host list", () => {
    expect(parseAllowedHosts(" Example.com , *.castcdn.net ,,localhost ")).toEqual([
      "example.com",
      "*.castcdn.net",
      "localhost",
    ]);
  });
});

describe("parseAllowedCorsOrigins (M1.3-e)", () => {
  it("returns an empty list when unset", () => {
    expect(parseAllowedCorsOrigins(undefined)).toEqual([]);
    expect(parseAllowedCorsOrigins("")).toEqual([]);
  });

  it("parses and lower-cases comma-separated origins", () => {
    expect(parseAllowedCorsOrigins(" https://Cast.LumenPlayer.com , https://app.example ,, "))
      .toEqual(["https://cast.lumenplayer.com", "https://app.example"]);
  });
});

describe("resolveCorsAllowOrigin (M1.3-e)", () => {
  it("falls back to wildcard when no allowlist is configured", () => {
    expect(resolveCorsAllowOrigin("https://cast.lumenplayer.com", [])).toBe("*");
    expect(resolveCorsAllowOrigin(undefined, [])).toBe("*");
  });

  it("echoes the request origin when it is in the allowlist", () => {
    const allow = ["https://cast.lumenplayer.com", "https://app.example"];
    expect(resolveCorsAllowOrigin("https://app.example", allow)).toBe("https://app.example");
  });

  it("falls back to the first configured origin for unknown/missing origins", () => {
    const allow = ["https://cast.lumenplayer.com", "https://app.example"];
    expect(resolveCorsAllowOrigin("https://evil.example", allow)).toBe("https://cast.lumenplayer.com");
    expect(resolveCorsAllowOrigin(undefined, allow)).toBe("https://cast.lumenplayer.com");
  });
});

describe("createProxyServer", () => {
  it("accepts privacy-safe observability events only from the configured browser origin", async () => {
    const app = createProxyServer({
      allowedHosts: ["*"],
      allowedCorsOrigins: ["https://player.exyu.tv"],
      logger: false,
      sweepIntervalMs: 0,
    });

    const accepted = await app.inject({
      method: "POST",
      url: "/observe",
      headers: { origin: "https://player.exyu.tv" },
      payload: {
        event: "playback.retry",
        sourceUrl: "https://provider.example/live/viewer@example.com/pass/112.m3u8",
      },
    });
    expect(accepted.statusCode).toBe(204);
    expect(accepted.headers["cache-control"]).toBe("no-store");
    expect(accepted.headers["referrer-policy"]).toBe("no-referrer");

    const rejected = await app.inject({
      method: "POST",
      url: "/observe",
      headers: { origin: "https://evil.example" },
      payload: { event: "playback.retry" },
    });
    const missingOrigin = await app.inject({
      method: "POST",
      url: "/observe",
      payload: { event: "playback.retry" },
    });
    expect(rejected.statusCode).toBe(403);
    expect(rejected.json()).toEqual({ error: "forbidden_origin" });
    expect(missingOrigin.statusCode).toBe(403);
    expect(missingOrigin.headers["access-control-allow-origin"]).toBeUndefined();

    await app.close();
  });

  it("rejects malformed and oversized observability batches before logging", async () => {
    const app = createProxyServer({
      allowedHosts: ["*"],
      logger: false,
      sweepIntervalMs: 0,
    });
    const infoSpy = vi.spyOn(app.log, "info");

    const missingEvent = await app.inject({
      method: "POST",
      url: "/observe",
      payload: { severity: "error", password: "must-not-be-logged" },
    });
    const oversizedBatch = await app.inject({
      method: "POST",
      url: "/observe",
      payload: {
        events: Array.from({ length: 11 }, (_, index) => ({
          event: `playback.event-${index}`,
        })),
      },
    });
    const deeplyNested = await app.inject({
      method: "POST",
      url: "/observe",
      payload: {
        event: "playback.started",
        metadata: {
          one: { two: { three: { four: { five: { six: { seven: "too-deep" } } } } } },
        },
      },
    });

    expect(missingEvent.statusCode).toBe(400);
    expect(missingEvent.json()).toMatchObject({ error: "invalid_observe_request" });
    expect(oversizedBatch.statusCode).toBe(400);
    expect(deeplyNested.statusCode).toBe(400);
    expect(infoSpy).not.toHaveBeenCalled();

    await app.close();
  });

  it("rate-limits observability by event count and resets after the fixed window", async () => {
    let nowMs = Date.UTC(2026, 7, 21, 12, 0, 0);
    const app = createProxyServer({
      allowedHosts: ["*"],
      logger: false,
      sweepIntervalMs: 0,
      observeRateLimitPerMinute: 2,
      observeNow: () => nowMs,
    });

    const accepted = await app.inject({
      method: "POST",
      url: "/observe",
      payload: {
        events: [
          { event: "playback.started" },
          { event: "playback.progress" },
        ],
      },
    });
    const limited = await app.inject({
      method: "POST",
      url: "/observe",
      payload: { event: "playback.stopped" },
    });
    nowMs += 60_001;
    const reset = await app.inject({
      method: "POST",
      url: "/observe",
      payload: { event: "playback.stopped" },
    });

    expect(accepted.statusCode).toBe(204);
    expect(limited.statusCode).toBe(429);
    expect(limited.headers["retry-after"]).toBe("60");
    expect(reset.statusCode).toBe(204);

    await app.close();
  });

  it("uses Fastify's trusted-proxy address for observability rate limits", async () => {
    const app = createProxyServer({
      allowedHosts: ["*"],
      logger: false,
      sweepIntervalMs: 0,
      observeRateLimitPerMinute: 1,
      trustProxyHops: 1,
    });

    const send = (clientIp: string) => app.inject({
      method: "POST",
      url: "/observe",
      headers: { "x-forwarded-for": clientIp },
      payload: { event: "playback.started" },
    });

    expect((await send("203.0.113.10")).statusCode).toBe(204);
    expect((await send("203.0.113.11")).statusCode).toBe(204);
    expect((await send("203.0.113.10")).statusCode).toBe(429);

    await app.close();
  });

  it("does not return proxy-remuxed from gateway resolve even when env tries to allow remux", async () => {
    const app = createProxyServer({
      allowedHosts: ["*"],
      env: REMUX_ALLOWED_ENV,
      logger: false,
      sweepIntervalMs: 0,
      remuxController: createTestRemuxController(),
    });

    const requestBody = {
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
        epgCoverageState: "available",
      },
    };

    const first = await app.inject({
      method: "POST",
      url: "/catchup-gateway/resolve",
      payload: requestBody,
    });
    const second = await app.inject({
      method: "POST",
      url: "/catchup-gateway/resolve",
      payload: requestBody,
    });

    expect(first.statusCode).toBe(200);
    expect(first.json()).toMatchObject({
      channelId: "channel-1",
      programId: "program-1",
      transportMode: "proxy-normalized",
      hotStart: false,
      assetState: "ready",
    });
    expect(second.json()).toMatchObject({
      channelId: "channel-1",
      programId: "program-1",
      transportMode: "proxy-normalized",
      hotStart: true,
      assetState: "ready",
    });
    expect(first.json().playbackUrl).toContain("__lumenTransport=normalized");
    expect(first.json().playbackUrl).not.toContain("__lumenTransport=remux-hls");

    await app.close();
  });

  it("rejects direct remux playback requests before any upstream fetch", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("upstream-body", {
      status: 200,
      headers: {
        "content-type": "video/mp2t",
      },
    }));
    const app = createProxyServer({
      allowedHosts: ["login.example"],
      fetchImpl: fetchMock as typeof fetch,
      logger: false,
      sweepIntervalMs: 0,
      remuxController: createTestRemuxController(),
    });

    const response = await app.inject({
      method: "GET",
      url: `/xui-api/${encodeTarget("https://login.example")}/timeshift/user/pass/1800/2026-03-08:08-30/112.ts?__lumenTransport=remux-hls&__lumenProgramId=program-1`,
    });

    expect(response.statusCode).toBe(410);
    expect(response.json()).toMatchObject({
      error: "remux_disabled",
    });
    expect(fetchMock).not.toHaveBeenCalled();

    await app.close();
  });

  it("rejects invalid catch-up gateway resolve requests", async () => {
    const app = createProxyServer({
      allowedHosts: ["*"],
      logger: false,
      sweepIntervalMs: 0,
      remuxController: createTestRemuxController(),
    });

    const response = await app.inject({
      method: "POST",
      url: "/catchup-gateway/resolve",
      payload: {
        channelId: "channel-1",
      },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({
      error: "invalid_resolve_request",
    });

    await app.close();
  });

  it("responds to catch-up gateway preflight with POST CORS allowance", async () => {
    const app = createProxyServer({
      allowedHosts: ["*"],
      logger: false,
      sweepIntervalMs: 0,
      remuxController: createTestRemuxController(),
    });

    const response = await app.inject({
      method: "OPTIONS",
      url: "/catchup-gateway/resolve",
    });

    expect(response.statusCode).toBe(204);
    expect(response.headers["access-control-allow-origin"]).toBe("*");
    expect(response.headers["access-control-allow-methods"]).toContain("POST");

    await app.close();
  });

  it("narrows CORS to the configured Cast origin when an allowlist is set (M1.3-e)", async () => {
    const app = createProxyServer({
      allowedHosts: ["*"],
      allowedCorsOrigins: ["https://cast.lumenplayer.com", "https://app.example"],
      logger: false,
      sweepIntervalMs: 0,
      remuxController: createTestRemuxController(),
    });

    const echoed = await app.inject({
      method: "OPTIONS",
      url: "/catchup-gateway/resolve",
      headers: { origin: "https://app.example" },
    });
    expect(echoed.headers["access-control-allow-origin"]).toBe("https://app.example");
    expect(echoed.headers.vary).toContain("Origin");

    const fallback = await app.inject({
      method: "OPTIONS",
      url: "/catchup-gateway/resolve",
      headers: { origin: "https://not-allowed.example" },
    });
    expect(fallback.headers["access-control-allow-origin"]).toBe("https://cast.lumenplayer.com");

    await app.close();
  });

  it("keeps wildcard CORS when no allowlist is configured (M1.3-e default)", async () => {
    const app = createProxyServer({
      allowedHosts: ["*"],
      logger: false,
      sweepIntervalMs: 0,
      remuxController: createTestRemuxController(),
    });

    const response = await app.inject({
      method: "OPTIONS",
      url: "/catchup-gateway/resolve",
      headers: { origin: "https://app.example" },
    });
    expect(response.headers["access-control-allow-origin"]).toBe("*");

    await app.close();
  });

  it("rejects remux manifest requests even when env tries to allow remux", async () => {
    const app = createProxyServer({
      allowedHosts: ["*"],
      env: REMUX_ALLOWED_ENV,
      logger: false,
      sweepIntervalMs: 0,
      remuxController: createTestRemuxController(),
    });

    const response = await app.inject({
      method: "GET",
      url: `/xui-api/${encodeTarget("https://login.example")}/timeshift/user/pass/1800/2026-03-08:08-30/112.ts?__lumenTransport=remux-hls&__lumenProgramId=program-1`,
    });

    expect(response.statusCode).toBe(410);
    expect(response.json()).toMatchObject({
      error: "remux_disabled",
    });

    await app.close();
  });

  it("rejects remux asset endpoints with CORS headers", async () => {
    const app = createProxyServer({
      allowedHosts: ["*"],
      env: REMUX_ALLOWED_ENV,
      logger: false,
      sweepIntervalMs: 0,
      remuxController: createTestRemuxController(),
    });

    const initResponse = await app.inject({
      method: "GET",
      url: "/xui-api/__remux__/session/session-1/init.mp4",
    });
    const segmentResponse = await app.inject({
      method: "GET",
      url: "/xui-api/__remux__/session/session-1/segment/0.m4s",
    });

    expect(initResponse.statusCode).toBe(410);
    expect(initResponse.headers["access-control-allow-origin"]).toBe("*");
    expect(initResponse.json()).toMatchObject({
      error: "remux_disabled",
    });
    expect(segmentResponse.statusCode).toBe(410);
    expect(segmentResponse.json()).toMatchObject({
      error: "remux_disabled",
    });

    await app.close();
  });

  it("returns missing_target when encoded target is invalid", async () => {
    const fetchMock = vi.fn();
    const app = createProxyServer({
      allowedHosts: ["*"],
      fetchImpl: fetchMock as typeof fetch,
      logger: false,
      remuxController: createTestRemuxController(),
    });

    const response = await app.inject({
      method: "GET",
      url: "/xui-api/not-a-valid-url/player_api.php",
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({
      error: "missing_target",
    });
    expect(fetchMock).not.toHaveBeenCalled();
    await app.close();
  });

  it("blocks outbound host outside allowlist", async () => {
    const fetchMock = vi.fn();
    const app = createProxyServer({
      allowedHosts: ["allowed.example"],
      fetchImpl: fetchMock as typeof fetch,
      logger: false,
      remuxController: createTestRemuxController(),
    });

    const response = await app.inject({
      method: "GET",
      url: `/xui-api/${encodeTarget("https://blocked.example")}/player_api.php?action=get_live_streams`,
    });

    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({
      error: "blocked_host",
    });
    expect(fetchMock).not.toHaveBeenCalled();
    await app.close();
  });

  it("rewrites upstream redirects back into /xui-api contract", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(null, {
        status: 302,
        headers: {
          location: "https://edge.example/streaming/timeshift.php?token=abc123",
        },
      }),
    );

    const app = createProxyServer({
      allowedHosts: ["login.example", "edge.example"],
      fetchImpl: fetchMock as typeof fetch,
      logger: false,
      remuxController: createTestRemuxController(),
    });

    const response = await app.inject({
      method: "GET",
      url: `/xui-api/${encodeTarget("https://login.example:8080")}/timeshift/demo/user/3600/2026-03-04:20-10/112.ts`,
    });

    expect(response.statusCode).toBe(302);
    expect(response.headers.location).toBe(
      `/xui-api/${encodeTarget("https://edge.example")}/streaming/timeshift.php?token=abc123`,
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await app.close();
  });

  it("preserves catch-up m3u8 token redirects through the proxy contract", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(null, {
        status: 302,
        headers: {
          location: "https://edge.example/streaming/timeshift.php?token=abc123",
        },
      }),
    );

    const app = createProxyServer({
      allowedHosts: ["login.example", "edge.example"],
      fetchImpl: fetchMock as typeof fetch,
      logger: false,
      remuxController: createTestRemuxController(),
    });

    const response = await app.inject({
      method: "GET",
      url: `/xui-api/${encodeTarget("https://login.example:8080")}/streaming/timeshift.php?username=demo&password=secret&stream=112&start=2026-03-04:20-10&duration=60&extension=m3u8`,
    });

    expect(response.statusCode).toBe(302);
    expect(response.headers.location).toBe(
      `/xui-api/${encodeTarget("https://edge.example")}/streaming/timeshift.php?token=abc123`,
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await app.close();
  });

  it("rewrites root-relative timeshift_hls manifest assets back through the proxy contract", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response([
      "#EXTM3U",
      "#EXT-X-PLAYLIST-TYPE:VOD",
      "#EXTINF:6.000,",
      "/timeshift_hls/demo/secret/60/2026-03-04:20-10/112_0_0.ts",
      "#EXT-X-ENDLIST",
    ].join("\n"), {
      status: 200,
      headers: {
        "content-type": "application/x-mpegurl",
      },
    }));

    const app = createProxyServer({
      allowedHosts: ["edge.example"],
      fetchImpl: fetchMock as typeof fetch,
      logger: false,
      remuxController: createTestRemuxController(),
    });

    const response = await app.inject({
      method: "GET",
      url: `/xui-api/${encodeTarget("https://edge.example")}/timeshift_hls/demo/secret/60/2026-03-04:20-10/112.m3u8`,
    });

    expect(response.statusCode).toBe(200);
    expect(response.payload).toContain(
      `/xui-api/${encodeTarget("https://edge.example")}/timeshift_hls/demo/secret/60/2026-03-04:20-10/112_0_0.ts`,
    );
    await app.close();
  });

  it("rewrites absolute timeshift_hls manifest assets back through the proxy contract", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response([
      "#EXTM3U",
      "#EXT-X-PLAYLIST-TYPE:VOD",
      "#EXTINF:6.000,",
      "https://edge.example/timeshift_hls/demo/secret/60/2026-03-04:20-10/112_0_0.ts",
      "#EXT-X-ENDLIST",
    ].join("\n"), {
      status: 200,
      headers: {
        "content-type": "application/x-mpegurl",
      },
    }));

    const app = createProxyServer({
      allowedHosts: ["edge.example"],
      fetchImpl: fetchMock as typeof fetch,
      logger: false,
      remuxController: createTestRemuxController(),
    });

    const response = await app.inject({
      method: "GET",
      url: `/xui-api/${encodeTarget("https://edge.example")}/timeshift_hls/demo/secret/60/2026-03-04:20-10/112.m3u8`,
    });

    expect(response.statusCode).toBe(200);
    expect(response.payload).toContain(
      `/xui-api/${encodeTarget("https://edge.example")}/timeshift_hls/demo/secret/60/2026-03-04:20-10/112_0_0.ts`,
    );
    expect(response.payload).not.toContain("https://edge.example/timeshift_hls/");
    await app.close();
  });

  it("marks MediaKing archive segment one as a discontinuity to prevent browser backtracking to segment zero", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response([
      "#EXTM3U",
      "#EXT-X-VERSION:3",
      "#EXT-X-TARGETDURATION:60",
      "#EXT-X-MEDIA-SEQUENCE:0",
      "#EXT-X-PLAYLIST-TYPE:VOD",
      "#EXTINF:60,",
      "/streaming/timeshift.php?token=abc&seg=0_21794816.ts",
      "#EXTINF:60,",
      "/streaming/timeshift.php?token=abc&seg=1_21512192.ts",
      "#EXTINF:60,",
      "/streaming/timeshift.php?token=abc&seg=2_21233664.ts",
      "#EXT-X-ENDLIST",
    ].join("\n"), {
      status: 200,
      headers: {
        "content-type": "application/x-mpegurl",
      },
    }));

    const app = createProxyServer({
      allowedHosts: ["oveu.mediaking.fi"],
      fetchImpl: fetchMock as typeof fetch,
      logger: false,
      remuxController: createTestRemuxController(),
    });

    const response = await app.inject({
      method: "GET",
      url: `/xui-api/${encodeTarget("http://oveu.mediaking.fi:8080")}/streaming/timeshift.php?token=abc`,
    });

    expect(response.statusCode).toBe(200);
    expect(response.payload).toContain([
      "/streaming/timeshift.php?token=abc&seg=0_21794816.ts",
      "#EXT-X-DISCONTINUITY",
      "#EXTINF:60,",
      "/streaming/timeshift.php?token=abc&seg=1_21512192.ts",
    ].join("\n").replaceAll(
      "/streaming/",
      `/xui-api/${encodeTarget("http://oveu.mediaking.fi:8080")}/streaming/`,
    ));
    await app.close();
  });

  it("strips leading junk bytes from MediaKing archive transport stream segments", async () => {
    const leadingJunk = Buffer.from([0xbc, 0xf9, 0xaa, 0xd7]);
    const packet = Buffer.alloc(188, 0);
    packet[0] = 0x47;
    const segmentBody = Buffer.concat([leadingJunk, packet, packet]);
    const fetchMock = vi.fn().mockResolvedValue(new Response(segmentBody, {
      status: 200,
      headers: {
        "content-type": "video/mp2t",
        "content-length": String(segmentBody.length),
      },
    }));

    const app = createProxyServer({
      allowedHosts: ["oveu.mediaking.fi"],
      fetchImpl: fetchMock as typeof fetch,
      logger: false,
      remuxController: createTestRemuxController(),
    });

    const response = await app.inject({
      method: "GET",
      url: `/xui-api/${encodeTarget("http://oveu.mediaking.fi:8080")}/streaming/timeshift.php?token=abc&seg=1_21512192.ts`,
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toContain("video/mp2t");
    expect(response.headers["content-length"]).toBe(String(segmentBody.length - leadingJunk.length));
    expect(response.rawPayload[0]).toBe(0x47);
    expect(response.rawPayload.length).toBe(segmentBody.length - leadingJunk.length);
    await app.close();
  });

  it("retries once on transport failure for GET and then returns upstream payload", async () => {
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(new TypeError("fetch failed"))
      .mockResolvedValueOnce(new Response("#EXTM3U", {
        status: 200,
        headers: {
          "content-type": "application/x-mpegurl",
        },
      }));

    const app = createProxyServer({
      allowedHosts: ["login.example"],
      retryCount: 1,
      fetchImpl: fetchMock as typeof fetch,
      logger: false,
      remuxController: createTestRemuxController(),
    });

    const response = await app.inject({
      method: "GET",
      url: `/xui-api/${encodeTarget("https://login.example")}/streaming/timeshift.php?stream=112`,
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toContain("application/x-mpegurl");
    await app.close();
  });

  it("does not retry on upstream HTTP 5xx", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("upstream fail", {
      status: 502,
      headers: {
        "content-type": "text/plain",
      },
    }));

    const app = createProxyServer({
      allowedHosts: ["login.example"],
      retryCount: 1,
      fetchImpl: fetchMock as typeof fetch,
      logger: false,
      remuxController: createTestRemuxController(),
    });

    const response = await app.inject({
      method: "GET",
      url: `/xui-api/${encodeTarget("https://login.example")}/live/demo/user/112.ts`,
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(response.statusCode).toBe(502);
    expect(response.headers["content-type"]).toContain("text/plain");
    await app.close();
  });

  it("requests identity encoding and strips decoded-body headers", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('{"ok":true}', {
      status: 200,
      headers: {
        "content-type": "application/json",
        "content-encoding": "gzip",
        "content-length": "999",
      },
    }));

    const app = createProxyServer({
      allowedHosts: ["login.example"],
      retryCount: 0,
      fetchImpl: fetchMock as typeof fetch,
      logger: false,
      remuxController: createTestRemuxController(),
    });

    const response = await app.inject({
      method: "GET",
      url: `/xui-api/${encodeTarget("https://login.example")}/player_api.php`,
      headers: {
        "accept-encoding": "gzip, deflate, br",
      },
    });

    const forwardedHeaders = fetchMock.mock.calls[0]?.[1]?.headers;
    expect(forwardedHeaders).toBeInstanceOf(Headers);
    expect((forwardedHeaders as Headers).get("accept-encoding")).toBe("identity");
    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toContain("application/json");
    expect(response.headers["content-encoding"]).toBeUndefined();
    expect(response.headers["content-length"]).toBeUndefined();
    expect(response.payload).toBe('{"ok":true}');
    await app.close();
  });

  it("returns upstream_timeout when request exceeds timeout budget", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new DOMException("Aborted", "AbortError"));

    const app = createProxyServer({
      allowedHosts: ["login.example"],
      retryCount: 0,
      timeoutMs: 5,
      fetchImpl: fetchMock as typeof fetch,
      logger: false,
      remuxController: createTestRemuxController(),
    });

    const response = await app.inject({
      method: "GET",
      url: `/xui-api/${encodeTarget("https://login.example")}/player_api.php?action=get_live_categories`,
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(response.statusCode).toBe(504);
    expect(response.json()).toMatchObject({
      error: "upstream_timeout",
    });
    await app.close();
  });

  it("gives shadow remux (timeshift_shadow.php) a longer timeout than the default budget", async () => {
    // Default budget is tiny (5ms). The shadow budget is generous. A fetch that
    // resolves after ~40ms must time out on a normal request but succeed for a
    // shadow request — proving the per-request shadow timeout is applied.
    const slowOk = (waitMs: number) => vi.fn().mockImplementation((
      _url: unknown,
      init?: { signal?: AbortSignal },
    ) => new Promise((resolve, reject) => {
      const signal = init?.signal;
      const timer = setTimeout(() => resolve(new Response("#EXTM3U\n", {
        status: 200,
        headers: { "content-type": "application/vnd.apple.mpegurl" },
      })), waitMs);
      // Honour the abort signal like the real fetch does, so the default-budget
      // path actually times out.
      signal?.addEventListener("abort", () => {
        clearTimeout(timer);
        reject(new DOMException("Aborted", "AbortError"));
      });
    }));

    // 1) normal request with tiny default budget -> times out
    const normalFetch = slowOk(40);
    const normalApp = createProxyServer({
      allowedHosts: ["edge6.castcdn.net"],
      retryCount: 0,
      timeoutMs: 5,
      fetchImpl: normalFetch as unknown as typeof fetch,
      logger: false,
      remuxController: createTestRemuxController(),
    });
    const normalResponse = await normalApp.inject({
      method: "GET",
      url: `/xui-api/${encodeTarget("https://edge6.castcdn.net")}/streaming/timeshift.php?token=abc&extension=m3u8`,
    });
    expect(normalResponse.statusCode).toBe(504);
    await normalApp.close();

    // 2) shadow request with the same tiny default budget but a generous shadow
    //    budget -> succeeds
    const shadowFetch = slowOk(40);
    const shadowApp = createProxyServer({
      allowedHosts: ["edge6.castcdn.net"],
      retryCount: 0,
      timeoutMs: 5,
      env: { ...process.env, XTREAM_PROXY_SHADOW_TIMEOUT_MS: "5000" },
      fetchImpl: shadowFetch as unknown as typeof fetch,
      logger: false,
      remuxController: createTestRemuxController(),
    });
    const shadowResponse = await shadowApp.inject({
      method: "GET",
      url: `/xui-api/${encodeTarget("https://edge6.castcdn.net")}/streaming/timeshift_shadow.php?token=abc&extension=m3u8`,
    });
    expect(shadowResponse.statusCode).toBe(200);
    await shadowApp.close();
  });

  it("streams media payload from real upstream without buffering", async () => {
    const upstream = createServer((_, response) => {
      response.writeHead(200, {
        "content-type": "video/mp2t",
      });
      response.end("segment-data");
    });

    const upstreamPort = await new Promise<number>((resolve) => {
      upstream.listen(0, "127.0.0.1", () => {
        const address = upstream.address();
        if (address && typeof address === "object") {
          resolve(address.port);
        }
      });
    });

    const app = createProxyServer({
      allowedHosts: ["127.0.0.1"],
      logger: false,
      remuxController: createTestRemuxController(),
    });

    await app.listen({
      host: "127.0.0.1",
      port: 0,
    });
    const proxyAddress = app.server.address();
    const proxyPort = typeof proxyAddress === "object" && proxyAddress ? proxyAddress.port : 0;

    const response = await fetch(
      `http://127.0.0.1:${proxyPort}/xui-api/${encodeTarget(`http://127.0.0.1:${upstreamPort}`)}/live/demo/user/112.ts`,
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("access-control-allow-origin")).toBe("*");
    expect(response.headers.get("access-control-expose-headers")).toBe("*");
    expect(response.headers.get("content-type") ?? "").toContain("video/mp2t");
    expect(await response.text()).toBe("segment-data");

    await app.close();
    await new Promise<void>((resolve, reject) => {
      upstream.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });
  });
});
