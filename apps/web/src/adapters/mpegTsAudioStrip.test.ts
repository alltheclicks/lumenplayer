import { describe, expect, it } from 'vitest';
import {
  detectMpegTsAudio,
  stripUnsupportedMpegAudioFromTs,
} from './mpegTsAudioStrip';

const TS_PACKET_SIZE = 188;
const PMT_PID = 0x1000;
const VIDEO_PID = 0x0100;
const AUDIO_PID = 0x0101;

const buildSection = (tableId: number, body: number[]): Uint8Array => {
  const sectionLength = body.length + 4;
  const section = new Uint8Array(3 + sectionLength);
  section[0] = tableId;
  section[1] = 0xb0 | ((sectionLength >> 8) & 0x0f);
  section[2] = sectionLength & 0xff;
  section.set(body, 3);
  return section;
};

const buildPacket = (pid: number, payload: Uint8Array, payloadUnitStart = true): Uint8Array => {
  const packet = new Uint8Array(TS_PACKET_SIZE);
  packet.fill(0xff);
  packet[0] = 0x47;
  packet[1] = ((payloadUnitStart ? 0x40 : 0) | ((pid >> 8) & 0x1f));
  packet[2] = pid & 0xff;
  packet[3] = 0x10;
  let offset = 4;
  if (payloadUnitStart) {
    packet[offset] = 0;
    offset += 1;
  }
  packet.set(payload.subarray(0, TS_PACKET_SIZE - offset), offset);
  return packet;
};

const concatPackets = (packets: Uint8Array[]): Uint8Array => {
  const output = new Uint8Array(packets.length * TS_PACKET_SIZE);
  packets.forEach((packet, index) => {
    output.set(packet, index * TS_PACKET_SIZE);
  });
  return output;
};

const buildPat = (): Uint8Array => buildSection(0x00, [
  0x00, 0x01,
  0xc1,
  0x00,
  0x00,
  0x00, 0x01,
  0xe0 | ((PMT_PID >> 8) & 0x1f), PMT_PID & 0xff,
]);

const buildPmt = (audioStreamType: number, videoStreamType = 0x1b): Uint8Array => buildSection(0x02, [
  0x00, 0x01,
  0xc1,
  0x00,
  0x00,
  0xe0 | ((VIDEO_PID >> 8) & 0x1f), VIDEO_PID & 0xff,
  0xf0, 0x00,
  videoStreamType, 0xe0 | ((VIDEO_PID >> 8) & 0x1f), VIDEO_PID & 0xff, 0xf0, 0x00,
  audioStreamType, 0xe0 | ((AUDIO_PID >> 8) & 0x1f), AUDIO_PID & 0xff, 0xf0, 0x00,
]);

const buildTransportStream = (audioStreamType: number, videoStreamType = 0x1b): Uint8Array => concatPackets([
  buildPacket(0, buildPat()),
  buildPacket(PMT_PID, buildPmt(audioStreamType, videoStreamType)),
  buildPacket(VIDEO_PID, new Uint8Array([0x00, 0x00, 0x01, 0xe0]), false),
  buildPacket(AUDIO_PID, new Uint8Array([0xff, 0xfd, 0x00, 0x00]), false),
]);

describe('mpegTsAudioStrip', () => {
  it('detects MPEG audio in a video transport stream', () => {
    const segment = buildTransportStream(0x03);

    expect(detectMpegTsAudio(segment)).toMatchObject({
      hasVideo: true,
      hasMpegAudio: true,
      hasAacAudio: false,
      pmtPid: PMT_PID,
      audioPids: [AUDIO_PID],
      mpegAudioPids: [AUDIO_PID],
    });
  });

  it('strips MPEG audio PID and rewrites PMT for video-only fallback', () => {
    const segment = buildTransportStream(0x03);
    const stripped = new Uint8Array(stripUnsupportedMpegAudioFromTs(segment));

    expect(stripped.length).toBe((4 - 1) * TS_PACKET_SIZE);
    expect(detectMpegTsAudio(stripped)).toMatchObject({
      hasVideo: true,
      hasMpegAudio: false,
      hasAacAudio: false,
      audioPids: [],
      mpegAudioPids: [],
    });
  });

  it('leaves AAC audio transport streams unchanged', () => {
    const segment = buildTransportStream(0x0f);
    const stripped = new Uint8Array(stripUnsupportedMpegAudioFromTs(segment));

    expect(stripped.length).toBe(segment.length);
    expect(detectMpegTsAudio(stripped)).toMatchObject({
      hasVideo: true,
      hasMpegAudio: false,
      hasAacAudio: true,
      audioPids: [AUDIO_PID],
      mpegAudioPids: [],
    });
  });

  it('flags HEVC (H.265, stream_type 0x24) video', () => {
    const hevcSegment = buildTransportStream(0x0f, 0x24);
    expect(detectMpegTsAudio(hevcSegment)).toMatchObject({
      hasVideo: true,
      hasHevcVideo: true,
    });
  });

  it('does not flag H.264 (stream_type 0x1b) as HEVC', () => {
    const h264Segment = buildTransportStream(0x0f, 0x1b);
    expect(detectMpegTsAudio(h264Segment)).toMatchObject({
      hasVideo: true,
      hasHevcVideo: false,
    });
  });
});
