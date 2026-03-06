import { describe, expect, it } from "vitest";
import {
  CatchUpRemuxSessionCache,
  createCatchUpRemuxFeatureGate,
  createRemuxedCatchUpManifest,
  parseCatchUpRemuxAssetRequest,
  shouldUseCatchUpRemux,
} from "./catchup-remuxer.js";

const createPtsBytes = (pts: number): number[] => [
  0x20 | (((pts >> 30) & 0x07) << 1) | 0x01,
  (pts >> 22) & 0xff,
  (((pts >> 15) & 0x7f) << 1) | 0x01,
  (pts >> 7) & 0xff,
  ((pts & 0x7f) << 1) | 0x01,
];

const createPesPacket = ({
  pid,
  streamId,
  pts,
  continuityCounter,
}: {
  pid: number;
  streamId: number;
  pts: number;
  continuityCounter: number;
}): Buffer => {
  const packet = Buffer.alloc(188, 0xff);
  packet[0] = 0x47;
  packet[1] = 0x40 | ((pid >> 8) & 0x1f);
  packet[2] = pid & 0xff;
  packet[3] = 0x10 | (continuityCounter & 0x0f);

  const payload = [
    0x00, 0x00, 0x01, streamId,
    0x00, 0x00,
    0x80,
    0x80,
    0x05,
    ...createPtsBytes(pts),
  ];

  Buffer.from(payload).copy(packet, 4);
  return packet;
};

const createSyntheticSegment = (syncOffsetBytes: number, durationSeconds: number): Buffer => {
  const videoPid = 0x101;
  const ptsValues = [
    0,
    Math.floor(durationSeconds * 30_000),
    Math.floor(durationSeconds * 60_000),
    Math.floor(durationSeconds * 90_000),
  ];
  const packets = ptsValues.map((pts, index) => (
    createPesPacket({
      pid: videoPid,
      streamId: 0xe0,
      pts,
      continuityCounter: index,
    })
  ));

  const preamble = Buffer.alloc(syncOffsetBytes, 0xaa);
  return Buffer.concat([preamble, ...packets, ...packets, ...packets]);
};

const SYNTHETIC_SEGMENT = createSyntheticSegment(146, 42.08);

const logger = {
  info: () => {},
  warn: () => {},
  error: () => {},
};

describe("catch-up remux feature gate", () => {
  it("enables remux only for matching proxied catch-up hints", () => {
    const featureGate = createCatchUpRemuxFeatureGate({
      LUMEN_PROXY_REMUX_ENABLED: "1",
      LUMEN_PROXY_REMUX_STREAM_IDS: "112",
      LUMEN_PROXY_REMUX_PROGRAM_IDS: "program-1",
      LUMEN_PROXY_REMUX_HOSTS: "login.example",
    });

    expect(shouldUseCatchUpRemux(
      new URL(
        "https://login.example/streaming/timeshift.php?stream=112&start=1772695800&duration=148&__lumenProgramId=program-1&__lumenTransport=remux-hls",
      ),
      featureGate,
    )).toBe(true);

    expect(shouldUseCatchUpRemux(
      new URL(
        "https://login.example/streaming/timeshift.php?stream=2927&start=1772695800&duration=148&__lumenProgramId=program-1&__lumenTransport=remux-hls",
      ),
      featureGate,
    )).toBe(false);
  });
});

describe("catch-up remux manifest", () => {
  it("rewrites a catch-up manifest into remuxed HLS session assets", async () => {
    const sessionCache = new CatchUpRemuxSessionCache();
    let manifestFetchCount = 0;

    const manifest = await createRemuxedCatchUpManifest({
      upstreamUrl: new URL(
        "https://login.example/timeshift/user/pass/148/1772695800/112.m3u8?__lumenProgramId=program-1&__lumenTransport=remux-hls",
      ),
      requestHeaders: new Headers(),
      sessionCache,
      logger,
      fetchImpl: async (input) => {
        const url = typeof input === "string" ? input : input.toString();
        if (url.endsWith(".m3u8")) {
          manifestFetchCount += 1;
          return new Response(
            [
              "#EXTM3U",
              "#EXT-X-VERSION:3",
              "#EXTINF:42.08,",
              "segment0.ts",
              "#EXTINF:42.08,",
              "segment1.ts",
              "#EXT-X-ENDLIST",
            ].join("\n"),
            {
              status: 200,
              headers: {
                "content-type": "application/vnd.apple.mpegurl",
              },
            },
          );
        }

        return new Response(new Uint8Array(SYNTHETIC_SEGMENT), {
          status: 200,
          headers: {
            "content-type": "video/mp2t",
          },
        });
      },
    });

    expect(manifest.contentType).toContain("mpegurl");
    expect(manifest.body).toContain("#EXT-X-MAP:URI=\"/xui-api/__remux__/session/");
    expect(manifest.body).toContain("/segment/0.m4s");
    expect(manifest.body).toContain("/segment/1.m4s");
    expect(manifestFetchCount).toBe(1);

    const remuxInitPath = manifest.body
      .split("\n")
      .find((line) => line.includes("/init.mp4"));
    expect(remuxInitPath).toBeTruthy();

    const parsedAsset = parseCatchUpRemuxAssetRequest(
      new URL(`http://localhost${remuxInitPath?.match(/"([^"]+)"/)?.[1] ?? ""}`),
    );
    expect(parsedAsset).toEqual({
      sessionId: expect.any(String),
      kind: "init",
      segmentIndex: null,
    });
  });

  it("reuses remux sessions for the same sanitized upstream request", async () => {
    const sessionCache = new CatchUpRemuxSessionCache();
    let manifestFetchCount = 0;

    const fetchImpl = async (input: string | URL | Request): Promise<Response> => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("timeshift.php") || url.endsWith(".m3u8")) {
        manifestFetchCount += 1;
        return new Response(
          [
            "#EXTM3U",
            "#EXTINF:42.08,",
            "segment0.ts",
            "#EXT-X-ENDLIST",
          ].join("\n"),
          {
            status: 200,
            headers: {
              "content-type": "application/vnd.apple.mpegurl",
            },
          },
        );
      }

      return new Response(new Uint8Array(SYNTHETIC_SEGMENT), {
        status: 200,
        headers: {
          "content-type": "video/mp2t",
        },
      });
    };

    const first = await createRemuxedCatchUpManifest({
      upstreamUrl: new URL(
        "https://login.example/streaming/timeshift.php?stream=112&start=1772695800&duration=148&__lumenProgramId=program-1&__lumenTransport=remux-hls",
      ),
      requestHeaders: new Headers(),
      sessionCache,
      logger,
      fetchImpl,
    });

    const second = await createRemuxedCatchUpManifest({
      upstreamUrl: new URL(
        "https://login.example/streaming/timeshift.php?stream=112&start=1772695800&duration=148&__lumenProgramId=program-1&__lumenTransport=remux-hls&__lumenFallbackReason=boundary-stall",
      ),
      requestHeaders: new Headers(),
      sessionCache,
      logger,
      fetchImpl,
    });

    expect(first.body).toBe(second.body);
    expect(manifestFetchCount).toBe(1);
  });
});
