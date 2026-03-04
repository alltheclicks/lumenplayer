import { useRef, useEffect, useState, useCallback, forwardRef, useImperativeHandle } from 'react';
import { AlertCircle, Loader2, WifiOff, ShieldAlert } from 'lucide-react';
import { useSessionContext } from '@/context/session-context';
import {
  HlsPlayerAdapter,
  type ManifestRuntimeGateDecision,
} from '@/adapters/HlsPlayerAdapter';
import type { PlaybackError } from '@lumen/types';
import type { AudioTrackOption } from '@lumen/types';
import type { SubtitleTrackOption } from '@lumen/types';
import { emitWebObservabilityEvent } from '@/services/observability';
import {
  isCatchUpFallbackStrategy,
  isCatchUpTransportAttempt,
  rememberCatchUpHostAffinity,
  resolveCatchUpHostAffinity,
  resolveCatchUpTargetOrigin,
  shouldApplyHostAffinityToAttempt,
  toCatchUpProxyUrl,
  rewriteCatchUpUrlTargetOrigin,
  type CatchUpTransportAttempt,
} from './catchupTransport';
import {
  createCatchUpFallbackSignalFromLoadError,
  createCatchUpFallbackSignalFromPlaybackError,
  evaluateCatchUpRuntimePayload,
  probeCatchUpRuntimePayload,
  resolveUrlHost,
  shouldApplyCatchUpRuntimeGate,
  type CatchUpFallbackSignal,
  type CatchUpFallbackReason,
} from './catchupRuntimeGate';
import {
  evaluateCatchUpDecodeErrorBurst,
  hasRuntimePlaybackStarted,
  shouldKeepPendingAutoplayOnIdle,
  shouldClearPendingAutoplayOnPlaybackError,
  sessionWantsPlayback,
  shouldShowBlockingPlaybackError,
  shouldHoldPauseSyncOnSourceStartup,
  shouldRetryPendingAutoplayAfterPausedEvent,
  shouldResumePlaybackAfterPictureInPictureExit,
  shouldAttemptCatchUpFallbackForPlaybackError,
  shouldSkipCatchUpNonManifestAttempt,
  shouldSkipCatchUpShortDurationAttempt,
  shouldTriggerCatchUpRuntimeStallFallback,
} from './videoPlaybackSync';

export interface VideoPlayerProps {
  poster?: string;
  autoPlay?: boolean;
  preferNativeHls?: boolean;
  loadingOverlayMaxMs?: number;
  onError?: (error: string) => void;
  onEnded?: () => void;
  onCanPlay?: () => void;
  className?: string;
}

export interface VideoPlayerHandle {
  play: () => void;
  pause: () => void;
  seek: (time: number) => void;
  setVolume: (volume: number) => void;
  setMuted: (muted: boolean) => void;
  toggleMute: () => void;
  getCurrentTime: () => number;
  getDuration: () => number;
  isPlaying: () => boolean;
  getAudioTracks: () => AudioTrackOption[];
  getSelectedAudioTrackId: () => string | null;
  setAudioTrack: (trackId: string) => boolean;
  onAudioTracksChange: (
    callback: (tracks: AudioTrackOption[], selectedTrackId: string | null) => void
  ) => () => void;
  getSubtitleTracks: () => SubtitleTrackOption[];
  getSelectedSubtitleTrackId: () => string | null;
  setSubtitleTrack: (trackId: string | null) => boolean;
  onSubtitleTracksChange: (
    callback: (tracks: SubtitleTrackOption[], selectedTrackId: string | null) => void
  ) => () => void;
  isPictureInPictureSupported: () => boolean;
  isPictureInPicture: () => boolean;
  enterPictureInPicture: () => Promise<boolean>;
  exitPictureInPicture: () => Promise<boolean>;
  togglePictureInPicture: () => Promise<boolean>;
  onPictureInPictureChange: (callback: (isInPictureInPicture: boolean) => void) => () => void;
  isAirPlaySupported: () => boolean;
  isAirPlayAvailable: () => boolean;
  isAirPlayConnected: () => boolean;
  showAirPlayPicker: () => boolean;
  onAirPlayAvailabilityChange: (callback: (isAvailable: boolean) => void) => () => void;
  onAirPlayConnectionChange: (callback: (isConnected: boolean) => void) => () => void;
}

type PlayerError = {
  type: 'network' | 'mixed-content' | 'format' | 'unknown';
  message: string;
  details?: string;
};

type WebKitPictureInPictureVideoElement = HTMLVideoElement & {
  webkitSupportsPresentationMode?: (mode: string) => boolean;
  webkitSetPresentationMode?: (mode: string) => void;
  webkitPresentationMode?: string;
};

type AirPlayAvailability = 'available' | 'not-available' | string;

type WebKitAirPlayVideoElement = HTMLVideoElement & {
  webkitShowPlaybackTargetPicker?: () => void;
  webkitPlaybackTargetAvailability?: AirPlayAvailability;
  webkitCurrentPlaybackTargetIsWireless?: boolean;
};

const STARTUP_AUTOPLAY_RECOVERY_MAX_RETRIES = 3;
const STARTUP_AUTOPLAY_RECOVERY_BASE_DELAY_MS = 220;
const CATCH_UP_STARTUP_TIMEOUT_MS = 12_000;
const CATCH_UP_PRESTART_NETWORK_ERROR_THRESHOLD = 3;
const CATCH_UP_NETWORK_FALLBACK_MIN_INTERVAL_MS = 3_000;
const CATCH_UP_RUNTIME_STALL_CHECK_INTERVAL_MS = 1_000;
const CATCH_UP_RUNTIME_STALL_THRESHOLD_MS = 12_000;
const CATCH_UP_RUNTIME_POST_START_STALL_THRESHOLD_MS = 12_000;
const CATCH_UP_RUNTIME_STALL_FALLBACK_MIN_INTERVAL_MS = 4_000;
const CATCH_UP_RUNTIME_PROGRESS_EPSILON_SECONDS = 0.2;
const CATCH_UP_DECODE_ERROR_BURST_WINDOW_MS = 45_000;
const CATCH_UP_DECODE_ERROR_BURST_THRESHOLD = 1;
const CATCH_UP_DECODE_ERROR_MIN_PROGRESS_SECONDS = 5;
const CATCH_UP_RUNTIME_MAX_FALLBACK_ATTEMPTS = 3;

interface ParsedCatchUpAttemptState {
  attempts: CatchUpTransportAttempt[];
  currentAttemptIndex: number;
}

const buildCatchUpFallbackSignalKey = (
  sourceUrl: string,
  attemptIndex: number,
  signal: CatchUpFallbackSignal,
): string => [
  sourceUrl,
  String(attemptIndex),
  signal.errorCode,
  signal.fallbackReason,
  String(signal.httpStatus ?? ''),
  signal.contentType ?? '',
  signal.finalUrlHost ?? '',
].join('|');

const parseNumericMetadataValue = (value: unknown): number | null => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === 'string') {
    const numericValue = Number(value);
    if (Number.isFinite(numericValue)) {
      return numericValue;
    }
  }

  return null;
};

const resolveCatchUpAttemptState = (
  metadata: Record<string, unknown>,
  currentSourceUrl: string,
): ParsedCatchUpAttemptState => {
  const parsedAttempts = Array.isArray(metadata.catchUpAttemptPlan)
    ? metadata.catchUpAttemptPlan.filter(isCatchUpTransportAttempt)
    : [];

  let attempts = parsedAttempts;
  if (attempts.length === 0) {
    const fallbackUrls = Array.isArray(metadata.catchUpFallbackUrls)
      ? metadata.catchUpFallbackUrls
        .filter((value): value is string => typeof value === 'string')
        .map((value) => value.trim())
        .filter((value) => value.length > 0)
      : [];
    const fallbackUrl = typeof metadata.catchUpFallbackUrl === 'string'
      ? metadata.catchUpFallbackUrl.trim()
      : '';

    const streamId = Math.floor(parseNumericMetadataValue(metadata.streamId) ?? 0);
    const startTimestamp = Math.floor(parseNumericMetadataValue(metadata.catchUpStartTimestamp) ?? 0);
    const durationSeconds = Math.floor(parseNumericMetadataValue(metadata.catchUpDurationSeconds) ?? 0);
    const fallbackAttempts = [
      currentSourceUrl,
      ...fallbackUrls,
      ...(fallbackUrl ? [fallbackUrl] : []),
    ].filter((url, index, urls) => (
      url.length > 0 && urls.indexOf(url) === index
    ));
    attempts = fallbackAttempts.map((url): CatchUpTransportAttempt => ({
      url,
      streamId,
      startTimestamp,
      durationSeconds,
      offsetMinutes: 0,
      strategy: 'legacy',
    }));
  }

  let currentAttemptIndex = Math.floor(parseNumericMetadataValue(metadata.catchUpAttemptIndex) ?? -1);
  if (
    currentAttemptIndex < 0 ||
    currentAttemptIndex >= attempts.length ||
    attempts[currentAttemptIndex]?.url !== currentSourceUrl
  ) {
    currentAttemptIndex = attempts.findIndex((attempt) => attempt.url === currentSourceUrl);
  }
  if (currentAttemptIndex < 0) {
    currentAttemptIndex = 0;
  }

  return {
    attempts,
    currentAttemptIndex,
  };
};

