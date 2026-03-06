const TS_PACKET_SIZE = 188;
const MIN_STABLE_SYNC_PACKETS = 5;
const PTS_TIMESCALE = 90_000;

type StreamKind = "video" | "audio";

export interface PidContinuityRange {
  first: number;
  last: number;
}

export type PidContinuityRangeMap = Record<string, PidContinuityRange>;
export type PidContinuityValueMap = Record<string, number>;

interface PidPtsStats {
  streamKind: StreamKind;
  firstPts: number | null;
  lastPts: number | null;
  ptsCount: number;
}

export interface TransportStreamInspection {
  syncOffsetBytes: number;
  cleanedBuffer: Buffer;
  pid: number;
  streamKind: StreamKind;
  firstPts: number;
  lastPts: number;
  normalizedDurationSeconds: number;
  continuityByPid: PidContinuityRangeMap;
}

const inferStreamKindFromStreamId = (streamId: number): StreamKind | null => {
  if (streamId >= 0xe0 && streamId <= 0xef) {
    return "video";
  }

  if (streamId >= 0xc0 && streamId <= 0xdf) {
    return "audio";
  }

  return null;
};

const decodePts = (buffer: Buffer, offset: number): number => (
  (((buffer[offset] >> 1) & 0x07) * 0x20000000) +
  (buffer[offset + 1] * 0x400000) +
  (((buffer[offset + 2] >> 1) & 0x7f) * 0x8000) +
  (buffer[offset + 3] * 0x80) +
  ((buffer[offset + 4] >> 1) & 0x7f)
);

const countAlignedPackets = (buffer: Buffer, offset: number): number => {
  let packetCount = 0;
  for (let cursor = offset; cursor + TS_PACKET_SIZE <= buffer.length; cursor += TS_PACKET_SIZE) {
    if (buffer[cursor] !== 0x47) {
      break;
    }
    packetCount += 1;
  }

  return packetCount;
};

export const findTransportStreamSyncOffset = (
  buffer: Buffer,
  minimumPackets = MIN_STABLE_SYNC_PACKETS,
): number | null => {
  const maxOffset = Math.min(TS_PACKET_SIZE - 1, Math.max(0, buffer.length - TS_PACKET_SIZE));
  let bestOffset: number | null = null;
  let bestPacketCount = 0;

  for (let offset = 0; offset <= maxOffset; offset += 1) {
    if (buffer[offset] !== 0x47) {
      continue;
    }

    const packetCount = countAlignedPackets(buffer, offset);
    if (packetCount >= minimumPackets && packetCount > bestPacketCount) {
      bestOffset = offset;
      bestPacketCount = packetCount;
    }
  }

  return bestOffset;
};

export const stripTransportStreamPreamble = (
  buffer: Buffer,
  syncOffsetBytes = findTransportStreamSyncOffset(buffer),
): Buffer => {
  if (typeof syncOffsetBytes !== "number" || syncOffsetBytes < 0) {
    throw new Error("No stable TS sync offset found.");
  }

  const packetAlignedLength = Math.floor((buffer.length - syncOffsetBytes) / TS_PACKET_SIZE) * TS_PACKET_SIZE;
  if (packetAlignedLength < TS_PACKET_SIZE) {
    throw new Error("Transport stream payload is too short after sync alignment.");
  }

  return buffer.subarray(syncOffsetBytes, syncOffsetBytes + packetAlignedLength);
};

const upsertPidStats = (
  statsByPid: Map<number, PidPtsStats>,
  pid: number,
  streamKind: StreamKind,
  pts: number,
): void => {
  const current = statsByPid.get(pid);
  if (!current) {
    statsByPid.set(pid, {
      streamKind,
      firstPts: pts,
      lastPts: pts,
      ptsCount: 1,
    });
    return;
  }

  current.firstPts = current.firstPts === null ? pts : Math.min(current.firstPts, pts);
  current.lastPts = current.lastPts === null ? pts : Math.max(current.lastPts, pts);
  current.ptsCount += 1;
};

const upsertPidContinuity = (
  continuityByPid: Map<number, PidContinuityRange>,
  pid: number,
  continuityCounter: number,
): void => {
  const current = continuityByPid.get(pid);
  if (!current) {
    continuityByPid.set(pid, {
      first: continuityCounter,
      last: continuityCounter,
    });
    return;
  }

  current.last = continuityCounter;
};

const toPidContinuityRangeMap = (
  continuityByPid: Map<number, PidContinuityRange>,
): PidContinuityRangeMap => Object.fromEntries(
  Array.from(continuityByPid.entries(), ([pid, value]) => [String(pid), value]),
);

const selectBestPidStats = (
  statsByPid: Map<number, PidPtsStats>,
  streamKind: StreamKind,
): [number, PidPtsStats] | null => {
  let best: [number, PidPtsStats] | null = null;

  for (const entry of statsByPid.entries()) {
    const [pid, stats] = entry;
    if (
      stats.streamKind !== streamKind ||
      stats.firstPts === null ||
      stats.lastPts === null ||
      stats.lastPts <= stats.firstPts
    ) {
      continue;
    }

    if (!best) {
      best = [pid, stats];
      continue;
    }

    const [, bestStats] = best;
    const currentSpan = stats.lastPts - stats.firstPts;
    const bestSpan = (bestStats.lastPts ?? 0) - (bestStats.firstPts ?? 0);
    if (currentSpan > bestSpan || (currentSpan === bestSpan && stats.ptsCount > bestStats.ptsCount)) {
      best = [pid, stats];
    }
  }

  return best;
};

