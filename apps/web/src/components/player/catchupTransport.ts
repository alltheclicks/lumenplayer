const XTREAM_PROXY_BASE_PATH = '/xui-api/';
const DEFAULT_BASE_ORIGIN = 'http://localhost';
const MAX_CATCH_UP_ATTEMPTS = 48;

export const CATCH_UP_MINUTE_STEP_OFFSETS = [-1, -2, -3, 1, -5, 2, -10, -15, 5] as const;
export const CATCH_UP_STREAM_FALLBACK_OFFSETS = [0, -1, -2, 1, -5] as const;

export type CatchUpTransportAttemptStrategy =
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

const alignTimestampToMinute = (timestampSeconds: number): number => {
  const normalized = Math.max(1, Math.floor(timestampSeconds));
  return Math.floor(normalized / 60) * 60;
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

const limitAttemptPlanSize = (
  attempts: CatchUpTransportAttempt[],
  options: {
    ensureStreamFallback: boolean;
  },
): CatchUpTransportAttempt[] => {
  if (attempts.length <= MAX_CATCH_UP_ATTEMPTS) {
    return attempts;
  }

  const limitedAttempts = attempts.slice(0, MAX_CATCH_UP_ATTEMPTS);
  if (!options.ensureStreamFallback) {
    return limitedAttempts;
  }

  const hasStreamFallbackAttempt = limitedAttempts.some((attempt) => (
    attempt.strategy === 'stream-fallback'
  ));
  if (hasStreamFallbackAttempt) {
    return limitedAttempts;
  }

  const streamFallbackCandidate = attempts
    .slice(MAX_CATCH_UP_ATTEMPTS)
    .find((attempt) => attempt.strategy === 'stream-fallback');
  if (!streamFallbackCandidate) {
    return limitedAttempts;
  }

  let replacementIndex = limitedAttempts.length - 1;
  while (
    replacementIndex > 0 &&
    (
      limitedAttempts[replacementIndex]?.strategy === 'redirect-primary' ||
      limitedAttempts[replacementIndex]?.strategy === 'primary-retry' ||
      limitedAttempts[replacementIndex]?.strategy === 'primary-query'
    )
  ) {
    replacementIndex -= 1;
  }

  limitedAttempts[replacementIndex] = streamFallbackCandidate;
  return limitedAttempts;
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

export const applyKnownCatchUpHostAffinity = (url: string): string => {
  const preferredOrigin = resolveCatchUpHostAffinity(url);
  if (!preferredOrigin) {
    return url;
  }

  return rewriteCatchUpUrlTargetOrigin(url, preferredOrigin);
};

export const toCatchUpProxyUrl = (url: string): string => {
  const parsedTarget = parseTargetUrl(url);
  if (!parsedTarget || parsedTarget.encodedProxyTarget) {
    return url;
  }

  const runtimeOrigin = getRuntimeOrigin();
  const runtimeOriginUrl = parseUrl(runtimeOrigin);
  if (!runtimeOriginUrl) {
    return url;
  }

  if (parsedTarget.requestUrl.origin === runtimeOriginUrl.origin) {
    return url;
  }

  const encodedTarget = encodeURIComponent(
    normalizeServerBase(parsedTarget.targetServerUrl.origin),
  );
  const proxiedPath = `${XTREAM_PROXY_BASE_PATH}${encodedTarget}${parsedTarget.requestUrl.pathname}`;
  const proxiedUrl = new URL(
    proxiedPath.startsWith('/')
      ? proxiedPath
      : `/${proxiedPath}`,
    runtimeOrigin,
  );
  proxiedUrl.search = parsedTarget.requestUrl.search;
  proxiedUrl.hash = parsedTarget.requestUrl.hash;
  return proxiedUrl.toString();
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
}: BuildCatchUpTransportPlanInput): CatchUpTransportPlan => {
  const normalizedDurationSeconds = Math.max(1, Math.floor(durationSeconds));
  const minuteAlignedStartTimestamp = alignTimestampToMinute(startTimestamp);
  const uniqueFallbackStreamIds = fallbackStreamIds
    .map((value) => Math.floor(value))
    .filter((value) => Number.isFinite(value) && value > 0 && value !== streamId)
    .filter((value, index, values) => values.indexOf(value) === index);
  const uniqueStreamFallbackOffsets = streamFallbackOffsets
    .map((value) => Math.floor(value))
    .filter((value) => Number.isFinite(value))
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

  const primaryRedirectUrls = urlBuilder.getCatchUpRedirectUrlVariants(
    streamId,
    minuteAlignedStartTimestamp,
    normalizedDurationSeconds,
  );
  appendUrls(
    primaryRedirectUrls,
    'redirect-primary',
    streamId,
    minuteAlignedStartTimestamp,
    0,
  );

  const primaryQueryUrls = urlBuilder.getCatchUpUrlVariants(
    streamId,
    minuteAlignedStartTimestamp,
    normalizedDurationSeconds,
  );
  const primaryRetryBaseUrl = primaryRedirectUrls[0] ?? primaryQueryUrls[0] ?? '';
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
  appendUrls(
    primaryQueryUrls,
    'primary-query',
    streamId,
    minuteAlignedStartTimestamp,
    0,
  );

  const appendStreamFallbackOffsetAttempts = (offsetMinutes: number): void => {
    const candidateStartTimestamp = minuteAlignedStartTimestamp + offsetMinutes * 60;
    if (candidateStartTimestamp <= 0) {
      return;
    }

    for (const candidateStreamId of uniqueFallbackStreamIds) {
      appendUrls(
        urlBuilder.getCatchUpRedirectUrlVariants(
          candidateStreamId,
          candidateStartTimestamp,
          normalizedDurationSeconds,
        ),
        'stream-fallback',
        candidateStreamId,
        candidateStartTimestamp,
        offsetMinutes,
      );
      appendUrls(
        urlBuilder.getCatchUpUrlVariants(
          candidateStreamId,
          candidateStartTimestamp,
          normalizedDurationSeconds,
        ),
        'stream-fallback',
        candidateStreamId,
        candidateStartTimestamp,
        offsetMinutes,
      );
    }
  };

  const remainingStreamFallbackOffsets = new Set(uniqueStreamFallbackOffsets);

  for (const offsetMinutes of minuteStepOffsets) {
    if (offsetMinutes === 0) {
      continue;
    }

    const candidateStartTimestamp = minuteAlignedStartTimestamp + offsetMinutes * 60;
    if (candidateStartTimestamp <= 0) {
      continue;
    }

    appendUrls(
      urlBuilder.getCatchUpRedirectUrlVariants(
        streamId,
        candidateStartTimestamp,
        normalizedDurationSeconds,
      ),
      'start-offset',
      streamId,
      candidateStartTimestamp,
      offsetMinutes,
    );
    appendUrls(
      urlBuilder.getCatchUpUrlVariants(
        streamId,
        candidateStartTimestamp,
        normalizedDurationSeconds,
      ),
      'start-offset',
      streamId,
      candidateStartTimestamp,
      offsetMinutes,
    );

    if (remainingStreamFallbackOffsets.delete(offsetMinutes)) {
      appendStreamFallbackOffsetAttempts(offsetMinutes);
    }
  }

  for (const offsetMinutes of uniqueStreamFallbackOffsets) {
    if (!remainingStreamFallbackOffsets.has(offsetMinutes)) {
      continue;
    }

    remainingStreamFallbackOffsets.delete(offsetMinutes);
    appendStreamFallbackOffsetAttempts(offsetMinutes);
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
  const plannedAttempts = limitAttemptPlanSize(deduplicatedAttempts, {
    ensureStreamFallback: uniqueFallbackStreamIds.length > 0,
  });
  const initialAttempt = plannedAttempts[0];
  if (!initialAttempt) {
    throw new Error('Unable to build catch-up transport plan');
  }

  return {
    initialAttempt,
    fallbackAttempts: plannedAttempts.slice(1),
    allAttempts: plannedAttempts,
  };
};
