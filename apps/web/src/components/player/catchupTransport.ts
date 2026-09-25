import type { CatchUpGatewayPlaybackMetadata } from './catchupGateway';

const XTREAM_PROXY_BASE_PATH = '/xui-api/';
const DEFAULT_BASE_ORIGIN = 'http://localhost';
const MAX_CATCH_UP_ATTEMPTS = 16;
const XTREAM_CATCH_UP_STREAMING_PATHS = new Set([
  '/streaming/timeshift.php',
  '/streaming/timeshift_hls.php',
]);
const SHADOW_TOKEN_HOSTS = new Set([
  'edge6.castcdn.net',
]);
const GATEWAY_ONLY_LEGACY_HOSTS = new Set([
  'smart.mediaking.fi',
  'serv2.mediaking.fi',
  'edge6.castcdn.net',
  '79.137.99.121',
]);

export const CATCH_UP_MINUTE_STEP_OFFSETS = [-1, -2, -3, 1, -5, 2, -10, -15, 5] as const;
export const CATCH_UP_STREAM_FALLBACK_OFFSETS = [0, -1, -2, 1, -5] as const;

export type CatchUpTransportAttemptStrategy =
  | 'gateway-resolved'
  | 'redirect-primary'
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
  startTimestamp: number;
  durationSeconds: number;
  fallbackStreamIds?: number[];
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

