import type { PlayerChannel } from '@lumen/types';
import { BRAND_SHORT } from '@/config/brand';

export type CatchUpWebCapabilityStatus = 'playable' | 'unsupported' | 'unknown';

export type CatchUpWebCapabilityReasonCode =
  | 'browser-compatible-provider-archive'
  | 'not-in-provider-matrix'
  | 'unsupported-audio-codec'
  | 'unsupported-video-codec'
  | 'unsupported-archive-signal'
  | 'ts-sanitizer-risk'
  | 'unstable-params-risk'
  | 'catchup-not-advertised';

interface ProviderCatchUpMatrixEntry {
  channelName: string;
  status: 'unsupported' | 'risk';
  reasonCode: CatchUpWebCapabilityReasonCode;
  summary: string;
  evidence: string;
}

export interface CatchUpWebCapability {
  status: CatchUpWebCapabilityStatus;
  blockPlayback: boolean;
  reasonCode: CatchUpWebCapabilityReasonCode;
  streamId: number;
  channelName: string;
  summary: string;
  evidence: string | null;
  observedAt: string | null;
}

export interface CatchUpWebCapabilityNotice {
  title: string;
  description: string;
  primaryActionLabel: string;
}

const PROVIDER_MATRIX_OBSERVED_AT = '2026-05-13T14:42:00+02:00';

const UNSUPPORTED_PROVIDER_ARCHIVE_STREAMS: Record<number, ProviderCatchUpMatrixEntry> = {
  53: {
    channelName: 'KANAL 5',
    status: 'unsupported',
    reasonCode: 'unsupported-audio-codec',
    summary: 'H.264 video + MP2 audio',
    evidence: 'unsupported=audio:mp2',
  },
  54: {
    channelName: 'SITEL',
    status: 'unsupported',
    reasonCode: 'unsupported-audio-codec',
    summary: 'H.264 video + MP2 audio',
    evidence: 'unsupported=audio:mp2',
  },
  81: {
    channelName: 'HBO',
    status: 'unsupported',
    reasonCode: 'unsupported-audio-codec',
    summary: 'H.264 video + AC3 audio',
    evidence: 'unsupported=audio:ac3',
  },
  169: {
    channelName: 'NICKELODEON',
    status: 'unsupported',
    reasonCode: 'unsupported-audio-codec',
    summary: 'H.264 video + MP2 audio',
    evidence: 'unsupported=audio:mp2',
  },
  260: {
    channelName: 'AMC',
    status: 'unsupported',
    reasonCode: 'unsupported-audio-codec',
    summary: 'H.264 video + MP2 audio',
    evidence: 'unsupported=audio:mp2',
  },
  530: {
    channelName: 'NOVA BH',
    status: 'unsupported',
    reasonCode: 'unsupported-audio-codec',
    summary: 'H.264 video + MP3 audio',
    evidence: 'unsupported=audio:mp3;unstable_params',
  },
  587: {
    channelName: 'NICK JR.',
    status: 'unsupported',
    reasonCode: 'unsupported-audio-codec',
    summary: 'H.264 video + MP2 audio',
    evidence: 'unsupported=audio:mp2',
  },
  713: {
    channelName: 'CINESTAR TV ACTION',
    status: 'unsupported',
    reasonCode: 'unsupported-audio-codec',
    summary: 'H.264 video + MP2 audio',
    evidence: 'unsupported=audio:mp2',
  },
  1495: {
    channelName: 'PRVA WORLD',
    status: 'unsupported',
    reasonCode: 'unsupported-audio-codec',
    summary: 'H.264 video + MP2 audio',
    evidence: 'unsupported=audio:mp2',
  },
  2927: {
    channelName: 'RTS 1 (Ultra HD)',
    status: 'unsupported',
    reasonCode: 'unsupported-video-codec',
    summary: 'HEVC video + AAC audio',
    evidence: 'unsupported=video:hevc',
  },
  14219: {
    channelName: 'MAX SPORT 2',
    status: 'unsupported',
    reasonCode: 'unsupported-archive-signal',
    summary: 'H.264 video + audio nije detektovan',
    evidence: 'internal_ts_break=1;audio=undetected',
  },
  29952: {
    channelName: 'ARENA PREMIUM 1 BH',
    status: 'unsupported',
    reasonCode: 'unsupported-audio-codec',
    summary: 'H.264 video + MP2 audio',
    evidence: 'unsupported=audio:mp2',
  },
};

const RISK_PROVIDER_ARCHIVE_STREAMS: Record<number, ProviderCatchUpMatrixEntry> = {
  5: {
    channelName: 'EUROSPORT 2',
    status: 'risk',
    reasonCode: 'unstable-params-risk',
    summary: 'H.264 video + AAC audio, ali nestabilni parametri u uzorku',
    evidence: 'unstable_params',
  },
  165: {
    channelName: 'RTV 1',
    status: 'risk',
    reasonCode: 'ts-sanitizer-risk',
    summary: 'H.264 video + AAC audio, ali sa TS prekidima u arhivi',
    evidence: 'internal_ts_break=3',
  },
};

