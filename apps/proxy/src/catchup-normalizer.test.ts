import http from "node:http";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createProxyServer,
} from "./server.js";

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

  return Buffer.concat([
    Buffer.alloc(syncOffsetBytes, 0xaa),
    ...packets,
    ...packets,
    ...packets,
  ]);
};

const listen = async (server: http.Server): Promise<number> => {
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve());
  });

  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Unable to resolve test server port.");
  }

  return address.port;
};

describe("proxy catch-up normalization", () => {
  let upstreamServer: http.Server | null = null;
  let proxyServer: http.Server | null = null;

  beforeEach(async () => {
    const upstreamSegment0 = createSyntheticSegment(146, 42.08);
    const upstreamSegment1 = createSyntheticSegment(168, 59.16);

    upstreamServer = http.createServer((request, response) => {
      const requestUrl = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);

      if (requestUrl.pathname === "/timeshift/user/pass/148/2026-03-05:08-30/112.m3u8") {
        response.writeHead(302, {
          location: "/edge/manifest.m3u8",
        });
        response.end();
        return;
      }

      if (requestUrl.pathname === "/edge/manifest.m3u8") {
        response.writeHead(200, { "content-type": "application/vnd.apple.mpegurl" });
        response.end([
          "#EXTM3U",
          "#EXT-X-VERSION:3",
          "#EXT-X-TARGETDURATION:60",
          "#EXTINF:60,",
          "segment0.ts",
          "#EXTINF:60,",
          "segment1.ts",
          "#EXT-X-ENDLIST",
        ].join("\n"));
        return;
      }

      if (requestUrl.pathname === "/edge/segment0.ts") {
        response.writeHead(200, { "content-type": "video/mp2t" });
        response.end(upstreamSegment0);
        return;
      }

      if (requestUrl.pathname === "/edge/segment1.ts") {
        response.writeHead(200, { "content-type": "video/mp2t" });
        response.end(upstreamSegment1);
        return;
      }

      if (requestUrl.pathname === "/player_api.php") {
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify({ ok: true, path: requestUrl.pathname }));
        return;
      }

      response.writeHead(404);
      response.end("not-found");
    });

    proxyServer = createProxyServer();
  });

  afterEach(async () => {
    await Promise.all([
      new Promise<void>((resolve) => upstreamServer?.close(() => resolve())),
      new Promise<void>((resolve) => proxyServer?.close(() => resolve())),
    ]);
    upstreamServer = null;
    proxyServer = null;
  });

  it("rewrites catch-up manifests to same-origin normalized segment URLs", async () => {
    if (!upstreamServer || !proxyServer) {
      throw new Error("Test servers were not initialized.");
    }

    const [upstreamPort, proxyPort] = await Promise.all([listen(upstreamServer), listen(proxyServer)]);
    const encodedTarget = encodeURIComponent(`http://127.0.0.1:${upstreamPort}`);

    const response = await fetch(
      `http://127.0.0.1:${proxyPort}/xui-api/${encodedTarget}/timeshift/user/pass/148/2026-03-05:08-30/112.m3u8?__lumenProgramId=program-1`,
    );
    const manifestBody = await response.text();

    expect(response.status).toBe(200);
    expect(manifestBody).toContain("#EXT-X-TARGETDURATION:60");
    expect(manifestBody).toContain("#EXTINF:42.08,");
    expect(manifestBody).toContain("/xui-api/__normalized__/segment/");
    expect(manifestBody).not.toContain("segment0.ts");

    const normalizedSegmentPath = manifestBody
      .split("\n")
      .find((line) => line.startsWith("/xui-api/__normalized__/segment/"));
    expect(normalizedSegmentPath).toBeTruthy();

    const segmentResponse = await fetch(`http://127.0.0.1:${proxyPort}${normalizedSegmentPath}`);
    const segmentBuffer = Buffer.from(await segmentResponse.arrayBuffer());

    expect(segmentResponse.status).toBe(200);
    expect(segmentResponse.headers.get("content-type")).toContain("video/mp2t");
    expect(segmentBuffer[0]).toBe(0x47);
  });

  it("keeps non-catch-up xui-api traffic as transparent pass-through", async () => {
    if (!upstreamServer || !proxyServer) {
      throw new Error("Test servers were not initialized.");
    }

    const [upstreamPort, proxyPort] = await Promise.all([listen(upstreamServer), listen(proxyServer)]);
    const encodedTarget = encodeURIComponent(`http://127.0.0.1:${upstreamPort}`);

    const response = await fetch(`http://127.0.0.1:${proxyPort}/xui-api/${encodedTarget}/player_api.php?action=test`);
    const payload = await response.json() as { ok: boolean; path: string };

    expect(response.status).toBe(200);
    expect(payload).toEqual({
      ok: true,
      path: "/player_api.php",
    });
  });
});
