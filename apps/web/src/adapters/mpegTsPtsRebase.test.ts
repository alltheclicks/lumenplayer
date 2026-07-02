import { describe, expect, it } from 'vitest';
import {
  createCatchUpRebaseSession,
  rebaseCatchUpSegment,
} from './mpegTsPtsRebase';

const TS_PACKET_SIZE = 188;
const PTS_CLOCK = 90_000;
const PTS_WRAP = 8_589_934_592;
const PMT_PID = 0x1000;
const VIDEO_PID = 0x0100;
const AUDIO_PID = 0x0101;
const NOMINAL_PTS = 60 * PTS_CLOCK;
const BASE_PAD_PTS = 10 * PTS_CLOCK;

const buildSection = (tableId: number, body: number[]): Uint8Array => {
  const sectionLength = body.length + 4;
  const section = new Uint8Array(3 + sectionLength);
  section[0] = tableId;
  section[1] = 0xb0 | ((sectionLength >> 8) & 0x0f);
  section[2] = sectionLength & 0xff;
  section.set(body, 3);
  return section;
};

const buildSectionPacket = (pid: number, payload: Uint8Array): Uint8Array => {
  const packet = new Uint8Array(TS_PACKET_SIZE);
  packet.fill(0xff);
  packet[0] = 0x47;
  packet[1] = 0x40 | ((pid >> 8) & 0x1f);
  packet[2] = pid & 0xff;
  packet[3] = 0x10;
  packet[4] = 0; // pointer field
  packet.set(payload.subarray(0, TS_PACKET_SIZE - 5), 5);
  return packet;
};

const buildPat = (): Uint8Array => buildSection(0x00, [
  0x00, 0x01,
  0xc1,
  0x00,
  0x00,
  0x00, 0x01,
  0xe0 | ((PMT_PID >> 8) & 0x1f), PMT_PID & 0xff,
]);

const buildPmt = (audioStreamType: number | null, videoStreamType: number | null = 0x1b): Uint8Array => {
  const body = [
    0x00, 0x01,
    0xc1,
    0x00,
    0x00,
    0xe0 | ((VIDEO_PID >> 8) & 0x1f), VIDEO_PID & 0xff,
    0xf0, 0x00,
  ];
  if (videoStreamType !== null) {
    body.push(videoStreamType, 0xe0 | ((VIDEO_PID >> 8) & 0x1f), VIDEO_PID & 0xff, 0xf0, 0x00);
  }
  if (audioStreamType !== null) {
    body.push(audioStreamType, 0xe0 | ((AUDIO_PID >> 8) & 0x1f), AUDIO_PID & 0xff, 0xf0, 0x00);
  }
  return buildSection(0x02, body);
};

const writePtsField = (data: Uint8Array, offset: number, value: number, prefix: number): void => {
  const wrapped = ((value % PTS_WRAP) + PTS_WRAP) % PTS_WRAP;
  const high = Math.floor(wrapped / 0x40000000) & 0x07;
  const mid = Math.floor(wrapped / 0x8000) % 0x8000;
  const low = wrapped % 0x8000;
  data[offset] = (prefix << 4) | (high << 1) | 0x01;
  data[offset + 1] = (mid >> 7) & 0xff;
  data[offset + 2] = ((mid & 0x7f) << 1) | 0x01;
  data[offset + 3] = (low >> 7) & 0xff;
  data[offset + 4] = ((low & 0x7f) << 1) | 0x01;
};

const readPtsField = (data: Uint8Array, offset: number): number => {
  const high = (data[offset] >> 1) & 0x07;
  const mid = ((data[offset + 1] << 7) | (data[offset + 2] >> 1)) & 0x7fff;
  const low = ((data[offset + 3] << 7) | (data[offset + 4] >> 1)) & 0x7fff;
  return high * 0x40000000 + mid * 0x8000 + low;
};

interface PesPacketOptions {
  dts?: number;
  pcrBase?: number;
  payloadUnitStart?: boolean;
}

