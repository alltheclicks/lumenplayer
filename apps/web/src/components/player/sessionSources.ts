import type { SessionSource } from '@lumen/session-core';
import type { PlayerChannel, Program } from '@lumen/types';
import type { CatchUpGatewayPlaybackMetadata } from './catchupGateway';
import {
  buildCatchUpTransportPlan,
  type CatchUpTransportPlan,
  type CatchUpUrlBuilder,
} from './catchupTransport';

export type SessionSourceMode = 'live' | 'catchup' | 'vod' | 'series-episode';

export interface LiveSessionSourceMetadata {
  mode: 'live';
  channelId: string;
  streamId: number;
  source?: PlayerChannel['source'];
  loadKey?: number;
  unsupportedAudioCodec?: 'mp2';
  unsupportedVideoCodec?: 'hevc';
}

export interface CatchUpSessionSourceMetadata {
  mode: 'catchup';
  channelId: string;
  streamId: number;
  programId: string;
  startTimestamp: number;
  durationSeconds: number;
  fallbackStreamIds: number[];
  title?: string;
  source?: PlayerChannel['source'];
  gateway?: CatchUpGatewayPlaybackMetadata;
  catchUpHlsStartupMode?: 'progressive' | 'complete';
  catchUpHlsStartPositionSeconds?: number;
  catchUpProviderSafeStartPositionSeconds?: number;
  catchUpMediaOffsetSeconds?: number;
  catchUpPendingTimelineSeekMs?: number;
  catchUpPendingMediaSeekSeconds?: number;
  catchUpWebProviderIssue?: {
    reasonCode: string;
    channelName: string;
    summary?: string;
    evidence?: string;
    observedAt?: string;
  };
}

export interface VodSessionSourceMetadata {
  mode: 'vod';
  vodId: string;
  streamId?: number;
  backPath?: string;
}

export interface SeriesEpisodeSessionSourceMetadata {
  mode: 'series-episode';
  seriesId: string;
  seasonNumber?: number;
  episodeId?: string;
  episodeNumber?: number;
  backPath?: string;
}

type SessionSourceMetadataShape = {
  mode?: SessionSourceMode;
  channelId?: string;
  streamId?: number;
  loadKey?: number;
  unsupportedAudioCodec?: 'mp2';
  unsupportedVideoCodec?: 'hevc';
  source?: PlayerChannel['source'];
  programId?: string;
  durationSeconds?: number;
  fallbackStreamIds?: number[];
  title?: string;
  vodId?: string;
  seriesId?: string;
  seasonNumber?: number;
  episodeId?: string;
  episodeNumber?: number;
  backPath?: string;
  gateway?: CatchUpGatewayPlaybackMetadata;
  catchUpHlsStartupMode?: 'progressive' | 'complete';
  catchUpHlsStartPositionSeconds?: number;
  catchUpProviderSafeStartPositionSeconds?: number;
  catchUpMediaOffsetSeconds?: number;
  catchUpPendingTimelineSeekMs?: number;
  catchUpPendingMediaSeekSeconds?: number;
  catchUpWebProviderIssue?: CatchUpSessionSourceMetadata['catchUpWebProviderIssue'];
};

export type ParsedSessionSourceMetadata = (
  | LiveSessionSourceMetadata
  | CatchUpSessionSourceMetadata
  | VodSessionSourceMetadata
  | SeriesEpisodeSessionSourceMetadata
  | Record<string, never>
) & SessionSourceMetadataShape;

export interface CatchUpSourceBuildResult {
  source: SessionSource;
  transportPlan: CatchUpTransportPlan;
  initialPositionMs: number;
  fullDurationSeconds: number;
  metadata: CatchUpSessionSourceMetadata;
}

const DEFAULT_CATCH_UP_INITIAL_POSITION_GUARD_SECONDS = 0;

const parseNumericValue = (value: unknown): number | undefined => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === 'string') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  return undefined;
};

const parseStringValue = (value: unknown): string | undefined => {
  if (typeof value !== 'string') {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

const parseStringArray = (value: unknown): string[] => {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) => parseStringValue(item))
    .filter((item): item is string => typeof item === 'string');
};

