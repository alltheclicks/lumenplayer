import { useRef, useEffect, useState, useCallback, forwardRef, useImperativeHandle } from 'react';
import { AlertCircle, Loader2, WifiOff, ShieldAlert } from 'lucide-react';
import { useSessionContext } from '@/context/session-context';
import { HlsPlayerAdapter, ManifestRuntimeGateError } from '@/adapters/HlsPlayerAdapter';
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
  rewriteCatchUpUrlTargetOrigin,
  type CatchUpTransportAttempt,
} from './catchupTransport';
import {
  evaluateCatchUpRuntimePayload,
  normalizeContentType,
} from './catchupRuntimeGate';
import {
  shouldKeepPendingAutoplayOnIdle,
  shouldClearPendingAutoplayOnPlaybackError,
  sessionWantsPlayback,
  shouldShowBlockingPlaybackError,
  shouldHoldPauseSyncOnSourceStartup,
  shouldRetryPendingAutoplayAfterPausedEvent,
  shouldResumePlaybackAfterPictureInPictureExit,
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
const CATCH_UP_FALLBACK_POSITION_GUARD_MS = 15_000;
const CATCH_UP_FALLBACK_ERROR_CODES = new Set([
  'NETWORK_ERROR',
  'MEDIA_ERROR',
  'HLS_ERROR',
  'LOAD_FAILED',
]);

interface ParsedCatchUpAttemptState {
  attempts: CatchUpTransportAttempt[];
  currentAttemptIndex: number;
}

interface CatchUpFallbackContext {
  errorCode: string;
  responseContentType?: string | null;
  rejectionReason?: string | null;
  finalHost?: string | null;
}

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

const parseCatchUpPlaybackErrorDetails = (details: unknown): {
  responseContentType: string | null;
  rejectionReason: string | null;
} => {
  if (!details || typeof details !== 'object') {
    return {
      responseContentType: null,
      rejectionReason: null,
    };
  }

  const parsedDetails = details as Record<string, unknown>;
  const responseContentType = normalizeContentType(
    typeof parsedDetails.contentType === 'string' ? parsedDetails.contentType : null,
  );
  const rejectionReason = typeof parsedDetails.fallbackReason === 'string'
    ? parsedDetails.fallbackReason
    : typeof parsedDetails.rejectionReason === 'string'
      ? parsedDetails.rejectionReason
      : null;

  return {
    responseContentType,
    rejectionReason,
  };
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
    strategy?: string | null;
  },
): Record<string, unknown> => {
  if (!source || typeof source.metadata !== 'object' || source.metadata === null) {
    return {
      status: options.status,
      errorCode: options.errorCode,
      finalHost: options.finalHost ?? null,
    };
  }

  const metadata = source.metadata as Record<string, unknown>;
  if (metadata.mode !== 'catchup') {
    return {
      status: options.status,
      errorCode: options.errorCode,
      finalHost: options.finalHost ?? null,
    };
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

  return {
    streamId: streamId ?? null,
    start: start ?? null,
    duration: duration ?? null,
    attempt: safeAttemptIndex + 1,
    status: options.status,
    finalHost: finalHost ?? null,
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
  const catchUpStartupTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hasCatchUpPlaybackStartedRef = useRef(false);
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

  const clearStartupAutoplayRecovery = useCallback(() => {
    if (startupAutoplayRecoveryTimerRef.current !== null) {
      clearTimeout(startupAutoplayRecoveryTimerRef.current);
      startupAutoplayRecoveryTimerRef.current = null;
    }
    startupAutoplayRecoveryAttemptsRef.current = 0;
  }, []);

  const clearCatchUpStartupTimer = useCallback(() => {
    if (catchUpStartupTimerRef.current !== null) {
      clearTimeout(catchUpStartupTimerRef.current);
      catchUpStartupTimerRef.current = null;
    }
  }, []);

  const shouldAttemptCatchUpFallback = useCallback((playbackError: PlaybackError): boolean => {
    if (playbackError.fatal) {
      if (playbackError.code.startsWith('MEDIA_ELEMENT_')) {
        // Media element code 4 appears during source transitions and causes
        // aggressive fallback loops before HLS reports a real network failure.
        return false;
      }

      return CATCH_UP_FALLBACK_ERROR_CODES.has(playbackError.code);
    }

    // Non-fatal play() rejections happen during source transitions and should not
    // consume catch-up fallback candidates.
    return false;
  }, []);

  const switchToCatchUpFallbackIfAvailable = useCallback((context: CatchUpFallbackContext): boolean => {
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
    if (attempts.length <= 1) {
      return false;
    }

    let nextAttemptIndex = currentAttemptIndex + 1;
    while (
      nextAttemptIndex < attempts.length &&
      attempts[nextAttemptIndex]?.url === source.url
    ) {
      nextAttemptIndex += 1;
    }
    if (nextAttemptIndex >= attempts.length) {
      emitWebObservabilityEvent({
        name: 'catchup.fallback',
        severity: 'error',
        metadata: {
          ...buildCatchUpEventMetadata(source, {
            attemptIndex: currentAttemptIndex,
            status: 'exhausted',
            errorCode: context.errorCode,
          }),
          renderer: currentSession.renderer,
          fallbackCount: Math.max(0, attempts.length - 1),
          responseContentType: context.responseContentType ?? null,
          rejectionReason: context.rejectionReason ?? null,
        },
      });
      return false;
    }

    const nextAttempt = attempts[nextAttemptIndex];
    const preferredFinalHost = (
      typeof context.finalHost === 'string' && context.finalHost.length > 0
        ? context.finalHost
        : typeof metadata.catchUpPreferredFinalHost === 'string'
          ? metadata.catchUpPreferredFinalHost
          : resolveCatchUpHostAffinity(source.url)
    );
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
    clearCatchUpStartupTimer();
    hasCatchUpPlaybackStartedRef.current = false;
    pendingAutoplaySourceUrlRef.current = fallbackUrl;
    const nextPositionMs = metadata.mode === 'catchup'
      ? Math.max(currentSession.positionMs ?? 0, CATCH_UP_FALLBACK_POSITION_GUARD_MS)
      : currentSession.positionMs ?? 0;

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
          errorCode: context.errorCode,
          finalHost: preferredFinalHost,
          strategy: nextAttempt.strategy,
        }),
        renderer: currentSession.renderer,
        fallbackIndex: Math.max(0, nextAttemptIndex - 1),
        fallbackCount: Math.max(0, nextAttempts.length - 1),
        offsetMinutes: nextAttempt.offsetMinutes,
        fallbackUrl,
        responseContentType: context.responseContentType ?? null,
        rejectionReason: context.rejectionReason ?? null,
      },
    });
    return true;
  }, [clearCatchUpStartupTimer, clearStartupAutoplayRecovery, commands]);

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
      onManifestResolved: ({ requestedUrl, manifestUrl, finalUrl, httpStatus, contentType }) => {
        const source = sessionRef.current.source;
        if (
          !source ||
          typeof source.metadata !== 'object' ||
          source.metadata === null
        ) {
          return;
        }

        const metadata = source.metadata as Record<string, unknown>;
        if (metadata.mode !== 'catchup') {
          return;
        }

        const { currentAttemptIndex } = resolveCatchUpAttemptState(metadata, source.url);
        const requestHost = resolveCatchUpTargetOrigin(requestedUrl);
        const finalHost = typeof finalUrl === 'string'
          ? (
            rememberCatchUpHostAffinity(requestedUrl, finalUrl) ??
            resolveCatchUpTargetOrigin(finalUrl)
          )
          : null;

        if (requestHost && finalHost && requestHost !== finalHost) {
          emitWebObservabilityEvent({
            name: 'catchup.redirect',
            severity: 'info',
            metadata: {
              ...buildCatchUpEventMetadata(source, {
                attemptIndex: currentAttemptIndex,
                status: 'redirect',
                errorCode: null,
                finalHost,
              }),
              requestHost,
              finalHost,
              requestUrl: requestedUrl,
              manifestUrl,
              finalUrl,
            },
          });
        }

        const runtimeGateDecision = evaluateCatchUpRuntimePayload({
          requestedUrl,
          manifestUrl,
          finalUrl,
          httpStatus,
          contentType,
        });

        emitWebObservabilityEvent({
          name: 'catchup.runtime_gate',
          severity: runtimeGateDecision.isPlayableForRuntime ? 'info' : 'warn',
          metadata: {
            ...buildCatchUpEventMetadata(source, {
              attemptIndex: currentAttemptIndex,
              status: runtimeGateDecision.isPlayableForRuntime ? 'accepted' : 'rejected',
              errorCode: runtimeGateDecision.isPlayableForRuntime ? null : 'NON_PLAYABLE_PAYLOAD',
              finalHost,
            }),
            requestUrl: requestedUrl,
            manifestUrl,
            finalUrl,
            httpStatus,
            responseContentType: runtimeGateDecision.responseContentType,
            rejectionReason: runtimeGateDecision.rejectionReason,
            isPlayableForRuntime: runtimeGateDecision.isPlayableForRuntime,
          },
        });

        if (!runtimeGateDecision.isPlayableForRuntime) {
          return {
            isPlayableForRuntime: false,
            rejectionReason: runtimeGateDecision.rejectionReason,
            responseContentType: runtimeGateDecision.responseContentType,
          };
        }

        return {
          isPlayableForRuntime: true,
        };
      },
    });
    adapterRef.current = adapter;

    const unsubscribeState = adapter.onStateChange((state) => {
      const currentSession = sessionRef.current;

      if (state === 'loading' || state === 'buffering') {
        setIsLoading(true);
      }

      if (state === 'playing') {
        hasCatchUpPlaybackStartedRef.current = true;
        clearCatchUpStartupTimer();
        clearStartupAutoplayRecovery();
        pendingAutoplaySourceUrlRef.current = null;
        setError(null);
        setIsPlaying(true);
        setIsLoading(false);
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
          commands.pause();
        }
        return;
      }

      if (state === 'ended') {
        clearCatchUpStartupTimer();
        clearStartupAutoplayRecovery();
        pendingAutoplaySourceUrlRef.current = null;
        setIsPlaying(false);
        setIsLoading(false);
        onEnded?.();
        return;
      }

      if (state === 'idle') {
        clearCatchUpStartupTimer();
        clearStartupAutoplayRecovery();
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
      const runtimeErrorDetails = parseCatchUpPlaybackErrorDetails(playbackError.details);
      if (shouldAttemptCatchUpFallback(playbackError) &&
        switchToCatchUpFallbackIfAvailable({
          errorCode: playbackError.code,
          responseContentType: runtimeErrorDetails.responseContentType,
          rejectionReason: runtimeErrorDetails.rejectionReason,
        })) {
        return;
      }

      clearStartupAutoplayRecovery();
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

      lastReportedPositionMsRef.current = currentPositionMs;
      commands.seek(currentPositionMs);
    });

    return () => {
      unsubscribeState();
      unsubscribeError();
      unsubscribeTime();
      clearCatchUpStartupTimer();
      hasCatchUpPlaybackStartedRef.current = false;
      clearStartupAutoplayRecovery();
      adapter.destroy();
      if (adapterRef.current === adapter) {
        adapterRef.current = null;
      }
    };
  }, [
    clearCatchUpStartupTimer,
    clearStartupAutoplayRecovery,
    commands,
    mapPlaybackError,
    onCanPlay,
    onEnded,
    onError,
    preferNativeHls,
    shouldAttemptCatchUpFallback,
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
      clearCatchUpStartupTimer();
      hasCatchUpPlaybackStartedRef.current = false;
      clearStartupAutoplayRecovery();
      pendingAutoplaySourceUrlRef.current = null;
      setError(null);
      setIsLoading(false);
      setIsPlaying(false);
      adapter.stop();
      return;
    }

    let cancelled = false;
    setError(null);
    setIsLoading(true);
    clearCatchUpStartupTimer();
    hasCatchUpPlaybackStartedRef.current = false;
    clearStartupAutoplayRecovery();
    lastStartedSourceRef.current = null;
    pendingAutoplaySourceUrlRef.current = autoPlay && sessionWantsPlayback(sessionRef.current)
      ? src
      : null;

    const currentSourceMetadata = (
      sessionRef.current.source?.metadata &&
      typeof sessionRef.current.source.metadata === 'object'
    ) ? sessionRef.current.source.metadata as Record<string, unknown> : null;
    if (currentSourceMetadata?.mode === 'catchup') {
      const startupSourceUrl = src;
      catchUpStartupTimerRef.current = setTimeout(() => {
        const latestSession = sessionRef.current;
        const latestSource = latestSession.source;
        if (!latestSource || latestSource.url !== startupSourceUrl) {
          return;
        }
        if (hasCatchUpPlaybackStartedRef.current) {
          return;
        }
        if (switchToCatchUpFallbackIfAvailable({
          errorCode: 'LOAD_TIMEOUT',
          rejectionReason: 'startup_timeout',
        })) {
          return;
        }
      }, CATCH_UP_STARTUP_TIMEOUT_MS);
    }

    void adapter.load({
      url: src,
      type: sourceType,
    }).then(() => {
      if (cancelled) {
        return;
      }

      setIsLoading(false);
      onCanPlay?.();
      if (autoPlay && sessionWantsPlayback(sessionRef.current)) {
        adapter.play();
      }
    }).catch((loadError: unknown) => {
      if (cancelled) {
        return;
      }

      if (loadError instanceof ManifestRuntimeGateError) {
        if (switchToCatchUpFallbackIfAvailable({
          errorCode: loadError.code,
          responseContentType: normalizeContentType(
            loadError.decision.responseContentType ??
            loadError.manifestEvent.contentType
          ),
          rejectionReason: loadError.decision.rejectionReason ?? 'non_playable_ts_payload',
          finalHost: resolveCatchUpTargetOrigin(
            loadError.manifestEvent.finalUrl ??
            loadError.manifestEvent.manifestUrl
          ),
        })) {
          return;
        }
      }

      const message = loadError instanceof Error ? loadError.message : 'Neuspešno učitavanje streama';
      if (switchToCatchUpFallbackIfAvailable({ errorCode: 'LOAD_FAILED' })) {
        return;
      }

      setIsLoading(false);
      clearStartupAutoplayRecovery();
      pendingAutoplaySourceUrlRef.current = null;
      emitWebObservabilityEvent({
        name: 'playback.error',
        severity: 'error',
        metadata: {
          code: 'LOAD_FAILED',
          fatal: true,
          message,
          renderer: sessionRef.current.renderer,
          ...buildCatchUpEventMetadata(sessionRef.current.source, {
            status: 'error',
            errorCode: 'LOAD_FAILED',
          }),
        },
      });
      setError((prev) => prev ?? {
        type: 'unknown',
        message: 'Nije moguće učitati stream',
        details: message,
      });
      onError?.(message);
    });

    return () => {
      cancelled = true;
      clearCatchUpStartupTimer();
    };
  }, [
    autoPlay,
    clearCatchUpStartupTimer,
    clearStartupAutoplayRecovery,
    exitPictureInPicture,
    isLocalRenderer,
    onCanPlay,
    onError,
    sourceType,
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
