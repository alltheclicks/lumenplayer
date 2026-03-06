import { describe, expect, it } from "vitest";
import {
  findTransportStreamSyncOffset,
  inspectTransportStreamSegment,
  stripTransportStreamPreamble,
} from "./transport-stream.js";

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

describe("transport stream inspection", () => {
  it.each([146, 168, 132])("detects the stable sync offset at %i bytes", (syncOffsetBytes) => {
    const segment = createSyntheticSegment(syncOffsetBytes, 42.08);
    expect(findTransportStreamSyncOffset(segment)).toBe(syncOffsetBytes);

    const cleaned = stripTransportStreamPreamble(segment);
    expect(cleaned[0]).toBe(0x47);
  });

  it("extracts first and last PTS and computes normalized duration", () => {
    const segment = createSyntheticSegment(146, 42.08);
    const inspection = inspectTransportStreamSegment(segment);

    expect(inspection.syncOffsetBytes).toBe(146);
    expect(inspection.streamKind).toBe("video");
    expect(inspection.cleanedBuffer[0]).toBe(0x47);
    expect(inspection.normalizedDurationSeconds).toBeCloseTo(42.08, 2);
  });
});
