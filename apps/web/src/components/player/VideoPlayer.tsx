import { useRef, useEffect, useState, useCallback, forwardRef, useImperativeHandle } from 'react';
import { AlertCircle, Loader2, WifiOff, ShieldAlert } from 'lucide-react';
import type { SessionState } from '@lumen/session-core';
import type {
  AudioTrackOption,
  MediaSourceType,
  PlaybackError,
  PlaybackState,
  SubtitleTrackOption,
} from '@lumen/types';
import { Button, type ButtonProps } from '@/components/ui/button';
import { useSessionContext } from '@/context/session-context';
import { HlsPlayerAdapter } from '@/adapters/HlsPlayerAdapter';
import { emitWebObservabilityEvent } from '@/services/observability';
import { xtreamCodesService } from '@/services/xtreamService';
import {
  buildCatchUpTransportPlan,
  isCatchUpFallbackStrategy,
  rememberCatchUpHostAffinity,
  resolveCatchUpTransportMode,
  resolveCatchUpTargetOrigin,
  type CatchUpTransportAttempt,
} from './catchupTransport';
import {
  mapCatchUpAttemptPositionToSessionPosition,
  mapCatchUpSessionPositionToAttemptPosition,
  resolveNextCatchUpAttemptIndex,
} from './videoPlaybackRuntime';
import {
  isCatchUpSessionSourceMetadata,
  parseSessionSourceMetadata,
  type CatchUpSessionSourceMetadata,
} from './sessionSources';
import {
  sessionWantsPlayback,
  shouldResumePlaybackAfterPictureInPictureExit,
} from './videoPlaybackSync';

export interface VideoPlayerErrorAction {
  label: string;
  onClick: () => void;
  variant?: ButtonProps['variant'];
}