export class CatchUpWebCapabilityError extends Error {
  readonly code = 'catchup_web_provider_incompatible';

  readonly capability: CatchUpWebCapability;

  constructor(capability: CatchUpWebCapability) {
    super(capability.reasonCode);
    this.name = 'CatchUpWebCapabilityError';
    this.capability = capability;
  }
}

const buildCapabilityFromMatrixEntry = (
  channel: Pick<PlayerChannel, 'name' | 'streamId'>,
  entry: ProviderCatchUpMatrixEntry,
): CatchUpWebCapability => ({
  status: 'unknown',
  blockPlayback: false,
  reasonCode: entry.reasonCode,
  streamId: channel.streamId,
  channelName: channel.name || entry.channelName,
  summary: entry.summary,
  evidence: entry.evidence,
  observedAt: PROVIDER_MATRIX_OBSERVED_AT,
});

export const resolveCatchUpWebCapability = (
  channel: Pick<PlayerChannel, 'name' | 'streamId' | 'source' | 'hasCatchUp' | 'catchUpDays'>,
): CatchUpWebCapability => {
  if (!channel.hasCatchUp || channel.catchUpDays <= 0) {
    return {
      status: 'unsupported',
      blockPlayback: true,
      reasonCode: 'catchup-not-advertised',
      streamId: channel.streamId,
      channelName: channel.name,
      summary: 'catch-up nije označen kao dostupan za ovaj kanal',
      evidence: null,
      observedAt: null,
    };
  }

  const unsupportedEntry = UNSUPPORTED_PROVIDER_ARCHIVE_STREAMS[channel.streamId];
  if (unsupportedEntry) {
    return buildCapabilityFromMatrixEntry(channel, unsupportedEntry);
  }

  const riskEntry = RISK_PROVIDER_ARCHIVE_STREAMS[channel.streamId];
  if (riskEntry) {
    return buildCapabilityFromMatrixEntry(channel, riskEntry);
  }

  return {
    status: 'unknown',
    blockPlayback: false,
    reasonCode: 'not-in-provider-matrix',
    streamId: channel.streamId,
    channelName: channel.name,
    summary: 'kanal nije u listi potvrđeno nepodržanih web catch-up arhiva',
    evidence: null,
    observedAt: null,
  };
};

export const assertCatchUpWebPlayable = (
  channel: Pick<PlayerChannel, 'name' | 'streamId' | 'source' | 'hasCatchUp' | 'catchUpDays'>,
): void => {
  const capability = resolveCatchUpWebCapability(channel);
  if (capability.blockPlayback) {
    throw new CatchUpWebCapabilityError(capability);
  }
};

export const isCatchUpWebCapabilityError = (
  value: unknown,
): value is CatchUpWebCapabilityError => (
  value instanceof CatchUpWebCapabilityError ||
  (
    Boolean(value) &&
    typeof value === 'object' &&
    (value as { name?: unknown }).name === 'CatchUpWebCapabilityError' &&
    (value as { code?: unknown }).code === 'catchup_web_provider_incompatible'
  )
);

const buildCapabilityNoticeDescription = (capability: CatchUpWebCapability): string => {
  if (capability.reasonCode === 'catchup-not-advertised') {
    return `${capability.channelName} nema dostupnu TV unazad arhivu u web playeru. Nije do vašeg uređaja niti do ${BRAND_SHORT} playera.`;
  }

  if (capability.reasonCode === 'unsupported-audio-codec') {
    return `Na kanalu ${capability.channelName}, TV unazad koristi audio kodek koji web browser ne može pouzdano da pusti. Live kanal može raditi normalno, ali ovaj snimak nije dostupan u web playeru bez promene formata kod provajdera.`;
  }

  if (capability.reasonCode === 'unsupported-video-codec') {
    return `Na kanalu ${capability.channelName}, TV unazad koristi video kodek koji web browser ne može pouzdano da pusti. Live kanal može raditi normalno, ali ovaj snimak nije dostupan u web playeru bez promene formata kod provajdera.`;
  }

  if (capability.reasonCode === 'unsupported-archive-signal') {
    return `Na kanalu ${capability.channelName}, TV unazad koristi format snimka koji web browser ne može pouzdano da pročita. Live kanal može raditi normalno, ali ovaj snimak nije dostupan u web playeru bez promene formata kod provajdera.`;
  }

  return `Na kanalu ${capability.channelName}, TV unazad koristi audio/video kodek ili format koji web browser ne može pouzdano da pusti. Live kanal može raditi normalno, ali ovaj snimak nije dostupan u web playeru bez promene formata kod provajdera.`;
};

export const getCatchUpWebCapabilityNotice = (
  value: CatchUpWebCapabilityError | CatchUpWebCapability,
): CatchUpWebCapabilityNotice => {
  const capability = value instanceof CatchUpWebCapabilityError
    ? value.capability
    : value;

  return {
    title: 'Snimak za TV unazad nije dostupan u web playeru',
    description: buildCapabilityNoticeDescription(capability),
    primaryActionLabel: `Gledaj ${capability.channelName} uživo`,
  };
};