export const inspectTransportStreamSegment = (buffer: Buffer): TransportStreamInspection => {
  const syncOffsetBytes = findTransportStreamSyncOffset(buffer);
  const cleanedBuffer = stripTransportStreamPreamble(buffer, syncOffsetBytes);
  const statsByPid = new Map<number, PidPtsStats>();
  const continuityByPid = new Map<number, PidContinuityRange>();

  for (let offset = 0; offset + TS_PACKET_SIZE <= cleanedBuffer.length; offset += TS_PACKET_SIZE) {
    if (cleanedBuffer[offset] !== 0x47) {
      continue;
    }

    const packet = cleanedBuffer.subarray(offset, offset + TS_PACKET_SIZE);
    const payloadUnitStartIndicator = (packet[1] & 0x40) !== 0;
    const pid = ((packet[1] & 0x1f) << 8) | packet[2];
    const adaptationFieldControl = (packet[3] >> 4) & 0x03;
    const continuityCounter = packet[3] & 0x0f;

    upsertPidContinuity(continuityByPid, pid, continuityCounter);

    if (adaptationFieldControl === 0 || adaptationFieldControl === 2) {
      continue;
    }

    let payloadOffset = 4;
    if (adaptationFieldControl === 3) {
      const adaptationFieldLength = packet[payloadOffset] ?? 0;
      payloadOffset += 1 + adaptationFieldLength;
    }

    if (!payloadUnitStartIndicator || payloadOffset + 14 > TS_PACKET_SIZE) {
      continue;
    }

    if (
      packet[payloadOffset] !== 0x00 ||
      packet[payloadOffset + 1] !== 0x00 ||
      packet[payloadOffset + 2] !== 0x01
    ) {
      continue;
    }

    const streamId = packet[payloadOffset + 3];
    const streamKind = inferStreamKindFromStreamId(streamId);
    if (!streamKind) {
      continue;
    }

    const ptsDtsFlags = (packet[payloadOffset + 7] >> 6) & 0x03;
    const pesHeaderDataLength = packet[payloadOffset + 8];
    if ((ptsDtsFlags & 0x02) === 0 || pesHeaderDataLength < 5) {
      continue;
    }

    const ptsOffset = payloadOffset + 9;
    if (ptsOffset + 5 > TS_PACKET_SIZE) {
      continue;
    }

    upsertPidStats(statsByPid, pid, streamKind, decodePts(packet, ptsOffset));
  }

  const bestVideo = selectBestPidStats(statsByPid, "video");
  const bestAudio = selectBestPidStats(statsByPid, "audio");
  const selected = bestVideo ?? bestAudio;
  if (!selected) {
    throw new Error("PTS scan is unusable for this transport stream segment.");
  }

  const [pid, stats] = selected;
  if (stats.firstPts === null || stats.lastPts === null || stats.lastPts <= stats.firstPts) {
    throw new Error("PTS scan did not produce a valid duration.");
  }

  return {
    syncOffsetBytes: syncOffsetBytes ?? 0,
    cleanedBuffer,
    pid,
    streamKind: stats.streamKind,
    firstPts: stats.firstPts,
    lastPts: stats.lastPts,
    normalizedDurationSeconds: (stats.lastPts - stats.firstPts) / PTS_TIMESCALE,
    continuityByPid: toPidContinuityRangeMap(continuityByPid),
  };
};

export const rewriteTransportStreamContinuity = (
  cleanedBuffer: Buffer,
  expectedFirstContinuityByPid: PidContinuityValueMap = {},
): {
  rewrittenBuffer: Buffer;
  lastContinuityByPid: PidContinuityValueMap;
} => {
  const rewrittenBuffer = Buffer.from(cleanedBuffer);
  const deltaByPid = new Map<number, number>();
  const lastContinuityByPid = new Map<number, number>();

  for (let offset = 0; offset + TS_PACKET_SIZE <= rewrittenBuffer.length; offset += TS_PACKET_SIZE) {
    if (rewrittenBuffer[offset] !== 0x47) {
      continue;
    }

    const pid = ((rewrittenBuffer[offset + 1] & 0x1f) << 8) | rewrittenBuffer[offset + 2];
    const currentContinuity = rewrittenBuffer[offset + 3] & 0x0f;

    let delta = deltaByPid.get(pid);
    if (typeof delta !== "number") {
      const expectedFirst = expectedFirstContinuityByPid[String(pid)];
      delta = typeof expectedFirst === "number"
        ? (expectedFirst - currentContinuity + 16) % 16
        : 0;
      deltaByPid.set(pid, delta);
    }

    const rewrittenContinuity = (currentContinuity + delta) & 0x0f;
    rewrittenBuffer[offset + 3] = (rewrittenBuffer[offset + 3] & 0xf0) | rewrittenContinuity;
    lastContinuityByPid.set(pid, rewrittenContinuity);
  }

  return {
    rewrittenBuffer,
    lastContinuityByPid: Object.fromEntries(
      Array.from(lastContinuityByPid.entries(), ([pid, value]) => [String(pid), value]),
    ),
  };
};
