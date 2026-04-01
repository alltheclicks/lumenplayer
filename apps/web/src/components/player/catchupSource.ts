import type { SessionSource } from '@lumen/session-core';
import type { PlayerChannel, Program } from '@lumen/types';
import type { CatchUpTransportPlan, CatchUpUrlBuilder } from './catchupTransport';
import { XTREAM_SERVER_URL, resolveXtreamApiServer } from '../../config/xtream';
import {
  resolveCatchUpGatewayPlayback,
  type CatchUpGatewayClientOptions,
  type CatchUpGatewayPlaybackMetadata,
} from './catchupGateway';
import { applyKnownCatchUpHostAffinity } from './catchupTransport';
import {
  buildCatchUpMetadata,
  buildCatchUpSessionSourceFromMetadata,
} from './sessionSources';

export interface CatchUpPlaybackSourceResult {
  source: SessionSource;
  transportPlan: CatchUpTransportPlan;
  initialPositionSeconds: number;
  fullDurationSeconds: number;
  gateway: CatchUpGatewayPlaybackMetadata | null;
}

const CATCHUP_SHADOW_VALIDATION_ENABLED = import.meta.env.VITE_CATCHUP_SHADOW_VALIDATION === '1';
const SHADOW_VALIDATION_UNAVAILABLE_ERROR = 'catchup_shadow_validation_unavailable';

const parseTimeshiftPathUrl = (
  url: string,
): {
  origin: string;
  pathType: 'timeshift' | 'timeshift_hls';
  username: string;
  password: string;
  duration: string;
  start: string;
  streamId: string;
} | null => {
  let parsed: URL;
  try {
    parsed = new URL(url, typeof window === 'undefined' ? 'http://localhost' : window.location.origin);
  } catch {
    return null;
  }

  const match = parsed.pathname.match(
    /^\/(timeshift|timeshift_hls)\/([^/]+)\/([^/]+)\/([^/]+)\/([^/]+)\/(\d+)\.(?:m3u8|ts)$/i,
  );
  if (!match) {
    return null;
  }

  const [, pathType, username, password, duration, start, streamId] = match;
  return {
    origin: parsed.origin,
    pathType: pathType.toLowerCase() === 'timeshift_hls' ? 'timeshift_hls' : 'timeshift',
    username,
    password,
    duration,
    start,
    streamId,
  };
};

const isTimeshiftGeneratorUrl = (url: string): boolean => {
  let parsed: URL;
  try {
    parsed = new URL(url, typeof window === 'undefined' ? 'http://localhost' : window.location.origin);
  } catch {
    return false;
  }

  return parsed.pathname.toLowerCase().endsWith('/streaming/timeshift.php');
};

const resolveShadowValidationSeedUrl = ({
  queryUrls,
  redirectUrls,
  legacyUrls,
}: {
  queryUrls: string[];
  redirectUrls: string[];
  legacyUrls: string[];
}): string | null => {
  const generatorUrl = queryUrls.find(isTimeshiftGeneratorUrl) ?? null;
  if (generatorUrl) {
    return generatorUrl;
  }

  const pathCandidates = [
    ...queryUrls,
    ...redirectUrls,
    ...legacyUrls,
  ]
    .map((url) => parseTimeshiftPathUrl(url))
    .filter((candidate): candidate is NonNullable<typeof candidate> => candidate !== null);
  const directCandidate = pathCandidates.find((candidate) => candidate.pathType === 'timeshift_hls')
    ?? pathCandidates[0]
    ?? null;
  if (!directCandidate) {
    return null;
  }

  const loginOrigin = pathCandidates.find((candidate) => candidate.pathType === 'timeshift')?.origin
    ?? (XTREAM_SERVER_URL ? resolveXtreamApiServer(XTREAM_SERVER_URL) : null)
    ?? directCandidate.origin;
  if (!loginOrigin) {
    return null;
  }

  const shadowSeedUrl = new URL(`${loginOrigin}/streaming/timeshift.php`);
  shadowSeedUrl.searchParams.set('username', directCandidate.username);
  shadowSeedUrl.searchParams.set('password', directCandidate.password);
  shadowSeedUrl.searchParams.set('stream', directCandidate.streamId);
  shadowSeedUrl.searchParams.set('start', directCandidate.start);
  shadowSeedUrl.searchParams.set('duration', directCandidate.duration);
  shadowSeedUrl.searchParams.set('extension', 'm3u8');
  return shadowSeedUrl.toString();
};

const resolveShadowValidationPlayback = async ({
  channelId,
  programId,
  sourceCandidates,
  fetchImpl,
}: {
  channelId: string;
  programId: string;
  sourceCandidates: {
    redirectUrls: string[];
    queryUrls: string[];
    legacyUrls: string[];
  };
  fetchImpl?: typeof fetch;
}): Promise<CatchUpGatewayPlaybackMetadata | null> => {
  const shadowSeedUrl = resolveShadowValidationSeedUrl(sourceCandidates);
  if (!shadowSeedUrl) {
    return null;
  }

  const performFetch = fetchImpl ?? fetch;
  const response = await performFetch(shadowSeedUrl, {
    redirect: 'follow',
    cache: 'no-store',
  });
  if (!response.ok) {
    return null;
  }

  const playbackUrl = applyKnownCatchUpHostAffinity(response.url);
  if (!playbackUrl.includes('/streaming/timeshift_shadow.php?token=')) {
    return null;
  }

  return {
    serverId: 'shadow-validation',
    assetKey: `shadow:${channelId}:${programId}`,
    transportMode: 'provider-direct',
    playbackUrl,
    assetState: 'ready',
    fallbackReason: 'shadow-validation',
    hotStart: true,
  };
};