export interface VideoPlayerProps {
  poster?: string;
  autoPlay?: boolean;
  preferNativeHls?: boolean;
  loadingOverlayMaxMs?: number;
  reloadToken?: number;
  errorActions?: VideoPlayerErrorAction[];
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

type SourceMode = 'live' | 'catchup' | 'on-demand' | 'other';
type AttemptPhase = 'loading' | 'ready' | 'startup' | 'monitoring' | 'blocked';

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

interface SourceAttemptRuntime {
  token: number;
  sourceKey: string;
  sourceMode: SourceMode;
  sourceType: string;
  canonicalSourceUrl: string;
  catchUpMetadata: CatchUpSessionSourceMetadata | null;
  attempts: CatchUpTransportAttempt[];
  attemptIndex: number;
  liveReloadCount: number;
  phase: AttemptPhase;
  desiredPositionMs: number;
  sawPlayingEvent: boolean;
  readyAtMs: number | null;
  lastObservedTime: number;
  lastProgressAtMs: number | null;
}

const STARTUP_TIMEOUT_LIVE_MS = 6_000;
const STARTUP_TIMEOUT_CATCH_UP_MS = 10_000;
const STARTUP_TIMEOUT_DEFAULT_MS = 8_000;
const RUNTIME_MONITOR_INTERVAL_MS = 2_000;
const RUNTIME_STALL_THRESHOLD_MS = 8_000;
const PROGRESS_EPSILON_SECONDS = 0.15;
const CATCH_UP_INITIAL_POSITION_GUARD_MS = 15_000;
const MAX_AUTOMATIC_CATCH_UP_ATTEMPTS = 4;

const canUseStandardPictureInPicture = (video: HTMLVideoElement): boolean => (
  typeof document !== 'undefined' &&
  document.pictureInPictureEnabled &&
  typeof video.requestPictureInPicture === 'function' &&
  !video.disablePictureInPicture
);

const canUseWebKitPictureInPicture = (
  video: WebKitPictureInPictureVideoElement,
): boolean => (
  typeof video.webkitSetPresentationMode === 'function' &&
  typeof video.webkitSupportsPresentationMode === 'function' &&
  video.webkitSupportsPresentationMode('picture-in-picture')
);

const isVideoInPictureInPicture = (
  video: WebKitPictureInPictureVideoElement,
): boolean => {
  const isStandardPictureInPicture = (
    typeof document !== 'undefined' &&
    document.pictureInPictureElement === video
  );
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

const buildSourceKey = (session: SessionState): string => (
  JSON.stringify({
    url: session.source?.url ?? null,
    type: session.source?.type ?? null,
    title: session.source?.title ?? null,
    channelId: session.source?.channelId ?? null,
    metadata: session.source?.metadata ?? null,
  })
);

const resolveSourceMode = (session: SessionState): SourceMode => {
  const metadata = parseSessionSourceMetadata(session.source?.metadata);
  if (isCatchUpSessionSourceMetadata(metadata)) {
    return 'catchup';
  }

  if (metadata.mode === 'live') {
    return 'live';
  }

  if (metadata.mode === 'vod' || metadata.mode === 'series-episode') {
    return 'on-demand';
  }

  if (session.source?.channelId) {
    return 'live';
  }

  return 'other';
};

const resolveStartupTimeoutMs = (sourceMode: SourceMode): number => {
  if (sourceMode === 'live') {
    return STARTUP_TIMEOUT_LIVE_MS;
  }

  if (sourceMode === 'catchup') {
    return STARTUP_TIMEOUT_CATCH_UP_MS;
  }

  return STARTUP_TIMEOUT_DEFAULT_MS;
};

const buildCatchUpAttempts = (
  metadata: CatchUpSessionSourceMetadata,
): CatchUpTransportAttempt[] => (
  buildCatchUpTransportPlan({
    urlBuilder: xtreamCodesService,
    channelId: metadata.channelId,
    programId: metadata.programId,
    streamId: metadata.streamId,
    startTimestamp: metadata.startTimestamp,
    durationSeconds: metadata.durationSeconds,
    fallbackStreamIds: metadata.fallbackStreamIds,
    gatewaySelection: metadata.gateway,
  }).allAttempts
);

const buildCatchUpEventMetadata = (
  metadata: CatchUpSessionSourceMetadata | null,
  attempts: CatchUpTransportAttempt[],
  attemptIndex: number,
  status: string,
  errorCode: string | null,
): Record<string, unknown> => {
  const attempt = attempts[attemptIndex] ?? null;
  return {
    channelId: metadata?.channelId ?? null,
    programId: metadata?.programId ?? null,
    serverId: metadata?.gateway?.serverId ?? null,
    assetKey: metadata?.gateway?.assetKey ?? null,
    streamId: attempt?.streamId ?? metadata?.streamId ?? null,
    start: attempt?.startTimestamp ?? metadata?.startTimestamp ?? null,
    duration: attempt?.durationSeconds ?? metadata?.durationSeconds ?? null,
    attempt: attemptIndex + 1,
    status,
    finalHost: attempt ? resolveCatchUpTargetOrigin(attempt.url) : null,
    transportMode: attempt
      ? resolveCatchUpTransportMode(attempt.url)
      : metadata?.gateway?.transportMode ?? null,
    fallbackReason: metadata?.gateway?.fallbackReason ?? null,
    hotStart: metadata?.gateway?.hotStart ?? null,
    errorCode,
    strategy: attempt?.strategy ?? null,
  };
};

const mapPlaybackError = (playbackError: PlaybackError): PlayerError => {
  if (playbackError.code === 'MIXED_CONTENT') {
    return {
      type: 'mixed-content',
      message: 'Nije moguće učitati stream',
      details: (
        'HTTPS stranica ne može pristupiti HTTP streamu. '
        + 'Koristite HTTPS verziju IPTV servera ili otvorite aplikaciju preko HTTP-a.'
      ),
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
};

const buildBlockingError = (
  sourceMode: SourceMode,
  failureKind: 'startup' | 'runtime' | 'load',
  playbackError?: PlaybackError,
): PlayerError => {
  if (playbackError && (playbackError.code === 'MIXED_CONTENT' || playbackError.code === 'HLS_NOT_SUPPORTED')) {
    return mapPlaybackError(playbackError);
  }

  if (sourceMode === 'catchup') {
    return {
      type: 'network',
      message: failureKind === 'runtime' ? 'TV unazad je zastao' : 'TV unazad nije pokrenut',
      details: 'Pokušajte ponovo ili se vratite na UŽIVO.',
    };
  }

  if (sourceMode === 'live') {
    return {
      type: 'network',
      message: failureKind === 'runtime' ? 'Live kanal je zastao' : 'Live kanal nije pokrenut',
      details: 'Pokušajte ponovo.',
    };
  }

  if (playbackError) {
    return mapPlaybackError(playbackError);
  }

  return {
    type: 'unknown',
    message: 'Nije moguće učitati stream',
    details: 'Pokušajte ponovo.',
  };
};

const isRecoverablePlaybackError = (playbackError: PlaybackError): boolean => {
  if (playbackError.code === 'MEDIA_ELEMENT_3' || playbackError.code === 'PLAYBACK_START_FAILED') {
    return false;
  }

  return playbackError.fatal || playbackError.code === 'LOAD_FAILED';
};

const isStartupOrMonitoringPhase = (phase: AttemptPhase): boolean => (
  phase === 'startup' || phase === 'monitoring'
);

const VideoPlayer = forwardRef<VideoPlayerHandle, VideoPlayerProps>(({
  poster,
  autoPlay = true,
  preferNativeHls = false,
  loadingOverlayMaxMs,
  reloadToken = 0,
  errorActions = [],
  onError,
  onEnded,
  onCanPlay,
  className = '',
}, ref) => {
  const { session, commands } = useSessionContext();
  const sourceType = session.source?.type ?? (
    (session.source?.url ?? '').includes('.m3u8') ? 'hls' : 'mp4'
  );
  const videoRef = useRef<HTMLVideoElement>(null);
  const adapterRef = useRef<HlsPlayerAdapter | null>(null);
  const sessionRef = useRef(session);
  const onErrorRef = useRef(onError);
  const onEndedRef = useRef(onEnded);
  const onCanPlayRef = useRef(onCanPlay);
  const isApplyingSessionSeekRef = useRef(false);
  const applyingSessionSeekTargetMsRef = useRef<number | null>(null);
  const lastReportedPositionMsRef = useRef<number | null>(null);
  const loadTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const startupTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const activeAttemptRef = useRef<SourceAttemptRuntime | null>(null);
  const attemptTokenRef = useRef(0);
  const lastStartedAttemptKeyRef = useRef<string | null>(null);
  const startAttemptRef = useRef<((nextRuntime: Omit<SourceAttemptRuntime, 'token'>) => void) | null>(null);
  const failAttemptRef = useRef<(
    reason: string,
    failureKind: 'startup' | 'runtime' | 'load',
    playbackError?: PlaybackError,
  ) => void>(() => {});
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
  const playbackWantsPlaying = sessionWantsPlayback(session);
  const isLocalRenderer = session.renderer === 'local-web' || session.renderer === 'airplay';

  const clearStartupTimeout = useCallback(() => {
    if (startupTimeoutRef.current !== null) {
      clearTimeout(startupTimeoutRef.current);
      startupTimeoutRef.current = null;
    }
  }, []);

  const clearLoadTimeout = useCallback(() => {
    if (loadTimeoutRef.current !== null) {
      clearTimeout(loadTimeoutRef.current);
      loadTimeoutRef.current = null;
    }
  }, []);

  const syncPlaybackProof = useCallback((token: number) => {
    const runtime = activeAttemptRef.current;
    const adapter = adapterRef.current;
    const video = videoRef.current;
    if (
      !runtime ||
      runtime.token !== token ||
      runtime.phase !== 'startup' ||
      !adapter ||
      !video
    ) {
      return;
    }

    const currentTime = adapter.getCurrentTime();
    const timeProgress = currentTime - runtime.lastObservedTime;
    if (timeProgress <= PROGRESS_EPSILON_SECONDS) {
      return;
    }

    const hasStartupProof = runtime.sawPlayingEvent || video.readyState >= 2;
    runtime.lastObservedTime = currentTime;
    if (!hasStartupProof) {
      return;
    }

    runtime.phase = 'monitoring';
    runtime.lastProgressAtMs = Date.now();
    clearStartupTimeout();
    setError(null);
    setIsLoading(false);
    setIsPlaying(true);
    onCanPlayRef.current?.();

    const startedAttemptKey = `${runtime.sourceKey}:${runtime.attemptIndex}:${runtime.liveReloadCount}`;
    if (lastStartedAttemptKeyRef.current !== startedAttemptKey) {
      lastStartedAttemptKeyRef.current = startedAttemptKey;
      emitWebObservabilityEvent({
        name: 'playback.started',
        severity: 'info',
        metadata: {
          renderer: sessionRef.current.renderer,
          sourceType: runtime.sourceType,
          sourceMode: runtime.sourceMode,
          attempt: runtime.attemptIndex + 1,
        },
      });
    }
  }, [clearStartupTimeout]);

  const blockAttempt = useCallback((
    reason: string,
    failureKind: 'startup' | 'runtime' | 'load',
    playbackError?: PlaybackError,
  ) => {
    const runtime = activeAttemptRef.current;
    if (!runtime) {
      return;
    }

    runtime.phase = 'blocked';
    clearLoadTimeout();
    clearStartupTimeout();
    setIsLoading(false);
    setIsPlaying(false);
    setError(buildBlockingError(runtime.sourceMode, failureKind, playbackError));

    if (sessionWantsPlayback(sessionRef.current)) {
      commands.pause();
    }

    emitWebObservabilityEvent({
      name: 'playback.error',
      severity: playbackError?.fatal ? 'error' : 'warn',
      metadata: {
        code: playbackError?.code ?? reason,
        fatal: playbackError?.fatal ?? true,
        message: playbackError?.message ?? reason,
        renderer: sessionRef.current.renderer,
        sourceType: runtime.sourceType,
        sourceMode: runtime.sourceMode,
        ...buildCatchUpEventMetadata(
          runtime.catchUpMetadata,
          runtime.attempts,
          runtime.attemptIndex,
          'error',
          playbackError?.code ?? reason,
        ),
      },
    });

    onErrorRef.current?.(playbackError?.message ?? reason);
  }, [clearLoadTimeout, clearStartupTimeout, commands]);

  const startAttempt = useCallback((
    nextRuntime: Omit<SourceAttemptRuntime, 'token'>,
  ) => {
    const adapter = adapterRef.current;
    if (!adapter) {
      return;
    }

    const token = attemptTokenRef.current + 1;
    attemptTokenRef.current = token;
    clearLoadTimeout();
    clearStartupTimeout();
    lastReportedPositionMsRef.current = null;
    isApplyingSessionSeekRef.current = false;
    applyingSessionSeekTargetMsRef.current = null;

    const runtime: SourceAttemptRuntime = {
      ...nextRuntime,
      token,
    };
    activeAttemptRef.current = runtime;
    setError(null);
    setIsLoading(true);
    setIsPlaying(false);

    if (
      runtime.sourceMode === 'catchup' &&
      runtime.desiredPositionMs > 0 &&
      (
        sessionRef.current.positionMs === null ||
        Math.abs((sessionRef.current.positionMs ?? 0) - runtime.desiredPositionMs) >= 1000
      )
    ) {
      commands.seek(runtime.desiredPositionMs);
    }

    loadTimeoutRef.current = setTimeout(() => {
      const currentRuntime = activeAttemptRef.current;
      if (!currentRuntime || currentRuntime.token !== token || currentRuntime.phase !== 'loading') {
        return;
      }

      failAttemptRef.current('LOAD_TIMEOUT', 'load');
    }, resolveStartupTimeoutMs(runtime.sourceMode));

    const attemptUrl = runtime.attempts[runtime.attemptIndex]?.url ?? runtime.canonicalSourceUrl;

    void adapter.load({
      url: attemptUrl,
      type: runtime.sourceType as MediaSourceType,
    }).catch((loadError: unknown) => {
      const currentRuntime = activeAttemptRef.current;
      if (!currentRuntime || currentRuntime.token !== token) {
        return;
      }

      const message = loadError instanceof Error ? loadError.message : 'Neuspešno učitavanje streama';
      failAttemptRef.current('LOAD_FAILED', 'load', {
        code: 'LOAD_FAILED',
        message,
        fatal: true,
      });
    });
  }, [clearLoadTimeout, clearStartupTimeout, commands]);
  startAttemptRef.current = startAttempt;

  const failAttempt = useCallback((
    reason: string,
    failureKind: 'startup' | 'runtime' | 'load',
    playbackError?: PlaybackError,
  ) => {
    const runtime = activeAttemptRef.current;
    const source = sessionRef.current.source;
    if (!runtime || !source) {
      return;
    }

    if (runtime.sourceMode === 'catchup' && runtime.catchUpMetadata) {
      const currentAttempt = runtime.attempts[runtime.attemptIndex] ?? null;
      const currentPlaybackPositionMs = Math.floor((adapterRef.current?.getCurrentTime() ?? 0) * 1000);
      const absolutePlaybackPositionMs = currentAttempt
        ? mapCatchUpAttemptPositionToSessionPosition({
          metadata: runtime.catchUpMetadata,
          attempt: currentAttempt,
          attemptPositionMs: currentPlaybackPositionMs,
        })
        : currentPlaybackPositionMs;
      const absoluteObservedPositionMs = currentAttempt
        ? mapCatchUpAttemptPositionToSessionPosition({
          metadata: runtime.catchUpMetadata,
          attempt: currentAttempt,
          attemptPositionMs: Math.floor(runtime.lastObservedTime * 1000),
        })
        : Math.floor(runtime.lastObservedTime * 1000);
      const nextAttempts = buildCatchUpAttempts(runtime.catchUpMetadata);
      const nextAttemptIndex = resolveNextCatchUpAttemptIndex({
        attempts: nextAttempts,
        currentAttemptIndex: runtime.attemptIndex,
        failureKind,
      });
      if (
        nextAttemptIndex >= 0 &&
        nextAttemptIndex < nextAttempts.length &&
        nextAttemptIndex < MAX_AUTOMATIC_CATCH_UP_ATTEMPTS
      ) {
        const nextAttempt = nextAttempts[nextAttemptIndex];
        emitWebObservabilityEvent({
          name: isCatchUpFallbackStrategy(nextAttempt.strategy)
            ? 'catchup.fallback'
            : 'catchup.retry',
          severity: 'warn',
          metadata: {
            ...buildCatchUpEventMetadata(
              runtime.catchUpMetadata,
              nextAttempts,
              nextAttemptIndex,
              failureKind === 'runtime' ? 'runtime-retry' : 'startup-retry',
              playbackError?.code ?? reason,
            ),
            renderer: sessionRef.current.renderer,
            offsetMinutes: nextAttempt.offsetMinutes,
            fallbackCount: Math.max(0, nextAttempts.length - 1),
            fallbackReason: nextAttempt.strategy === 'proxy-remux'
              ? 'boundary-stall-remux'
              : (failureKind === 'runtime' ? 'runtime-retry' : 'startup-retry'),
          },
        });

        const runtimePositionMs = Math.max(
          runtime.desiredPositionMs,
          absoluteObservedPositionMs,
          sessionRef.current.positionMs ?? 0,
          absolutePlaybackPositionMs,
          CATCH_UP_INITIAL_POSITION_GUARD_MS,
        );
        startAttemptRef.current?.({
          sourceKey: runtime.sourceKey,
          sourceMode: runtime.sourceMode,
          sourceType: runtime.sourceType,
          canonicalSourceUrl: runtime.canonicalSourceUrl,
          catchUpMetadata: runtime.catchUpMetadata,
          attempts: nextAttempts,
          attemptIndex: nextAttemptIndex,
          liveReloadCount: runtime.liveReloadCount,
          phase: 'loading',
          desiredPositionMs: runtimePositionMs,
          sawPlayingEvent: false,
          readyAtMs: null,
          lastObservedTime: 0,
          lastProgressAtMs: null,
        });
        return;
      }
    }

    if (
      runtime.sourceMode === 'live' &&
      runtime.liveReloadCount < 1 &&
      (
        failureKind === 'startup' ||
        failureKind === 'runtime' ||
        failureKind === 'load' ||
        playbackError?.fatal
      )
    ) {
      emitWebObservabilityEvent({
        name: failureKind === 'runtime' ? 'playback.runtime_recovery' : 'playback.startup_recovery',
        severity: 'warn',
        metadata: {
          reason,
          attempt: runtime.liveReloadCount + 1,
          renderer: sessionRef.current.renderer,
          sourceType: runtime.sourceType,
          sourceMode: runtime.sourceMode,
          strategy: 'live-reload',
        },
      });

      startAttemptRef.current?.({
        sourceKey: runtime.sourceKey,
        sourceMode: runtime.sourceMode,
        sourceType: runtime.sourceType,
        canonicalSourceUrl: source.url,
        catchUpMetadata: null,
        attempts: [],
        attemptIndex: 0,
        liveReloadCount: runtime.liveReloadCount + 1,
        phase: 'loading',
        desiredPositionMs: 0,
        sawPlayingEvent: false,
        readyAtMs: null,
        lastObservedTime: 0,
        lastProgressAtMs: null,
      });
      return;
    }

    blockAttempt(reason, failureKind, playbackError);
  }, [blockAttempt]);
  failAttemptRef.current = failAttempt;

  useEffect(() => {
    sessionRef.current = session;
  }, [session]);

  useEffect(() => {
    onErrorRef.current = onError;
  }, [onError]);

  useEffect(() => {
    onEndedRef.current = onEnded;
  }, [onEnded]);

  useEffect(() => {
    onCanPlayRef.current = onCanPlay;
  }, [onCanPlay]);

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
  }, [error, isLoading, loadingOverlayMaxMs, reloadToken, session.source?.url]);

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
    getSelectedSubtitleTrackId: () => adapterRef.current?.getSelectedSubtitleTrackId?.() || null,
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

  useEffect(() => {
    const video = videoRef.current;
    if (!video) {
      return;
    }

    const adapter = new HlsPlayerAdapter(video, {
      preferNativeHls,
      onManifestResolved: ({ requestedUrl, manifestUrl, finalUrl }) => {
        const runtime = activeAttemptRef.current;
        if (
          !runtime ||
          runtime.sourceMode !== 'catchup' ||
          runtime.catchUpMetadata === null ||
          typeof finalUrl !== 'string'
        ) {
          return;
        }

        const requestHost = resolveCatchUpTargetOrigin(requestedUrl);
        const finalHost = rememberCatchUpHostAffinity(requestedUrl, finalUrl) ??
          resolveCatchUpTargetOrigin(finalUrl);
        if (!requestHost || !finalHost || requestHost === finalHost) {
          return;
        }

        emitWebObservabilityEvent({
          name: 'catchup.redirect',
          severity: 'info',
          metadata: {
            ...buildCatchUpEventMetadata(
              runtime.catchUpMetadata,
              runtime.attempts,
              runtime.attemptIndex,
              'redirect',
              null,
            ),
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

    const unsubscribeState = adapter.onStateChange((state: PlaybackState) => {
      const runtime = activeAttemptRef.current;
      if (!runtime) {
        if (state === 'idle') {
          setIsLoading(false);
          setIsPlaying(false);
        }
        return;
      }

      if (runtime.phase === 'loading' && state !== 'loading' && state !== 'ready') {
        return;
      }

      if (state === 'loading') {
        setIsLoading(true);
        return;
      }

      if (state === 'ready') {
        clearLoadTimeout();
        runtime.phase = 'ready';
        runtime.readyAtMs = Date.now();
        runtime.lastObservedTime = adapter.getCurrentTime();
        runtime.lastProgressAtMs = runtime.readyAtMs;

        if (runtime.desiredPositionMs > 0 && runtime.sourceMode !== 'live') {
          const currentAttempt = runtime.attempts[runtime.attemptIndex] ?? null;
          const targetPositionMs = (
            runtime.sourceMode === 'catchup' &&
            runtime.catchUpMetadata &&
            currentAttempt
          )
            ? mapCatchUpSessionPositionToAttemptPosition({
              metadata: runtime.catchUpMetadata,
              attempt: currentAttempt,
              sessionPositionMs: runtime.desiredPositionMs,
            })
            : runtime.desiredPositionMs;
          isApplyingSessionSeekRef.current = true;
          applyingSessionSeekTargetMsRef.current = targetPositionMs;
          runtime.lastObservedTime = targetPositionMs / 1000;
          adapter.seek(targetPositionMs / 1000);
        }

        if (autoPlay && sessionWantsPlayback(sessionRef.current)) {
          runtime.phase = 'startup';
          setIsLoading(true);
          clearStartupTimeout();
          startupTimeoutRef.current = setTimeout(() => {
            const currentRuntime = activeAttemptRef.current;
            if (!currentRuntime || currentRuntime.token !== runtime.token || currentRuntime.phase !== 'startup') {
              return;
            }

            failAttempt('STARTUP_TIMEOUT', 'startup');
          }, resolveStartupTimeoutMs(runtime.sourceMode));
          adapter.play();
        } else {
          setIsLoading(false);
          setIsPlaying(false);
        }
        return;
      }

      if (state === 'playing') {
        runtime.sawPlayingEvent = true;
        setIsPlaying(true);
        syncPlaybackProof(runtime.token);
        return;
      }

      if (state === 'buffering') {
        if (isStartupOrMonitoringPhase(runtime.phase)) {
          setIsLoading(true);
        }
        return;
      }

      if (state === 'paused') {
        setIsPlaying(false);
        if (runtime.phase !== 'startup') {
          setIsLoading(false);
        }
        return;
      }

      if (state === 'ended') {
        clearStartupTimeout();
        runtime.phase = 'blocked';
        setIsPlaying(false);
        setIsLoading(false);
        onEndedRef.current?.();
        return;
      }

      if (state === 'idle' && runtime.phase === 'blocked') {
        setIsPlaying(false);
        setIsLoading(false);
      }
    });

    const unsubscribeError = adapter.onError((playbackError) => {
      const runtime = activeAttemptRef.current;
      if (!runtime) {
        setError(mapPlaybackError(playbackError));
        setIsLoading(false);
        onErrorRef.current?.(playbackError.message);
        return;
      }

      if (playbackError.code === 'MEDIA_ELEMENT_3' || playbackError.code === 'PLAYBACK_START_FAILED') {
        emitWebObservabilityEvent({
          name: 'playback.error',
          severity: playbackError.fatal ? 'error' : 'warn',
          metadata: {
            code: playbackError.code,
            fatal: playbackError.fatal,
            message: playbackError.message,
            renderer: sessionRef.current.renderer,
            sourceType: runtime.sourceType,
            sourceMode: runtime.sourceMode,
          },
        });
        failAttempt(
          playbackError.code,
          runtime.phase === 'monitoring' ? 'runtime' : 'startup',
          playbackError,
        );
        return;
      }

      if (isRecoverablePlaybackError(playbackError)) {
        failAttempt(
          playbackError.code,
          runtime.phase === 'monitoring' ? 'runtime' : 'startup',
          playbackError,
        );
        return;
      }

      blockAttempt(playbackError.code, runtime.phase === 'monitoring' ? 'runtime' : 'startup', playbackError);
    });

    const unsubscribeTime = adapter.onTimeUpdate((time) => {
      const currentSession = sessionRef.current;
      const runtime = activeAttemptRef.current;
      if (!currentSession.source || !runtime) {
        return;
      }

      const currentAttempt = runtime.attempts[runtime.attemptIndex] ?? null;
      const currentPositionMs = Math.floor(time * 1000);
      const sessionPositionMs = (
        runtime.sourceMode === 'catchup' &&
        runtime.catchUpMetadata &&
        currentAttempt
      )
        ? mapCatchUpAttemptPositionToSessionPosition({
          metadata: runtime.catchUpMetadata,
          attempt: currentAttempt,
          attemptPositionMs: currentPositionMs,
        })
        : currentPositionMs;
      if (runtime.phase === 'loading' || runtime.phase === 'ready') {
        return;
      }

      if (isApplyingSessionSeekRef.current) {
        const applyingTargetMs = applyingSessionSeekTargetMsRef.current;
        if (
          applyingTargetMs === null ||
          Math.abs(currentPositionMs - applyingTargetMs) < 500
        ) {
          isApplyingSessionSeekRef.current = false;
          applyingSessionSeekTargetMsRef.current = null;
          lastReportedPositionMsRef.current = sessionPositionMs;
          if (
            currentSession.positionMs === null ||
            Math.abs(sessionPositionMs - currentSession.positionMs) >= 1000
          ) {
            commands.seek(sessionPositionMs);
          }
        }
      } else {
        const lastReportedPositionMs = lastReportedPositionMsRef.current;
        if (
          lastReportedPositionMs === null ||
          Math.abs(sessionPositionMs - lastReportedPositionMs) >= 1000
        ) {
          lastReportedPositionMsRef.current = sessionPositionMs;
          if (
            currentSession.positionMs === null ||
            Math.abs(sessionPositionMs - currentSession.positionMs) >= 1000
          ) {
            commands.seek(sessionPositionMs);
          }
        }
      }

      const previousTime = runtime.lastObservedTime;
      const timeProgress = time - previousTime;
      if (runtime.phase === 'startup') {
        if (timeProgress > PROGRESS_EPSILON_SECONDS) {
          syncPlaybackProof(runtime.token);
        }
        return;
      }

      if (runtime.phase === 'monitoring' && timeProgress > PROGRESS_EPSILON_SECONDS) {
        runtime.lastObservedTime = time;
        runtime.lastProgressAtMs = Date.now();
        setIsLoading(false);
        setIsPlaying(true);
      }
    });

    return () => {
      unsubscribeState();
      unsubscribeError();
      unsubscribeTime();
      clearLoadTimeout();
      clearStartupTimeout();
      adapter.destroy();
      if (adapterRef.current === adapter) {
        adapterRef.current = null;
      }
      activeAttemptRef.current = null;
      applyingSessionSeekTargetMsRef.current = null;
    };
  }, [
    autoPlay,
    blockAttempt,
    clearLoadTimeout,
    clearStartupTimeout,
    commands,
    failAttempt,
    preferNativeHls,
    syncPlaybackProof,
  ]);

  useEffect(() => {
    const adapter = adapterRef.current;
    if (!adapter) {
      return;
    }

    if (!session.source || !isLocalRenderer) {
      clearLoadTimeout();
      clearStartupTimeout();
      activeAttemptRef.current = null;
      applyingSessionSeekTargetMsRef.current = null;
      lastStartedAttemptKeyRef.current = null;
      setError(null);
      setIsLoading(false);
      setIsPlaying(false);
      adapter.stop();
      return;
    }

    clearLoadTimeout();
    clearStartupTimeout();
    const metadata = parseSessionSourceMetadata(session.source.metadata);
    const sourceMode = resolveSourceMode(session);
    const catchUpMetadata = isCatchUpSessionSourceMetadata(metadata) ? metadata : null;
    let attempts: CatchUpTransportAttempt[] = [];
    if (catchUpMetadata) {
      try {
        attempts = buildCatchUpAttempts(catchUpMetadata);
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'Catch-up plan nije moguće napraviti';
        activeAttemptRef.current = {
          token: attemptTokenRef.current + 1,
          sourceKey: buildSourceKey(session),
          sourceMode,
          sourceType,
          canonicalSourceUrl: session.source.url,
          catchUpMetadata,
          attempts: [],
          attemptIndex: 0,
          liveReloadCount: 0,
          phase: 'blocked',
          desiredPositionMs: 0,
          sawPlayingEvent: false,
          readyAtMs: null,
          lastObservedTime: 0,
          lastProgressAtMs: null,
        };
        setIsLoading(false);
        setIsPlaying(false);
        setError(buildBlockingError(sourceMode, 'load', {
          code: 'LOAD_FAILED',
          message,
          fatal: true,
        }));
        onErrorRef.current?.(message);
        return;
      }
    }

    startAttempt({
      sourceKey: buildSourceKey(session),
      sourceMode,
      sourceType,
      canonicalSourceUrl: session.source.url,
      catchUpMetadata,
      attempts,
      attemptIndex: 0,
      liveReloadCount: 0,
      phase: 'loading',
      desiredPositionMs: Math.max(0, session.positionMs ?? 0),
      sawPlayingEvent: false,
      readyAtMs: null,
      lastObservedTime: 0,
      lastProgressAtMs: null,
    });
  }, [
    clearLoadTimeout,
    clearStartupTimeout,
    isLocalRenderer,
    reloadToken,
    session.source,
    sourceType,
    startAttempt,
  ]);

  useEffect(() => {
    const adapter = adapterRef.current;
    const runtime = activeAttemptRef.current;
    if (!adapter || !runtime || !session.source || session.positionMs === null) {
      return;
    }

    if (runtime.phase === 'loading') {
      return;
    }

    const currentAttempt = runtime.attempts[runtime.attemptIndex] ?? null;
    const targetPositionMs = (
      runtime.sourceMode === 'catchup' &&
      runtime.catchUpMetadata &&
      currentAttempt
    )
      ? mapCatchUpSessionPositionToAttemptPosition({
        metadata: runtime.catchUpMetadata,
        attempt: currentAttempt,
        sessionPositionMs: session.positionMs,
      })
      : session.positionMs;
    const targetTime = targetPositionMs / 1000;
    const currentTime = adapter.getCurrentTime();
    if (Math.abs(currentTime - targetTime) < 1) {
      return;
    }

    isApplyingSessionSeekRef.current = true;
    applyingSessionSeekTargetMsRef.current = Math.floor(targetPositionMs);
    runtime.lastObservedTime = targetTime;
    if (runtime.phase === 'monitoring') {
      runtime.lastProgressAtMs = Date.now();
    }
    adapter.seek(targetTime);
  }, [session.positionMs, session.source]);

  useEffect(() => {
    const adapter = adapterRef.current;
    const runtime = activeAttemptRef.current;
    if (!adapter || !runtime) {
      return;
    }

    if (!session.source || !isLocalRenderer) {
      clearLoadTimeout();
      clearStartupTimeout();
      adapter.pause();
      return;
    }

    if (playbackWantsPlaying) {
      if (runtime.phase === 'loading') {
        return;
      }

      if (runtime.phase === 'ready') {
        runtime.phase = 'startup';
        runtime.lastProgressAtMs = Date.now();
        clearStartupTimeout();
        startupTimeoutRef.current = setTimeout(() => {
          const currentRuntime = activeAttemptRef.current;
          if (!currentRuntime || currentRuntime.token !== runtime.token || currentRuntime.phase !== 'startup') {
            return;
          }

          failAttempt('STARTUP_TIMEOUT', 'startup');
        }, resolveStartupTimeoutMs(runtime.sourceMode));
        setIsLoading(true);
      }

      adapter.play();
      return;
    }

    if (runtime.phase === 'startup') {
      runtime.phase = 'ready';
      clearStartupTimeout();
      setIsLoading(false);
    }
    adapter.pause();
  }, [
    clearLoadTimeout,
    clearStartupTimeout,
    failAttempt,
    isLocalRenderer,
    playbackWantsPlaying,
    session.source,
  ]);

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      const runtime = activeAttemptRef.current;
      const adapter = adapterRef.current;
      const video = videoRef.current;
      if (!runtime || !adapter || !video) {
        return;
      }

      if (
        runtime.phase !== 'monitoring' ||
        !sessionWantsPlayback(sessionRef.current) ||
        isApplyingSessionSeekRef.current
      ) {
        return;
      }

      const currentTime = adapter.getCurrentTime();
      if (currentTime - runtime.lastObservedTime > PROGRESS_EPSILON_SECONDS) {
        runtime.lastObservedTime = currentTime;
        runtime.lastProgressAtMs = Date.now();
        return;
      }

      const stalledForMs = Date.now() - (runtime.lastProgressAtMs ?? Date.now());
      if (stalledForMs < RUNTIME_STALL_THRESHOLD_MS) {
        return;
      }

      emitWebObservabilityEvent({
        name: 'playback.runtime_recovery',
        severity: 'warn',
        metadata: {
          reason: 'RUNTIME_STALL',
          attempt: runtime.sourceMode === 'live' ? runtime.liveReloadCount + 1 : runtime.attemptIndex + 1,
          renderer: sessionRef.current.renderer,
          sourceType: runtime.sourceType,
          sourceMode: runtime.sourceMode,
          strategy: runtime.sourceMode === 'catchup' ? 'next-attempt' : 'live-reload',
        },
      });
      failAttempt('RUNTIME_STALL', 'runtime');
    }, RUNTIME_MONITOR_INTERVAL_MS);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [failAttempt]);

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      const runtime = activeAttemptRef.current;
      if (
        !runtime ||
        runtime.sourceMode !== 'catchup' ||
        runtime.phase === 'monitoring' ||
        runtime.phase === 'blocked' ||
        !sessionWantsPlayback(sessionRef.current) ||
        runtime.desiredPositionMs <= 0
      ) {
        return;
      }

      const currentSessionPositionMs = sessionRef.current.positionMs ?? 0;
      if (Math.abs(currentSessionPositionMs - runtime.desiredPositionMs) < 1000) {
        return;
      }

      commands.seek(runtime.desiredPositionMs);
    }, 500);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [commands]);

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
      event: Event & { availability?: AirPlayAvailability },
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
      handleTargetAvailabilityChange as EventListener,
    );
    video.addEventListener(
      'webkitcurrentplaybacktargetiswirelesschanged',
      handleWirelessTargetChange,
    );

    return () => {
      video.removeEventListener(
        'webkitplaybacktargetavailabilitychanged',
        handleTargetAvailabilityChange as EventListener,
      );
      video.removeEventListener(
        'webkitcurrentplaybacktargetiswirelesschanged',
        handleWirelessTargetChange,
      );
    };
  }, []);

