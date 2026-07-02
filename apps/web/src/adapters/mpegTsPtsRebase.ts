import {
  AAC_AUDIO_STREAM_TYPE,
  MPEG_AUDIO_STREAM_TYPES,
  TS_PACKET_SIZE,
  TS_SYNC_BYTE,
  VIDEO_STREAM_TYPES,
  getPacketPid,
  getPayloadOffset,
  hasPayloadUnitStart,
  parseTs,
  toUint8Array,
} from './mpegTsAudioStrip';

// XUI catch-up serves each archive minute-file as one HLS segment whose PTS
// timeline restarts near 1.4s, bridged by #EXT-X-DISCONTINUITY. The per-file
// A/V start skew makes every splice dirty (audio overlap + video skip). The
// underlying content is a byte-copy of one continuous live stream, so this
// module rewrites PES PTS/DTS (and PCR) in place with a per-segment offset
// that stitches all files into a single continuous timeline; the companion
// playlist loader strips the discontinuity tags so hls.js never resets the
// demuxer/remuxer across those boundaries.

const PTS_CLOCK = 90_000;
const PTS_WRAP = 8_589_934_592; // 2^33
const NULL_PACKET_PID = 0x1fff;
const DEFAULT_NOMINAL_SEGMENT_SECONDS = 60;

// Rebased timeline pad ahead of nominal position so a backward seek that
// extrapolates before the first processed index can never produce a
// negative (wrapped) PTS.
const REBASE_BASE_PAD_PTS = 10 * PTS_CLOCK;

// A PTS jump beyond this within one 60s file means the archive restarted
// mid-file (a genuine discontinuity) — rebasing would splice unrelated
// timelines, so the caller must fall back to the untouched playlist.
const INTRA_FILE_PTS_JUMP_LIMIT = 10 * PTS_CLOCK;

// Residual error tolerated at a joint between independently placed regions
// (after seeks). hls.js absorbs sub-second holes/overlaps; beyond this the
// splice would be audible/visible, so the session aborts instead.
const JOINT_DELTA_FATAL_PTS = 2 * PTS_CLOCK;

// Only the leading audio PES units of a segment can ever need overlap
// trimming (anything deeper than the fatal joint threshold aborts first).
const MAX_TRIMMABLE_AUDIO_UNITS = 128;

const DEFAULT_AUDIO_FRAME_DURATION_PTS = 1920; // 1024 samples @ 48kHz
const DEFAULT_VIDEO_FRAME_DURATION_PTS = 3600; // 25 fps

export interface RebaseTrackState {
  /** Unwrapped 90kHz PTS of the earliest sample in the file. */
  firstPts: number;
  /** Unwrapped 90kHz PTS of the latest sample in the file. */
  lastPts: number;
  sampleCount: number;
  frameDurationPts: number;
}

export type RebaseOffsetAssignment =
  | 'memoized'
  | 'chained'
  | 'extrapolated-forward'
  | 'extrapolated-backward'
  | 'grid';

export interface SegmentRebaseRecord {
  index: number;
  offsetPts: number;
  assignment: RebaseOffsetAssignment;
  audio: RebaseTrackState | null;
  video: RebaseTrackState | null;
  /** Rebased PTS at which the next chained segment should begin. */
  rebasedChainEndPts: number;
  /** Rebased PTS of this segment's first chain-track sample. */
  rebasedChainStartPts: number;
  /** Measured splice error against already-known neighbours, in PTS ticks. */
  boundaryDeltaPts: number;
  trimmedPackets: number;
  anomalies: string[];
}

export interface CatchUpRebaseSessionStats {
  segments: number;
  chained: number;
  anchored: number;
  trimmedPackets: number;
  anomalies: number;
  maxBoundaryDeltaMs: number;
}

export interface CatchUpRebaseSession {
  readonly records: Map<number, SegmentRebaseRecord>;
  readonly nominalSegmentPts: number;
  readonly stats: CatchUpRebaseSessionStats;
}

