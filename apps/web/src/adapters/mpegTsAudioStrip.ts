export const TS_PACKET_SIZE = 188;
export const TS_SYNC_BYTE = 0x47;
export const MPEG_AUDIO_STREAM_TYPES = new Set([0x03, 0x04]);
export const AAC_AUDIO_STREAM_TYPE = 0x0f;
// PMT stream_type values: 0x02 = MPEG-2 video, 0x1b = H.264/AVC, 0x24 = H.265/HEVC.
const HEVC_VIDEO_STREAM_TYPE = 0x24;
export const VIDEO_STREAM_TYPES = new Set([0x02, 0x1b, HEVC_VIDEO_STREAM_TYPE]);

export interface MpegTsAudioDetection {
  hasVideo: boolean;
  hasMpegAudio: boolean;
  hasAacAudio: boolean;
  /** True when the video track is H.265/HEVC, which most browsers cannot decode in MSE. */
  hasHevcVideo: boolean;
  audioPids: number[];
  mpegAudioPids: number[];
  pmtPid: number | null;
}

export interface PmtStreamEntry {
  streamType: number;
  pid: number;
  start: number;
  end: number;
}

export interface PmtParseResult {
  pmtPid: number;
  streams: PmtStreamEntry[];
  section: Uint8Array;
}

export const toUint8Array = (data: ArrayBuffer | Uint8Array): Uint8Array => (
  data instanceof Uint8Array ? data : new Uint8Array(data)
);

export const getPacketPid = (packet: Uint8Array, offset: number): number => (
  ((packet[offset + 1] & 0x1f) << 8) | packet[offset + 2]
);

export const hasPayloadUnitStart = (packet: Uint8Array, offset: number): boolean => (
  (packet[offset + 1] & 0x40) !== 0
);

export const getPayloadOffset = (packet: Uint8Array, offset: number): number | null => {
  const adaptationControl = (packet[offset + 3] >> 4) & 0x03;
  if (adaptationControl === 0 || adaptationControl === 2) {
    return null;
  }

  let payloadOffset = offset + 4;
  if (adaptationControl === 3) {
    payloadOffset += 1 + packet[payloadOffset];
  }

  return payloadOffset < offset + TS_PACKET_SIZE ? payloadOffset : null;
};

const readSectionForPid = (data: Uint8Array, targetPid: number): Uint8Array | null => {
  const chunks: Uint8Array[] = [];
  let expectedLength: number | null = null;

  for (let offset = 0; offset + TS_PACKET_SIZE <= data.length; offset += TS_PACKET_SIZE) {
    if (data[offset] !== TS_SYNC_BYTE || getPacketPid(data, offset) !== targetPid) {
      continue;
    }

    let payloadOffset = getPayloadOffset(data, offset);
    if (payloadOffset === null) {
      continue;
    }

    if (hasPayloadUnitStart(data, offset)) {
      const pointerField = data[payloadOffset];
      payloadOffset += 1 + pointerField;
      chunks.length = 0;
      expectedLength = null;
    }

    if (payloadOffset >= offset + TS_PACKET_SIZE) {
      continue;
    }

    chunks.push(data.subarray(payloadOffset, offset + TS_PACKET_SIZE));
    const current = concatChunks(chunks);
    if (current.length >= 3 && expectedLength === null) {
      expectedLength = 3 + (((current[1] & 0x0f) << 8) | current[2]);
    }
    if (expectedLength !== null && current.length >= expectedLength) {
      return current.subarray(0, expectedLength);
    }
  }

  return null;
};

const concatChunks = (chunks: Uint8Array[]): Uint8Array => {
  const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const output = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.length;
  }
  return output;
};

const parsePatForPmtPid = (section: Uint8Array | null): number | null => {
  if (!section || section.length < 12 || section[0] !== 0x00) {
    return null;
  }

  const sectionLength = ((section[1] & 0x0f) << 8) | section[2];
  const end = Math.min(section.length, 3 + sectionLength - 4);
  for (let offset = 8; offset + 4 <= end; offset += 4) {
    const programNumber = (section[offset] << 8) | section[offset + 1];
    if (programNumber === 0) {
      continue;
    }
    return ((section[offset + 2] & 0x1f) << 8) | section[offset + 3];
  }

  return null;
};

const parsePmt = (data: Uint8Array, pmtPid: number): PmtParseResult | null => {
  const section = readSectionForPid(data, pmtPid);
  if (!section || section.length < 16 || section[0] !== 0x02) {
    return null;
  }

  const sectionLength = ((section[1] & 0x0f) << 8) | section[2];
  const sectionEnd = Math.min(section.length, 3 + sectionLength - 4);
  const programInfoLength = ((section[10] & 0x0f) << 8) | section[11];
  const streams: PmtStreamEntry[] = [];

  for (let offset = 12 + programInfoLength; offset + 5 <= sectionEnd;) {
    const streamType = section[offset];
    const pid = ((section[offset + 1] & 0x1f) << 8) | section[offset + 2];
    const esInfoLength = ((section[offset + 3] & 0x0f) << 8) | section[offset + 4];
    const end = offset + 5 + esInfoLength;
    if (end > sectionEnd) {
      break;
    }
    streams.push({
      streamType,
      pid,
      start: offset,
      end,
    });
    offset = end;
  }

  return {
    pmtPid,
    streams,
    section,
  };
};

export const parseTs = (data: Uint8Array): PmtParseResult | null => {
  const patSection = readSectionForPid(data, 0);
  const pmtPid = parsePatForPmtPid(patSection);
  return pmtPid === null ? null : parsePmt(data, pmtPid);
};

