import type { CatchUpGatewayPlaybackMetadata } from './catchupGateway';

const XTREAM_PROXY_BASE_PATH = '/xui-api/';
const DEFAULT_BASE_ORIGIN = 'http://localhost';
const MAX_CATCH_UP_ATTEMPTS = 16;
const LOCAL_PROXY_PROGRAM_ID_PARAM = '__lumenProgramId';
const LOCAL_PROXY_STREAM_ID_PARAM = '__lumenStreamId';
const LOCAL_PROXY_START_PARAM = '__lumenStart';
const LOCAL_PROXY_DURATION_PARAM = '__lumenDuration';
const LOCAL_PROXY_TRANSPORT_PARAM = '__lumenTransport';
const LOCAL_PROXY_FALLBACK_REASON_PARAM = '__lumenFallbackReason';
const PROXY_REMUX_TRANSPORT_HINT = 'remux-hls';
const PROXY_REMUX_FALLBACK_REASON = 'boundary-stall';
const PROXY_REMUX_FALLBACK_ENABLED = import.meta.env.VITE_XUI_PROXY_REMUX_FALLBACK_ENABLED === '1';
const PROXY_REMUX_STREAM_IDS = parseNumericFilter(import.meta.env.VITE_XUI_PROXY_REMUX_FALLBACK_STREAM_IDS);
const PROXY_REMUX_PROGRAM_IDS = parseStringFilter(import.meta.env.VITE_XUI_PROXY_REMUX_FALLBACK_PROGRAM_IDS);
const PROXY_REMUX_CHANNEL_IDS = parseStringFilter(import.meta.env.VITE_XUI_PROXY_REMUX_FALLBACK_CHANNEL_IDS);

export const CATCH_UP_MINUTE_STEP_OFFSETS = [-1, -2, -3, 1, -5, 2, -10, -15, 5] as const;
export const CATCH_UP_STREAM_FALLBACK_OFFSETS = [0, -1, -2, 1, -5] as const;

export type CatchUpTransportAttemptStrategy =
  | 'gateway-resolved'
  | 'redirect-primary'
  | 'proxy-remux'
  | 'primary-query'
  | 'primary-retry'
  | 'start-offset'
  | 'stream-fallback'
  | 'legacy';

export interface CatchUpTransportAttempt {
  url: string;
  streamId: number;
  startTimestamp: number;
  durationSeconds: number;
  offsetMinutes: number;
  strategy: CatchUpTransportAttemptStrategy;
}

export interface CatchUpTransportPlan {
  initialAttempt: CatchUpTransportAttempt;
  fallbackAttempts: CatchUpTransportAttempt[];
  allAttempts: CatchUpTransportAttempt[];
}

export interface CatchUpUrlBuilder {
  getCatchUpRedirectUrlVariants: (
    streamId: number,
    startTimestamp: number,
    durationSeconds: number,
  ) => string[];
  getCatchUpUrlVariants: (
    streamId: number,
    startTimestamp: number,
    durationSeconds: number,
  ) => string[];
  getLegacyCatchUpUrlVariants: (
    streamId: number,
    startTimestamp: number,
    durationSeconds: number,
  ) => string[];
}

interface BuildCatchUpTransportPlanInput {
  urlBuilder: CatchUpUrlBuilder;
  streamId: number;
  channelId?: string;
  startTimestamp: number;
  durationSeconds: number;
  programId?: string;
  fallbackStreamIds?: number[];
  includeProxyRemuxFallback?: boolean;
  primaryRetries?: number;
  minuteStepOffsets?: readonly number[];
  streamFallbackOffsets?: readonly number[];
  gatewaySelection?: CatchUpGatewayPlaybackMetadata;
}

interface ParsedTargetUrl {
  requestUrl: URL;
  targetServerUrl: URL;
  proxySuffixPath: string;
  encodedProxyTarget: string | null;
}

function parseNumericFilter(value: string | undefined): Set<number> | null {
  if (!value) {
    return null;
  }

  const parsed = value
    .split(',')
    .map((entry) => Number(entry.trim()))
    .filter((entry) => Number.isFinite(entry) && entry > 0)
    .map((entry) => Math.floor(entry));

  return parsed.length > 0 ? new Set(parsed) : null;
}

function parseStringFilter(value: string | undefined): Set<string> | null {
  if (!value) {
    return null;
  }

  const parsed = value
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);

  return parsed.length > 0 ? new Set(parsed) : null;
}