const buildPesPacket = (pid: number, pts: number, options: PesPacketOptions = {}): Uint8Array => {
  const packet = new Uint8Array(TS_PACKET_SIZE);
  packet.fill(0xff);
  const payloadUnitStart = options.payloadUnitStart ?? true;
  packet[0] = 0x47;
  packet[1] = (payloadUnitStart ? 0x40 : 0x00) | ((pid >> 8) & 0x1f);
  packet[2] = pid & 0xff;

  let offset = 4;
  if (options.pcrBase !== undefined) {
    packet[3] = 0x30;
    packet[4] = 7; // adaptation field length: flags + 6-byte PCR
    packet[5] = 0x10; // PCR flag
    const base = options.pcrBase;
    packet[6] = Math.floor(base / 0x2000000) & 0xff;
    packet[7] = Math.floor(base / 0x20000) & 0xff;
    packet[8] = Math.floor(base / 0x200) & 0xff;
    packet[9] = Math.floor(base / 2) & 0xff;
    packet[10] = ((base % 2) << 7) | 0x7e;
    packet[11] = 0x00;
    offset = 12;
  } else {
    packet[3] = 0x10;
  }

  if (!payloadUnitStart) {
    packet.fill(0xaa, offset);
    return packet;
  }

  const hasDts = options.dts !== undefined;
  packet[offset] = 0x00;
  packet[offset + 1] = 0x00;
  packet[offset + 2] = 0x01;
  packet[offset + 3] = pid === VIDEO_PID ? 0xe0 : 0xc0;
  packet[offset + 4] = 0x00;
  packet[offset + 5] = 0x00;
  packet[offset + 6] = 0x80;
  packet[offset + 7] = hasDts ? 0xc0 : 0x80;
  packet[offset + 8] = hasDts ? 10 : 5;
  writePtsField(packet, offset + 9, pts, hasDts ? 0x03 : 0x02);
  if (hasDts) {
    writePtsField(packet, offset + 14, options.dts as number, 0x01);
  }
  return packet;
};

const concatPackets = (packets: Uint8Array[]): Uint8Array => {
  const output = new Uint8Array(packets.length * TS_PACKET_SIZE);
  packets.forEach((packet, index) => {
    output.set(packet, index * TS_PACKET_SIZE);
  });
  return output;
};

interface SegmentOptions {
  audioPtsList?: number[];
  videoPtsList?: Array<{ pts: number; dts?: number }>;
  audioStreamType?: number | null;
  videoStreamType?: number | null;
  pcrBase?: number;
  audioContinuationAfterFirstUnit?: boolean;
}

const secondsToPts = (seconds: number): number => Math.round(seconds * PTS_CLOCK);

const buildSegment = (options: SegmentOptions = {}): Uint8Array => {
  const {
    audioPtsList = [1.4, 1.9, 2.4, 2.9].map(secondsToPts),
    videoPtsList = [3.5, 3.54, 3.58].map((s) => ({ pts: secondsToPts(s), dts: secondsToPts(s) - 3600 })),
    audioStreamType = 0x0f,
    videoStreamType = 0x1b,
    pcrBase,
    audioContinuationAfterFirstUnit = false,
  } = options;

  const packets: Uint8Array[] = [
    buildSectionPacket(0, buildPat()),
    buildSectionPacket(PMT_PID, buildPmt(audioStreamType, videoStreamType)),
  ];
  videoPtsList.forEach((entry, index) => {
    packets.push(buildPesPacket(VIDEO_PID, entry.pts, {
      dts: entry.dts,
      pcrBase: index === 0 ? pcrBase : undefined,
    }));
  });
  audioPtsList.forEach((pts, index) => {
    packets.push(buildPesPacket(AUDIO_PID, pts));
    if (index === 0 && audioContinuationAfterFirstUnit) {
      packets.push(buildPesPacket(AUDIO_PID, 0, { payloadUnitStart: false }));
    }
  });
  return concatPackets(packets);
};

const readPacketPid = (segment: Uint8Array, packetIndex: number): number => {
  const offset = packetIndex * TS_PACKET_SIZE;
  return ((segment[offset + 1] & 0x1f) << 8) | segment[offset + 2];
};

/** Reads the PES PTS of a builder-produced packet (no adaptation field). */
const readPacketPts = (segment: Uint8Array, packetIndex: number): number => (
  readPtsField(segment, packetIndex * TS_PACKET_SIZE + 4 + 9)
);

const rebaseOrThrow = (
  session: ReturnType<typeof createCatchUpRebaseSession>,
  index: number,
  segment: Uint8Array,
) => {
  const outcome = rebaseCatchUpSegment(session, index, segment);
  if (outcome.status !== 'rebased') {
    throw new Error(`expected rebased, got ${outcome.status}: ${outcome.reason}`);
  }
  return outcome;
};