export const detectMpegTsAudio = (data: ArrayBuffer | Uint8Array): MpegTsAudioDetection => {
  const parsed = parseTs(toUint8Array(data));
  if (!parsed) {
    return {
      hasVideo: false,
      hasMpegAudio: false,
      hasAacAudio: false,
      hasHevcVideo: false,
      audioPids: [],
      mpegAudioPids: [],
      pmtPid: null,
    };
  }

  const audioPids: number[] = [];
  const mpegAudioPids: number[] = [];
  let hasVideo = false;
  let hasAacAudio = false;
  let hasHevcVideo = false;

  for (const stream of parsed.streams) {
    if (VIDEO_STREAM_TYPES.has(stream.streamType)) {
      hasVideo = true;
    }
    if (stream.streamType === HEVC_VIDEO_STREAM_TYPE) {
      hasHevcVideo = true;
    }
    if (MPEG_AUDIO_STREAM_TYPES.has(stream.streamType)) {
      audioPids.push(stream.pid);
      mpegAudioPids.push(stream.pid);
    }
    if (stream.streamType === AAC_AUDIO_STREAM_TYPE) {
      audioPids.push(stream.pid);
      hasAacAudio = true;
    }
  }

  return {
    hasVideo,
    hasMpegAudio: mpegAudioPids.length > 0,
    hasAacAudio,
    hasHevcVideo,
    audioPids,
    mpegAudioPids,
    pmtPid: parsed.pmtPid,
  };
};

const crc32Mpeg = (data: Uint8Array): number => {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc ^= byte << 24;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc & 0x80000000)
        ? ((crc << 1) ^ 0x04c11db7)
        : (crc << 1);
      crc >>>= 0;
    }
  }
  return crc >>> 0;
};

const rebuildPmtWithoutMpegAudio = (pmt: PmtParseResult): Uint8Array | null => {
  const section = pmt.section;
  const sectionLength = ((section[1] & 0x0f) << 8) | section[2];
  const sectionEnd = Math.min(section.length, 3 + sectionLength - 4);
  const programInfoLength = ((section[10] & 0x0f) << 8) | section[11];
  const streamsStart = 12 + programInfoLength;
  if (streamsStart > sectionEnd) {
    return null;
  }

  const keptStreamBytes: Uint8Array[] = [];
  let removedAny = false;
  for (const stream of pmt.streams) {
    if (MPEG_AUDIO_STREAM_TYPES.has(stream.streamType)) {
      removedAny = true;
      continue;
    }
    keptStreamBytes.push(section.subarray(stream.start, stream.end));
  }

  if (!removedAny) {
    return null;
  }

  const bodyLength = (streamsStart - 3) + keptStreamBytes.reduce((sum, chunk) => sum + chunk.length, 0);
  const nextSectionLength = bodyLength + 4;
  const output = new Uint8Array(3 + nextSectionLength);
  output[0] = section[0];
  output[1] = (section[1] & 0xf0) | ((nextSectionLength >> 8) & 0x0f);
  output[2] = nextSectionLength & 0xff;
  output.set(section.subarray(3, streamsStart), 3);

  let offset = streamsStart;
  for (const chunk of keptStreamBytes) {
    output.set(chunk, offset);
    offset += chunk.length;
  }

  const crc = crc32Mpeg(output.subarray(0, offset));
  output[offset] = (crc >>> 24) & 0xff;
  output[offset + 1] = (crc >>> 16) & 0xff;
  output[offset + 2] = (crc >>> 8) & 0xff;
  output[offset + 3] = crc & 0xff;

  return output;
};

export const stripUnsupportedMpegAudioFromTs = (
  data: ArrayBuffer | Uint8Array,
): ArrayBuffer => {
  const input = toUint8Array(data);
  const parsed = parseTs(input);
  if (!parsed) {
    return input.slice().buffer;
  }

  const mpegAudioPids = parsed.streams
    .filter((stream) => MPEG_AUDIO_STREAM_TYPES.has(stream.streamType))
    .map((stream) => stream.pid);
  const hasVideo = parsed.streams.some((stream) => VIDEO_STREAM_TYPES.has(stream.streamType));
  if (mpegAudioPids.length === 0 || !hasVideo) {
    return input.slice().buffer;
  }

  const nextPmtSection = rebuildPmtWithoutMpegAudio(parsed);
  if (!nextPmtSection) {
    return input.slice().buffer;
  }

  const mpegAudioPidSet = new Set(mpegAudioPids);
  const outputPackets: Uint8Array[] = [];
  for (let offset = 0; offset + TS_PACKET_SIZE <= input.length; offset += TS_PACKET_SIZE) {
    if (input[offset] !== TS_SYNC_BYTE) {
      continue;
    }

    const pid = getPacketPid(input, offset);
    if (mpegAudioPidSet.has(pid)) {
      continue;
    }

    const packet = input.slice(offset, offset + TS_PACKET_SIZE);
    if (pid === parsed.pmtPid && hasPayloadUnitStart(packet, 0)) {
      const payloadOffset = getPayloadOffset(packet, 0);
      if (payloadOffset !== null) {
        const pointerField = packet[payloadOffset];
        const sectionOffset = payloadOffset + 1 + pointerField;
        if (sectionOffset + nextPmtSection.length <= TS_PACKET_SIZE) {
          packet.set(nextPmtSection, sectionOffset);
          packet.fill(0xff, sectionOffset + nextPmtSection.length);
        }
      }
    }

    outputPackets.push(packet);
  }

  const output = new Uint8Array(outputPackets.length * TS_PACKET_SIZE);
  outputPackets.forEach((packet, index) => {
    output.set(packet, index * TS_PACKET_SIZE);
  });
  return output.buffer;
};