const parseBooleanValue = (value: unknown): boolean | undefined => {
  if (typeof value === 'boolean') {
    return value;
  }

  if (value === 'true') {
    return true;
  }

  if (value === 'false') {
    return false;
  }

  return undefined;
};

const parseCatchUpGatewayMetadata = (
  metadata: Record<string, unknown>,
): CatchUpGatewayPlaybackMetadata | undefined => {
  const rawGateway = metadata.gateway;
  if (!rawGateway || typeof rawGateway !== 'object') {
    return undefined;
  }

  const gateway = rawGateway as Record<string, unknown>;
  const serverId = parseStringValue(gateway.serverId);
  const assetKey = parseStringValue(gateway.assetKey);
  const transportMode = parseStringValue(gateway.transportMode);
  const playbackUrl = parseStringValue(gateway.playbackUrl);
  const assetState = parseStringValue(gateway.assetState);
  const hotStart = parseBooleanValue(gateway.hotStart);

  if (
    !serverId ||
    !assetKey ||
    !playbackUrl ||
    hotStart === undefined ||
    (
      transportMode !== 'provider-direct' &&
      transportMode !== 'proxy-normalized' &&
      transportMode !== 'proxy-remuxed'
    ) ||
    (
      assetState !== 'ready' &&
      assetState !== 'preparing' &&
      assetState !== 'failed'
    )
  ) {
    return undefined;
  }

  return {
    serverId,
    assetKey,
    transportMode,
    playbackUrl,
    assetState,
    fallbackReason: parseStringValue(gateway.fallbackReason) ?? null,
    hotStart,
  };
};

const parseCatchUpWebProviderIssueMetadata = (
  metadata: Record<string, unknown>,
): CatchUpSessionSourceMetadata['catchUpWebProviderIssue'] | undefined => {
  const rawProviderIssue = metadata.catchUpWebProviderIssue;
  if (!rawProviderIssue || typeof rawProviderIssue !== 'object') {
    return undefined;
  }

  const providerIssue = rawProviderIssue as Record<string, unknown>;
  const reasonCode = parseStringValue(providerIssue.reasonCode);
  const channelName = parseStringValue(providerIssue.channelName);
  if (!reasonCode || !channelName) {
    return undefined;
  }

  return {
    reasonCode,
    channelName,
    ...(parseStringValue(providerIssue.summary)
      ? { summary: parseStringValue(providerIssue.summary) }
      : {}),
    ...(parseStringValue(providerIssue.evidence)
      ? { evidence: parseStringValue(providerIssue.evidence) }
      : {}),
    ...(parseStringValue(providerIssue.observedAt)
      ? { observedAt: parseStringValue(providerIssue.observedAt) }
      : {}),
  };
};

const normalizeFallbackStreamIds = (values: readonly number[], streamId: number): number[] => (
  values
    .map((value) => Math.floor(value))
    .filter((value) => Number.isFinite(value) && value > 0 && value !== streamId)
    .filter((value, index, array) => array.indexOf(value) === index)
);

