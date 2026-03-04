import type { SessionState } from '@lumen/session-core';
import type { PlaybackError } from '@lumen/types';

export interface RuntimePlaybackSample {
  readyState: number;
  currentTime: number;
  paused: boolean;
  videoWidth: number;
  videoHeight: number;
}

export interface CatchUpRuntimeStallFallbackInput {
  isCatchUpSource: boolean;
  hasRuntimePlaybackData: boolean;
  isVideoPaused: boolean;
  playbackRequested: boolean;
  stalledDurationMs: number;
  thresholdMs: number;
}

export interface CatchUpFallbackDecisionInput {
  playbackError: PlaybackError;
  isCatchUpSource: boolean;
  hasRuntimePlaybackData: boolean;
  allowNetworkFallback: boolean;
}

export interface CatchUpShortDurationAttemptInput {
  attemptUrl: string;
  expectedDurationSeconds: number | null;
  hasRuntimePlaybackProgress: boolean;
}

export interface CatchUpNonManifestAttemptInput {
  attemptUrl: string;
  hasRuntimePlaybackProgress: boolean;
}

export interface CatchUpDecodeErrorBurstState {
  sourceUrl: string | null;
  count: number;
  lastAtMs: number;
}

export interface CatchUpDecodeErrorBurstInput {
  tracker: CatchUpDecodeErrorBurstState;
  isCatchUpSource: boolean;
  playbackErrorCode: string;
  hasRuntimeProgressForCurrentSource: boolean;
  currentSourceUrl: string | null;
  nowMs: number;
  windowMs: number;
  threshold: number;
}

export interface CatchUpDecodeErrorBurstDecision {
  tracker: CatchUpDecodeErrorBurstState;
  shouldFallback: boolean;
}

const CATCH_UP_SHORT_DURATION_SKIP_MIN_EXPECTED_SECONDS = 600;
const CATCH_UP_SHORT_DURATION_SKIP_MAX_RATIO = 0.25;
const CATCH_UP_SHORT_DURATION_SKIP_ABSOLUTE_SECONDS = 180;

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