describe('mpegTsPtsRebase', () => {
  it('places the first processed segment on the nominal grid with marker bits intact', () => {
    const session = createCatchUpRebaseSession();
    const segment = buildSegment();
    const { record } = rebaseOrThrow(session, 0, segment);

    expect(record.assignment).toBe('grid');
    expect(record.rebasedChainStartPts).toBe(BASE_PAD_PTS);

    // Packet 5 is the first audio PES (2 sections + 3 video packets first).
    expect(readPacketPts(segment, 5)).toBe(BASE_PAD_PTS);

    // Marker bits: PTS-only prefix 0b0010, each field byte ends in 1.
    const ptsFieldOffset = 5 * TS_PACKET_SIZE + 4 + 9;
    expect(segment[ptsFieldOffset] >> 4).toBe(0x02);
    expect(segment[ptsFieldOffset] & 0x01).toBe(1);
    expect(segment[ptsFieldOffset + 2] & 0x01).toBe(1);
    expect(segment[ptsFieldOffset + 4] & 0x01).toBe(1);

    // Video keeps PTS+DTS prefixes (0b0011 / 0b0001).
    const videoFieldOffset = 2 * TS_PACKET_SIZE + 4 + 9;
    expect(segment[videoFieldOffset] >> 4).toBe(0x03);
    expect(segment[videoFieldOffset + 5] >> 4).toBe(0x01);
  });

  it('chains sequential segments into one continuous timeline preserving A/V skew', () => {
    const session = createCatchUpRebaseSession();
    const audioPts = [1.4, 1.9, 2.4, 2.9].map(secondsToPts);
    const audioFrameDuration = secondsToPts(0.5);

    const first = buildSegment({ audioPtsList: audioPts });
    const firstOutcome = rebaseOrThrow(session, 0, first);
    const expectedEnd = BASE_PAD_PTS
      + (audioPts[3] - audioPts[0]) + audioFrameDuration;
    expect(firstOutcome.record.rebasedChainEndPts).toBe(expectedEnd);

    const second = buildSegment({ audioPtsList: audioPts });
    const secondOutcome = rebaseOrThrow(session, 1, second);
    expect(secondOutcome.record.assignment).toBe('chained');
    expect(secondOutcome.record.rebasedChainStartPts).toBe(expectedEnd);
    expect(secondOutcome.record.boundaryDeltaPts).toBe(0);

    // A/V skew inside each file is preserved: video first PTS − audio first PTS.
    const skew = secondsToPts(3.5) - secondsToPts(1.4);
    expect(readPacketPts(second, 2) - readPacketPts(second, 5)).toBe(skew);
    expect(readPacketPts(second, 2)).toBe(expectedEnd + skew);
  });

  it('handles 33-bit PTS wraparound inside a file', () => {
    const session = createCatchUpRebaseSession();
    const nearWrap = PTS_WRAP - secondsToPts(1);
    const audioPtsList = [
      nearWrap,
      (nearWrap + secondsToPts(0.5)) % PTS_WRAP,
      (nearWrap + secondsToPts(1)) % PTS_WRAP,
      (nearWrap + secondsToPts(1.5)) % PTS_WRAP,
    ];
    const videoPtsList = [{ pts: nearWrap, dts: nearWrap - 3600 }];
    const segment = buildSegment({ audioPtsList, videoPtsList });
    const { record } = rebaseOrThrow(session, 0, segment);

    expect(record.assignment).toBe('grid');
    expect(record.rebasedChainStartPts).toBe(BASE_PAD_PTS);
    // Post-wrap samples land after pre-wrap ones on the rebased timeline.
    expect(readPacketPts(segment, 3)).toBe(BASE_PAD_PTS);
    expect(readPacketPts(segment, 6)).toBe(BASE_PAD_PTS + secondsToPts(1.5));
  });

  it('extrapolates forward across an index gap after a seek', () => {
    const session = createCatchUpRebaseSession();
    const first = rebaseOrThrow(session, 0, buildSegment());
    const jumped = rebaseOrThrow(session, 5, buildSegment());

    expect(jumped.record.assignment).toBe('extrapolated-forward');
    expect(jumped.record.rebasedChainStartPts).toBe(
      first.record.rebasedChainEndPts + 4 * NOMINAL_PTS,
    );
  });

  it('extrapolates backward when seeking before the first processed index', () => {
    const session = createCatchUpRebaseSession();
    const first = rebaseOrThrow(session, 10, buildSegment());
    const back = rebaseOrThrow(session, 7, buildSegment());

    expect(back.record.assignment).toBe('extrapolated-backward');
    expect(back.record.rebasedChainStartPts).toBe(
      first.record.rebasedChainStartPts - 3 * NOMINAL_PTS,
    );
    // Far enough from zero that the rebased timeline never goes negative.
    expect(back.record.rebasedChainStartPts).toBeGreaterThan(0);
  });

  it('is deterministic for re-loads of the same fragment (memoized)', () => {
    const session = createCatchUpRebaseSession();
    const a = buildSegment();
    const b = buildSegment();
    const firstOutcome = rebaseOrThrow(session, 0, a);
    const secondOutcome = rebaseOrThrow(session, 0, b);

    expect(secondOutcome.record.assignment).toBe('memoized');
    expect(secondOutcome.record.offsetPts).toBe(firstOutcome.record.offsetPts);
    expect(Array.from(b)).toEqual(Array.from(a));
    expect(session.stats.segments).toBe(1);
  });

  it('trims overlapping leading audio into null packets without changing length', () => {
    const session = createCatchUpRebaseSession();
    // Index 1 first (grid), then index 0 backward-extrapolated with a long
    // audio tail spilling 1.5s past index 1's start, then re-load index 1.
    rebaseOrThrow(session, 1, buildSegment());
    const longTail = Array.from({ length: 123 }, (_, k) => secondsToPts(1.4 + k * 0.5));
    rebaseOrThrow(session, 0, buildSegment({ audioPtsList: longTail }));

    const reload = buildSegment({ audioContinuationAfterFirstUnit: true });
    const originalLength = reload.length;
    const outcome = rebaseOrThrow(session, 1, reload);

    expect(outcome.record.assignment).toBe('memoized');
    expect(outcome.record.trimmedPackets).toBe(4);
    expect(reload.length).toBe(originalLength);
    // Packets: 0 PAT, 1 PMT, 2–4 video, 5 audio#1, 6 its continuation,
    // 7 audio#2, 8 audio#3, 9 audio#4. Units at +60/+60.5/+61s overlap the
    // previous file's tail (ends +61.5s) and are nulled; the last survives.
    expect(readPacketPid(reload, 5)).toBe(0x1fff);
    expect(readPacketPid(reload, 6)).toBe(0x1fff);
    expect(readPacketPid(reload, 7)).toBe(0x1fff);
    expect(readPacketPid(reload, 8)).toBe(0x1fff);
    expect(readPacketPid(reload, 9)).toBe(AUDIO_PID);
  });

  it('fails the session when a joint error exceeds the fatal threshold', () => {
    const session = createCatchUpRebaseSession();
    rebaseOrThrow(session, 0, buildSegment());
    rebaseOrThrow(session, 2, buildSegment());

    // Index 1 chains from index 0 but is far too short to reach index 2.
    const outcome = rebaseCatchUpSegment(session, 1, buildSegment());
    expect(outcome).toMatchObject({ status: 'failed', reason: 'joint-delta-exceeded' });
  });

  it('chains on video when the file has no audio track', () => {
    const session = createCatchUpRebaseSession();
    const segment = buildSegment({ audioStreamType: null, audioPtsList: [] });
    const { record } = rebaseOrThrow(session, 0, segment);

    expect(record.audio).toBeNull();
    expect(record.video).not.toBeNull();
    expect(record.anomalies).toContain('no-audio-chained-video');
    expect(record.rebasedChainStartPts).toBe(BASE_PAD_PTS);
  });

  it('rewrites PCR bases alongside PES timestamps', () => {
    const session = createCatchUpRebaseSession();
    const pcrBase = secondsToPts(3.4);
    const segment = buildSegment({ pcrBase });
    const { record } = rebaseOrThrow(session, 0, segment);

    // First video packet carries the PCR in its adaptation field.
    const offset = 2 * TS_PACKET_SIZE + 6;
    const rebasedBase = segment[offset] * 0x2000000
      + segment[offset + 1] * 0x20000
      + segment[offset + 2] * 0x200
      + segment[offset + 3] * 2
      + (segment[offset + 4] >> 7);
    expect(rebasedBase).toBe(pcrBase + record.offsetPts);
    // Reserved bits + 9-bit extension untouched.
    expect(segment[offset + 4] & 0x7f).toBe(0x7e);
    expect(segment[offset + 5]).toBe(0x00);
  });

  it('fails cleanly on non-TS data', () => {
    const session = createCatchUpRebaseSession();
    const outcome = rebaseCatchUpSegment(session, 0, new Uint8Array(188 * 4).fill(0x11));
    expect(outcome).toMatchObject({ status: 'failed', reason: 'not-ts' });
  });

  it('fails cleanly on MP2 audio streams', () => {
    const session = createCatchUpRebaseSession();
    const outcome = rebaseCatchUpSegment(session, 0, buildSegment({ audioStreamType: 0x03 }));
    expect(outcome).toMatchObject({ status: 'failed', reason: 'no-aac-audio' });
  });

  it('fails cleanly when video is missing', () => {
    const session = createCatchUpRebaseSession();
    const outcome = rebaseCatchUpSegment(
      session,
      0,
      buildSegment({ videoStreamType: null, videoPtsList: [] }),
    );
    expect(outcome).toMatchObject({ status: 'failed', reason: 'no-video' });
  });

  it('fails cleanly on an intra-file PTS jump (archive restart mid-file)', () => {
    const session = createCatchUpRebaseSession();
    const audioPtsList = [1.4, 1.9, 200.0, 200.5].map(secondsToPts);
    const outcome = rebaseCatchUpSegment(session, 0, buildSegment({ audioPtsList }));
    expect(outcome).toMatchObject({ status: 'failed', reason: 'intra-file-pts-jump' });
  });
});