const parseFallbackStreamIds = (metadata: Record<string, unknown>, streamId: number): number[] => {
  const directValues = Array.isArray(metadata.fallbackStreamIds)
    ? metadata.fallbackStreamIds
    : [];

  const fallbackUrls = Array.isArray(metadata.catchUpFallbackUrls)
    ? metadata.catchUpFallbackUrls
    : [];

  const legacyIds = parseStringArray(fallbackUrls)
    .map((url) => {
      const queryMatch = url.match(/[?&](?:stream|stream_id)=(\d+)/i);
      if (queryMatch) {
        return Number(queryMatch[1]);
      }

      const pathMatch = url.match(/\/(\d+)\.(?:ts|m3u8)(?:$|[?#])/i);
      return pathMatch ? Number(pathMatch[1]) : NaN;
    })
    .filter((value) => Number.isFinite(value)) as number[];

  return normalizeFallbackStreamIds(
    [
      ...directValues
        .map((value) => parseNumericValue(value))
        .filter((value): value is number => typeof value === 'number'),
      ...legacyIds,
    ],
    streamId,
  );
};

const resolveCatchUpProgramId = (metadata: Record<string, unknown>): string | undefined => (
  parseStringValue(metadata.programId) ?? parseStringValue(metadata.catchUpProgramId)
);

const resolveCatchUpStartTimestamp = (metadata: Record<string, unknown>): number | undefined => (
  parseNumericValue(metadata.startTimestamp)
  ?? parseNumericValue(metadata.catchUpStartTimestamp)
  ?? parseNumericValue(metadata.initialStartTs)
  ?? parseNumericValue(metadata.catchUpInitialStartTimestamp)
);

const resolveCatchUpDurationSeconds = (metadata: Record<string, unknown>): number | undefined => (
  parseNumericValue(metadata.durationSeconds)
  ?? parseNumericValue(metadata.catchUpDurationSeconds)
);

const resolveCatchUpTitle = (metadata: Record<string, unknown>): string | undefined => (
  parseStringValue(metadata.title) ?? parseStringValue(metadata.programTitle)
);

export const parseSessionSourceMetadata = (
  metadata: Record<string, unknown> | undefined,
): ParsedSessionSourceMetadata => {
  if (!metadata) {
    return {};
  }

  const mode = parseStringValue(metadata.mode);
  if (mode === 'live') {
    const channelId = parseStringValue(metadata.channelId);
    const streamId = parseNumericValue(metadata.streamId);
    if (!channelId || typeof streamId !== 'number') {
      return {};
    }

    return {
      mode,
      channelId,
      streamId: Math.floor(streamId),
      loadKey: parseNumericValue(metadata.loadKey),
      unsupportedAudioCodec: metadata.unsupportedAudioCodec === 'mp2'
        ? 'mp2'
        : undefined,
      unsupportedVideoCodec: metadata.unsupportedVideoCodec === 'hevc'
        ? 'hevc'
        : undefined,
      source: metadata.source === 'xtream' || metadata.source === 'm3u'
        ? metadata.source
        : undefined,
    };
  }

  if (mode === 'catchup') {
    const channelId = parseStringValue(metadata.channelId);
    const streamId = parseNumericValue(metadata.streamId);
    const programId = resolveCatchUpProgramId(metadata);
    const startTimestamp = resolveCatchUpStartTimestamp(metadata);
    const durationSeconds = resolveCatchUpDurationSeconds(metadata);
    if (
      !channelId ||
      typeof streamId !== 'number' ||
      !programId ||
      typeof startTimestamp !== 'number' ||
      typeof durationSeconds !== 'number'
    ) {
      return {};
    }

    return {
      mode,
      channelId,
      streamId: Math.floor(streamId),
      programId,
      startTimestamp: Math.floor(startTimestamp),
      durationSeconds: Math.max(1, Math.floor(durationSeconds)),
      fallbackStreamIds: parseFallbackStreamIds(metadata, Math.floor(streamId)),
      title: resolveCatchUpTitle(metadata),
      source: metadata.source === 'xtream' || metadata.source === 'm3u'
        ? metadata.source
        : undefined,
      gateway: parseCatchUpGatewayMetadata(metadata),
      catchUpHlsStartupMode: metadata.catchUpHlsStartupMode === 'complete'
        ? 'complete'
        : (metadata.catchUpHlsStartupMode === 'progressive' ? 'progressive' : undefined),
      catchUpHlsStartPositionSeconds: parseNumericValue(metadata.catchUpHlsStartPositionSeconds),
      catchUpProviderSafeStartPositionSeconds: parseNumericValue(metadata.catchUpProviderSafeStartPositionSeconds),
      catchUpMediaOffsetSeconds: parseNumericValue(metadata.catchUpMediaOffsetSeconds),
      catchUpPendingTimelineSeekMs: parseNumericValue(metadata.catchUpPendingTimelineSeekMs),
      catchUpPendingMediaSeekSeconds: parseNumericValue(metadata.catchUpPendingMediaSeekSeconds),
      catchUpWebProviderIssue: parseCatchUpWebProviderIssueMetadata(metadata),
    };
  }

  if (mode === 'vod') {
    const vodId = parseStringValue(metadata.vodId);
    if (!vodId) {
      return {};
    }

    return {
      mode,
      vodId,
      streamId: parseNumericValue(metadata.streamId),
      backPath: parseStringValue(metadata.backPath),
    };
  }

  if (mode === 'series-episode') {
    const seriesId = parseStringValue(metadata.seriesId);
    if (!seriesId) {
      return {};
    }

    return {
      mode,
      seriesId,
      seasonNumber: parseNumericValue(metadata.seasonNumber),
      episodeId: parseStringValue(metadata.episodeId),
      episodeNumber: parseNumericValue(metadata.episodeNumber),
      backPath: parseStringValue(metadata.backPath),
    };
  }

  return {};
};

export const isLiveSessionSourceMetadata = (
  metadata: ParsedSessionSourceMetadata,
): metadata is LiveSessionSourceMetadata => metadata.mode === 'live';

export const isCatchUpSessionSourceMetadata = (
  metadata: ParsedSessionSourceMetadata,
): metadata is CatchUpSessionSourceMetadata => metadata.mode === 'catchup';

export const resolveCatchUpInitialPositionMs = (
  durationSeconds: number,
  preferredPositionSeconds = 0,
  initialPositionGuardSeconds = DEFAULT_CATCH_UP_INITIAL_POSITION_GUARD_SECONDS,
): number => {
  const safeDurationSeconds = Math.max(1, Math.floor(durationSeconds));
  const safePreferredSeconds = Math.max(0, preferredPositionSeconds);
  const positionSeconds = safePreferredSeconds > 0
    ? Math.min(safeDurationSeconds, safePreferredSeconds)
    : Math.min(safeDurationSeconds, initialPositionGuardSeconds);

  return Math.floor(positionSeconds * 1000);
};

export const clampCatchUpPositionMs = (
  positionMs: number | null | undefined,
  durationSeconds: number,
  initialPositionGuardSeconds = DEFAULT_CATCH_UP_INITIAL_POSITION_GUARD_SECONDS,
): number => {
  const safeDurationMs = Math.max(1, Math.floor(durationSeconds) * 1000);
  const safePositionMs = Math.max(0, Math.floor(positionMs ?? 0));
  if (safePositionMs > 0) {
    return Math.min(safeDurationMs, safePositionMs);
  }

  return resolveCatchUpInitialPositionMs(durationSeconds, 0, initialPositionGuardSeconds);
};

export const buildLiveSessionSource = ({
  channel,
  sourceUrl,
  loadKey,
}: {
  channel: Pick<PlayerChannel, 'id' | 'name' | 'streamId' | 'source'>;
  sourceUrl: string;
  loadKey?: number;
}): SessionSource => ({
  url: sourceUrl,
  type: 'hls',
  title: channel.name,
  channelId: channel.id,
  metadata: {
    channelId: channel.id,
    streamId: channel.streamId,
    mode: 'live',
    source: channel.source,
    ...(typeof loadKey === 'number' ? { loadKey } : {}),
  } satisfies LiveSessionSourceMetadata,
});

export const buildCatchUpMetadata = ({
  channel,
  program,
  fallbackStreamIds = [],
  durationSeconds,
  gateway,
}: {
  channel: Pick<PlayerChannel, 'id' | 'streamId' | 'source'>;
  program: Pick<Program, 'id' | 'title' | 'startTime'>;
  fallbackStreamIds?: readonly number[];
  durationSeconds: number;
  gateway?: CatchUpGatewayPlaybackMetadata;
}): CatchUpSessionSourceMetadata => ({
  mode: 'catchup',
  channelId: channel.id,
  streamId: channel.streamId,
  programId: program.id,
  startTimestamp: Math.floor(program.startTime.getTime() / 1000),
  durationSeconds: Math.max(1, Math.floor(durationSeconds)),
  fallbackStreamIds: normalizeFallbackStreamIds(fallbackStreamIds, channel.streamId),
  title: program.title,
  source: channel.source,
  ...(gateway ? { gateway } : {}),
});

export const buildCatchUpSessionSourceFromMetadata = ({
  channel,
  metadata,
  channelTitle,
  sourceType = 'hls',
  urlBuilder,
  preferredPositionSeconds = 0,
  initialPositionGuardSeconds = DEFAULT_CATCH_UP_INITIAL_POSITION_GUARD_SECONDS,
}: {
  channel: Pick<PlayerChannel, 'id' | 'name' | 'streamId'>;
  metadata: CatchUpSessionSourceMetadata;
  channelTitle?: string;
  sourceType?: SessionSource['type'];
  urlBuilder: CatchUpUrlBuilder;
  preferredPositionSeconds?: number;
  initialPositionGuardSeconds?: number;
}): CatchUpSourceBuildResult => {
  const transportPlan = buildCatchUpTransportPlan({
    urlBuilder,
    streamId: metadata.streamId,
    startTimestamp: metadata.startTimestamp,
    durationSeconds: metadata.durationSeconds,
    fallbackStreamIds: metadata.fallbackStreamIds,
    gatewaySelection: metadata.gateway,
  });
  const sourceTitle = metadata.title
    ? `${channelTitle ?? channel.name} - ${metadata.title}`
    : (channelTitle ?? channel.name);
  const catchUpFallbackUrls = transportPlan.fallbackAttempts.map((attempt) => attempt.url);
  const catchUpFallbackUrl = catchUpFallbackUrls[0] ?? '';
  const initialPositionMs = resolveCatchUpInitialPositionMs(
    metadata.durationSeconds,
    preferredPositionSeconds,
    initialPositionGuardSeconds,
  );
  const explicitHlsStartPositionSeconds = typeof metadata.catchUpHlsStartPositionSeconds === 'number' &&
    Number.isFinite(metadata.catchUpHlsStartPositionSeconds) &&
    metadata.catchUpHlsStartPositionSeconds >= 0
    ? Math.floor(metadata.catchUpHlsStartPositionSeconds)
    : null;
  const catchUpHlsStartPositionSeconds = explicitHlsStartPositionSeconds ?? Math.floor(initialPositionMs / 1000);

  return {
    source: {
      url: transportPlan.initialAttempt.url,
      type: sourceType,
      title: sourceTitle,
      channelId: channel.id,
      metadata: {
        ...metadata,
        gateway: metadata.gateway ?? null,
        catchUpProgramId: metadata.programId,
        catchUpStartTimestamp: transportPlan.initialAttempt.startTimestamp,
        catchUpDurationSeconds: metadata.durationSeconds,
        catchUpAttemptPlan: transportPlan.allAttempts,
        catchUpAttemptIndex: 0,
        catchUpAttemptStrategy: transportPlan.initialAttempt.strategy,
        catchUpFallbackUrl,
        catchUpFallbackUrls,
        catchUpFallbackIndex: -1,
        catchUpFallbackUsed: false,
        catchUpHlsStartupMode: metadata.catchUpHlsStartupMode,
        catchUpHlsStartPositionSeconds,
      },
    },
    transportPlan,
    initialPositionMs,
    fullDurationSeconds: metadata.durationSeconds,
    metadata,
  };
};

export const buildCatchUpSessionSource = ({
  channel,
  program,
  urlBuilder,
  fallbackStreamIds = [],
  durationSeconds,
  preferredPositionSeconds = 0,
  initialPositionGuardSeconds = DEFAULT_CATCH_UP_INITIAL_POSITION_GUARD_SECONDS,
  gateway,
}: {
  channel: Pick<PlayerChannel, 'id' | 'name' | 'streamId' | 'source'>;
  program: Pick<Program, 'id' | 'title' | 'startTime' | 'endTime'>;
  urlBuilder: CatchUpUrlBuilder;
  fallbackStreamIds?: readonly number[];
  durationSeconds?: number;
  preferredPositionSeconds?: number;
  initialPositionGuardSeconds?: number;
  gateway?: CatchUpGatewayPlaybackMetadata;
}): CatchUpSourceBuildResult => {
  const fullDurationSeconds = Math.floor(
    (program.endTime.getTime() - program.startTime.getTime()) / 1000,
  );
  const resolvedDurationSeconds = typeof durationSeconds === 'number' && Number.isFinite(durationSeconds)
    ? Math.max(1, Math.floor(durationSeconds))
    : fullDurationSeconds;
  const metadata = buildCatchUpMetadata({
    channel,
    program,
    fallbackStreamIds,
    durationSeconds: resolvedDurationSeconds,
    gateway,
  });

  const result = buildCatchUpSessionSourceFromMetadata({
    channel,
    metadata,
    urlBuilder,
    preferredPositionSeconds,
    initialPositionGuardSeconds,
  });

  return {
    ...result,
    fullDurationSeconds,
  };
};