export type RebaseOutcome =
  | { status: 'rebased'; data: ArrayBuffer; record: SegmentRebaseRecord }
  | { status: 'failed'; reason: string };

export const createCatchUpRebaseSession = (
  options?: { nominalSegmentSeconds?: number },
): CatchUpRebaseSession => ({
  records: new Map(),
  nominalSegmentPts: Math.round(
    (options?.nominalSegmentSeconds ?? DEFAULT_NOMINAL_SEGMENT_SECONDS) * PTS_CLOCK,
  ),
  stats: {
    segments: 0,
    chained: 0,
    anchored: 0,
    trimmedPackets: 0,
    anomalies: 0,
    maxBoundaryDeltaMs: 0,
  },
});

interface PesTimestampSite {
  /** Absolute offset of the 5-byte PTS field within the segment buffer. */
  ptsOffset: number;
  ptsValue: number;
  /** Absolute offset of the 5-byte DTS field, when present. */
  dtsOffset: number | null;
  dtsValue: number;
}

interface AudioPesUnit {
  pts: number;
  packetOffsets: number[] | null;
}

interface SegmentScan {
  pesSites: PesTimestampSite[];
  pcrOffsets: number[];
  audio: RebaseTrackState | null;
  video: RebaseTrackState | null;
  audioUnits: AudioPesUnit[];
  audioPid: number | null;
  anomalies: string[];
}

const readPtsField = (data: Uint8Array, offset: number): number => {
  const high = (data[offset] >> 1) & 0x07;
  const mid = ((data[offset + 1] << 7) | (data[offset + 2] >> 1)) & 0x7fff;
  const low = ((data[offset + 3] << 7) | (data[offset + 4] >> 1)) & 0x7fff;
  return high * 0x40000000 + mid * 0x8000 + low;
};