const buildCatchUpEventMetadata = (
  source: {
    url: string;
    metadata?: unknown;
  } | null | undefined,
  options: {
    attemptIndex?: number;
    status: string;
    errorCode: string | null;
    finalHost?: string | null;
    finalUrlHost?: string | null;
    httpStatus?: number | null;
    contentType?: string | null;
    isPlayableForRuntime?: boolean;
    fallbackReason?: CatchUpFallbackReason | null;
    strategy?: string | null;
  },
): Record<string, unknown> => {
  const baseMetadata = {
    attemptIndex: typeof options.attemptIndex === 'number' ? options.attemptIndex : null,
    status: options.status,
    errorCode: options.errorCode,
    finalHost: options.finalHost ?? null,
    finalUrlHost: options.finalUrlHost ?? null,
    httpStatus: options.httpStatus ?? null,
    contentType: options.contentType ?? null,
    isPlayableForRuntime: options.isPlayableForRuntime ?? false,
    fallbackReason: options.fallbackReason ?? null,
  };

  if (!source || typeof source.metadata !== 'object' || source.metadata === null) {
    return baseMetadata;
  }

  const metadata = source.metadata as Record<string, unknown>;
  if (metadata.mode !== 'catchup') {
    return baseMetadata;
  }

  const { attempts, currentAttemptIndex } = resolveCatchUpAttemptState(metadata, source.url);
  const safeAttemptIndex = typeof options.attemptIndex === 'number'
    ? options.attemptIndex
    : currentAttemptIndex;
  const attempt = attempts[safeAttemptIndex] ?? attempts[currentAttemptIndex] ?? null;
  const streamId = attempt?.streamId ?? parseNumericMetadataValue(metadata.streamId);
  const start = attempt?.startTimestamp ?? parseNumericMetadataValue(metadata.catchUpStartTimestamp);
  const duration = attempt?.durationSeconds ?? parseNumericMetadataValue(metadata.catchUpDurationSeconds);
  const finalHost = options.finalHost ?? resolveCatchUpHostAffinity(source.url);
  const finalUrlHost = options.finalUrlHost ?? resolveUrlHost(finalHost ?? source.url);

  return {
    streamId: streamId ?? null,
    start: start ?? null,
    duration: duration ?? null,
    attempt: safeAttemptIndex + 1,
    attemptIndex: safeAttemptIndex,
    status: options.status,
    finalHost: finalHost ?? null,
    finalUrlHost,
    httpStatus: options.httpStatus ?? null,
    contentType: options.contentType ?? null,
    isPlayableForRuntime: options.isPlayableForRuntime ?? false,
    fallbackReason: options.fallbackReason ?? null,
    errorCode: options.errorCode,
    strategy: options.strategy ?? attempt?.strategy ?? null,
  };
};

const canUseStandardPictureInPicture = (video: HTMLVideoElement): boolean => (
  typeof document !== 'undefined' &&
  document.pictureInPictureEnabled &&
  typeof video.requestPictureInPicture === 'function' &&
  !video.disablePictureInPicture
);

const canUseWebKitPictureInPicture = (
  video: WebKitPictureInPictureVideoElement
): boolean => (
  typeof video.webkitSetPresentationMode === 'function' &&
  typeof video.webkitSupportsPresentationMode === 'function' &&
  video.webkitSupportsPresentationMode('picture-in-picture')
);

const isVideoInPictureInPicture = (
  video: WebKitPictureInPictureVideoElement
): boolean => {
  const isStandardPictureInPicture =
    typeof document !== 'undefined' &&
    document.pictureInPictureElement === video;
  const isWebKitPictureInPicture = video.webkitPresentationMode === 'picture-in-picture';
  return isStandardPictureInPicture || isWebKitPictureInPicture;
};

const canUseAirPlayPicker = (video: WebKitAirPlayVideoElement): boolean => (
  typeof video.webkitShowPlaybackTargetPicker === 'function'
);

const isAirPlayDeviceAvailable = (video: WebKitAirPlayVideoElement): boolean => (
  video.webkitPlaybackTargetAvailability === 'available'
);

const isAirPlayDeviceConnected = (video: WebKitAirPlayVideoElement): boolean => (
  Boolean(video.webkitCurrentPlaybackTargetIsWireless)
);