export const resolveCatchUpAttemptDurationSeconds = (attemptUrl: string): number | null => {
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
      /\/timeshift\/[^/]+\/[^/]+\/(\d+)\/[^/]+\/\d+\.(?:ts|m3u8)$/i,
    );
    if (pathMatch?.[1]) {
      const pathDuration = parseFiniteInteger(pathMatch[1]);
      if (pathDuration !== null && pathDuration > 0) {
        return pathDuration;
      }
    }
  } catch {
    // Ignore malformed URLs; fallback regex checks below.
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

export const shouldSkipCatchUpShortDurationAttempt = (
  input: CatchUpShortDurationAttemptInput
): boolean => {
  if (!input.hasRuntimePlaybackProgress) {
    return false;
  }

  if (
    input.expectedDurationSeconds === null ||
    !Number.isFinite(input.expectedDurationSeconds) ||
    input.expectedDurationSeconds < CATCH_UP_SHORT_DURATION_SKIP_MIN_EXPECTED_SECONDS
  ) {
    return false;
  }

  const attemptDurationSeconds = resolveCatchUpAttemptDurationSeconds(input.attemptUrl);
  if (attemptDurationSeconds === null) {
    return false;
  }

  const maxShortDurationSeconds = Math.max(
    CATCH_UP_SHORT_DURATION_SKIP_ABSOLUTE_SECONDS,
    Math.floor(input.expectedDurationSeconds * CATCH_UP_SHORT_DURATION_SKIP_MAX_RATIO),
  );

  return attemptDurationSeconds <= maxShortDurationSeconds;
};

const isLikelyTsCatchUpAttemptUrl = (attemptUrl: string): boolean => {
  if (typeof attemptUrl !== 'string' || attemptUrl.trim().length === 0) {
    return false;
  }

  const normalized = attemptUrl.toLowerCase();
  if (
    normalized.includes('extension=m3u8') ||
    normalized.includes('format=m3u8') ||
    normalized.includes('.m3u8')
  ) {
    return false;
  }

  return /\.ts(?:[?#]|$)/i.test(normalized);
};

export const shouldSkipCatchUpNonManifestAttempt = (
  input: CatchUpNonManifestAttemptInput
): boolean => {
  if (!input.hasRuntimePlaybackProgress) {
    return false;
  }

  return isLikelyTsCatchUpAttemptUrl(input.attemptUrl);
};

export const evaluateCatchUpDecodeErrorBurst = (
  input: CatchUpDecodeErrorBurstInput
): CatchUpDecodeErrorBurstDecision => {
  const resetTracker: CatchUpDecodeErrorBurstState = {
    sourceUrl: input.currentSourceUrl,
    count: 0,
    lastAtMs: 0,
  };

  if (input.playbackErrorCode !== 'MEDIA_ELEMENT_3') {
    return {
      tracker: resetTracker,
      shouldFallback: false,
    };
  }

  if (!input.isCatchUpSource || !input.hasRuntimeProgressForCurrentSource) {
    return {
      tracker: resetTracker,
      shouldFallback: false,
    };
  }

  const safeWindowMs = (
    Number.isFinite(input.windowMs) && input.windowMs > 0
  ) ? input.windowMs : 0;
  const safeThreshold = (
    Number.isFinite(input.threshold) && input.threshold > 0
  ) ? Math.floor(input.threshold) : 1;
  const isSameSource = input.tracker.sourceUrl === input.currentSourceUrl;
  const withinWindow = (
    safeWindowMs > 0 &&
    isSameSource &&
    Number.isFinite(input.tracker.lastAtMs) &&
    (input.nowMs - input.tracker.lastAtMs) <= safeWindowMs
  );
  const nextCount = withinWindow ? input.tracker.count + 1 : 1;

  return {
    tracker: {
      sourceUrl: input.currentSourceUrl,
      count: nextCount,
      lastAtMs: input.nowMs,
    },
    shouldFallback: nextCount >= safeThreshold,
  };
};

export const sessionWantsPlayback = (session: SessionState): boolean => (
  session.playback === 'playing' || session.playback === 'buffering'
);

const isLiveSourceMode = (session: SessionState): boolean => {
  if (!session.source) {
    return false;
  }

  const metadataMode = session.source.metadata?.mode;
  if (metadataMode === 'live') {
    return true;
  }

  return typeof session.source.channelId === 'string' && session.source.channelId.length > 0;
};

export const shouldResumePlaybackAfterPictureInPictureExit = (
  session: SessionState,
  isVideoPaused: boolean
): boolean => {
  if (!isVideoPaused) {
    return false;
  }

  if (!sessionWantsPlayback(session)) {
    return false;
  }

  return isLiveSourceMode(session);
};

export const shouldHoldPauseSyncOnSourceStartup = (
  session: SessionState,
  pendingAutoplaySourceUrl: string | null
): boolean => {
  if (!pendingAutoplaySourceUrl) {
    return false;
  }

  const currentSourceUrl = session.source?.url ?? null;
  if (!currentSourceUrl) {
    return false;
  }

  return currentSourceUrl === pendingAutoplaySourceUrl && sessionWantsPlayback(session);
};

export const shouldKeepPendingAutoplayOnIdle = (
  session: SessionState,
  pendingAutoplaySourceUrl: string | null
): boolean => (
  shouldHoldPauseSyncOnSourceStartup(session, pendingAutoplaySourceUrl)
);

export const shouldRetryPendingAutoplayAfterPausedEvent = (
  session: SessionState,
  pendingAutoplaySourceUrl: string | null,
  retryCount: number,
  maxRetries: number
): boolean => {
  if (!shouldHoldPauseSyncOnSourceStartup(session, pendingAutoplaySourceUrl)) {
    return false;
  }

  return retryCount < maxRetries;
};

export const shouldShowBlockingPlaybackError = (playbackError: PlaybackError): boolean => (
  playbackError.fatal
);

export const shouldClearPendingAutoplayOnPlaybackError = (
  playbackError: PlaybackError
): boolean => (
  playbackError.fatal
);

export const hasRuntimePlaybackStarted = (
  sample: RuntimePlaybackSample | null
): boolean => {
  if (!sample) {
    return false;
  }

  if (sample.readyState < 2) {
    return false;
  }

  if (sample.videoWidth <= 0 || sample.videoHeight <= 0) {
    return false;
  }

  if (sample.currentTime > 0) {
    return true;
  }

  return !sample.paused;
};

export const shouldTriggerCatchUpRuntimeStallFallback = (
  input: CatchUpRuntimeStallFallbackInput
): boolean => {
  if (!input.isCatchUpSource) {
    return false;
  }

  if (!input.hasRuntimePlaybackData) {
    return false;
  }

  if (input.isVideoPaused || !input.playbackRequested) {
    return false;
  }

  if (
    !Number.isFinite(input.stalledDurationMs) ||
    !Number.isFinite(input.thresholdMs) ||
    input.thresholdMs <= 0
  ) {
    return false;
  }

  return input.stalledDurationMs >= input.thresholdMs;
};

export const shouldAttemptCatchUpFallbackForPlaybackError = (
  input: CatchUpFallbackDecisionInput
): boolean => {
  const {
    playbackError,
    isCatchUpSource,
    hasRuntimePlaybackData,
    allowNetworkFallback,
  } = input;

  if (!isCatchUpSource) {
    return false;
  }

  if (playbackError.code.startsWith('MEDIA_ELEMENT_')) {
    // Media element errors are noisy during source transitions and can
    // trigger fallback churn. Runtime stall/network gates handle real failures.
    return false;
  }

  if (playbackError.fatal) {
    return (
      playbackError.code === 'NETWORK_ERROR' ||
      playbackError.code === 'MEDIA_ERROR' ||
      playbackError.code === 'HLS_ERROR' ||
      playbackError.code === 'LOAD_FAILED' ||
      playbackError.code === 'NON_PLAYABLE_PAYLOAD'
    );
  }

  if (
    (playbackError.code === 'NETWORK_ERROR' || playbackError.code === 'HLS_ERROR') &&
    allowNetworkFallback
  ) {
    return true;
  }

  if (!hasRuntimePlaybackData && playbackError.code === 'PLAYBACK_START_FAILED') {
    return true;
  }

  return false;
};