const writePtsField = (
  data: Uint8Array,
  offset: number,
  value: number,
  prefix: number,
): void => {
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

/** Pick the wrap candidate closest to the reference (files span ~60s). */
const unwrapPts = (pts: number, reference: number): number => {
  let best = pts;
  let bestDistance = Math.abs(pts - reference);
  for (const candidate of [pts - PTS_WRAP, pts + PTS_WRAP]) {
    const distance = Math.abs(candidate - reference);
    if (distance < bestDistance) {
      best = candidate;
      bestDistance = distance;
    }
  }
  return best;
};

const readPcrBase = (data: Uint8Array, offset: number): number => (
  data[offset] * 0x2000000
  + data[offset + 1] * 0x20000
  + data[offset + 2] * 0x200
  + data[offset + 3] * 2
  + (data[offset + 4] >> 7)
);

const writePcrBase = (data: Uint8Array, offset: number, value: number): void => {
  const wrapped = ((value % PTS_WRAP) + PTS_WRAP) % PTS_WRAP;
  data[offset] = Math.floor(wrapped / 0x2000000) & 0xff;
  data[offset + 1] = Math.floor(wrapped / 0x20000) & 0xff;
  data[offset + 2] = Math.floor(wrapped / 0x200) & 0xff;
  data[offset + 3] = Math.floor(wrapped / 2) & 0xff;
  data[offset + 4] = ((wrapped % 2) << 7) | (data[offset + 4] & 0x7f);
};

const hasPcrField = (data: Uint8Array, offset: number): boolean => {
  const adaptationControl = (data[offset + 3] >> 4) & 0x03;
  if (adaptationControl !== 2 && adaptationControl !== 3) {
    return false;
  }
  const adaptationLength = data[offset + 4];
  return adaptationLength >= 7 && (data[offset + 5] & 0x10) !== 0;
};

const createTrackState = (defaultFrameDurationPts: number): RebaseTrackState => ({
  firstPts: Number.POSITIVE_INFINITY,
  lastPts: Number.NEGATIVE_INFINITY,
  sampleCount: 0,
  frameDurationPts: defaultFrameDurationPts,
});

const finalizeTrackState = (
  track: RebaseTrackState,
  defaultFrameDurationPts: number,
): RebaseTrackState | null => {
  if (track.sampleCount === 0) {
    return null;
  }
  if (track.sampleCount > 1 && track.lastPts > track.firstPts) {
    track.frameDurationPts = (track.lastPts - track.firstPts) / (track.sampleCount - 1);
  } else {
    track.frameDurationPts = defaultFrameDurationPts;
  }
  return track;
};

const scanSegment = (data: Uint8Array): SegmentScan | { failure: string } => {
  const parsed = parseTs(data);
  if (!parsed) {
    return { failure: 'not-ts' };
  }

  let videoPid: number | null = null;
  let audioPid: number | null = null;
  const pesPids = new Set<number>();
  for (const stream of parsed.streams) {
    if (VIDEO_STREAM_TYPES.has(stream.streamType) && videoPid === null) {
      videoPid = stream.pid;
    }
    if (stream.streamType === AAC_AUDIO_STREAM_TYPE && audioPid === null) {
      audioPid = stream.pid;
    }
    if (MPEG_AUDIO_STREAM_TYPES.has(stream.streamType) && audioPid === null) {
      // MP2 catch-up cannot play in MSE anyway; the rebase path must not be
      // partially applied, so the whole session falls back.
      return { failure: 'no-aac-audio' };
    }
    pesPids.add(stream.pid);
  }

  if (videoPid === null) {
    return { failure: 'no-video' };
  }

  const audio = createTrackState(DEFAULT_AUDIO_FRAME_DURATION_PTS);
  const video = createTrackState(DEFAULT_VIDEO_FRAME_DURATION_PTS);
  const pesSites: PesTimestampSite[] = [];
  const pcrOffsets: number[] = [];
  const audioUnits: AudioPesUnit[] = [];
  const anomalies: string[] = [];
  let currentAudioUnit: AudioPesUnit | null = null;
  let previousAudioPts: number | null = null;
  let previousVideoPts: number | null = null;

  for (let offset = 0; offset + TS_PACKET_SIZE <= data.length; offset += TS_PACKET_SIZE) {
    if (data[offset] !== TS_SYNC_BYTE) {
      continue;
    }

    if (hasPcrField(data, offset)) {
      pcrOffsets.push(offset + 6);
    }

    const pid = getPacketPid(data, offset);
    if (!pesPids.has(pid)) {
      continue;
    }

    const isAudio = pid === audioPid;
    if (isAudio && currentAudioUnit?.packetOffsets && !hasPayloadUnitStart(data, offset)) {
      currentAudioUnit.packetOffsets.push(offset);
    }

    if (!hasPayloadUnitStart(data, offset)) {
      continue;
    }

    const payloadOffset = getPayloadOffset(data, offset);
    if (payloadOffset === null) {
      continue;
    }

    const packetEnd = offset + TS_PACKET_SIZE;
    if (payloadOffset + 9 > packetEnd
      || data[payloadOffset] !== 0x00
      || data[payloadOffset + 1] !== 0x00
      || data[payloadOffset + 2] !== 0x01) {
      continue;
    }

    const ptsDtsFlags = (data[payloadOffset + 7] >> 6) & 0x03;
    if (ptsDtsFlags !== 0x02 && ptsDtsFlags !== 0x03) {
      continue;
    }

    const ptsOffset = payloadOffset + 9;
    const dtsPresent = ptsDtsFlags === 0x03;
    const requiredEnd = ptsOffset + (dtsPresent ? 10 : 5);
    if (requiredEnd > packetEnd) {
      // A PES header split across TS packets is rare; recovering it would
      // require repacketization, so the session falls back instead.
      return { failure: 'split-pes-header' };
    }

    const rawPts = readPtsField(data, ptsOffset);
    const track = isAudio ? audio : (pid === videoPid ? video : null);
    const reference = track && track.sampleCount > 0 ? track.firstPts : rawPts;
    const pts = unwrapPts(rawPts, reference);
    const dtsOffset = dtsPresent ? ptsOffset + 5 : null;
    const dts = dtsOffset !== null ? unwrapPts(readPtsField(data, dtsOffset), pts) : pts;

    pesSites.push({ ptsOffset, ptsValue: pts, dtsOffset, dtsValue: dts });

    if (track) {
      const previousPts = isAudio ? previousAudioPts : previousVideoPts;
      if (previousPts !== null && Math.abs(pts - previousPts) > INTRA_FILE_PTS_JUMP_LIMIT) {
        return { failure: 'intra-file-pts-jump' };
      }
      if (isAudio) {
        previousAudioPts = pts;
      } else {
        previousVideoPts = pts;
      }
      track.firstPts = Math.min(track.firstPts, pts);
      track.lastPts = Math.max(track.lastPts, pts);
      track.sampleCount += 1;
    }

    if (isAudio) {
      currentAudioUnit = {
        pts,
        packetOffsets: audioUnits.length < MAX_TRIMMABLE_AUDIO_UNITS ? [offset] : null,
      };
      audioUnits.push(currentAudioUnit);
    }
  }

  if (pesSites.length === 0) {
    return { failure: 'no-pes-timestamps' };
  }

  return {
    pesSites,
    pcrOffsets,
    audio: finalizeTrackState(audio, DEFAULT_AUDIO_FRAME_DURATION_PTS),
    video: finalizeTrackState(video, DEFAULT_VIDEO_FRAME_DURATION_PTS),
    audioUnits,
    audioPid,
    anomalies,
  };
};

interface OffsetAssignment {
  offsetPts: number;
  assignment: RebaseOffsetAssignment;
}

const findNearestRecord = (
  records: Map<number, SegmentRebaseRecord>,
  index: number,
  direction: -1 | 1,
): SegmentRebaseRecord | null => {
  let nearest: SegmentRebaseRecord | null = null;
  for (const record of records.values()) {
    if (direction === -1 ? record.index >= index : record.index <= index) {
      continue;
    }
    if (!nearest || Math.abs(record.index - index) < Math.abs(nearest.index - index)) {
      nearest = record;
    }
  }
  return nearest;
};

const assignOffset = (
  session: CatchUpRebaseSession,
  index: number,
  chainFirstPts: number,
): OffsetAssignment => {
  const memoized = session.records.get(index);
  if (memoized) {
    return { offsetPts: memoized.offsetPts, assignment: 'memoized' };
  }

  const previous = session.records.get(index - 1);
  if (previous) {
    return {
      offsetPts: previous.rebasedChainEndPts - chainFirstPts,
      assignment: 'chained',
    };
  }

  const earlier = findNearestRecord(session.records, index, -1);
  if (earlier) {
    const gapSegments = index - earlier.index - 1;
    return {
      offsetPts: earlier.rebasedChainEndPts
        + gapSegments * session.nominalSegmentPts
        - chainFirstPts,
      assignment: 'extrapolated-forward',
    };
  }

  const later = findNearestRecord(session.records, index, 1);
  if (later) {
    return {
      offsetPts: later.rebasedChainStartPts
        - (later.index - index) * session.nominalSegmentPts
        - chainFirstPts,
      assignment: 'extrapolated-backward',
    };
  }

  return {
    offsetPts: index * session.nominalSegmentPts + REBASE_BASE_PAD_PTS - chainFirstPts,
    assignment: 'grid',
  };
};

const nullOutPacket = (data: Uint8Array, offset: number): void => {
  data[offset + 1] = (data[offset + 1] & 0xe0) | ((NULL_PACKET_PID >> 8) & 0x1f);
  data[offset + 2] = NULL_PACKET_PID & 0xff;
};

export const rebaseCatchUpSegment = (
  session: CatchUpRebaseSession,
  segmentIndex: number,
  input: ArrayBuffer | Uint8Array,
): RebaseOutcome => {
  const data = toUint8Array(input);
  const scan = scanSegment(data);
  if ('failure' in scan) {
    return { status: 'failed', reason: scan.failure };
  }

  // The chain track is audio when present (audio joints are the audible
  // ones); pure video channels chain on video instead.
  const chainTrack = scan.audio ?? scan.video;
  if (!chainTrack) {
    return { status: 'failed', reason: 'no-chain-track' };
  }
  const anomalies = [...scan.anomalies];
  if (!scan.audio) {
    anomalies.push('no-audio-chained-video');
  }

  const { offsetPts, assignment } = assignOffset(session, segmentIndex, chainTrack.firstPts);
  const rebasedChainStartPts = chainTrack.firstPts + offsetPts;
  const rebasedChainEndPts = chainTrack.lastPts + chainTrack.frameDurationPts + offsetPts;

  // Measure the splice error against already-placed neighbours; beyond the
  // fatal threshold the joint would be audible, so abandon rebasing.
  let boundaryDeltaPts = 0;
  const previous = session.records.get(segmentIndex - 1);
  if (previous) {
    boundaryDeltaPts = rebasedChainStartPts - previous.rebasedChainEndPts;
  }
  const next = session.records.get(segmentIndex + 1);
  if (next) {
    const nextDelta = next.rebasedChainStartPts - rebasedChainEndPts;
    if (Math.abs(nextDelta) > Math.abs(boundaryDeltaPts)) {
      boundaryDeltaPts = nextDelta;
    }
  }
  if (Math.abs(boundaryDeltaPts) > JOINT_DELTA_FATAL_PTS) {
    return { status: 'failed', reason: 'joint-delta-exceeded' };
  }

  // Trim leading audio PES units that would overlap the previous segment's
  // already-appended audio (possible when a memoized region later gains a
  // neighbour): converting their packets to null packets keeps byte length
  // and packet alignment intact.
  let trimmedPackets = 0;
  if (previous && scan.audio) {
    const trimBeforePts = previous.rebasedChainEndPts - scan.audio.frameDurationPts / 2;
    for (const unit of scan.audioUnits) {
      if (unit.pts + offsetPts >= trimBeforePts) {
        break;
      }
      if (!unit.packetOffsets) {
        return { status: 'failed', reason: 'overlap-beyond-trim-window' };
      }
      for (const packetOffset of unit.packetOffsets) {
        nullOutPacket(data, packetOffset);
        trimmedPackets += 1;
      }
    }
  }

  for (const site of scan.pesSites) {
    writePtsField(data, site.ptsOffset, site.ptsValue + offsetPts, site.dtsOffset !== null ? 0x03 : 0x02);
    if (site.dtsOffset !== null) {
      writePtsField(data, site.dtsOffset, site.dtsValue + offsetPts, 0x01);
    }
  }

  for (const pcrOffset of scan.pcrOffsets) {
    writePcrBase(data, pcrOffset, readPcrBase(data, pcrOffset) + offsetPts);
  }

  const record: SegmentRebaseRecord = {
    index: segmentIndex,
    offsetPts,
    assignment,
    audio: scan.audio,
    video: scan.video,
    rebasedChainEndPts,
    rebasedChainStartPts,
    boundaryDeltaPts,
    trimmedPackets,
    anomalies,
  };
  session.records.set(segmentIndex, record);

  const stats = session.stats;
  if (assignment !== 'memoized') {
    stats.segments += 1;
    if (assignment === 'chained') {
      stats.chained += 1;
    } else {
      stats.anchored += 1;
    }
    stats.anomalies += anomalies.length;
  }
  stats.trimmedPackets += trimmedPackets;
  stats.maxBoundaryDeltaMs = Math.max(
    stats.maxBoundaryDeltaMs,
    Math.round(Math.abs(boundaryDeltaPts) / (PTS_CLOCK / 1000)),
  );

  const buffer = data.buffer instanceof ArrayBuffer ? data.buffer : data.slice().buffer;
  return { status: 'rebased', data: buffer, record };
};