const VideoPlayer = forwardRef<VideoPlayerHandle, VideoPlayerProps>(({
  poster,
  autoPlay = true,
  preferNativeHls = false,
  loadingOverlayMaxMs,
  onError,
  onEnded,
  onCanPlay,
  className = '',
}, ref) => {
  const { session, commands } = useSessionContext();
  const src = session.source?.url ?? '';
  const sourceType = session.source?.type ?? (src.includes('.m3u8') ? 'hls' : 'mp4');
  const videoRef = useRef<HTMLVideoElement>(null);
  const adapterRef = useRef<HlsPlayerAdapter | null>(null);
  const sessionRef = useRef(session);
  const isApplyingSessionSeekRef = useRef(false);
  const lastReportedPositionMsRef = useRef<number | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingOverlayVisible, setIsLoadingOverlayVisible] = useState(true);
  const [error, setError] = useState<PlayerError | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isPictureInPicture, setIsPictureInPicture] = useState(false);
  const [isAirPlayAvailable, setIsAirPlayAvailable] = useState(false);
  const [isAirPlayConnected, setIsAirPlayConnected] = useState(false);
  const pictureInPictureListenersRef = useRef(new Set<(isInPictureInPicture: boolean) => void>());
  const airPlayAvailabilityListenersRef = useRef(new Set<(isAvailable: boolean) => void>());
  const airPlayConnectionListenersRef = useRef(new Set<(isConnected: boolean) => void>());
  const lastStartedSourceRef = useRef<string | null>(null);
  const pendingAutoplaySourceUrlRef = useRef<string | null>(null);
  const startupAutoplayRecoveryAttemptsRef = useRef(0);
  const startupAutoplayRecoveryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const catchUpStartupTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const catchUpPreStartNetworkErrorRef = useRef<{ sourceUrl: string | null; count: number }>({
    sourceUrl: null,
    count: 0,
  });
  const catchUpLastNetworkFallbackAtRef = useRef(0);
  const catchUpRuntimeProgressRef = useRef<{
    sourceUrl: string | null;
    lastPositionSeconds: number;
    lastProgressAtMs: number;
  }>({
    sourceUrl: null,
    lastPositionSeconds: 0,
    lastProgressAtMs: 0,
  });
  const catchUpRuntimeStallMonitorTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const catchUpLastRuntimeStallFallbackAtRef = useRef(0);
  const catchUpDecodeErrorBurstRef = useRef<{ sourceUrl: string | null; count: number; lastAtMs: number }>({
    sourceUrl: null,
    count: 0,
    lastAtMs: 0,
  });
  const lastCatchUpFallbackSignalRef = useRef<string | null>(null);
  const playbackWantsPlaying = sessionWantsPlayback(session);
  const isLocalRenderer = session.renderer === 'local-web' || session.renderer === 'airplay';

  useEffect(() => {
    pictureInPictureListenersRef.current.forEach((listener) => {
      listener(isPictureInPicture);
    });
  }, [isPictureInPicture]);

  useEffect(() => {
    airPlayAvailabilityListenersRef.current.forEach((listener) => {
      listener(isAirPlayAvailable);
    });
  }, [isAirPlayAvailable]);

  useEffect(() => {
    airPlayConnectionListenersRef.current.forEach((listener) => {
      listener(isAirPlayConnected);
    });
  }, [isAirPlayConnected]);

  useEffect(() => {
    if (!isLoading || error) {
      setIsLoadingOverlayVisible(false);
      return;
    }

    setIsLoadingOverlayVisible(true);
    if (
      typeof loadingOverlayMaxMs !== 'number' ||
      !Number.isFinite(loadingOverlayMaxMs) ||
      loadingOverlayMaxMs <= 0
    ) {
      return;
    }

    const timeoutId = setTimeout(() => {
      setIsLoadingOverlayVisible(false);
    }, loadingOverlayMaxMs);

    return () => {
      clearTimeout(timeoutId);
    };
  }, [error, isLoading, loadingOverlayMaxMs, src]);

  const isPictureInPictureSupported = useCallback((): boolean => {
    const video = videoRef.current as WebKitPictureInPictureVideoElement | null;
    if (!video) {
      return false;
    }

    return canUseStandardPictureInPicture(video) || canUseWebKitPictureInPicture(video);
  }, []);

  const enterPictureInPicture = useCallback(async (): Promise<boolean> => {
    const video = videoRef.current as WebKitPictureInPictureVideoElement | null;
    if (!video) {
      return false;
    }

    try {
      if (canUseStandardPictureInPicture(video)) {
        await video.requestPictureInPicture();
        return true;
      }

      if (canUseWebKitPictureInPicture(video)) {
        video.webkitSetPresentationMode?.('picture-in-picture');
        return true;
      }
    } catch {
      return false;
    }

    return false;
  }, []);

  const exitPictureInPicture = useCallback(async (): Promise<boolean> => {
    const video = videoRef.current as WebKitPictureInPictureVideoElement | null;
    if (!video) {
      return false;
    }

    try {
      if (typeof document !== 'undefined' && document.pictureInPictureElement === video) {
        await document.exitPictureInPicture();
        return true;
      }

      if (video.webkitPresentationMode === 'picture-in-picture' && video.webkitSetPresentationMode) {
        video.webkitSetPresentationMode('inline');
        return true;
      }
    } catch {
      return false;
    }

    return false;
  }, []);

  const togglePictureInPicture = useCallback(async (): Promise<boolean> => {
    const video = videoRef.current as WebKitPictureInPictureVideoElement | null;
    if (!video || !isPictureInPictureSupported()) {
      return false;
    }

    if (isVideoInPictureInPicture(video)) {
      return exitPictureInPicture();
    }

    return enterPictureInPicture();
  }, [enterPictureInPicture, exitPictureInPicture, isPictureInPictureSupported]);

  const isAirPlaySupported = useCallback((): boolean => {
    const video = videoRef.current as WebKitAirPlayVideoElement | null;
    if (!video) {
      return false;
    }

    return canUseAirPlayPicker(video);
  }, []);

  const showAirPlayPicker = useCallback((): boolean => {
    const video = videoRef.current as WebKitAirPlayVideoElement | null;
    if (!video || !canUseAirPlayPicker(video)) {
      return false;
    }

    try {
      video.webkitShowPlaybackTargetPicker?.();
      return true;
    } catch {
      return false;
    }
  }, []);

  useEffect(() => {
    sessionRef.current = session;
  }, [session]);

  useEffect(() => {
    const nextSourceUrl = src || null;
    const existingRuntimeProgress = catchUpRuntimeProgressRef.current;
    const canReuseRuntimeProgress = (
      existingRuntimeProgress.sourceUrl === nextSourceUrl &&
      existingRuntimeProgress.lastPositionSeconds > CATCH_UP_RUNTIME_PROGRESS_EPSILON_SECONDS
    );
    const fallbackPositionSeconds = Number.isFinite(videoRef.current?.currentTime)
      ? (videoRef.current?.currentTime ?? 0)
      : 0;

    lastCatchUpFallbackSignalRef.current = null;
    catchUpPreStartNetworkErrorRef.current = {
      sourceUrl: nextSourceUrl,
      count: 0,
    };
    catchUpLastNetworkFallbackAtRef.current = 0;
    catchUpLastRuntimeStallFallbackAtRef.current = 0;
    catchUpRuntimeProgressRef.current = {
      sourceUrl: nextSourceUrl,
      lastPositionSeconds: canReuseRuntimeProgress
        ? existingRuntimeProgress.lastPositionSeconds
        : fallbackPositionSeconds,
      lastProgressAtMs: Date.now(),
    };
    catchUpDecodeErrorBurstRef.current = {
      sourceUrl: nextSourceUrl,
      count: 0,
      lastAtMs: 0,
    };
  }, [src]);

  const clearStartupAutoplayRecovery = useCallback(() => {
    if (startupAutoplayRecoveryTimerRef.current !== null) {
      clearTimeout(startupAutoplayRecoveryTimerRef.current);
      startupAutoplayRecoveryTimerRef.current = null;
    }
    startupAutoplayRecoveryAttemptsRef.current = 0;
  }, []);

  const clearCatchUpStartupTimeout = useCallback(() => {
    if (catchUpStartupTimeoutRef.current !== null) {
      clearTimeout(catchUpStartupTimeoutRef.current);
      catchUpStartupTimeoutRef.current = null;
    }
  }, []);

  const clearCatchUpRuntimeStallMonitor = useCallback(() => {
    if (catchUpRuntimeStallMonitorTimerRef.current !== null) {
      clearInterval(catchUpRuntimeStallMonitorTimerRef.current);
      catchUpRuntimeStallMonitorTimerRef.current = null;
    }
  }, []);

  const markCatchUpRuntimeProgress = useCallback((
    sourceUrl: string | null,
    positionSeconds: number,
  ) => {
    catchUpRuntimeProgressRef.current = {
      sourceUrl,
      lastPositionSeconds: Number.isFinite(positionSeconds) ? positionSeconds : 0,
      lastProgressAtMs: Date.now(),
    };
  }, []);

  const shouldAttemptCatchUpFallback = useCallback((
    playbackError: PlaybackError,
    _signal: CatchUpFallbackSignal,
    options: {
      isCatchUpSource: boolean;
      hasRuntimePlaybackData: boolean;
      allowNetworkFallback: boolean;
    },
  ): boolean => {
    return shouldAttemptCatchUpFallbackForPlaybackError({
      playbackError,
      isCatchUpSource: options.isCatchUpSource,
      hasRuntimePlaybackData: options.hasRuntimePlaybackData,
      allowNetworkFallback: options.allowNetworkFallback,
    });
  }, []);

  const switchToCatchUpFallbackIfAvailable = useCallback((signal: CatchUpFallbackSignal): boolean => {
    const currentSession = sessionRef.current;
    const source = currentSession.source;
    if (!source || typeof source.metadata !== 'object' || source.metadata === null) {
      return false;
    }

    const metadata = source.metadata as Record<string, unknown>;
    if (metadata.mode !== 'catchup') {
      return false;
    }

    const { attempts, currentAttemptIndex } = resolveCatchUpAttemptState(metadata, source.url);
    const fallbackSignalKey = buildCatchUpFallbackSignalKey(source.url, currentAttemptIndex, signal);
    if (lastCatchUpFallbackSignalRef.current === fallbackSignalKey) {
      return false;
    }

    lastCatchUpFallbackSignalRef.current = fallbackSignalKey;

    if (attempts.length <= 1) {
      return false;
    }

    const expectedCatchUpDurationSeconds = parseNumericMetadataValue(metadata.catchUpDurationSeconds);
    const currentRuntimeProgress = catchUpRuntimeProgressRef.current;
    const hasRuntimePlaybackProgressForCurrentSource = (
      currentRuntimeProgress.sourceUrl === source.url &&
      currentRuntimeProgress.lastPositionSeconds > CATCH_UP_RUNTIME_PROGRESS_EPSILON_SECONDS
    );
    const hasRuntimePlaybackProgress = (
      metadata.catchUpRuntimePlaybackStarted === true ||
      hasRuntimePlaybackProgressForCurrentSource
    );
    const shouldCapRuntimeFallbackAttempts = (
      hasRuntimePlaybackProgress &&
      currentAttemptIndex >= CATCH_UP_RUNTIME_MAX_FALLBACK_ATTEMPTS &&
      (
        signal.fallbackReason === 'media_error' ||
        signal.fallbackReason === 'network_error' ||
        signal.fallbackReason === 'playback_error' ||
        signal.fallbackReason === 'timeout'
      )
    );
    let nextAttemptIndex = currentAttemptIndex + 1;
    if (shouldCapRuntimeFallbackAttempts) {
      emitWebObservabilityEvent({
        name: 'catchup.runtime_gate',
        severity: 'warn',
        metadata: {
          ...buildCatchUpEventMetadata(source, {
            attemptIndex: currentAttemptIndex,
            status: 'runtime_retry_cap_reached',
            errorCode: signal.errorCode,
            finalUrlHost: signal.finalUrlHost,
            httpStatus: signal.httpStatus,
            contentType: signal.contentType,
            isPlayableForRuntime: signal.isPlayableForRuntime,
            fallbackReason: signal.fallbackReason,
          }),
          renderer: currentSession.renderer,
          maxRuntimeFallbackAttempts: CATCH_UP_RUNTIME_MAX_FALLBACK_ATTEMPTS,
        },
      });
      nextAttemptIndex = attempts.length;
    }

    while (nextAttemptIndex < attempts.length) {
      const candidateAttempt = attempts[nextAttemptIndex];
      if (!candidateAttempt) {
        break;
      }

      if (candidateAttempt.url === source.url) {
        nextAttemptIndex += 1;
        continue;
      }

      const shouldSkipShortDurationAttempt = shouldSkipCatchUpShortDurationAttempt({
        attemptUrl: candidateAttempt.url,
        expectedDurationSeconds: expectedCatchUpDurationSeconds,
        hasRuntimePlaybackProgress,
      });
      const shouldSkipNonManifestAttempt = shouldSkipCatchUpNonManifestAttempt({
        attemptUrl: candidateAttempt.url,
        hasRuntimePlaybackProgress,
      });
      if (!shouldSkipShortDurationAttempt && !shouldSkipNonManifestAttempt) {
        break;
      }

      emitWebObservabilityEvent({
        name: 'catchup.runtime_gate',
        severity: 'warn',
        metadata: {
          ...buildCatchUpEventMetadata(source, {
            attemptIndex: nextAttemptIndex,
            status: 'skip_short_duration',
            errorCode: signal.errorCode,
            finalUrlHost: signal.finalUrlHost,
            httpStatus: signal.httpStatus,
            contentType: signal.contentType,
            isPlayableForRuntime: signal.isPlayableForRuntime,
            fallbackReason: signal.fallbackReason,
            strategy: candidateAttempt.strategy,
          }),
          renderer: currentSession.renderer,
          expectedDurationSeconds: expectedCatchUpDurationSeconds,
          rejectionReason: shouldSkipShortDurationAttempt
            ? 'short_duration_after_progress'
            : 'non_manifest_attempt_after_progress',
        },
      });
      nextAttemptIndex += 1;
    }
    if (nextAttemptIndex >= attempts.length) {
      const liveFallbackUrl = typeof metadata.catchUpLiveFallbackUrl === 'string'
        ? metadata.catchUpLiveFallbackUrl.trim()
        : '';
      if (liveFallbackUrl.length > 0) {
        const liveChannelId = typeof metadata.channelId === 'string'
          ? metadata.channelId
          : source.channelId;
        const liveStreamId = parseNumericMetadataValue(metadata.streamId);
        const liveTitle = typeof metadata.catchUpLiveFallbackTitle === 'string' &&
          metadata.catchUpLiveFallbackTitle.trim().length > 0
          ? metadata.catchUpLiveFallbackTitle.trim()
          : source.title.split(' - ')[0]?.trim() || source.title;
        const liveMetadata: Record<string, unknown> = {
          mode: 'live',
        };
        if (typeof liveChannelId === 'string') {
          liveMetadata.channelId = liveChannelId;
        }
        if (typeof liveStreamId === 'number') {
          liveMetadata.streamId = Math.floor(liveStreamId);
        }

        clearStartupAutoplayRecovery();
        clearCatchUpStartupTimeout();
        clearCatchUpRuntimeStallMonitor();
        pendingAutoplaySourceUrlRef.current = liveFallbackUrl;
        markCatchUpRuntimeProgress(liveFallbackUrl, 0);
        commands.setSource(
          {
            ...source,
            url: liveFallbackUrl,
            title: liveTitle,
            channelId: liveChannelId,
            metadata: liveMetadata,
          },
          0
        );
        commands.play();
        setError(null);
        setIsLoading(true);
        emitWebObservabilityEvent({
          name: 'catchup.fallback',
          severity: 'warn',
          metadata: {
            ...buildCatchUpEventMetadata(source, {
              attemptIndex: currentAttemptIndex,
              status: 'fallback-live',
              errorCode: signal.errorCode,
              finalUrlHost: signal.finalUrlHost,
              httpStatus: signal.httpStatus,
              contentType: signal.contentType,
              isPlayableForRuntime: signal.isPlayableForRuntime,
              fallbackReason: signal.fallbackReason,
            }),
            renderer: currentSession.renderer,
            fallbackCount: Math.max(0, attempts.length - 1),
            fallbackTarget: 'live',
            fallbackUrl: liveFallbackUrl,
          },
        });
        return true;
      }

      emitWebObservabilityEvent({
        name: 'catchup.fallback',
        severity: 'error',
        metadata: {
          ...buildCatchUpEventMetadata(source, {
            attemptIndex: currentAttemptIndex,
            status: 'exhausted',
            errorCode: signal.errorCode,
            finalUrlHost: signal.finalUrlHost,
            httpStatus: signal.httpStatus,
            contentType: signal.contentType,
            isPlayableForRuntime: signal.isPlayableForRuntime,
            fallbackReason: signal.fallbackReason,
          }),
          renderer: currentSession.renderer,
          fallbackCount: Math.max(0, attempts.length - 1),
        },
      });
      return false;
    }

    const nextAttempt = attempts[nextAttemptIndex];
    const resolvedPreferredFinalHost = typeof metadata.catchUpPreferredFinalHost === 'string'
      ? metadata.catchUpPreferredFinalHost
      : resolveCatchUpHostAffinity(source.url);
    const shouldResetPreferredFinalHost = signal.fallbackReason === 'non_playable_payload' || (
      typeof signal.httpStatus === 'number' && signal.httpStatus >= 400
    );
    const isAffinitySafeForNextAttempt = shouldApplyHostAffinityToAttempt(nextAttempt.url);
    const preferredFinalHost = (shouldResetPreferredFinalHost || !isAffinitySafeForNextAttempt)
      ? null
      : resolvedPreferredFinalHost;
    const fallbackUrl = preferredFinalHost
      ? rewriteCatchUpUrlTargetOrigin(nextAttempt.url, preferredFinalHost)
      : nextAttempt.url;
    const nextAttempts = attempts.map((attempt, index) => (
      index === nextAttemptIndex ? { ...attempt, url: fallbackUrl } : attempt
    ));
    const nextFallbackUrls = nextAttempts
      .slice(1)
      .map((attempt) => attempt.url);

    clearStartupAutoplayRecovery();
    clearCatchUpStartupTimeout();
    clearCatchUpRuntimeStallMonitor();
    pendingAutoplaySourceUrlRef.current = fallbackUrl;
    const runtimeProgressMs = Math.max(
      0,
      Math.floor(catchUpRuntimeProgressRef.current.lastPositionSeconds * 1000),
    );
    const expectedDurationMs = (
      typeof expectedCatchUpDurationSeconds === 'number' &&
      Number.isFinite(expectedCatchUpDurationSeconds) &&
      expectedCatchUpDurationSeconds > 0
    ) ? Math.floor(expectedCatchUpDurationSeconds * 1000) : null;
    const maxResumePositionMs = expectedDurationMs !== null
      ? Math.max(0, expectedDurationMs - 2_000)
      : null;
    const safeResumePositionMs = maxResumePositionMs !== null
      ? Math.min(runtimeProgressMs, maxResumePositionMs)
      : runtimeProgressMs;
    const shouldPreserveCatchUpPosition = (
      metadata.mode === 'catchup' &&
      hasRuntimePlaybackProgress &&
      (
        signal.fallbackReason === 'media_error' ||
        signal.fallbackReason === 'network_error' ||
        signal.fallbackReason === 'playback_error'
      )
    );
    const nextPositionMs = metadata.mode === 'catchup'
      ? (shouldPreserveCatchUpPosition ? safeResumePositionMs : 0)
      : currentSession.positionMs ?? 0;
    markCatchUpRuntimeProgress(fallbackUrl, nextPositionMs / 1000);

    commands.setSource(
      {
        ...source,
        url: fallbackUrl,
        metadata: {
          ...metadata,
          catchUpAttemptPlan: nextAttempts,
          catchUpAttemptIndex: nextAttemptIndex,
          catchUpAttemptStrategy: nextAttempt.strategy,
          catchUpPreferredFinalHost: preferredFinalHost ?? null,
          catchUpStartTimestamp: nextAttempt.startTimestamp,
          catchUpDurationSeconds: nextAttempt.durationSeconds,
          catchUpFallbackUrl: fallbackUrl,
          catchUpFallbackUrls: nextFallbackUrls,
          catchUpFallbackIndex: Math.max(0, nextAttemptIndex - 1),
          catchUpFallbackUsed: true,
          catchUpLastFallbackReason: signal.fallbackReason,
          catchUpLastErrorCode: signal.errorCode,
          catchUpLastHttpStatus: signal.httpStatus,
          catchUpLastContentType: signal.contentType,
          catchUpLastFinalUrlHost: signal.finalUrlHost,
          catchUpLastPlayableForRuntime: signal.isPlayableForRuntime,
          catchUpRuntimePlaybackStarted: hasRuntimePlaybackProgress,
          catchUpResumePositionMs: nextPositionMs,
        },
      },
      nextPositionMs
    );
    commands.play();
    setError(null);
    setIsLoading(true);

    const isFallbackStrategy = isCatchUpFallbackStrategy(nextAttempt.strategy);
    emitWebObservabilityEvent({
      name: isFallbackStrategy ? 'catchup.fallback' : 'catchup.retry',
      severity: 'warn',
        metadata: {
          ...buildCatchUpEventMetadata(source, {
            attemptIndex: nextAttemptIndex,
            status: isFallbackStrategy ? 'fallback' : 'retry',
            errorCode: signal.errorCode,
            finalHost: preferredFinalHost,
            finalUrlHost: signal.finalUrlHost,
            httpStatus: signal.httpStatus,
            contentType: signal.contentType,
            isPlayableForRuntime: signal.isPlayableForRuntime,
            fallbackReason: signal.fallbackReason,
            strategy: nextAttempt.strategy,
          }),
          renderer: currentSession.renderer,
        fallbackIndex: Math.max(0, nextAttemptIndex - 1),
        fallbackCount: Math.max(0, nextAttempts.length - 1),
        offsetMinutes: nextAttempt.offsetMinutes,
        fallbackUrl,
        resumeFromMs: nextPositionMs,
      },
    });
    return true;
  }, [
    clearCatchUpRuntimeStallMonitor,
    clearCatchUpStartupTimeout,
    clearStartupAutoplayRecovery,
    commands,
    markCatchUpRuntimeProgress,
  ]);

  const startCatchUpRuntimeStallMonitor = useCallback(() => {
    if (catchUpRuntimeStallMonitorTimerRef.current !== null) {
      return;
    }

    catchUpRuntimeStallMonitorTimerRef.current = setInterval(() => {
      const currentSession = sessionRef.current;
      const source = currentSession.source;
      const videoElement = videoRef.current;
      if (
        !source ||
        !videoElement ||
        typeof source.metadata !== 'object' ||
        source.metadata === null
      ) {
        return;
      }

      const metadata = source.metadata as Record<string, unknown>;
      if (!shouldApplyCatchUpRuntimeGate(metadata.mode)) {
        return;
      }

      const runtimeSample = {
        readyState: videoElement.readyState,
        currentTime: videoElement.currentTime,
        paused: videoElement.paused,
        videoWidth: videoElement.videoWidth,
        videoHeight: videoElement.videoHeight,
      };
      const currentTime = Number.isFinite(videoElement.currentTime) ? videoElement.currentTime : 0;
      const progress = catchUpRuntimeProgressRef.current;
      if (progress.sourceUrl !== source.url) {
        markCatchUpRuntimeProgress(source.url, currentTime);
        return;
      }

      const runtimePlaybackEstablished = hasRuntimePlaybackStarted(runtimeSample) || (
        progress.lastPositionSeconds > CATCH_UP_RUNTIME_PROGRESS_EPSILON_SECONDS
      );
      if (!runtimePlaybackEstablished) {
        return;
      }

      if (currentTime > progress.lastPositionSeconds + CATCH_UP_RUNTIME_PROGRESS_EPSILON_SECONDS) {
        markCatchUpRuntimeProgress(source.url, currentTime);
        return;
      }

      const stalledDurationMs = Date.now() - progress.lastProgressAtMs;
      if (!shouldTriggerCatchUpRuntimeStallFallback({
        isCatchUpSource: true,
        hasRuntimePlaybackData: runtimePlaybackEstablished,
        isVideoPaused: runtimeSample.paused,
        playbackRequested: sessionWantsPlayback(currentSession),
        stalledDurationMs,
        thresholdMs: progress.lastPositionSeconds > 5.0
          ? CATCH_UP_RUNTIME_POST_START_STALL_THRESHOLD_MS
          : CATCH_UP_RUNTIME_STALL_THRESHOLD_MS,
      })) {
        return;
      }

      const nowMs = Date.now();
      if (
        nowMs - catchUpLastRuntimeStallFallbackAtRef.current <
        CATCH_UP_RUNTIME_STALL_FALLBACK_MIN_INTERVAL_MS
      ) {
        return;
      }
      catchUpLastRuntimeStallFallbackAtRef.current = nowMs;

      const { currentAttemptIndex } = resolveCatchUpAttemptState(metadata, source.url);
      const stallSignal: CatchUpFallbackSignal = {
        errorCode: 'PLAYBACK_STALLED',
        fallbackReason: 'media_error',
        httpStatus: null,
        contentType: null,
        finalUrlHost: resolveUrlHost(source.url),
        isPlayableForRuntime: false,
      };
      emitWebObservabilityEvent({
        name: 'catchup.runtime_gate',
        severity: 'warn',
        metadata: {
          ...buildCatchUpEventMetadata(source, {
            attemptIndex: currentAttemptIndex,
            status: 'stalled',
            errorCode: stallSignal.errorCode,
            finalUrlHost: stallSignal.finalUrlHost,
            httpStatus: stallSignal.httpStatus,
            contentType: stallSignal.contentType,
            isPlayableForRuntime: stallSignal.isPlayableForRuntime,
            fallbackReason: stallSignal.fallbackReason,
          }),
          renderer: currentSession.renderer,
          stalledDurationMs,
          stalledAtSeconds: currentTime,
        },
      });

      switchToCatchUpFallbackIfAvailable(stallSignal);
    }, CATCH_UP_RUNTIME_STALL_CHECK_INTERVAL_MS);
  }, [markCatchUpRuntimeProgress, switchToCatchUpFallbackIfAvailable]);

  const scheduleCatchUpStartupTimeout = useCallback((sourceUrl: string) => {
    clearCatchUpStartupTimeout();
    catchUpStartupTimeoutRef.current = setTimeout(() => {
      catchUpStartupTimeoutRef.current = null;

      const currentSession = sessionRef.current;
      const source = currentSession.source;
      if (
        !source ||
        source.url !== sourceUrl ||
        typeof source.metadata !== 'object' ||
        source.metadata === null ||
        !shouldApplyCatchUpRuntimeGate((source.metadata as Record<string, unknown>).mode)
      ) {
        return;
      }

      if (hasRuntimePlaybackStarted(videoRef.current
        ? {
          readyState: videoRef.current.readyState,
          currentTime: videoRef.current.currentTime,
          paused: videoRef.current.paused,
          videoWidth: videoRef.current.videoWidth,
          videoHeight: videoRef.current.videoHeight,
        }
        : null
      )) {
        return;
      }

      const timeoutSignal: CatchUpFallbackSignal = {
        errorCode: 'LOAD_TIMEOUT',
        fallbackReason: 'timeout',
        httpStatus: null,
        contentType: null,
        finalUrlHost: null,
        isPlayableForRuntime: false,
      };

      if (switchToCatchUpFallbackIfAvailable(timeoutSignal)) {
        return;
      }

      clearStartupAutoplayRecovery();
      pendingAutoplaySourceUrlRef.current = null;
      setIsLoading(false);
      emitWebObservabilityEvent({
        name: 'playback.error',
        severity: 'error',
        metadata: {
          code: timeoutSignal.errorCode,
          fatal: true,
          message: 'Catch-up startup timeout pre prvog frame-a.',
          renderer: sessionRef.current.renderer,
          ...buildCatchUpEventMetadata(source, {
            status: 'error',
            errorCode: timeoutSignal.errorCode,
            finalUrlHost: timeoutSignal.finalUrlHost,
            httpStatus: timeoutSignal.httpStatus,
            contentType: timeoutSignal.contentType,
            isPlayableForRuntime: timeoutSignal.isPlayableForRuntime,
            fallbackReason: timeoutSignal.fallbackReason,
          }),
        },
      });
      setError((prev) => prev ?? {
        type: 'network',
        message: 'Greška u mreži',
        details: 'Catch-up startup timeout pre prvog frame-a.',
      });
      onError?.('Catch-up startup timeout pre prvog frame-a.');
    }, CATCH_UP_STARTUP_TIMEOUT_MS);
  }, [
    clearCatchUpStartupTimeout,
    clearStartupAutoplayRecovery,
    onError,
    switchToCatchUpFallbackIfAvailable,
  ]);

  useImperativeHandle(ref, () => ({
    play: () => adapterRef.current?.play(),
    pause: () => adapterRef.current?.pause(),
    seek: (time: number) => {
      adapterRef.current?.seek(time);
    },
    setVolume: (volume: number) => {
      adapterRef.current?.setVolume(volume);
    },
    setMuted: (muted: boolean) => {
      if (videoRef.current) {
        videoRef.current.muted = muted;
      }
    },
    toggleMute: () => {
      if (videoRef.current) {
        videoRef.current.muted = !videoRef.current.muted;
      }
    },
    getCurrentTime: () => adapterRef.current?.getCurrentTime() || 0,
    getDuration: () => adapterRef.current?.getDuration() || 0,
    isPlaying: () => isPlaying,
    getAudioTracks: () => adapterRef.current?.getAudioTracks?.() || [],
    getSelectedAudioTrackId: () => adapterRef.current?.getSelectedAudioTrackId?.() || null,
    setAudioTrack: (trackId: string) => adapterRef.current?.setAudioTrack?.(trackId) ?? false,
    onAudioTracksChange: (callback) => (
      adapterRef.current?.onAudioTracksChange?.(callback) ?? (() => {})
    ),
    getSubtitleTracks: () => adapterRef.current?.getSubtitleTracks?.() || [],
    getSelectedSubtitleTrackId: () => (
      adapterRef.current?.getSelectedSubtitleTrackId?.() || null
    ),
    setSubtitleTrack: (trackId: string | null) => (
      adapterRef.current?.setSubtitleTrack?.(trackId) ?? false
    ),
    onSubtitleTracksChange: (callback) => (
      adapterRef.current?.onSubtitleTracksChange?.(callback) ?? (() => {})
    ),
    isPictureInPictureSupported: () => isPictureInPictureSupported(),
    isPictureInPicture: () => isPictureInPicture,
    enterPictureInPicture: () => enterPictureInPicture(),
    exitPictureInPicture: () => exitPictureInPicture(),
    togglePictureInPicture: () => togglePictureInPicture(),
    onPictureInPictureChange: (callback) => {
      pictureInPictureListenersRef.current.add(callback);
      callback(isPictureInPicture);
      return () => {
        pictureInPictureListenersRef.current.delete(callback);
      };
    },
    isAirPlaySupported: () => isAirPlaySupported(),
    isAirPlayAvailable: () => isAirPlayAvailable,
    isAirPlayConnected: () => isAirPlayConnected,
    showAirPlayPicker: () => showAirPlayPicker(),
    onAirPlayAvailabilityChange: (callback) => {
      airPlayAvailabilityListenersRef.current.add(callback);
      callback(isAirPlayAvailable);
      return () => {
        airPlayAvailabilityListenersRef.current.delete(callback);
      };
    },
    onAirPlayConnectionChange: (callback) => {
      airPlayConnectionListenersRef.current.add(callback);
      callback(isAirPlayConnected);
      return () => {
        airPlayConnectionListenersRef.current.delete(callback);
      };
    },
  }));

  const mapPlaybackError = useCallback((playbackError: PlaybackError): PlayerError => {
    if (playbackError.code === 'MIXED_CONTENT') {
      return {
        type: 'mixed-content',
        message: 'Nije moguće učitati stream',
        details: 'HTTPS stranica ne može pristupiti HTTP streamu. Koristite HTTPS verziju IPTV servera ili pristupite aplikaciji preko HTTP-a.',
      };
    }

    if (playbackError.code === 'NETWORK_ERROR') {
      return {
        type: 'network',
        message: 'Greška u mreži',
        details: 'Proverite internet konekciju i dostupnost servera.',
      };
    }

    if (playbackError.code === 'MEDIA_ERROR' || playbackError.code === 'HLS_NOT_SUPPORTED') {
      return {
        type: 'format',
        message: 'Format streama nije podržan',
        details: playbackError.message,
      };
    }

    return {
      type: 'unknown',
      message: 'Greška pri reprodukciji',
      details: playbackError.message,
    };
  }, []);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) {
      return;
    }

    const adapter = new HlsPlayerAdapter(video, {
      preferNativeHls,
      rewriteRequestUrl: (requestUrl) => {
        const source = sessionRef.current.source;
        if (
          !source ||
          typeof source.metadata !== 'object' ||
          source.metadata === null
        ) {
          return requestUrl;
        }

        const metadata = source.metadata as Record<string, unknown>;
        if (!source.url.includes('/xui-api/')) {
          return requestUrl;
        }

        const directProxyRewrite = toCatchUpProxyUrl(requestUrl);
        if (directProxyRewrite !== requestUrl) {
          return directProxyRewrite;
        }

        if (typeof window === 'undefined') {
          return requestUrl;
        }

        let parsedRequestUrl: URL;
        try {
          parsedRequestUrl = new URL(requestUrl, window.location.origin);
        } catch {
          return requestUrl;
        }

        if (
          parsedRequestUrl.origin !== window.location.origin ||
          parsedRequestUrl.pathname.startsWith('/xui-api/')
        ) {
          return requestUrl;
        }

        const isCatchUpSegmentPath = (
          parsedRequestUrl.pathname.startsWith('/streaming/') ||
          parsedRequestUrl.pathname.startsWith('/timeshift/') ||
          parsedRequestUrl.pathname.startsWith('/hlsr/')
        );
        if (!isCatchUpSegmentPath) {
          return requestUrl;
        }

        const preferredTargetOrigin = resolveCatchUpHostAffinity(source.url) ??
          resolveCatchUpTargetOrigin(source.url);
        if (!preferredTargetOrigin) {
          return requestUrl;
        }

        const preferredTargetUrl = new URL(
          `${parsedRequestUrl.pathname}${parsedRequestUrl.search}${parsedRequestUrl.hash}`,
          preferredTargetOrigin,
        );
        return toCatchUpProxyUrl(preferredTargetUrl.toString());
      },
      onManifestResolved: ({
        requestedUrl,
        manifestUrl,
        finalUrl,
        httpStatus,
        contentType,
      }): ManifestRuntimeGateDecision | void => {
        const source = sessionRef.current.source;
        if (!source) {
          return;
        }

        const finalManifestUrl = finalUrl ?? manifestUrl;
        rememberCatchUpHostAffinity(requestedUrl, finalManifestUrl);
        if (source.url !== requestedUrl) {
          rememberCatchUpHostAffinity(source.url, finalManifestUrl);
        }

        if (
          typeof source.metadata !== 'object' ||
          source.metadata === null
        ) {
          return;
        }

        const metadata = source.metadata as Record<string, unknown>;
        if (!shouldApplyCatchUpRuntimeGate(metadata.mode)) {
          return;
        }

        const gateDecision = evaluateCatchUpRuntimePayload({
          requestedUrl,
          manifestUrl,
          finalUrl,
          httpStatus,
          contentType,
        });
        const finalResponseUrl = finalUrl ?? manifestUrl;
        const requestHost = resolveCatchUpTargetOrigin(requestedUrl);
        const finalHostFromResponse = resolveCatchUpTargetOrigin(finalResponseUrl);
        const finalHost = typeof finalUrl === 'string'
          ? (
            rememberCatchUpHostAffinity(requestedUrl, finalUrl) ??
            finalHostFromResponse
          )
          : finalHostFromResponse;
        const finalUrlHost = resolveUrlHost(finalResponseUrl);
        const { currentAttemptIndex } = resolveCatchUpAttemptState(metadata, source.url);

        emitWebObservabilityEvent({
          name: 'catchup.runtime_gate',
          severity: gateDecision.isPlayableForRuntime ? 'info' : 'warn',
          metadata: {
            ...buildCatchUpEventMetadata(source, {
              attemptIndex: currentAttemptIndex,
              status: gateDecision.isPlayableForRuntime ? 'accepted' : 'rejected',
              errorCode: gateDecision.isPlayableForRuntime ? null : 'NON_PLAYABLE_PAYLOAD',
              finalHost,
              finalUrlHost,
              httpStatus,
              contentType: gateDecision.contentType,
              isPlayableForRuntime: gateDecision.isPlayableForRuntime,
              fallbackReason: gateDecision.fallbackReason,
            }),
            requestHost,
            finalHost,
            requestUrl: requestedUrl,
            manifestUrl,
            finalUrl,
          },
        });

        if (!gateDecision.isPlayableForRuntime) {
          return gateDecision;
        }

        if (!requestHost || !finalHost || requestHost === finalHost) {
          return;
        }

        emitWebObservabilityEvent({
          name: 'catchup.redirect',
          severity: 'info',
          metadata: {
            ...buildCatchUpEventMetadata(source, {
              attemptIndex: currentAttemptIndex,
              status: 'redirect',
              errorCode: null,
              finalHost,
              finalUrlHost,
              httpStatus,
              contentType: gateDecision.contentType,
              isPlayableForRuntime: gateDecision.isPlayableForRuntime,
              fallbackReason: gateDecision.fallbackReason,
            }),
            requestHost,
            finalHost,
            requestUrl: requestedUrl,
            manifestUrl,
            finalUrl,
          },
        });
      },
    });
    adapterRef.current = adapter;

    const unsubscribeState = adapter.onStateChange((state) => {
      const currentSession = sessionRef.current;

      if (state === 'loading' || state === 'buffering') {
        setIsLoading(true);
      }

      if (state === 'playing') {
        const videoElement = videoRef.current;
        const runtimePlaybackSample = videoElement
          ? {
            readyState: videoElement.readyState,
            currentTime: videoElement.currentTime,
            paused: videoElement.paused,
            videoWidth: videoElement.videoWidth,
            videoHeight: videoElement.videoHeight,
          }
          : null;
        const hasRuntimePlaybackData = hasRuntimePlaybackStarted(runtimePlaybackSample);
        if (!hasRuntimePlaybackData) {
          setIsLoading(true);
          return;
        }

        clearStartupAutoplayRecovery();
        const sourceMetadata = currentSession.source?.metadata;
        const isCatchUpSource = typeof sourceMetadata === 'object' &&
          sourceMetadata !== null &&
          shouldApplyCatchUpRuntimeGate((sourceMetadata as Record<string, unknown>).mode);
        clearCatchUpStartupTimeout();
        pendingAutoplaySourceUrlRef.current = null;
        setError(null);
        setIsPlaying(true);
        setIsLoading(false);
        markCatchUpRuntimeProgress(
          currentSession.source?.url ?? null,
          runtimePlaybackSample?.currentTime ?? 0
        );
        catchUpPreStartNetworkErrorRef.current = {
          sourceUrl: currentSession.source?.url ?? null,
          count: 0,
        };
        onCanPlay?.();

        const sourceUrl = sessionRef.current.source?.url ?? null;
        if (sourceUrl && sourceUrl !== lastStartedSourceRef.current) {
          lastStartedSourceRef.current = sourceUrl;
          emitWebObservabilityEvent({
            name: 'playback.started',
            severity: 'info',
            metadata: {
              renderer: sessionRef.current.renderer,
              sourceType: sessionRef.current.source?.type ?? 'unknown',
            },
          });
        }

        if (!sessionWantsPlayback(currentSession)) {
          commands.play();
        }
        return;
      }

      if (state === 'paused') {
        if (shouldHoldPauseSyncOnSourceStartup(
          currentSession,
          pendingAutoplaySourceUrlRef.current
        )) {
          if (
            shouldRetryPendingAutoplayAfterPausedEvent(
              currentSession,
              pendingAutoplaySourceUrlRef.current,
              startupAutoplayRecoveryAttemptsRef.current,
              STARTUP_AUTOPLAY_RECOVERY_MAX_RETRIES
            )
          ) {
            if (startupAutoplayRecoveryTimerRef.current !== null) {
              clearTimeout(startupAutoplayRecoveryTimerRef.current);
            }

            startupAutoplayRecoveryAttemptsRef.current += 1;
            const retryDelayMs =
              STARTUP_AUTOPLAY_RECOVERY_BASE_DELAY_MS * startupAutoplayRecoveryAttemptsRef.current;
            startupAutoplayRecoveryTimerRef.current = setTimeout(() => {
              startupAutoplayRecoveryTimerRef.current = null;
              const nextSession = sessionRef.current;
              if (
                shouldHoldPauseSyncOnSourceStartup(
                  nextSession,
                  pendingAutoplaySourceUrlRef.current
                )
              ) {
                adapterRef.current?.play();
              }
            }, retryDelayMs);
            return;
          }

          clearStartupAutoplayRecovery();
          pendingAutoplaySourceUrlRef.current = null;
          setIsPlaying(false);
          setIsLoading(false);
          if (currentSession.source && sessionWantsPlayback(currentSession)) {
            commands.pause();
          }
          return;
        }

        setIsPlaying(false);
        setIsLoading(false);

        if (currentSession.source && sessionWantsPlayback(currentSession)) {
          setIsLoading(true);
          adapterRef.current?.play();
        }
        return;
      }

      if (state === 'ended') {
        clearStartupAutoplayRecovery();
        clearCatchUpStartupTimeout();
        pendingAutoplaySourceUrlRef.current = null;
        setIsPlaying(false);
        setIsLoading(false);
        onEnded?.();
        return;
      }

      if (state === 'idle') {
        clearStartupAutoplayRecovery();
        clearCatchUpStartupTimeout();
        if (!shouldKeepPendingAutoplayOnIdle(
          currentSession,
          pendingAutoplaySourceUrlRef.current
        )) {
          pendingAutoplaySourceUrlRef.current = null;
        }
        setIsPlaying(false);
        setIsLoading(false);
      }
    });

    const unsubscribeError = adapter.onError((playbackError) => {
      const catchUpFallbackSignal = createCatchUpFallbackSignalFromPlaybackError(playbackError);
      const sourceMetadata = sessionRef.current.source?.metadata;
      const isCatchUpSource = typeof sourceMetadata === 'object' &&
        sourceMetadata !== null &&
        shouldApplyCatchUpRuntimeGate((sourceMetadata as Record<string, unknown>).mode);
      const hasRuntimePlaybackData = hasRuntimePlaybackStarted(videoRef.current
        ? {
          readyState: videoRef.current.readyState,
          currentTime: videoRef.current.currentTime,
          paused: videoRef.current.paused,
          videoWidth: videoRef.current.videoWidth,
          videoHeight: videoRef.current.videoHeight,
        }
        : null
      );
      const currentSourceUrl = sessionRef.current.source?.url ?? null;
      const runtimeProgress = catchUpRuntimeProgressRef.current;
      const hasRuntimeProgressForCurrentSource = (
        currentSourceUrl !== null &&
        runtimeProgress.sourceUrl === currentSourceUrl &&
        runtimeProgress.lastPositionSeconds >= CATCH_UP_DECODE_ERROR_MIN_PROGRESS_SECONDS
      );
      const decodeBurstDecision = evaluateCatchUpDecodeErrorBurst({
        tracker: catchUpDecodeErrorBurstRef.current,
        isCatchUpSource,
        playbackErrorCode: playbackError.code,
        hasRuntimeProgressForCurrentSource,
        currentSourceUrl,
        nowMs: Date.now(),
        windowMs: CATCH_UP_DECODE_ERROR_BURST_WINDOW_MS,
        threshold: CATCH_UP_DECODE_ERROR_BURST_THRESHOLD,
      });
      catchUpDecodeErrorBurstRef.current = decodeBurstDecision.tracker;
      let allowDecodeErrorBurstFallback = decodeBurstDecision.shouldFallback;
      let allowNetworkFallback = false;
      if (
        isCatchUpSource &&
        (playbackError.code === 'NETWORK_ERROR' || playbackError.code === 'HLS_ERROR')
      ) {
        if (catchUpPreStartNetworkErrorRef.current.sourceUrl !== currentSourceUrl) {
          catchUpPreStartNetworkErrorRef.current = {
            sourceUrl: currentSourceUrl,
            count: 1,
          };
        } else {
          catchUpPreStartNetworkErrorRef.current.count += 1;
        }

        const hasRuntimeProgress = hasRuntimePlaybackData || hasRuntimeProgressForCurrentSource;
        const isUnauthorizedRuntimeError = (
          hasRuntimeProgress &&
          catchUpFallbackSignal.httpStatus === 401
        );

        if (isUnauthorizedRuntimeError) {
          allowNetworkFallback = true;
        } else if (!hasRuntimePlaybackData) {
          allowNetworkFallback =
            catchUpPreStartNetworkErrorRef.current.count >= CATCH_UP_PRESTART_NETWORK_ERROR_THRESHOLD;
        }

        if (allowNetworkFallback) {
          const nowMs = Date.now();
          if (nowMs - catchUpLastNetworkFallbackAtRef.current < CATCH_UP_NETWORK_FALLBACK_MIN_INTERVAL_MS) {
            allowNetworkFallback = false;
          } else {
            catchUpLastNetworkFallbackAtRef.current = nowMs;
          }
        }
      } else {
        catchUpPreStartNetworkErrorRef.current = {
          sourceUrl: sessionRef.current.source?.url ?? null,
          count: 0,
        };
      }

      if (allowDecodeErrorBurstFallback) {
        const nowMs = Date.now();
        if (
          nowMs - catchUpLastRuntimeStallFallbackAtRef.current <
          CATCH_UP_RUNTIME_STALL_FALLBACK_MIN_INTERVAL_MS
        ) {
          allowDecodeErrorBurstFallback = false;
        } else {
          catchUpLastRuntimeStallFallbackAtRef.current = nowMs;
        }
      }

      if (allowDecodeErrorBurstFallback) {
        emitWebObservabilityEvent({
          name: 'catchup.runtime_gate',
          severity: 'warn',
          metadata: {
            ...buildCatchUpEventMetadata(sessionRef.current.source, {
              status: 'decode_error_burst',
              errorCode: playbackError.code,
              finalUrlHost: catchUpFallbackSignal.finalUrlHost,
              httpStatus: catchUpFallbackSignal.httpStatus,
              contentType: catchUpFallbackSignal.contentType,
              isPlayableForRuntime: catchUpFallbackSignal.isPlayableForRuntime,
              fallbackReason: catchUpFallbackSignal.fallbackReason,
            }),
            renderer: sessionRef.current.renderer,
            decodeErrorBurstCount: catchUpDecodeErrorBurstRef.current.count,
            runtimeProgressSeconds: runtimeProgress.lastPositionSeconds,
          },
        });

        if (switchToCatchUpFallbackIfAvailable(catchUpFallbackSignal)) {
          return;
        }
      }

      if (shouldAttemptCatchUpFallback(playbackError, catchUpFallbackSignal, {
        isCatchUpSource,
        hasRuntimePlaybackData,
        allowNetworkFallback,
      }) && switchToCatchUpFallbackIfAvailable(catchUpFallbackSignal)) {
        return;
      }

      const shouldKeepCatchUpStartupTimeout = isCatchUpSource;

      clearStartupAutoplayRecovery();
      if (!shouldKeepCatchUpStartupTimeout) {
        clearCatchUpStartupTimeout();
      }
      if (shouldClearPendingAutoplayOnPlaybackError(playbackError)) {
        pendingAutoplaySourceUrlRef.current = null;
      }
      if (shouldShowBlockingPlaybackError(playbackError)) {
        setError(mapPlaybackError(playbackError));
      }
      setIsLoading(false);
      emitWebObservabilityEvent({
        name: 'playback.error',
        severity: playbackError.fatal ? 'error' : 'warn',
        metadata: {
          code: playbackError.code,
          fatal: playbackError.fatal,
          message: playbackError.message,
          renderer: sessionRef.current.renderer,
          ...buildCatchUpEventMetadata(sessionRef.current.source, {
            status: 'error',
            errorCode: playbackError.code,
            finalUrlHost: catchUpFallbackSignal.finalUrlHost,
            httpStatus: catchUpFallbackSignal.httpStatus,
            contentType: catchUpFallbackSignal.contentType,
            isPlayableForRuntime: catchUpFallbackSignal.isPlayableForRuntime,
            fallbackReason: catchUpFallbackSignal.fallbackReason,
          }),
        },
      });
      onError?.(playbackError.message);
    });

    const unsubscribeTime = adapter.onTimeUpdate((time) => {
      const currentSession = sessionRef.current;
      if (!currentSession.source) {
        return;
      }

      const currentPositionMs = Math.floor(time * 1000);
      const sourceMetadata = currentSession.source?.metadata;
      const isCatchUpSource = typeof sourceMetadata === 'object' &&
        sourceMetadata !== null &&
        shouldApplyCatchUpRuntimeGate((sourceMetadata as Record<string, unknown>).mode);
      const hasRuntimePlaybackData = hasRuntimePlaybackStarted(videoRef.current
        ? {
          readyState: videoRef.current.readyState,
          currentTime: videoRef.current.currentTime,
          paused: videoRef.current.paused,
          videoWidth: videoRef.current.videoWidth,
          videoHeight: videoRef.current.videoHeight,
        }
        : null
      );
      if (isCatchUpSource && hasRuntimePlaybackData) {
        clearCatchUpStartupTimeout();
        catchUpPreStartNetworkErrorRef.current = {
          sourceUrl: currentSession.source?.url ?? null,
          count: 0,
        };
        markCatchUpRuntimeProgress(currentSession.source?.url ?? null, time);
      }

      if (isApplyingSessionSeekRef.current) {
        if (
          currentSession.positionMs === null ||
          Math.abs(currentPositionMs - currentSession.positionMs) < 500
        ) {
          isApplyingSessionSeekRef.current = false;
        }
        return;
      }

      const lastReportedPositionMs = lastReportedPositionMsRef.current;
      if (
        lastReportedPositionMs !== null &&
        Math.abs(currentPositionMs - lastReportedPositionMs) < 1000
      ) {
        return;
      }

      if (
        currentSession.positionMs !== null &&
        Math.abs(currentPositionMs - currentSession.positionMs) < 1000
      ) {
        return;
      }
      if (!hasRuntimePlaybackData) {
        return;
      }

      lastReportedPositionMsRef.current = currentPositionMs;
      commands.seek(currentPositionMs);
    });

    startCatchUpRuntimeStallMonitor();

    return () => {
      unsubscribeState();
      unsubscribeError();
      unsubscribeTime();
      clearStartupAutoplayRecovery();
      clearCatchUpStartupTimeout();
      clearCatchUpRuntimeStallMonitor();
      adapter.destroy();
      if (adapterRef.current === adapter) {
        adapterRef.current = null;
      }
    };
  }, [
    clearStartupAutoplayRecovery,
    clearCatchUpStartupTimeout,
    clearCatchUpRuntimeStallMonitor,
    commands,
    markCatchUpRuntimeProgress,
    mapPlaybackError,
    onCanPlay,
    onEnded,
    onError,
    preferNativeHls,
    shouldAttemptCatchUpFallback,
    startCatchUpRuntimeStallMonitor,
    switchToCatchUpFallbackIfAvailable,
  ]);

  useEffect(() => {
    const adapter = adapterRef.current;
    if (!adapter) {
      return;
    }

    isApplyingSessionSeekRef.current = false;
    lastReportedPositionMsRef.current = null;

    if (!src || !isLocalRenderer) {
      void exitPictureInPicture();
      clearStartupAutoplayRecovery();
      clearCatchUpStartupTimeout();
      clearCatchUpRuntimeStallMonitor();
      pendingAutoplaySourceUrlRef.current = null;
      markCatchUpRuntimeProgress(null, 0);
      setError(null);
      setIsLoading(false);
      setIsPlaying(false);
      adapter.stop();
      return;
    }

    let cancelled = false;
    setError(null);
    setIsLoading(true);
    clearStartupAutoplayRecovery();
    clearCatchUpStartupTimeout();
    startCatchUpRuntimeStallMonitor();
    const existingRuntimeProgress = catchUpRuntimeProgressRef.current;
    const initialCatchUpPositionSeconds = (
      existingRuntimeProgress.sourceUrl === src &&
      existingRuntimeProgress.lastPositionSeconds > CATCH_UP_RUNTIME_PROGRESS_EPSILON_SECONDS
    ) ? existingRuntimeProgress.lastPositionSeconds : 0;
    markCatchUpRuntimeProgress(src, initialCatchUpPositionSeconds);
    lastStartedSourceRef.current = null;
    pendingAutoplaySourceUrlRef.current = autoPlay && sessionWantsPlayback(sessionRef.current)
      ? src
      : null;

    const loadSource = async () => {
      const source = sessionRef.current.source;
      if (
        source &&
        typeof source.metadata === 'object' &&
        source.metadata !== null &&
        shouldApplyCatchUpRuntimeGate((source.metadata as Record<string, unknown>).mode)
      ) {
        scheduleCatchUpStartupTimeout(src);
        const metadata = source.metadata as Record<string, unknown>;
        const probeResult = await probeCatchUpRuntimePayload(src);
        if (cancelled) {
          return;
        }

        if (probeResult) {
          const gateDecision = evaluateCatchUpRuntimePayload({
            requestedUrl: src,
            manifestUrl: src,
            finalUrl: probeResult.finalUrl,
            httpStatus: probeResult.httpStatus,
            contentType: probeResult.contentType,
          });

          if (!gateDecision.isPlayableForRuntime) {
            const { currentAttemptIndex } = resolveCatchUpAttemptState(metadata, source.url);
            const finalResponseUrl = probeResult.finalUrl ?? src;
            const finalHost = resolveCatchUpTargetOrigin(finalResponseUrl);
            const finalUrlHost = resolveUrlHost(finalResponseUrl);
            const probeFallbackSignal: CatchUpFallbackSignal = {
              errorCode: 'NON_PLAYABLE_PAYLOAD',
              fallbackReason: gateDecision.fallbackReason ?? 'non_playable_payload',
              httpStatus: probeResult.httpStatus,
              contentType: gateDecision.contentType,
              finalUrlHost,
              isPlayableForRuntime: false,
            };

            emitWebObservabilityEvent({
              name: 'catchup.runtime_gate',
              severity: 'warn',
              metadata: {
                ...buildCatchUpEventMetadata(source, {
                  attemptIndex: currentAttemptIndex,
                  status: 'probe_rejected',
                  errorCode: probeFallbackSignal.errorCode,
                  finalHost,
                  finalUrlHost: probeFallbackSignal.finalUrlHost,
                  httpStatus: probeFallbackSignal.httpStatus,
                  contentType: probeFallbackSignal.contentType,
                  isPlayableForRuntime: probeFallbackSignal.isPlayableForRuntime,
                  fallbackReason: probeFallbackSignal.fallbackReason,
                }),
                requestUrl: src,
                manifestUrl: src,
                finalUrl: probeResult.finalUrl,
              },
            });

            if (switchToCatchUpFallbackIfAvailable(probeFallbackSignal)) {
              return;
            }

            setIsLoading(false);
            clearCatchUpStartupTimeout();
            clearStartupAutoplayRecovery();
            pendingAutoplaySourceUrlRef.current = null;
            emitWebObservabilityEvent({
              name: 'playback.error',
              severity: 'error',
              metadata: {
                code: probeFallbackSignal.errorCode,
                fatal: true,
                message: 'Catch-up payload nije HLS playlist za browser runtime.',
                renderer: sessionRef.current.renderer,
                ...buildCatchUpEventMetadata(sessionRef.current.source, {
                  status: 'error',
                  errorCode: probeFallbackSignal.errorCode,
                  finalHost,
                  finalUrlHost: probeFallbackSignal.finalUrlHost,
                  httpStatus: probeFallbackSignal.httpStatus,
                  contentType: probeFallbackSignal.contentType,
                  isPlayableForRuntime: probeFallbackSignal.isPlayableForRuntime,
                  fallbackReason: probeFallbackSignal.fallbackReason,
                }),
              },
            });
            setError((prev) => prev ?? {
              type: 'format',
              message: 'Format streama nije podržan',
              details: 'Catch-up payload nije HLS playlist za browser runtime.',
            });
            onError?.('Catch-up payload nije HLS playlist za browser runtime.');
            return;
          }
        }
      }

      try {
        await adapter.load({
          url: src,
          type: sourceType,
        });
        if (cancelled) {
          return;
        }

        setIsLoading(false);
        onCanPlay?.();
        if (autoPlay && sessionWantsPlayback(sessionRef.current)) {
          adapter.play();
        }
      } catch (loadError: unknown) {
        if (cancelled) {
          return;
        }

        const catchUpFallbackSignal = createCatchUpFallbackSignalFromLoadError(loadError);
        const message = loadError instanceof Error ? loadError.message : 'Neuspešno učitavanje streama';
        if (switchToCatchUpFallbackIfAvailable(catchUpFallbackSignal)) {
          return;
        }

        setIsLoading(false);
        clearCatchUpStartupTimeout();
        clearStartupAutoplayRecovery();
        pendingAutoplaySourceUrlRef.current = null;
        emitWebObservabilityEvent({
          name: 'playback.error',
          severity: 'error',
          metadata: {
            code: catchUpFallbackSignal.errorCode,
            fatal: true,
            message,
            renderer: sessionRef.current.renderer,
            ...buildCatchUpEventMetadata(sessionRef.current.source, {
              status: 'error',
              errorCode: catchUpFallbackSignal.errorCode,
              finalUrlHost: catchUpFallbackSignal.finalUrlHost,
              httpStatus: catchUpFallbackSignal.httpStatus,
              contentType: catchUpFallbackSignal.contentType,
              isPlayableForRuntime: catchUpFallbackSignal.isPlayableForRuntime,
              fallbackReason: catchUpFallbackSignal.fallbackReason,
            }),
          },
        });
        setError((prev) => prev ?? {
          type: 'unknown',
          message: 'Nije moguće učitati stream',
          details: message,
        });
        onError?.(message);
      }
    };

    void loadSource();

    return () => {
      cancelled = true;
      clearCatchUpStartupTimeout();
    };
  }, [
    autoPlay,
    clearStartupAutoplayRecovery,
    clearCatchUpStartupTimeout,
    clearCatchUpRuntimeStallMonitor,
    exitPictureInPicture,
    isLocalRenderer,
    markCatchUpRuntimeProgress,
    onCanPlay,
    onError,
    scheduleCatchUpStartupTimeout,
    sourceType,
    startCatchUpRuntimeStallMonitor,
    src,
    switchToCatchUpFallbackIfAvailable,
  ]);

  useEffect(() => {
    const adapter = adapterRef.current;
    if (!adapter || !session.source || session.positionMs === null) {
      return;
    }

    const targetTime = session.positionMs / 1000;
    const currentTime = adapter.getCurrentTime();
    if (Math.abs(currentTime - targetTime) < 1) {
      return;
    }

    isApplyingSessionSeekRef.current = true;
    adapter.seek(targetTime);
  }, [session.positionMs, session.source]);

  useEffect(() => {
    const adapter = adapterRef.current;
    if (!adapter) {
      return;
    }

    if (!session.source || !isLocalRenderer) {
      adapter.pause();
      return;
    }

    if (playbackWantsPlaying) {
      if (adapter.getState() === 'loading') {
        return;
      }
      adapter.play();
      return;
    }

    adapter.pause();
  }, [isLocalRenderer, playbackWantsPlaying, session.source]);

  useEffect(() => {
    const video = videoRef.current as WebKitPictureInPictureVideoElement | null;
    if (!video) {
      return;
    }

    let wasInPictureInPicture = isVideoInPictureInPicture(video);
    const updatePictureInPictureState = () => {
      const isInPictureInPicture = isVideoInPictureInPicture(video);
      const didExitPictureInPicture = wasInPictureInPicture && !isInPictureInPicture;
      wasInPictureInPicture = isInPictureInPicture;
      setIsPictureInPicture(isInPictureInPicture);

      if (
        didExitPictureInPicture &&
        shouldResumePlaybackAfterPictureInPictureExit(sessionRef.current, video.paused)
      ) {
        adapterRef.current?.play();
        commands.play();
      }
    };

    updatePictureInPictureState();
    video.addEventListener('enterpictureinpicture', updatePictureInPictureState);
    video.addEventListener('leavepictureinpicture', updatePictureInPictureState);
    video.addEventListener('webkitpresentationmodechanged', updatePictureInPictureState);

    return () => {
      video.removeEventListener('enterpictureinpicture', updatePictureInPictureState);
      video.removeEventListener('leavepictureinpicture', updatePictureInPictureState);
      video.removeEventListener('webkitpresentationmodechanged', updatePictureInPictureState);
    };
  }, [commands]);

  useEffect(() => {
    const video = videoRef.current as WebKitAirPlayVideoElement | null;
    if (!video) {
      return;
    }

    const syncAirPlayState = () => {
      if (!canUseAirPlayPicker(video)) {
        setIsAirPlayAvailable(false);
        setIsAirPlayConnected(false);
        return;
      }

      setIsAirPlayAvailable(isAirPlayDeviceAvailable(video));
      setIsAirPlayConnected(isAirPlayDeviceConnected(video));
    };

    const handleTargetAvailabilityChange = (
      event: Event & { availability?: AirPlayAvailability }
    ) => {
      if (event.availability === 'available') {
        setIsAirPlayAvailable(true);
        return;
      }

      if (event.availability === 'not-available') {
        setIsAirPlayAvailable(false);
        return;
      }

      syncAirPlayState();
    };

    const handleWirelessTargetChange = () => {
      syncAirPlayState();
    };

    syncAirPlayState();
    video.addEventListener(
      'webkitplaybacktargetavailabilitychanged',
      handleTargetAvailabilityChange as EventListener
    );
    video.addEventListener(
      'webkitcurrentplaybacktargetiswirelesschanged',
      handleWirelessTargetChange
    );

    return () => {
      video.removeEventListener(
        'webkitplaybacktargetavailabilitychanged',
        handleTargetAvailabilityChange as EventListener
      );
      video.removeEventListener(
        'webkitcurrentplaybacktargetiswirelesschanged',
        handleWirelessTargetChange
      );
    };
  }, []);

  const ErrorDisplay = ({ error }: { error: PlayerError }) => {
    const Icon = error.type === 'mixed-content' ? ShieldAlert
      : error.type === 'network' ? WifiOff
      : AlertCircle;

    return (
      <div className="absolute inset-0 flex flex-col items-center justify-center bg-background/90 backdrop-blur-sm z-10">
        <div className="flex flex-col items-center gap-3 p-6 max-w-md text-center">
          <div className="w-16 h-16 rounded-full bg-destructive/10 flex items-center justify-center">
            <Icon className="w-8 h-8 text-destructive" />
          </div>
          <h3 className="text-lg font-semibold text-foreground">{error.message}</h3>
          {error.details && (
            <p className="text-sm text-muted-foreground">{error.details}</p>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className={`relative w-full h-full bg-black ${className}`}>
      <video
        ref={videoRef}
        poster={poster}
        playsInline
        className="w-full h-full object-contain"
      />

      {isLoading && isLoadingOverlayVisible && !error && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/50 z-10">
          <Loader2 className="w-12 h-12 text-primary animate-spin" />
        </div>
      )}

      {error && <ErrorDisplay error={error} />}
    </div>
  );
});

VideoPlayer.displayName = 'VideoPlayer';

export default VideoPlayer;
