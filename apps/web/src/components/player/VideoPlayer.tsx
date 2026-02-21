import { useRef, useEffect, useState, useCallback, forwardRef, useImperativeHandle } from 'react';
import { AlertCircle, Loader2, WifiOff, ShieldAlert } from 'lucide-react';
import { useSessionContext } from '@/context/session-context';
import { HlsPlayerAdapter } from '@/adapters/HlsPlayerAdapter';
import type { PlaybackError } from '@lumen/types';
import type { AudioTrackOption } from '@lumen/types';
import type { SubtitleTrackOption } from '@lumen/types';
import { emitWebObservabilityEvent } from '@/services/observability';
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

  const switchToCatchUpFallbackIfAvailable = useCallback((reason: string): boolean => {
    const currentSession = sessionRef.current;
    const source = currentSession.source;
    if (!source || typeof source.metadata !== 'object' || source.metadata === null) {
      return false;
    }

    const metadata = source.metadata as Record<string, unknown>;
    if (metadata.mode !== 'catchup') {
      return false;
    }

    if (metadata.catchUpFallbackUsed === true) {
      return false;
    }

    const fallbackUrl = typeof metadata.catchUpFallbackUrl === 'string'
      ? metadata.catchUpFallbackUrl.trim()
      : '';
    if (!fallbackUrl || fallbackUrl === source.url) {
      return false;
    }

    clearStartupAutoplayRecovery();
    pendingAutoplaySourceUrlRef.current = fallbackUrl;
    commands.setSource(
      {
        ...source,
        url: fallbackUrl,
        metadata: {
          ...metadata,
          catchUpFallbackUsed: true,
        },
      },
      currentSession.positionMs ?? 0
    );
    commands.play();
    setError(null);
    setIsLoading(true);
    emitWebObservabilityEvent({
      name: 'playback.catchup_fallback',
      severity: 'warn',
      metadata: {
        reason,
        renderer: currentSession.renderer,
      },
    });
    return true;
  }, [clearStartupAutoplayRecovery, commands]);

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

    const adapter = new HlsPlayerAdapter(video, { preferNativeHls });
    adapterRef.current = adapter;

    const unsubscribeState = adapter.onStateChange((state) => {
      const currentSession = sessionRef.current;

      if (state === 'loading' || state === 'buffering') {
        setIsLoading(true);
      }

      if (state === 'playing') {
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
        clearStartupAutoplayRecovery();
        pendingAutoplaySourceUrlRef.current = null;
        setIsPlaying(false);
        setIsLoading(false);
        onEnded?.();
        return;
      }

      if (state === 'idle') {
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
      if (switchToCatchUpFallbackIfAvailable(playbackError.code)) {
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
      clearStartupAutoplayRecovery();
      adapter.destroy();
      if (adapterRef.current === adapter) {
        adapterRef.current = null;
      }
    };
  }, [
    clearStartupAutoplayRecovery,
    commands,
    mapPlaybackError,
    onCanPlay,
    onEnded,
    onError,
    preferNativeHls,
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
    clearStartupAutoplayRecovery();
    lastStartedSourceRef.current = null;
    pendingAutoplaySourceUrlRef.current = autoPlay && sessionWantsPlayback(sessionRef.current)
      ? src
      : null;

    void adapter.load({
      url: src,
      type: src.includes('.m3u8') ? 'hls' : 'mp4',
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

      const message = loadError instanceof Error ? loadError.message : 'Neuspešno učitavanje streama';
      if (switchToCatchUpFallbackIfAvailable('LOAD_FAILED')) {
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
    };
  }, [
    autoPlay,
    clearStartupAutoplayRecovery,
    exitPictureInPicture,
    isLocalRenderer,
    onCanPlay,
    onError,
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