const isCatchUpHostAffinityEligibleUrl = (url: string): boolean => {
  const parsedTarget = parseTargetUrl(url);
  if (!parsedTarget) {
    return false;
  }

  const pathname = (
    parsedTarget.encodedProxyTarget && parsedTarget.proxySuffixPath.length > 0
      ? parsedTarget.proxySuffixPath
      : parsedTarget.targetServerUrl.pathname
  ).toLowerCase();
  if (pathname.startsWith('/hlsr/')) {
    return true;
  }

  if (!XTREAM_CATCH_UP_STREAMING_PATHS.has(pathname)) {
    return false;
  }

  return parsedTarget.requestUrl.searchParams.has('token');
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

const appendPrioritizedCatchUpAttemptGroup = ({
  attempts,
  redirectUrls,
  queryUrls,
  strategy,
  streamId,
  startTimestamp,
  durationSeconds,
  offsetMinutes,
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
}): void => {
  const [primaryManifestUrl, ...fallbackManifestUrls] = redirectUrls.manifestUrls;
  const appendUrl = (url: string) => {
    attempts.push({
      url,
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

const shouldSuppressLegacyCatchUpFallback = (queryUrls: readonly string[]): boolean => {
  const firstQueryUrl = queryUrls[0];
  if (!firstQueryUrl) {
    return false;
  }

  const parsed = parseUrl(firstQueryUrl);
  if (!parsed) {
    return false;
  }

  return (
    GATEWAY_ONLY_LEGACY_HOSTS.has(parsed.hostname.toLowerCase()) &&
    parsed.pathname.toLowerCase().startsWith('/timeshift_hls/')
  );
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

const rewriteTokenizedCatchUpShadowUrl = (url: string): string => {
  const parsedTarget = parseTargetUrl(url);
  if (!parsedTarget) {
    return url;
  }

  const pathname = (
    parsedTarget.encodedProxyTarget && parsedTarget.proxySuffixPath.length > 0
      ? parsedTarget.proxySuffixPath
      : parsedTarget.targetServerUrl.pathname
  ).toLowerCase();
  if (
    pathname !== '/streaming/timeshift.php' ||
    !parsedTarget.requestUrl.searchParams.has('token') ||
    !SHADOW_TOKEN_HOSTS.has(parsedTarget.targetServerUrl.hostname.toLowerCase())
  ) {
    return url;
  }

  if (!parsedTarget.encodedProxyTarget) {
    const nextTargetServerUrl = new URL(parsedTarget.targetServerUrl.toString());
    nextTargetServerUrl.pathname = '/streaming/timeshift_shadow.php';
    return nextTargetServerUrl.toString();
  }

  const encodedTarget = encodeURIComponent(normalizeServerBase(parsedTarget.targetServerUrl.toString()));
  const nextPath = `${XTREAM_PROXY_BASE_PATH}${encodedTarget}/streaming/timeshift_shadow.php`;
  parsedTarget.requestUrl.pathname = nextPath.startsWith('/') ? nextPath : `/${nextPath}`;
  return parsedTarget.requestUrl.toString();
};

export const applyKnownCatchUpHostAffinity = (url: string): string => {
  if (!isCatchUpHostAffinityEligibleUrl(url)) {
    return rewriteTokenizedCatchUpShadowUrl(url);
  }

  const preferredOrigin = resolveCatchUpHostAffinity(url);
  const originRewrittenUrl = preferredOrigin
    ? rewriteCatchUpUrlTargetOrigin(url, preferredOrigin)
    : url;
  return rewriteTokenizedCatchUpShadowUrl(originRewrittenUrl);
};

export const isCatchUpFallbackStrategy = (
  strategy: CatchUpTransportAttemptStrategy,
): boolean => strategy === 'stream-fallback' || strategy === 'legacy';

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
  startTimestamp,
  durationSeconds,
  fallbackStreamIds = [],
  primaryRetries = 3,
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
        url,
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
  const [primaryRedirectManifestUrl, ...fallbackManifestUrls] = primaryRedirectUrls.manifestUrls;
  const [primaryRedirectTransportUrl, ...fallbackTransportUrls] = primaryRedirectUrls.transportUrls;
  const primaryQueryUrls = urlBuilder.getCatchUpUrlVariants(
    streamId,
    minuteAlignedStartTimestamp,
    normalizedDurationSeconds,
  );
  const [primaryQueryUrl, ...fallbackQueryUrls] = primaryQueryUrls;
  const primaryStartupUrl = primaryQueryUrl ?? primaryRedirectManifestUrl ?? primaryRedirectTransportUrl ?? null;
  const primaryStartupStrategy: CatchUpTransportAttemptStrategy = (
    primaryStartupUrl === primaryRedirectManifestUrl ||
    (
      !primaryQueryUrl &&
      primaryStartupUrl === primaryRedirectTransportUrl
    )
  )
    ? 'redirect-primary'
    : 'primary-query';
  if (primaryStartupUrl) {
    attempts.push({
      url: primaryStartupUrl,
      streamId,
      startTimestamp: minuteAlignedStartTimestamp,
      durationSeconds: normalizedDurationSeconds,
      offsetMinutes: 0,
      strategy: primaryStartupStrategy,
    });
  }

  const primaryRetryBaseUrl = primaryStartupUrl ?? '';
  for (let retryAttempt = 1; retryAttempt <= primaryRetries; retryAttempt += 1) {
    if (!primaryRetryBaseUrl) {
      break;
    }

    attempts.push({
      url: buildRetryUrl(primaryRetryBaseUrl, retryAttempt),
      streamId,
      startTimestamp: minuteAlignedStartTimestamp,
      durationSeconds: normalizedDurationSeconds,
      offsetMinutes: 0,
      strategy: 'primary-retry',
    });
  }
  if (primaryStartupUrl === primaryRedirectManifestUrl) {
    appendUrls(
      primaryQueryUrls,
      'primary-query',
      streamId,
      minuteAlignedStartTimestamp,
      0,
    );
    appendUrls(
      fallbackManifestUrls,
      'redirect-primary',
      streamId,
      minuteAlignedStartTimestamp,
      0,
    );
    appendUrls(
      primaryRedirectUrls.transportUrls,
      'redirect-primary',
      streamId,
      minuteAlignedStartTimestamp,
      0,
    );
  } else if (primaryStartupUrl === primaryQueryUrl) {
    appendUrls(
      fallbackQueryUrls,
      'primary-query',
      streamId,
      minuteAlignedStartTimestamp,
      0,
    );
    appendUrls(
      primaryRedirectUrls.manifestUrls,
      'redirect-primary',
      streamId,
      minuteAlignedStartTimestamp,
      0,
    );
    appendUrls(
      primaryRedirectUrls.transportUrls,
      'redirect-primary',
      streamId,
      minuteAlignedStartTimestamp,
      0,
    );
  } else {
    appendUrls(
      fallbackTransportUrls,
      'redirect-primary',
      streamId,
      minuteAlignedStartTimestamp,
      0,
    );
  }

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
    appendPrioritizedCatchUpAttemptGroup({
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
      appendPrioritizedCatchUpAttemptGroup({
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
      });
    }
  }

  if (!shouldSuppressLegacyCatchUpFallback(primaryQueryUrls)) {
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
  }

  const deduplicatedAttempts = dedupeAttempts(attempts);
  const firstLegacyIndex = deduplicatedAttempts.findIndex((attempt) => attempt.strategy === 'legacy');
  const initialCappedAttempts = (
    deduplicatedAttempts.length <= MAX_CATCH_UP_ATTEMPTS ||
    firstLegacyIndex < 0 ||
    firstLegacyIndex < MAX_CATCH_UP_ATTEMPTS
  )
    ? deduplicatedAttempts.slice(0, MAX_CATCH_UP_ATTEMPTS)
    : [
      ...deduplicatedAttempts.slice(0, MAX_CATCH_UP_ATTEMPTS - 1),
      deduplicatedAttempts[firstLegacyIndex],
    ];
  const cappedAttempts = (
    firstLegacyIndex >= 0 &&
    initialCappedAttempts.every((attempt) => attempt.strategy !== 'legacy')
  )
    ? [
      ...initialCappedAttempts.slice(0, Math.max(0, MAX_CATCH_UP_ATTEMPTS - 1)),
      deduplicatedAttempts[firstLegacyIndex],
    ]
    : initialCappedAttempts;
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
