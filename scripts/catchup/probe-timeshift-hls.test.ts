import { spawnSync } from "node:child_process";

import { describe, expect, it } from "vitest";

import { parseManifest, pickSampleSegments } from "./probe-timeshift-hls.mjs";

describe("probe-timeshift-hls helpers", () => {
  it("blocks direct CLI probes before local media tools can run", () => {
    const result = spawnSync(process.execPath, [
      "scripts/catchup/probe-timeshift-hls.mjs",
      "--url",
      "https://edge.example/archive/index.m3u8",
      "--ffmpeg-bin",
      "should-not-run",
      "--ffprobe-bin",
      "should-not-run",
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
    });

    expect(result.status).toBe(2);
    expect(result.stderr).toContain("Local timeshift HLS ffmpeg/ffprobe probing is disabled");
    expect(result.stderr).not.toContain("should-not-run");
  });

  it("parses media segments and cumulative durations from an HLS manifest", () => {
    const manifest = parseManifest(
      [
        "#EXTM3U",
        "#EXT-X-VERSION:3",
        "#EXTINF:6.000,",
        "seg-0.ts",
        "#EXTINF:5.500,",
        "https://edge.example/seg-1.ts",
        "#EXT-X-ENDLIST",
      ].join("\n"),
      "https://edge.example/archive/index.m3u8",
    );

    expect(manifest.segments).toHaveLength(2);
    expect(manifest.segments[0]).toMatchObject({
      index: 0,
      durationSeconds: 6,
      startSeconds: 0,
      url: "https://edge.example/archive/seg-0.ts",
    });
    expect(manifest.segments[1]).toMatchObject({
      index: 1,
      durationSeconds: 5.5,
      startSeconds: 6,
      url: "https://edge.example/seg-1.ts",
    });
    expect(manifest.totalDurationSeconds).toBeCloseTo(11.5);
  });

  it("selects checkpoint samples plus the last segment without duplicates", () => {
    const manifest = parseManifest(
      [
        "#EXTM3U",
        "#EXTINF:10.000,",
        "seg-0.ts",
        "#EXTINF:10.000,",
        "seg-1.ts",
        "#EXTINF:10.000,",
        "seg-2.ts",
      ].join("\n"),
      "https://edge.example/archive/index.m3u8",
    );

    const samples = pickSampleSegments(manifest.segments, [0, 25, 35]);

    expect(samples.map((entry) => entry.segment.index)).toEqual([0, 2]);
    expect(samples.map((entry) => entry.checkpointSeconds)).toEqual([0, 20]);
  });
});