const matchesOptionalFilter = <T>(
  filter: Set<T> | null,
  value: T | null | undefined,
): boolean => filter === null || (value !== null && value !== undefined && filter.has(value));

const catchUpHostAffinityByOrigin = new Map<string, string>();

const normalizeServerBase = (value: string): string => value.trim().replace(/\/+$/, '');

const getRuntimeOrigin = (): string => (
  typeof window === 'undefined' ? DEFAULT_BASE_ORIGIN : window.location.origin
);

const parseUrl = (value: string): URL | null => {
  try {
    return new URL(value, getRuntimeOrigin());
  } catch {
    return null;
  }
};

const parseTargetUrl = (value: string): ParsedTargetUrl | null => {
  const requestUrl = parseUrl(value);
  if (!requestUrl) {
    return null;
  }

  const proxyMatch = requestUrl.pathname.match(/^\/xui-api\/([^/?#]+)(\/.*)?$/);
  if (!proxyMatch || !proxyMatch[1]) {
    return {
      requestUrl,
      targetServerUrl: requestUrl,
      proxySuffixPath: '',
      encodedProxyTarget: null,
    };
  }

  const encodedTarget = proxyMatch[1];
  let decodedTarget = '';
  try {
    decodedTarget = decodeURIComponent(encodedTarget).trim();
  } catch {
    return null;
  }

  if (!decodedTarget) {
    return null;
  }

  let targetServerUrl: URL;
  try {
    targetServerUrl = new URL(
      decodedTarget.includes('://') ? decodedTarget : `http://${decodedTarget}`,
    );
  } catch {
    return null;
  }

  return {
    requestUrl,
    targetServerUrl,
    proxySuffixPath: proxyMatch[2] ?? '',
    encodedProxyTarget: encodedTarget,
  };
};

const isProxyCatchUpUrl = (value: string): boolean => {
  const parsed = parseUrl(value);
  return Boolean(parsed?.pathname.startsWith('/xui-api/'));
};

const getProxyCatchUpTransportHint = (url: string): string | null => {
  const parsed = parseUrl(url);
  if (!parsed) {
    return null;
  }

  return parsed.searchParams.get(LOCAL_PROXY_TRANSPORT_PARAM);
};

const decorateProxyCatchUpUrl = (
  url: string,
  metadata: {
    programId?: string;
    streamId: number;
    startTimestamp: number;
    durationSeconds: number;
    transportHint?: string;
    fallbackReason?: string;
  },
): string => {
  if (!isProxyCatchUpUrl(url)) {
    return url;
  }

  const parsed = parseUrl(url);
  if (!parsed) {
    return url;
  }

  if (metadata.programId) {
    parsed.searchParams.set(LOCAL_PROXY_PROGRAM_ID_PARAM, metadata.programId);
  }
  parsed.searchParams.set(LOCAL_PROXY_STREAM_ID_PARAM, String(metadata.streamId));
  parsed.searchParams.set(LOCAL_PROXY_START_PARAM, String(metadata.startTimestamp));
  parsed.searchParams.set(LOCAL_PROXY_DURATION_PARAM, String(metadata.durationSeconds));
  if (metadata.transportHint) {
    parsed.searchParams.set(LOCAL_PROXY_TRANSPORT_PARAM, metadata.transportHint);
  }
  if (metadata.fallbackReason) {
    parsed.searchParams.set(LOCAL_PROXY_FALLBACK_REASON_PARAM, metadata.fallbackReason);
  }
  return parsed.toString();
};

const shouldIncludeProxyRemuxFallback = ({
  url,
  streamId,
  channelId,
  programId,
  override,
}: {
  url: string;
  streamId: number;
  channelId?: string;
  programId?: string;
  override?: boolean;
}): boolean => {
  if (typeof override === 'boolean') {
    return override && isProxyCatchUpUrl(url);
  }

  return (
    PROXY_REMUX_FALLBACK_ENABLED &&
    isProxyCatchUpUrl(url) &&
    matchesOptionalFilter(PROXY_REMUX_STREAM_IDS, streamId) &&
    matchesOptionalFilter(PROXY_REMUX_PROGRAM_IDS, programId) &&
    matchesOptionalFilter(PROXY_REMUX_CHANNEL_IDS, channelId)
  );
};

const buildProxyRemuxCatchUpUrl = (
  url: string,
  metadata: {
    programId?: string;
    streamId: number;
    startTimestamp: number;
    durationSeconds: number;
  },
): string | null => {
  if (!isProxyCatchUpUrl(url)) {
    return null;
  }

  return decorateProxyCatchUpUrl(url, {
    ...metadata,
    transportHint: PROXY_REMUX_TRANSPORT_HINT,
    fallbackReason: PROXY_REMUX_FALLBACK_REASON,
  });
};

const alignTimestampToMinute = (timestampSeconds: number): number => {
  const normalized = Math.max(1, Math.floor(timestampSeconds));
  return Math.floor(normalized / 60) * 60;
};

const getCatchUpStartupUrlPriority = (url: string): number => {
  const parsed = parseUrl(url);
  if (!parsed) {
    return 3;
  }

  const pathname = parsed.pathname.toLowerCase();
  const extension = parsed.searchParams.get('extension')?.toLowerCase() ?? '';
  if (pathname.endsWith('.m3u8') || extension === 'm3u8') {
    return 0;
  }

  if (pathname.endsWith('.ts') || extension === 'ts') {
    return 1;
  }

  return 2;
};

const splitCatchUpStartupUrls = (urls: string[]): {
  manifestUrls: string[];
  transportUrls: string[];
} => {
  const orderedUrls = [...urls].sort((left, right) => (
    getCatchUpStartupUrlPriority(left) - getCatchUpStartupUrlPriority(right)
  ));

  return {
    manifestUrls: orderedUrls.filter((url) => getCatchUpStartupUrlPriority(url) === 0),
    transportUrls: orderedUrls.filter((url) => getCatchUpStartupUrlPriority(url) !== 0),
  };
};

const appendPrioritizedRedirectAttemptGroup = ({
  attempts,
  redirectUrls,
  queryUrls,
  strategy,
  streamId,
  startTimestamp,
  durationSeconds,
  offsetMinutes,
  programId,
}: {
  attempts: CatchUpTransportAttempt[];
  redirectUrls: {
    manifestUrls: string[];
    transportUrls: string[];
  };
  queryUrls: string[];
  strategy: CatchUpTransportAttemptStrategy;
  streamId: number;
  startTimestamp: number;
  durationSeconds: number;
  offsetMinutes: number;
  programId?: string;
}): void => {
  const [primaryManifestUrl, ...fallbackManifestUrls] = redirectUrls.manifestUrls;
  const appendUrl = (url: string) => {
    attempts.push({
      url: decorateProxyCatchUpUrl(url, {
        programId,
        streamId,
        startTimestamp,
        durationSeconds,
      }),
      streamId,
      startTimestamp,
      durationSeconds,
      offsetMinutes,
      strategy,
    });
  };

  if (primaryManifestUrl) {
    appendUrl(primaryManifestUrl);
  }

  for (const url of queryUrls) {
    appendUrl(url);
  }

  for (const url of fallbackManifestUrls) {
    appendUrl(url);
  }

  for (const url of redirectUrls.transportUrls) {
    appendUrl(url);
  }
};

const buildRetryUrl = (url: string, retryAttempt: number): string => {
  const parsed = parseUrl(url);
  if (!parsed) {
    return url;
  }
  parsed.searchParams.set('_retry', String(retryAttempt));
  parsed.searchParams.set('_ts', String(Date.now() + retryAttempt));
  return parsed.toString();
};

const dedupeAttempts = (attempts: CatchUpTransportAttempt[]): CatchUpTransportAttempt[] => {
  const uniqueAttempts: CatchUpTransportAttempt[] = [];
  const seenUrls = new Set<string>();

  for (const attempt of attempts) {
    const rewrittenUrl = applyKnownCatchUpHostAffinity(attempt.url);
    if (seenUrls.has(rewrittenUrl)) {
      continue;
    }

    seenUrls.add(rewrittenUrl);
    uniqueAttempts.push({
      ...attempt,
      url: rewrittenUrl,
    });
  }

  return uniqueAttempts;
};

export const clearCatchUpHostAffinityMemory = (): void => {
  catchUpHostAffinityByOrigin.clear();
};

export const resolveCatchUpTargetOrigin = (url: string): string | null => {
  const parsedTarget = parseTargetUrl(url);
  if (!parsedTarget) {
    return null;
  }

  return parsedTarget.targetServerUrl.origin;
};

export const resolveCatchUpTransportMode = (
  url: string,
): 'proxy-normalized' | 'proxy-remuxed' | 'provider-direct' => {
  if (!isProxyCatchUpUrl(url)) {
    return 'provider-direct';
  }

  return getProxyCatchUpTransportHint(url) === PROXY_REMUX_TRANSPORT_HINT
    ? 'proxy-remuxed'
    : 'proxy-normalized';
};

export const rememberCatchUpHostAffinity = (
  requestUrl: string,
  finalUrl: string,
): string | null => {
  const requestOrigin = resolveCatchUpTargetOrigin(requestUrl);
  const finalOrigin = resolveCatchUpTargetOrigin(finalUrl);
  if (!requestOrigin || !finalOrigin) {
    return null;
  }

  catchUpHostAffinityByOrigin.set(requestOrigin, finalOrigin);
  return finalOrigin;
};

const resolveTransitivelyPreferredOrigin = (requestOrigin: string): string | null => {
  let currentOrigin = requestOrigin;
  const visited = new Set<string>();

  while (true) {
    if (visited.has(currentOrigin)) {
      break;
    }

    visited.add(currentOrigin);
    const preferredOrigin = catchUpHostAffinityByOrigin.get(currentOrigin);
    if (!preferredOrigin || preferredOrigin === currentOrigin) {
      break;
    }

    currentOrigin = preferredOrigin;
  }

  return currentOrigin === requestOrigin ? null : currentOrigin;
};

export const resolveCatchUpHostAffinity = (url: string): string | null => {
  const requestOrigin = resolveCatchUpTargetOrigin(url);
  if (!requestOrigin) {
    return null;
  }

  return resolveTransitivelyPreferredOrigin(requestOrigin);
};

export const rewriteCatchUpUrlTargetOrigin = (
  url: string,
  preferredOrigin: string,
): string => {
  const parsedTarget = parseTargetUrl(url);
  if (!parsedTarget) {
    return url;
  }

  let preferredOriginUrl: URL;
  try {
    preferredOriginUrl = new URL(preferredOrigin);
  } catch {
    return url;
  }

  const nextTargetServerUrl = new URL(parsedTarget.targetServerUrl.toString());
  nextTargetServerUrl.protocol = preferredOriginUrl.protocol;
  nextTargetServerUrl.hostname = preferredOriginUrl.hostname;
  nextTargetServerUrl.port = preferredOriginUrl.port;

  if (!parsedTarget.encodedProxyTarget) {
    return nextTargetServerUrl.toString();
  }

  const encodedTarget = encodeURIComponent(normalizeServerBase(nextTargetServerUrl.toString()));
  const nextPath = `${XTREAM_PROXY_BASE_PATH}${encodedTarget}${parsedTarget.proxySuffixPath}`;
  parsedTarget.requestUrl.pathname = nextPath.startsWith('/') ? nextPath : `/${nextPath}`;
  return parsedTarget.requestUrl.toString();
};

export const applyKnownCatchUpHostAffinity = (url: string): string => {
  const preferredOrigin = resolveCatchUpHostAffinity(url);
  if (!preferredOrigin) {
    return url;
  }

  return rewriteCatchUpUrlTargetOrigin(url, preferredOrigin);
};

export const isCatchUpFallbackStrategy = (
  strategy: CatchUpTransportAttemptStrategy,
): boolean => (
  strategy === 'proxy-remux' ||
  strategy === 'stream-fallback' ||
  strategy === 'legacy'
);

export const isCatchUpTransportAttempt = (value: unknown): value is CatchUpTransportAttempt => {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.url === 'string' &&
    typeof candidate.streamId === 'number' &&
    Number.isFinite(candidate.streamId) &&
    typeof candidate.startTimestamp === 'number' &&
    Number.isFinite(candidate.startTimestamp) &&
    typeof candidate.durationSeconds === 'number' &&
    Number.isFinite(candidate.durationSeconds) &&
    typeof candidate.offsetMinutes === 'number' &&
    Number.isFinite(candidate.offsetMinutes) &&
    typeof candidate.strategy === 'string'
  );
};

export const buildCatchUpTransportPlan = ({
  urlBuilder,
  streamId,
  channelId,
  startTimestamp,
  durationSeconds,
  programId,
  fallbackStreamIds = [],
  includeProxyRemuxFallback,
  primaryRetries = 1,
  minuteStepOffsets = CATCH_UP_MINUTE_STEP_OFFSETS,
  streamFallbackOffsets = CATCH_UP_STREAM_FALLBACK_OFFSETS,
  gatewaySelection,
}: BuildCatchUpTransportPlanInput): CatchUpTransportPlan => {
  const normalizedDurationSeconds = Math.max(1, Math.floor(durationSeconds));
  const minuteAlignedStartTimestamp = alignTimestampToMinute(startTimestamp);
  const uniqueFallbackStreamIds = fallbackStreamIds
    .map((value) => Math.floor(value))
    .filter((value) => Number.isFinite(value) && value > 0 && value !== streamId)
    .filter((value, index, values) => values.indexOf(value) === index);
  const streamCandidates = [streamId, ...uniqueFallbackStreamIds];

  const attempts: CatchUpTransportAttempt[] = [];
  const appendUrls = (
    urls: string[],
    strategy: CatchUpTransportAttemptStrategy,
    candidateStreamId: number,
    candidateStartTimestamp: number,
    offsetMinutes: number,
  ) => {
    for (const url of urls) {
      attempts.push({
        url: decorateProxyCatchUpUrl(url, {
          programId,
          streamId: candidateStreamId,
          startTimestamp: candidateStartTimestamp,
          durationSeconds: normalizedDurationSeconds,
        }),
        streamId: candidateStreamId,
        startTimestamp: candidateStartTimestamp,
        durationSeconds: normalizedDurationSeconds,
        offsetMinutes,
        strategy,
      });
    }
  };

  const primaryRedirectUrls = splitCatchUpStartupUrls(urlBuilder.getCatchUpRedirectUrlVariants(
    streamId,
    minuteAlignedStartTimestamp,
    normalizedDurationSeconds,
  ));
  const [primaryRedirectManifestUrl] = primaryRedirectUrls.manifestUrls;
  if (primaryRedirectManifestUrl) {
    attempts.push({
      url: decorateProxyCatchUpUrl(primaryRedirectManifestUrl, {
        programId,
        streamId,
        startTimestamp: minuteAlignedStartTimestamp,
        durationSeconds: normalizedDurationSeconds,
      }),
      streamId,
      startTimestamp: minuteAlignedStartTimestamp,
      durationSeconds: normalizedDurationSeconds,
      offsetMinutes: 0,
      strategy: 'redirect-primary',
    });
  }

  const primaryQueryUrls = urlBuilder.getCatchUpUrlVariants(
    streamId,
    minuteAlignedStartTimestamp,
    normalizedDurationSeconds,
  );
  const primaryRemuxBaseUrl = (
    primaryRedirectManifestUrl ??
    primaryQueryUrls[0] ??
    primaryRedirectUrls.transportUrls[0] ??
    null
  );
  const primaryRetryBaseUrl = primaryRedirectManifestUrl ?? '';
  for (let retryAttempt = 1; retryAttempt <= primaryRetries; retryAttempt += 1) {
    if (!primaryRetryBaseUrl) {
      break;
    }

    attempts.push({
      url: decorateProxyCatchUpUrl(buildRetryUrl(primaryRetryBaseUrl, retryAttempt), {
        programId,
        streamId,
        startTimestamp: minuteAlignedStartTimestamp,
        durationSeconds: normalizedDurationSeconds,
      }),
      streamId,
      startTimestamp: minuteAlignedStartTimestamp,
      durationSeconds: normalizedDurationSeconds,
      offsetMinutes: 0,
      strategy: 'primary-retry',
    });
  }

  if (
    primaryRemuxBaseUrl &&
    shouldIncludeProxyRemuxFallback({
      url: primaryRemuxBaseUrl,
      streamId,
      channelId,
      programId,
      override: includeProxyRemuxFallback,
    })
  ) {
    const remuxUrl = buildProxyRemuxCatchUpUrl(primaryRemuxBaseUrl, {
      programId,
      streamId,
      startTimestamp: minuteAlignedStartTimestamp,
      durationSeconds: normalizedDurationSeconds,
    });

    if (remuxUrl) {
      attempts.push({
        url: remuxUrl,
        streamId,
        startTimestamp: minuteAlignedStartTimestamp,
        durationSeconds: normalizedDurationSeconds,
        offsetMinutes: 0,
        strategy: 'proxy-remux',
      });
    }
  }

  appendPrioritizedRedirectAttemptGroup({
    attempts,
    redirectUrls: {
      manifestUrls: primaryRedirectUrls.manifestUrls.slice(1),
      transportUrls: primaryRedirectUrls.transportUrls,
    },
    queryUrls: primaryQueryUrls,
    strategy: 'primary-query',
    streamId,
    startTimestamp: minuteAlignedStartTimestamp,
    durationSeconds: normalizedDurationSeconds,
    offsetMinutes: 0,
    programId,
  });

  for (const offsetMinutes of minuteStepOffsets) {
    if (offsetMinutes === 0) {
      continue;
    }

    const candidateStartTimestamp = minuteAlignedStartTimestamp + offsetMinutes * 60;
    if (candidateStartTimestamp <= 0) {
      continue;
    }

    const offsetRedirectUrls = splitCatchUpStartupUrls(urlBuilder.getCatchUpRedirectUrlVariants(
      streamId,
      candidateStartTimestamp,
      normalizedDurationSeconds,
    ));

    appendPrioritizedRedirectAttemptGroup({
      attempts,
      redirectUrls: offsetRedirectUrls,
      queryUrls: urlBuilder.getCatchUpUrlVariants(
        streamId,
        candidateStartTimestamp,
        normalizedDurationSeconds,
      ),
      strategy: 'start-offset',
      streamId,
      startTimestamp: candidateStartTimestamp,
      durationSeconds: normalizedDurationSeconds,
      offsetMinutes,
      programId,
    });
  }

  for (const candidateStreamId of uniqueFallbackStreamIds) {
    for (const offsetMinutes of streamFallbackOffsets) {
      const candidateStartTimestamp = minuteAlignedStartTimestamp + offsetMinutes * 60;
      if (candidateStartTimestamp <= 0) {
        continue;
      }

      const streamFallbackRedirectUrls = splitCatchUpStartupUrls(urlBuilder.getCatchUpRedirectUrlVariants(
        candidateStreamId,
        candidateStartTimestamp,
        normalizedDurationSeconds,
      ));

      appendPrioritizedRedirectAttemptGroup({
        attempts,
        redirectUrls: streamFallbackRedirectUrls,
        queryUrls: urlBuilder.getCatchUpUrlVariants(
          candidateStreamId,
          candidateStartTimestamp,
          normalizedDurationSeconds,
        ),
        strategy: 'stream-fallback',
        streamId: candidateStreamId,
        startTimestamp: candidateStartTimestamp,
        durationSeconds: normalizedDurationSeconds,
        offsetMinutes,
        programId,
      });
    }
  }

  for (const candidateStreamId of streamCandidates) {
    appendUrls(
      urlBuilder.getLegacyCatchUpUrlVariants(
        candidateStreamId,
        minuteAlignedStartTimestamp,
        normalizedDurationSeconds,
      ),
      'legacy',
      candidateStreamId,
      minuteAlignedStartTimestamp,
      0,
    );
  }

  const deduplicatedAttempts = dedupeAttempts(attempts);
  const firstLegacyIndex = deduplicatedAttempts.findIndex((attempt) => attempt.strategy === 'legacy');
  const cappedAttempts = (
    deduplicatedAttempts.length <= MAX_CATCH_UP_ATTEMPTS ||
    firstLegacyIndex < 0 ||
    firstLegacyIndex < MAX_CATCH_UP_ATTEMPTS
  )
    ? deduplicatedAttempts.slice(0, MAX_CATCH_UP_ATTEMPTS)
    : [
      ...deduplicatedAttempts.slice(0, MAX_CATCH_UP_ATTEMPTS - 1),
      deduplicatedAttempts[firstLegacyIndex],
    ];
  const gatewayAttempts = gatewaySelection?.playbackUrl
    ? dedupeAttempts([
      {
        url: gatewaySelection.playbackUrl,
        streamId,
        startTimestamp: minuteAlignedStartTimestamp,
        durationSeconds: normalizedDurationSeconds,
        offsetMinutes: 0,
        strategy: 'gateway-resolved',
      },
      ...cappedAttempts,
    ]).slice(0, MAX_CATCH_UP_ATTEMPTS)
    : cappedAttempts;
  const initialAttempt = gatewayAttempts[0];
  if (!initialAttempt) {
    throw new Error('Unable to build catch-up transport plan');
  }

  return {
    initialAttempt,
    fallbackAttempts: gatewayAttempts.slice(1),
    allAttempts: gatewayAttempts,
  };
};