  const ErrorDisplay = ({ currentError }: { currentError: PlayerError }) => {
    const Icon = currentError.type === 'mixed-content'
      ? ShieldAlert
      : currentError.type === 'network'
        ? WifiOff
        : AlertCircle;

    return (
      <div className="absolute inset-0 z-10 flex flex-col items-center justify-center bg-background/90 backdrop-blur-sm">
        <div className="flex max-w-md flex-col items-center gap-3 p-6 text-center">
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-destructive/10">
            <Icon className="h-8 w-8 text-destructive" />
          </div>
          <h3 className="text-lg font-semibold text-foreground">{currentError.message}</h3>
          {currentError.details && (
            <p className="text-sm text-muted-foreground">{currentError.details}</p>
          )}
          {errorActions.length > 0 && (
            <div className="mt-2 flex flex-wrap items-center justify-center gap-2">
              {errorActions.map((action) => (
                <Button
                  key={action.label}
                  variant={action.variant ?? 'outline'}
                  onClick={action.onClick}
                >
                  {action.label}
                </Button>
              ))}
            </div>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className={`relative h-full w-full bg-black ${className}`}>
      <video
        ref={videoRef}
        poster={poster}
        playsInline
        className="h-full w-full object-contain"
      />

      {isLoading && isLoadingOverlayVisible && !error && (
        <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center bg-black/50">
          <Loader2 className="h-12 w-12 animate-spin text-primary" />
        </div>
      )}

      {error && <ErrorDisplay currentError={error} />}
    </div>
  );
});

VideoPlayer.displayName = 'VideoPlayer';

export default VideoPlayer;
