import type { SessionSource, SessionState } from '@lumen/session-core';
import type { PlaybackError } from '@lumen/types';

export const sessionWantsPlayback = (session: Pick<SessionState, 'playback'>): boolean => (
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

  if (metadataMode) {
    return false;
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

export const shouldShowPlaybackErrorAfterPlaybackError = (
  session: Pick<SessionState, 'source'>,
  playbackError: PlaybackError,
  media: {
    hasRenderableFrame: boolean;
  },
): boolean => {
  if (!shouldShowBlockingPlaybackError(playbackError)) {
    return false;
  }

  const sourceMode = session.source?.metadata?.mode;
  if (
    media.hasRenderableFrame &&
    (
      sourceMode === 'live' ||
      sourceMode === 'catchup'
    )
  ) {
    return false;
  }

  return true;
};

export const shouldResolveProviderBlockingErrorAfterPlaybackError = (
  session: Pick<SessionState, 'source'>,
  playbackError: Pick<PlaybackError, 'fatal'>,
  media: {
    hasRenderableFrame: boolean;
  },
): boolean => {
  if (session.source?.metadata?.mode !== 'live') {
    return true;
  }

  return !media.hasRenderableFrame;
};

export const shouldClearPendingAutoplayOnPlaybackError = (
  playbackError: PlaybackError
): boolean => (
  playbackError.fatal
);

export const shouldUseCatchUpStartupWatchdog = (session: SessionState): boolean => (
  Boolean(session.source) &&
  session.source?.metadata?.mode === 'catchup'
);

export const hasRenderableMediaFrame = (
  media: Pick<HTMLMediaElement, 'readyState'> & Pick<HTMLVideoElement, 'videoWidth'> | null | undefined,
): boolean => Boolean(
  media &&
  media.readyState >= 2 &&
  media.videoWidth > 0
);

export type CatchUpLoadingPhase = 'requesting' | 'playlist' | 'segment' | 'buffered' | 'frame';

export const resolveCatchUpLoadingProgressPercent = ({
  phase,
  bufferedAheadSeconds = 0,
  hasRenderableFrame = false,
}: {
  phase: CatchUpLoadingPhase;
  bufferedAheadSeconds?: number;
  hasRenderableFrame?: boolean;
}): number => {
  if (hasRenderableFrame || phase === 'frame') {
    return 96;
  }

  if (phase === 'buffered' || bufferedAheadSeconds > 0) {
    return Math.min(90, 76 + Math.floor(Math.min(12, bufferedAheadSeconds) * 1.2));
  }

  if (phase === 'segment') {
    return 58;
  }

  if (phase === 'playlist') {
    return 36;
  }

  return 16;
};

const parseNonNegativeFiniteSeconds = (value: unknown): number => {
  const numericValue = typeof value === 'number'
    ? value
    : (typeof value === 'string' ? Number(value) : NaN);

  if (!Number.isFinite(numericValue) || numericValue <= 0) {
    return 0;
  }

  return numericValue;
};

const parseOptionalNonNegativeFiniteNumber = (value: unknown): number | null => {
  const numericValue = typeof value === 'number'
    ? value
    : (typeof value === 'string' ? Number(value) : NaN);

  if (!Number.isFinite(numericValue) || numericValue < 0) {
    return null;
  }

  return numericValue;
};

export const resolveCatchUpMediaOffsetSeconds = (
  source: Pick<SessionSource, 'metadata'> | null | undefined,
): number => {
  if (!source || typeof source.metadata !== 'object' || source.metadata === null) {
    return 0;
  }

  const metadata = source.metadata as Record<string, unknown>;
  if (metadata.mode !== 'catchup') {
    return 0;
  }

  return parseNonNegativeFiniteSeconds(metadata.catchUpMediaOffsetSeconds);
};

export const resolveCatchUpTimelinePositionMs = (
  mediaTimeSeconds: number,
  mediaOffsetSeconds = 0,
): number => {
  const safeMediaTimeSeconds = parseNonNegativeFiniteSeconds(mediaTimeSeconds);
  const safeMediaOffsetSeconds = parseNonNegativeFiniteSeconds(mediaOffsetSeconds);
  return Math.floor((safeMediaTimeSeconds + safeMediaOffsetSeconds) * 1000);
};

interface CatchUpTimelineMediaAnchor {
  timelinePositionMs: number;
  mediaPositionSeconds: number;
}

const resolveCatchUpTimelineMediaAnchor = (
  source: Pick<SessionSource, 'metadata'> | null | undefined,
): CatchUpTimelineMediaAnchor | null => {
  if (!source || typeof source.metadata !== 'object' || source.metadata === null) {
    return null;
  }

  const metadata = source.metadata as Record<string, unknown>;
  if (metadata.mode !== 'catchup') {
    return null;
  }

  const timelinePositionMs = parseOptionalNonNegativeFiniteNumber(
    metadata.catchUpPendingTimelineSeekMs,
  );
  const mediaPositionSeconds = parseOptionalNonNegativeFiniteNumber(
    metadata.catchUpPendingMediaSeekSeconds,
  );

  if (
    timelinePositionMs === null ||
    mediaPositionSeconds === null ||
    mediaPositionSeconds <= 0
  ) {
    const startupRetryStartPositionSeconds = parseOptionalNonNegativeFiniteNumber(
      metadata.catchUpHlsStartPositionSeconds,
    );
    if (
      startupRetryStartPositionSeconds !== null &&
      startupRetryStartPositionSeconds > 0 &&
      (
        metadata.catchUpInitialSegmentRetryUsed === true ||
        metadata.catchUpProviderSafeStartRetryUsed === true
      )
    ) {
      return {
        timelinePositionMs: 0,
        mediaPositionSeconds: startupRetryStartPositionSeconds,
      };
    }

    return null;
  }

  return {
    timelinePositionMs: Math.floor(timelinePositionMs),
    mediaPositionSeconds,
  };
};

export const resolveCatchUpTimelinePositionMsForSource = (
  source: Pick<SessionSource, 'metadata'> | null | undefined,
  mediaTimeSeconds: number,
): number => {
  const timelineMediaAnchor = resolveCatchUpTimelineMediaAnchor(source);
  if (timelineMediaAnchor) {
    const safeMediaTimeSeconds = parseNonNegativeFiniteSeconds(mediaTimeSeconds);
    return Math.max(0, Math.floor(
      timelineMediaAnchor.timelinePositionMs +
      ((safeMediaTimeSeconds - timelineMediaAnchor.mediaPositionSeconds) * 1000),
    ));
  }

  return resolveCatchUpTimelinePositionMs(
    mediaTimeSeconds,
    resolveCatchUpMediaOffsetSeconds(source),
  );
};

export const resolveCatchUpMediaSeekTimeSeconds = (
  targetPositionMs: number | null | undefined,
  mediaOffsetSeconds = 0,
  minimumMediaPositionSeconds = 0,
): number => {
  const safeTargetSeconds = Math.max(0, (targetPositionMs ?? 0) / 1000);
  const safeMediaOffsetSeconds = parseNonNegativeFiniteSeconds(mediaOffsetSeconds);
  const safeMinimumMediaPositionSeconds = parseNonNegativeFiniteSeconds(minimumMediaPositionSeconds);
  return Math.max(
    0,
    safeMinimumMediaPositionSeconds,
    safeTargetSeconds - safeMediaOffsetSeconds,
  );
};

export const resolveCatchUpMediaSeekTimeSecondsForSource = (
  source: Pick<SessionSource, 'metadata'> | null | undefined,
  targetPositionMs: number | null | undefined,
  minimumMediaPositionSeconds = 0,
): number => {
  const timelineMediaAnchor = resolveCatchUpTimelineMediaAnchor(source);
  if (timelineMediaAnchor) {
    const safeTargetSeconds = Math.max(0, (targetPositionMs ?? 0) / 1000);
    const anchorTimelineSeconds = timelineMediaAnchor.timelinePositionMs / 1000;
    const safeMinimumMediaPositionSeconds = parseNonNegativeFiniteSeconds(minimumMediaPositionSeconds);
    return Math.max(
      0,
      safeMinimumMediaPositionSeconds,
      timelineMediaAnchor.mediaPositionSeconds + (safeTargetSeconds - anchorTimelineSeconds),
    );
  }

  return resolveCatchUpMediaSeekTimeSeconds(
    targetPositionMs,
    resolveCatchUpMediaOffsetSeconds(source),
    minimumMediaPositionSeconds,
  );
};

export const resolveCatchUpTimelineSeekTargetMsForSource = (
  source: Pick<SessionSource, 'metadata'> | null | undefined,
  targetPositionMs: number | null | undefined,
  minimumMediaPositionSeconds = 0,
): number => {
  const timelineMediaAnchor = resolveCatchUpTimelineMediaAnchor(source);
  if (timelineMediaAnchor) {
    const mediaPositionSeconds = resolveCatchUpMediaSeekTimeSecondsForSource(
      source,
      targetPositionMs,
      minimumMediaPositionSeconds,
    );
    return Math.max(0, Math.floor(
      timelineMediaAnchor.timelinePositionMs +
      ((mediaPositionSeconds - timelineMediaAnchor.mediaPositionSeconds) * 1000),
    ));
  }

  return resolveCatchUpTimelineSeekTargetMs(
    targetPositionMs,
    resolveCatchUpMediaOffsetSeconds(source),
    minimumMediaPositionSeconds,
  );
};

export interface CatchUpPendingStartupSeekTarget {
  timelinePositionMs: number;
  mediaPositionSeconds: number;
}

export const resolveCatchUpPendingStartupSeek = (
  source: Pick<SessionSource, 'metadata'> | null | undefined,
  options: {
    fallbackTimelinePositionMs?: number | null;
    minimumMediaPositionSeconds?: number;
  } = {},
): CatchUpPendingStartupSeekTarget | null => {
  if (!source || typeof source.metadata !== 'object' || source.metadata === null) {
    return null;
  }

  const metadata = source.metadata as Record<string, unknown>;
  if (metadata.mode !== 'catchup') {
    return null;
  }

  const explicitTimelinePositionMs = parseOptionalNonNegativeFiniteNumber(
    metadata.catchUpPendingTimelineSeekMs,
  );
  const fallbackTimelinePositionMs = parseOptionalNonNegativeFiniteNumber(
    options.fallbackTimelinePositionMs,
  );
  const timelinePositionMs = explicitTimelinePositionMs ?? fallbackTimelinePositionMs;
  if (timelinePositionMs === null) {
    return null;
  }

  const mediaOffsetSeconds = resolveCatchUpMediaOffsetSeconds(source);
  const explicitMediaPositionSeconds = parseOptionalNonNegativeFiniteNumber(
    metadata.catchUpPendingMediaSeekSeconds,
  );
  const minimumMediaPositionSeconds = parseNonNegativeFiniteSeconds(
    options.minimumMediaPositionSeconds,
  );
  const mediaPositionSeconds = Math.max(
    minimumMediaPositionSeconds,
    explicitMediaPositionSeconds ?? resolveCatchUpMediaSeekTimeSeconds(
      timelinePositionMs,
      mediaOffsetSeconds,
      minimumMediaPositionSeconds,
    ),
  );
  if (mediaPositionSeconds <= 0) {
    return null;
  }

  return {
    timelinePositionMs: Math.floor(timelinePositionMs),
    mediaPositionSeconds,
  };
};

export const resolveCatchUpSeekRecoveryFallbackPositionMs = ({
  targetPositionMs,
  lastRenderablePositionMs,
  toleranceMs = 2_000,
}: {
  targetPositionMs: number | null | undefined;
  lastRenderablePositionMs: number | null | undefined;
  toleranceMs?: number;
}): number | null => {
  if (
    typeof targetPositionMs !== 'number' ||
    !Number.isFinite(targetPositionMs) ||
    typeof lastRenderablePositionMs !== 'number' ||
    !Number.isFinite(lastRenderablePositionMs) ||
    lastRenderablePositionMs < 0
  ) {
    return null;
  }

  const safeToleranceMs = Math.max(
    0,
    Number.isFinite(toleranceMs) ? toleranceMs : 0,
  );
  if (Math.abs(targetPositionMs - lastRenderablePositionMs) <= safeToleranceMs) {
    return null;
  }

  return Math.floor(lastRenderablePositionMs);
};

export const resolveCatchUpTimelineSeekTargetMs = (
  targetPositionMs: number | null | undefined,
  mediaOffsetSeconds = 0,
  minimumMediaPositionSeconds = 0,
): number => resolveCatchUpTimelinePositionMs(
  resolveCatchUpMediaSeekTimeSeconds(
    targetPositionMs,
    mediaOffsetSeconds,
    minimumMediaPositionSeconds,
  ),
  mediaOffsetSeconds,
);

export const resolveCatchUpFallbackTimelinePositionMs = ({
  requestedPositionMs,
  mediaOffsetSeconds = 0,
  mediaDurationSeconds = 0,
  positionGuardMs = 30_000,
}: {
  requestedPositionMs: number | null | undefined;
  mediaOffsetSeconds?: number;
  mediaDurationSeconds?: number;
  positionGuardMs?: number;
}): number => {
  const safeRequestedPositionMs = Math.max(
    0,
    Number.isFinite(requestedPositionMs ?? NaN) ? requestedPositionMs ?? 0 : 0,
  );
  const safeMediaOffsetMs = Math.floor(parseNonNegativeFiniteSeconds(mediaOffsetSeconds) * 1000);
  const safeMediaDurationMs = Math.floor(parseNonNegativeFiniteSeconds(mediaDurationSeconds) * 1000);
  const safePositionGuardMs = Math.max(
    0,
    Number.isFinite(positionGuardMs) ? positionGuardMs : 0,
  );
  const minTimelinePositionMs = safeMediaOffsetMs > 0
    ? safeMediaOffsetMs
    : safePositionGuardMs;
  const maxTimelinePositionMs = safeMediaDurationMs > safePositionGuardMs
    ? safeMediaOffsetMs + safeMediaDurationMs - 1_000
    : safeRequestedPositionMs;

  return Math.floor(
    Math.max(
      minTimelinePositionMs,
      Math.min(safeRequestedPositionMs, maxTimelinePositionMs),
    ),
  );
};

export interface CatchUpFallbackPlaybackPosition {
  timelinePositionMs: number;
  mediaPositionSeconds: number;
}

export const resolveCatchUpFallbackPlaybackPosition = ({
  requestedPositionMs,
  mediaOffsetSeconds = 0,
  mediaDurationSeconds = 0,
  positionGuardMs = 30_000,
  preserveRequestedTimelinePosition = false,
}: {
  requestedPositionMs: number | null | undefined;
  mediaOffsetSeconds?: number;
  mediaDurationSeconds?: number;
  positionGuardMs?: number;
  preserveRequestedTimelinePosition?: boolean;
}): CatchUpFallbackPlaybackPosition => {
  const guardedTimelinePositionMs = resolveCatchUpFallbackTimelinePositionMs({
    requestedPositionMs,
    mediaOffsetSeconds,
    mediaDurationSeconds,
    positionGuardMs,
  });
  const safeRequestedPositionMs = Math.max(
    0,
    Number.isFinite(requestedPositionMs ?? NaN) ? requestedPositionMs ?? 0 : 0,
  );
  const safeMediaOffsetSeconds = parseNonNegativeFiniteSeconds(mediaOffsetSeconds);
  const timelinePositionMs = preserveRequestedTimelinePosition && safeMediaOffsetSeconds <= 0
    ? Math.floor(safeRequestedPositionMs)
    : guardedTimelinePositionMs;

  return {
    timelinePositionMs,
    mediaPositionSeconds: resolveCatchUpMediaSeekTimeSeconds(
      guardedTimelinePositionMs,
      safeMediaOffsetSeconds,
    ),
  };
};

export const shouldResolveCatchUpStartupWatchdog = (
  session: SessionState,
  watchedSourceUrl: string,
): boolean => (
  Boolean(session.source) &&
  session.source?.metadata?.mode === 'catchup' &&
  session.source.url === watchedSourceUrl
);

export const shouldRetryCatchUpStartupWithoutSafeStart = (
  session: Pick<SessionState, 'source'>,
  reason: string,
  media: {
    hasRenderableFrame: boolean;
  },
  fallbackMediaPositionSeconds: number,
): boolean => {
  if (
    reason !== 'STARTUP_TIMEOUT' ||
    !session.source ||
    session.source.metadata?.mode !== 'catchup' ||
    media.hasRenderableFrame
  ) {
    return false;
  }

  const metadata = session.source.metadata as Record<string, unknown>;
  if (metadata.catchUpInitialSegmentRetryUsed === true) {
    return false;
  }

  const currentStartPositionSeconds = parseOptionalNonNegativeFiniteNumber(
    metadata.catchUpHlsStartPositionSeconds,
  ) ?? 0;
  const safeFallbackPositionSeconds = parseNonNegativeFiniteSeconds(
    fallbackMediaPositionSeconds,
  );

  return currentStartPositionSeconds > safeFallbackPositionSeconds + 1;
};

export const shouldRetryCatchUpStartupWithProviderSafeStart = (
  session: Pick<SessionState, 'source'>,
  reason: string,
  media: {
    hasRenderableFrame: boolean;
  },
  providerSafeStartPositionSeconds: number,
): boolean => {
  if (
    reason !== 'STARTUP_TIMEOUT' ||
    !session.source ||
    session.source.metadata?.mode !== 'catchup' ||
    media.hasRenderableFrame
  ) {
    return false;
  }

  const metadata = session.source.metadata as Record<string, unknown>;
  if (metadata.catchUpProviderSafeStartRetryUsed === true) {
    return false;
  }

  const safeProviderStartPositionSeconds = parseNonNegativeFiniteSeconds(
    providerSafeStartPositionSeconds,
  );
  if (safeProviderStartPositionSeconds <= 0) {
    return false;
  }

  const currentStartPositionSeconds = parseOptionalNonNegativeFiniteNumber(
    metadata.catchUpHlsStartPositionSeconds,
  ) ?? 0;

  return safeProviderStartPositionSeconds > currentStartPositionSeconds + 1;
};

export const shouldStopLongCatchUpStartupLoading = (
  session: Pick<SessionState, 'source'>,
  media: {
    hasRenderableFrame: boolean;
  },
  elapsedMs: number,
  maxElapsedMs: number,
): boolean => (
  Boolean(session.source) &&
  session.source?.metadata?.mode === 'catchup' &&
  !media.hasRenderableFrame &&
  Number.isFinite(elapsedMs) &&
  Number.isFinite(maxElapsedMs) &&
  elapsedMs >= Math.max(0, maxElapsedMs)
);

export const shouldShowCatchUpManifestNoFrameUnavailable = (
  session: Pick<SessionState, 'source'>,
  attemptedStartupTimeouts: number,
  attemptedStartupFallbacks: number,
): boolean => (
  Boolean(session.source) &&
  session.source?.metadata?.mode === 'catchup' &&
  (attemptedStartupTimeouts > 0 || attemptedStartupFallbacks > 0)
);

export const resolveCatchUpManifestNoFrameWatchdogDelayMs = (
  session: Pick<SessionState, 'source'>,
  attemptedStartupTimeouts: number,
  attemptedStartupFallbacks: number,
  firstAttemptDelayMs: number,
  recoveredAttemptDelayMs: number,
): number => {
  const firstAttemptDelay = Math.max(
    0,
    Number.isFinite(firstAttemptDelayMs) ? firstAttemptDelayMs : 0,
  );
  const recoveredAttemptDelay = Math.max(
    firstAttemptDelay,
    Number.isFinite(recoveredAttemptDelayMs) ? recoveredAttemptDelayMs : firstAttemptDelay,
  );

  return shouldShowCatchUpManifestNoFrameUnavailable(
    session,
    attemptedStartupTimeouts,
    attemptedStartupFallbacks,
  )
    ? recoveredAttemptDelay
    : firstAttemptDelay;
};

export const shouldScheduleStartupHardRetry = (session: SessionState): boolean => (
  Boolean(session.source) &&
  session.source?.metadata?.mode === 'live' &&
  sessionWantsPlayback(session)
);

export const shouldRetryLiveStartupWithoutFrame = (
  media: {
    currentTimeSeconds: number;
    hasRenderableFrame: boolean;
  },
): boolean => !media.hasRenderableFrame;

export type LiveUnexpectedStopDecision = 'sync-stop' | 'retry' | 'block';

export const shouldResumeRenderableLiveAfterUnexpectedStop = (
  session: Pick<SessionState, 'source' | 'playback'>,
  recovery: {
    manualPauseRequested: boolean;
    hasRenderableFrame: boolean;
  },
): boolean => {
  if (
    recovery.manualPauseRequested ||
    !recovery.hasRenderableFrame ||
    !session.source ||
    session.source.metadata?.mode !== 'live' ||
    !sessionWantsPlayback(session)
  ) {
    return false;
  }

  return true;
};

export const resolveLiveUnexpectedStopDecision = (
  session: Pick<SessionState, 'source' | 'playback'>,
  recovery: {
    manualPauseRequested: boolean;
    attemptedRetries: number;
    maxRetries: number;
  },
): LiveUnexpectedStopDecision => {
  if (
    recovery.manualPauseRequested ||
    !session.source ||
    session.source.metadata?.mode !== 'live' ||
    !sessionWantsPlayback(session)
  ) {
    return 'sync-stop';
  }

  return recovery.attemptedRetries < recovery.maxRetries ? 'retry' : 'block';
};

export const shouldContinueCatchUpStartupFallbacks = (
  session: SessionState,
  lastStartedSourceUrl: string | null,
  attemptedStartupFallbacks: number,
  maxStartupFallbacks: number,
): boolean => {
  if (!session.source || session.source.metadata?.mode !== 'catchup') {
    return true;
  }

  if (session.source.url === lastStartedSourceUrl) {
    return true;
  }

  return attemptedStartupFallbacks < maxStartupFallbacks;
};

export const shouldRetryCatchUpBufferingStall = (
  session: Pick<SessionState, 'source' | 'playback'>,
  media: {
    currentTimeSeconds: number;
    hasRenderableFrame: boolean;
  },
): boolean => {
  if (
    !session.source ||
    session.source.metadata?.mode !== 'catchup' ||
    session.playback !== 'buffering'
  ) {
    return false;
  }

  if (media.hasRenderableFrame) {
    return true;
  }

  return false;
};

const CATCH_UP_HLS_FALLBACK_ERROR_CODES = new Set([
  'NETWORK_ERROR',
  'MEDIA_ERROR',
  'HLS_ERROR',
  'LOAD_FAILED',
]);

const CATCH_UP_STARTUP_DEFERRED_ERROR_CODES = new Set([
  ...CATCH_UP_HLS_FALLBACK_ERROR_CODES,
  'MEDIA_ELEMENT_3',
  'MEDIA_ELEMENT_4',
  'PLAYBACK_START_FAILED',
]);

const LIVE_STARTUP_DEFERRED_ERROR_CODES = new Set([
  'NETWORK_ERROR',
  'MEDIA_ERROR',
  'HLS_ERROR',
  'LOAD_FAILED',
  'MEDIA_ELEMENT_3',
  'MEDIA_ELEMENT_4',
  'PLAYBACK_START_FAILED',
]);

export const shouldDeferLiveStartupPlaybackError = (
  session: Pick<SessionState, 'source' | 'playback'>,
  playbackError: Pick<PlaybackError, 'code' | 'fatal'>,
  media: {
    hasRenderableFrame: boolean;
  },
  startup: {
    sourceHasStarted: boolean;
  },
): boolean => {
  if (
    !session.source ||
    session.source.metadata?.mode !== 'live' ||
    media.hasRenderableFrame ||
    startup.sourceHasStarted ||
    !sessionWantsPlayback(session)
  ) {
    return false;
  }

  return playbackError.fatal && LIVE_STARTUP_DEFERRED_ERROR_CODES.has(playbackError.code);
};

export const shouldDeferCatchUpStartupPlaybackError = (
  session: Pick<SessionState, 'source' | 'playback'>,
  playbackError: Pick<PlaybackError, 'code' | 'fatal'>,
  media: {
    hasRenderableFrame: boolean;
  },
  startup: {
    sourceHasStarted: boolean;
  },
): boolean => {
  if (
    !session.source ||
    session.source.metadata?.mode !== 'catchup' ||
    media.hasRenderableFrame ||
    startup.sourceHasStarted ||
    !sessionWantsPlayback(session)
  ) {
    return false;
  }

  return CATCH_UP_STARTUP_DEFERRED_ERROR_CODES.has(playbackError.code);
};

export const shouldAttemptCatchUpErrorFallback = (
  session: Pick<SessionState, 'source'>,
  playbackError: Pick<PlaybackError, 'code' | 'fatal'>,
  media: {
    hasRenderableFrame: boolean;
  },
): boolean => {
  if (!session.source || session.source.metadata?.mode !== 'catchup') {
    return false;
  }

  if (playbackError.code === 'MEDIA_ELEMENT_3') {
    return !media.hasRenderableFrame;
  }

  if (playbackError.code.startsWith('MEDIA_ELEMENT_')) {
    return false;
  }

  if (playbackError.fatal) {
    return CATCH_UP_HLS_FALLBACK_ERROR_CODES.has(playbackError.code);
  }

  return playbackError.code === 'MEDIA_ERROR' && !media.hasRenderableFrame;
};

export const shouldResolveCatchUpRuntimeUnavailableAfterPlaybackError = (
  session: Pick<SessionState, 'source'>,
  playbackError: Pick<PlaybackError, 'code' | 'fatal'>,
  media: {
    hasRenderableFrame: boolean;
  },
): boolean => {
  if (!session.source || session.source.metadata?.mode !== 'catchup') {
    return false;
  }

  if (media.hasRenderableFrame) {
    return false;
  }

  if (playbackError.fatal) {
    return true;
  }

  if (playbackError.code === 'MEDIA_ELEMENT_3') {
    return true;
  }

  return false;
};

export type CatchUpSeekNoFrameDecision = 'wait' | 'retry' | 'block';

export const resolveCatchUpSeekNoFrameDecision = (
  session: Pick<SessionState, 'source' | 'playback' | 'positionMs'>,
  media: {
    currentTimeSeconds: number;
    hasRenderableFrame: boolean;
  },
  recovery: {
    targetPositionMs: number | null;
    attemptedRetries: number;
    maxRetries: number;
    toleranceMs?: number;
  },
): CatchUpSeekNoFrameDecision => {
  if (
    !session.source ||
    session.source.metadata?.mode !== 'catchup' ||
    !sessionWantsPlayback(session) ||
    session.positionMs === null ||
    recovery.targetPositionMs === null ||
    !Number.isFinite(recovery.targetPositionMs)
  ) {
    return 'wait';
  }

  const toleranceMs = Math.max(0, recovery.toleranceMs ?? 2_000);
  if (Math.abs(session.positionMs - recovery.targetPositionMs) > toleranceMs) {
    return 'wait';
  }

  const currentPositionMs = Math.floor(media.currentTimeSeconds * 1000);
  if (
    media.hasRenderableFrame &&
    Math.abs(currentPositionMs - recovery.targetPositionMs) <= toleranceMs
  ) {
    return 'wait';
  }

  return recovery.attemptedRetries < recovery.maxRetries ? 'retry' : 'block';
};

export const shouldWatchCatchUpSeekAfterPlaybackError = (
  session: Pick<SessionState, 'source' | 'playback'>,
  recovery: {
    fatal: boolean;
    hasRenderableFrame: boolean;
    targetPositionMs: number | null;
  },
): boolean => {
  if (
    recovery.fatal ||
    recovery.hasRenderableFrame ||
    recovery.targetPositionMs === null ||
    !Number.isFinite(recovery.targetPositionMs)
  ) {
    return false;
  }

  return Boolean(
    session.source &&
    session.source.metadata?.mode === 'catchup' &&
    sessionWantsPlayback(session)
  );
};

export const shouldWatchCatchUpSeekAfterPositionChange = (
  session: Pick<SessionState, 'source'>,
  recovery: {
    playbackWantsPlaying: boolean;
    hasRenderableFrame: boolean;
    retryCount: number;
    sourceHasStarted: boolean;
  },
): boolean => {
  if (
    !session.source ||
    session.source.metadata?.mode !== 'catchup' ||
    !recovery.playbackWantsPlaying
  ) {
    return false;
  }

  return (
    recovery.hasRenderableFrame ||
    recovery.retryCount > 0 ||
    recovery.sourceHasStarted
  );
};
