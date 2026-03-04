const XTREAM_PROXY_BASE_PATH = '/xui-api/';
const DEFAULT_BASE_ORIGIN = 'http://localhost';
const MAX_CATCH_UP_ATTEMPTS = 20;
const CATCH_UP_SHORT_DURATION_REORDER_MIN_EXPECTED_SECONDS = 600;
const CATCH_UP_SHORT_DURATION_REORDER_MAX_RATIO = 0.25;
const CATCH_UP_SHORT_DURATION_REORDER_ABSOLUTE_SECONDS = 180;

export const CATCH_UP_MINUTE_STEP_OFFSETS = [1, -1, -2, -3, 2, -5, 5, -10, -15] as const;
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

const parseFiniteInteger = (value: unknown): number | null => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.floor(value);
  }

  if (typeof value === 'string') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return Math.floor(parsed);
    }
  }

  return null;
};

const resolveCatchUpAttemptDurationSeconds = (attemptUrl: string): number | null => {
  if (typeof attemptUrl !== 'string' || attemptUrl.trim().length === 0) {
    return null;
  }

  try {
    const parsedUrl = new URL(attemptUrl);
    const queryDuration = parseFiniteInteger(parsedUrl.searchParams.get('duration'));
    if (queryDuration !== null && queryDuration > 0) {
      return queryDuration;
    }

    const pathMatch = parsedUrl.pathname.match(
      /\/timeshift\/[^/]+\/[^/]+\/(\d+)\/[^/?#]+\/\d+\.(?:ts|m3u8)(?:[?#].*)?$/i,
    );
    if (pathMatch?.[1]) {
      const pathDuration = parseFiniteInteger(pathMatch[1]);
      if (pathDuration !== null && pathDuration > 0) {
        return pathDuration;
      }
    }
  } catch {
    // Ignore malformed URLs.
  }

  const queryMatch = attemptUrl.match(/[?&]duration=(\d+)(?:&|$)/i);
  if (queryMatch?.[1]) {
    const queryDuration = parseFiniteInteger(queryMatch[1]);
    if (queryDuration !== null && queryDuration > 0) {
      return queryDuration;
    }
  }

  const pathMatch = attemptUrl.match(
    /\/timeshift\/[^/]+\/[^/]+\/(\d+)\/[^/?#]+\/\d+\.(?:ts|m3u8)(?:[?#].*)?$/i,
  );
  if (pathMatch?.[1]) {
    const pathDuration = parseFiniteInteger(pathMatch[1]);
    if (pathDuration !== null && pathDuration > 0) {
      return pathDuration;
    }
  }

  return null;
};

const isShortDurationAttemptVariant = (
  attempt: CatchUpTransportAttempt,
  expectedDurationSeconds: number,
): boolean => {
  if (
    !Number.isFinite(expectedDurationSeconds) ||
    expectedDurationSeconds < CATCH_UP_SHORT_DURATION_REORDER_MIN_EXPECTED_SECONDS
  ) {
    return false;
  }

  const attemptDurationSeconds = resolveCatchUpAttemptDurationSeconds(attempt.url);
  if (
    attemptDurationSeconds === null ||
    !Number.isFinite(attemptDurationSeconds) ||
    attemptDurationSeconds >= expectedDurationSeconds
  ) {
    return false;
  }

  const maxShortDurationSeconds = Math.max(
    CATCH_UP_SHORT_DURATION_REORDER_ABSOLUTE_SECONDS,
    Math.floor(expectedDurationSeconds * CATCH_UP_SHORT_DURATION_REORDER_MAX_RATIO),
  );
  return attemptDurationSeconds <= maxShortDurationSeconds;
};

const reorderShortDurationAttemptsToTail = (
  attempts: CatchUpTransportAttempt[],
  expectedDurationSeconds: number,
): CatchUpTransportAttempt[] => {
  if (attempts.length <= 1) {
    return attempts;
  }

  const longDurationAttempts: CatchUpTransportAttempt[] = [];
  const shortDurationAttempts: CatchUpTransportAttempt[] = [];
  for (const attempt of attempts) {
    if (isShortDurationAttemptVariant(attempt, expectedDurationSeconds)) {
      shortDurationAttempts.push(attempt);
      continue;
    }

    longDurationAttempts.push(attempt);
  }

  if (shortDurationAttempts.length === 0 || longDurationAttempts.length === 0) {
    return attempts;
  }

  return [...longDurationAttempts, ...shortDurationAttempts];
};

const isManifestLikeAttemptUrl = (attemptUrl: string): boolean => {
  if (typeof attemptUrl !== 'string' || attemptUrl.trim().length === 0) {
    return false;
  }

  const parsedUrl = parseUrl(attemptUrl);
  if (parsedUrl) {
    const normalizedPath = parsedUrl.pathname.toLowerCase();
    if (normalizedPath.endsWith('.m3u8')) {
      return true;
    }

    const extensionValue = parsedUrl.searchParams.get('extension')?.toLowerCase() ?? '';
    if (extensionValue === 'm3u8') {
      return true;
    }

    const formatValue = parsedUrl.searchParams.get('format')?.toLowerCase() ?? '';
    if (formatValue === 'm3u8') {
      return true;
    }
  }

  return (
    /\.m3u8(?:[?#]|$)/i.test(attemptUrl) ||
    /[?&]extension=m3u8(?:&|$)/i.test(attemptUrl) ||
    /[?&]format=m3u8(?:&|$)/i.test(attemptUrl)
  );
};

const prioritizeManifestLikeUrls = (urls: string[]): string[] => {
  if (urls.length <= 1) {
    return urls;
  }

  const manifestLikeUrls: string[] = [];
  const nonManifestLikeUrls: string[] = [];
  for (const url of urls) {
    if (isManifestLikeAttemptUrl(url)) {
      manifestLikeUrls.push(url);
      continue;
    }

    nonManifestLikeUrls.push(url);
  }

  if (manifestLikeUrls.length === 0 || nonManifestLikeUrls.length === 0) {
    return urls;
  }

  return [...manifestLikeUrls, ...nonManifestLikeUrls];
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

/**
 * Returns true when the URL uses the credential-path catch-up format
 * (`/timeshift/{user}/{pass}/{duration}/{start}/{streamId}.{ext}`).
 * These URLs embed login credentials in the path and MUST hit the
 * original login server so the server can issue the redirect/token.
 * Host-affinity rewriting would bypass that handshake and cause 401s.
 */
export const isCredentialPathCatchUpUrl = (url: string): boolean => {
  const parsed = parseTargetUrl(url);
  if (!parsed) {
    return false;
  }

  const targetPathname = parsed.targetServerUrl.pathname + parsed.proxySuffixPath;
  return /\/timeshift\/[^/]+\/[^/]+\/\d+\/[^/]+\/\d+\.(?:ts|m3u8)/i.test(targetPathname);
};

export const isCredentialQueryCatchUpUrl = (url: string): boolean => {
  const parsed = parseTargetUrl(url);
  if (!parsed) {
    return false;
  }

  const searchParams = parsed.requestUrl.searchParams;
  return (
    (searchParams.has('username') && searchParams.has('password')) ||
    (searchParams.has('user') && searchParams.has('pass'))
  );
};

/**
 * Determines whether host-affinity rewriting is safe for the given
 * attempt URL.  Credential-path and credential-query URLs must NOT
 * be rewritten because the login server needs to see the original
 * host to issue a valid redirect/token.  Only token-based URLs
 * (already redirected) are safe to rewrite.
 */
export const shouldApplyHostAffinityToAttempt = (url: string): boolean => {
  if (isCredentialPathCatchUpUrl(url)) {
    return false;
  }

  if (isCredentialQueryCatchUpUrl(url)) {
    return false;
  }

  return true;
};

const dedupeAttempts = (attempts: CatchUpTransportAttempt[]): CatchUpTransportAttempt[] => {
  const uniqueAttempts: CatchUpTransportAttempt[] = [];
  const seenUrls = new Set<string>();

  for (const attempt of attempts) {
    const rewrittenUrl = shouldApplyHostAffinityToAttempt(attempt.url)
      ? applyKnownCatchUpHostAffinity(attempt.url)
      : attempt.url;
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
    for (const url of prioritizeManifestLikeUrls(urls)) {
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

  const primaryRedirectUrls = prioritizeManifestLikeUrls(urlBuilder.getCatchUpRedirectUrlVariants(
    streamId,
    minuteAlignedStartTimestamp,
    normalizedDurationSeconds,
  ));
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
  const reorderedAttempts = reorderShortDurationAttemptsToTail(
    deduplicatedAttempts,
    normalizedDurationSeconds,
  );
  const plannedAttempts = limitAttemptPlanSize(reorderedAttempts, {
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