const buildShadowOnlyResult = ({
  result,
  gateway,
}: {
  result: CatchUpPlaybackSourceResult;
  gateway: CatchUpGatewayPlaybackMetadata;
}): CatchUpPlaybackSourceResult => {
  const initialAttempt = result.transportPlan.initialAttempt;
  const sourceMetadata = {
    ...(result.source.metadata as Record<string, unknown>),
    gateway,
    catchUpAttemptPlan: [initialAttempt],
    catchUpAttemptIndex: 0,
    catchUpAttemptStrategy: initialAttempt.strategy,
    catchUpFallbackUrl: '',
    catchUpFallbackUrls: [],
    catchUpFallbackIndex: -1,
    catchUpFallbackUsed: false,
  };

  return {
    ...result,
    source: {
      ...result.source,
      url: initialAttempt.url,
      metadata: sourceMetadata,
    },
    transportPlan: {
      initialAttempt,
      fallbackAttempts: [],
      allAttempts: [initialAttempt],
    },
    gateway,
  };
};

const alignTimestampToMinute = (timestampSeconds: number): number => {
  const normalized = Math.max(1, Math.floor(timestampSeconds));
  return Math.floor(normalized / 60) * 60;
};

export const resolveCatchUpPlaybackSource = async ({
  channel,
  program,
  urlBuilder,
  fallbackStreamIds = [],
  durationSeconds,
  preferredPositionSeconds = 0,
  initialPositionGuardSeconds = 15,
  channelTitle,
  gatewayOptions,
  shadowValidation = CATCHUP_SHADOW_VALIDATION_ENABLED,
}: {
  channel: Pick<PlayerChannel, 'id' | 'name' | 'streamId' | 'source' | 'catchUpDays' | 'hasCatchUp'>;
  program: Pick<Program, 'id' | 'title' | 'startTime' | 'endTime'>;
  urlBuilder: CatchUpUrlBuilder;
  fallbackStreamIds?: readonly number[];
  durationSeconds?: number;
  preferredPositionSeconds?: number;
  initialPositionGuardSeconds?: number;
  channelTitle?: string;
  gatewayOptions?: CatchUpGatewayClientOptions;
  shadowValidation?: boolean;
}): Promise<CatchUpPlaybackSourceResult> => {
  const startTimestamp = Math.floor(program.startTime.getTime() / 1000);
  const fullDurationSeconds = Math.max(
    1,
    Math.floor((program.endTime.getTime() - program.startTime.getTime()) / 1000),
  );
  const resolvedDurationSeconds = typeof durationSeconds === 'number' && Number.isFinite(durationSeconds)
    ? Math.max(1, Math.floor(durationSeconds))
    : fullDurationSeconds;
  const metadata = buildCatchUpMetadata({
    channel,
    program,
    fallbackStreamIds,
    durationSeconds: resolvedDurationSeconds,
  });
  const minuteAlignedStartTimestamp = alignTimestampToMinute(startTimestamp);
  const initialPositionSeconds = preferredPositionSeconds > 0
    ? Math.max(0, Math.min(resolvedDurationSeconds, preferredPositionSeconds))
    : Math.max(
      0,
      Math.min(resolvedDurationSeconds, initialPositionGuardSeconds),
    );

  const sourceCandidates = {
    redirectUrls: urlBuilder.getCatchUpRedirectUrlVariants(
      channel.streamId,
      minuteAlignedStartTimestamp,
      resolvedDurationSeconds,
    ),
    queryUrls: urlBuilder.getCatchUpUrlVariants(
      channel.streamId,
      minuteAlignedStartTimestamp,
      resolvedDurationSeconds,
    ),
    legacyUrls: urlBuilder.getLegacyCatchUpUrlVariants(
      channel.streamId,
      minuteAlignedStartTimestamp,
      resolvedDurationSeconds,
    ),
  };

  if (shadowValidation) {
    const shadowGateway = await resolveShadowValidationPlayback({
      channelId: channel.id,
      programId: program.id,
      sourceCandidates,
      fetchImpl: gatewayOptions?.fetchImpl,
    }).catch(() => null);
    if (!shadowGateway) {
      throw new Error(SHADOW_VALIDATION_UNAVAILABLE_ERROR);
    }

    const resolvedSource = buildCatchUpSessionSourceFromMetadata({
      channel,
      metadata: { ...metadata, gateway: shadowGateway },
      channelTitle,
      urlBuilder,
      preferredPositionSeconds,
      initialPositionGuardSeconds,
    });
    const result = {
      source: resolvedSource.source,
      transportPlan: resolvedSource.transportPlan,
      initialPositionSeconds,
      fullDurationSeconds,
      gateway: shadowGateway,
    };

    return buildShadowOnlyResult({ result, gateway: shadowGateway });
  }

  const gateway = await resolveCatchUpGatewayPlayback({
    channel,
    program,
    streamId: channel.streamId,
    startTimestamp: minuteAlignedStartTimestamp,
    durationSeconds: resolvedDurationSeconds,
    sourceCandidates,
    gatewayOptions,
  });
  const resolvedSource = buildCatchUpSessionSourceFromMetadata({
    channel,
    metadata: gateway ? { ...metadata, gateway } : metadata,
    channelTitle,
    urlBuilder,
    preferredPositionSeconds,
    initialPositionGuardSeconds,
  });

  const result = {
    source: resolvedSource.source,
    transportPlan: resolvedSource.transportPlan,
    initialPositionSeconds,
    fullDurationSeconds,
    gateway,
  };

  return result;
};
