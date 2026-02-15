import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { SessionState } from '@lumen/session-core';
import type { SessionCommands } from '@/hooks/useSessionCommands';

const GOOGLE_CAST_SCRIPT_ID = 'lumen-google-cast-sdk';
const GOOGLE_CAST_SCRIPT_SRC =
  'https://www.gstatic.com/cv/js/sender/v1/cast_sender.js?loadCastFramework=1';
const DEFAULT_CAST_RECEIVER_APP_ID = 'CC1AD845';
const CAST_POSITION_SYNC_INTERVAL_MS = 2000;
const CAST_POSITION_SYNC_THRESHOLD_MS = 1500;

type CastSessionState =
  | 'NO_SESSION'
  | 'SESSION_STARTING'
  | 'SESSION_STARTED'
  | 'SESSION_START_FAILED'
  | 'SESSION_ENDING'
  | 'SESSION_ENDED'
  | 'SESSION_RESUMED';

interface CastDevice {
  friendlyName?: string;
}

interface CastMedia {
  contentId?: string;
}

interface CastMediaSession {
  media?: CastMedia;
  playerState?: string;
  currentTime?: number;
  play(): void | Promise<void>;
  pause(): void | Promise<void>;
  seek(request: unknown): void | Promise<void>;
}

interface CastSession {
  getCastDevice(): CastDevice;
  getMediaSession(): CastMediaSession | null;
  loadMedia(request: unknown): void | Promise<void>;
}

interface CastContextEvent {
  sessionState: CastSessionState;
}

interface CastContext {
  setOptions(options: {
    receiverApplicationId: string;
    autoJoinPolicy: string;
  }): void;
  requestSession(): Promise<void>;
  endCurrentSession(stopCasting: boolean): void;
  getCurrentSession(): CastSession | null;
  addEventListener(type: string, listener: (event: CastContextEvent) => void): void;
  removeEventListener(type: string, listener: (event: CastContextEvent) => void): void;
}

interface CastFrameworkAPI {
  CastContext: {
    getInstance(): CastContext;
  };
  CastContextEventType: {
    SESSION_STATE_CHANGED: string;
  };
  SessionState: Record<CastSessionState, CastSessionState>;
}

interface ChromeCastMediaAPI {
  MediaInfo: new (contentId: string, contentType: string) => { metadata?: { title?: string } };
  GenericMediaMetadata: new () => { title?: string };
  LoadRequest: new (mediaInfo: unknown) => { autoplay?: boolean; currentTime?: number };
  SeekRequest: new () => { currentTime?: number };
}

interface ChromeCastAPI {
  AutoJoinPolicy: {
    ORIGIN_SCOPED: string;
  };
  media: ChromeCastMediaAPI;
}

declare global {
  interface Window {
    __onGCastApiAvailable?: (isAvailable: boolean) => void;
    cast?: {
      framework?: CastFrameworkAPI;
    };
    chrome?: {
      cast?: ChromeCastAPI;
    };
  }
}

let castSdkPromise: Promise<void> | null = null;

const wantsPlaying = (session: SessionState): boolean => (
  session.playback === 'playing' || session.playback === 'buffering'
);

const ensureGoogleCastSdk = (): Promise<void> => {
  if (typeof window === 'undefined') {
    return Promise.reject(new Error('Google Cast is only available in browsers.'));
  }

  if (window.cast?.framework && window.chrome?.cast) {
    return Promise.resolve();
  }

  if (castSdkPromise) {
    return castSdkPromise;
  }

  castSdkPromise = new Promise<void>((resolve, reject) => {
    let settled = false;
    const resolveSdk = () => {
      if (settled) {
        return;
      }
      settled = true;
      resolve();
    };
    const rejectSdk = (message: string) => {
      if (settled) {
        return;
      }
      settled = true;
      castSdkPromise = null;
      reject(new Error(message));
    };

    const existingScript = document.getElementById(GOOGLE_CAST_SCRIPT_ID) as HTMLScriptElement | null;
    const previousCallback = window.__onGCastApiAvailable;

    const handleApiAvailable = (isAvailable: boolean) => {
      previousCallback?.(isAvailable);
      if (isAvailable && window.cast?.framework && window.chrome?.cast) {
        resolveSdk();
        return;
      }

      rejectSdk('Google Cast API is unavailable.');
    };

    window.__onGCastApiAvailable = handleApiAvailable;

    if (existingScript) {
      if (window.cast?.framework && window.chrome?.cast) {
        resolveSdk();
        return;
      }

      const startedAt = Date.now();
      const intervalId = window.setInterval(() => {
        if (window.cast?.framework && window.chrome?.cast) {
          window.clearInterval(intervalId);
          resolveSdk();
          return;
        }

        if (Date.now() - startedAt > 8000) {
          window.clearInterval(intervalId);
          rejectSdk('Google Cast script exists but API did not become available.');
        }
      }, 100);
      return;
    }

    const script = document.createElement('script');
    script.id = GOOGLE_CAST_SCRIPT_ID;
    script.src = GOOGLE_CAST_SCRIPT_SRC;
    script.async = true;
    script.onerror = () => {
      rejectSdk('Failed to load Google Cast SDK.');
    };
    document.head.appendChild(script);
  });

  return castSdkPromise;
};

const getCastContext = (): CastContext | null => {
  return window.cast?.framework?.CastContext.getInstance() ?? null;
};

const getSourceContentType = (type: string): string => {
  switch (type) {
    case 'hls':
      return 'application/x-mpegURL';
    case 'dash':
      return 'application/dash+xml';
    case 'mp4':
      return 'video/mp4';
    default:
      return 'application/octet-stream';
  }
};

interface UseGoogleCastSenderOptions {
  session: SessionState;
  commands: SessionCommands;
}

export interface GoogleCastSenderState {
  isAvailable: boolean;
  isConnected: boolean;
  isConnecting: boolean;
  deviceName: string | null;
  error: string | null;
  startCasting: () => Promise<void>;
  stopCasting: () => void;
  toggleCasting: () => Promise<void>;
}

export const useGoogleCastSender = ({
  session,
  commands,
}: UseGoogleCastSenderOptions): GoogleCastSenderState => {
  const [isAvailable, setIsAvailable] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [deviceName, setDeviceName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const sessionRef = useRef(session);
  const syncInProgressRef = useRef(false);
  const pendingSyncUpdateRef = useRef(false);
  const [syncRetryTick, setSyncRetryTick] = useState(0);
  const lastLoadedSourceUrlRef = useRef<string | null>(null);
  const lastSyncedCastPositionMsRef = useRef<number | null>(null);

  useEffect(() => {
    sessionRef.current = session;
  }, [session]);

  const syncSessionFromCastMedia = useCallback(() => {
    const castContext = getCastContext();
    const castSession = castContext?.getCurrentSession() ?? null;
    const mediaSession = castSession?.getMediaSession() ?? null;
    const currentSession = sessionRef.current;
    if (!mediaSession || currentSession.renderer !== 'cast') {
      return;
    }

    const currentTime = mediaSession.currentTime;
    if (typeof currentTime === 'number' && Number.isFinite(currentTime)) {
      const positionMs = Math.max(0, Math.floor(currentTime * 1000));
      const knownPositionMs = currentSession.positionMs;
      const lastSyncedCastPositionMs = lastSyncedCastPositionMsRef.current;
      const divergesFromSession = knownPositionMs === null ||
        Math.abs(knownPositionMs - positionMs) >= CAST_POSITION_SYNC_THRESHOLD_MS;
      const divergesFromPreviousSync = lastSyncedCastPositionMs === null ||
        Math.abs(lastSyncedCastPositionMs - positionMs) >= 1000;

      if (divergesFromSession && divergesFromPreviousSync) {
        lastSyncedCastPositionMsRef.current = positionMs;
        commands.seek(positionMs);
      }
    }

    if (
      (mediaSession.playerState === 'PLAYING' || mediaSession.playerState === 'BUFFERING')
      && !wantsPlaying(currentSession)
    ) {
      commands.play();
      return;
    }

    if (mediaSession.playerState === 'PAUSED' && wantsPlaying(currentSession)) {
      commands.pause();
    }
  }, [commands]);

  useEffect(() => {
    let cancelled = false;
    let castContext: CastContext | null = null;

    const configureCast = async () => {
      try {
        await ensureGoogleCastSdk();
        if (cancelled) {
          return;
        }

        castContext = getCastContext();
        const chromeCast = window.chrome?.cast;
        if (!castContext || !chromeCast) {
          return;
        }

        castContext.setOptions({
          receiverApplicationId:
            import.meta.env.VITE_GOOGLE_CAST_APP_ID || DEFAULT_CAST_RECEIVER_APP_ID,
          autoJoinPolicy: chromeCast.AutoJoinPolicy.ORIGIN_SCOPED,
        });

        const handleSessionChange = (event: CastContextEvent) => {
          const currentSession = castContext?.getCurrentSession() ?? null;
          const connected = Boolean(currentSession);
          setIsConnected(connected);
          setDeviceName(currentSession?.getCastDevice()?.friendlyName ?? null);

          if (event.sessionState === window.cast?.framework?.SessionState.SESSION_START_FAILED) {
            setError('Failed to start Cast session.');
          } else {
            setError(null);
          }

          if (connected && sessionRef.current.renderer !== 'cast') {
            commands.switchRenderer('cast');
          }

          if (!connected && sessionRef.current.renderer === 'cast') {
            syncSessionFromCastMedia();
            commands.switchRenderer('local-web');
            lastLoadedSourceUrlRef.current = null;
            lastSyncedCastPositionMsRef.current = null;
          }

          setIsConnecting(event.sessionState === window.cast?.framework?.SessionState.SESSION_STARTING);
        };

        castContext.addEventListener(
          window.cast.framework.CastContextEventType.SESSION_STATE_CHANGED,
          handleSessionChange
        );

        const initialSession = castContext.getCurrentSession();
        setIsAvailable(true);
        setIsConnected(Boolean(initialSession));
        setDeviceName(initialSession?.getCastDevice()?.friendlyName ?? null);
        setIsConnecting(false);
        setError(null);

        return () => {
          castContext?.removeEventListener(
            window.cast?.framework?.CastContextEventType.SESSION_STATE_CHANGED ?? '',
            handleSessionChange
          );
        };
      } catch (loadError) {
        if (!cancelled) {
          const message = loadError instanceof Error ? loadError.message : 'Cast unavailable.';
          setError(message);
          setIsAvailable(false);
        }
      }

      return undefined;
    };

    let removeListener: (() => void) | undefined;
    void configureCast().then((cleanup) => {
      removeListener = cleanup;
    });

    return () => {
      cancelled = true;
      removeListener?.();
    };
  }, [commands, syncSessionFromCastMedia]);

  useEffect(() => {
    if (!isConnected || session.renderer !== 'cast') {
      return;
    }

    const syncFromCast = () => {
      if (syncInProgressRef.current) {
        return;
      }

      syncSessionFromCastMedia();
    };

    syncFromCast();
    const intervalId = window.setInterval(syncFromCast, CAST_POSITION_SYNC_INTERVAL_MS);
    return () => {
      window.clearInterval(intervalId);
    };
  }, [isConnected, session.renderer, syncSessionFromCastMedia]);

  useEffect(() => {
    if (!isConnected || session.renderer !== 'cast' || !session.source) {
      pendingSyncUpdateRef.current = false;
      return;
    }

    if (syncInProgressRef.current) {
      pendingSyncUpdateRef.current = true;
      return;
    }

    const castContext = getCastContext();
    const castSession = castContext?.getCurrentSession() ?? null;
    const chromeMedia = window.chrome?.cast?.media;
    if (!castSession || !chromeMedia) {
      return;
    }

    syncInProgressRef.current = true;
    const wantsPlaying = session.playback === 'playing' || session.playback === 'buffering';

    void (async () => {
      try {
        let mediaSession = castSession.getMediaSession();
        const targetUrl = session.source?.url ?? null;
        if (!targetUrl) {
          return;
        }

        if (
          !mediaSession ||
          mediaSession.media?.contentId !== targetUrl ||
          lastLoadedSourceUrlRef.current !== targetUrl
        ) {
          const mediaInfo = new chromeMedia.MediaInfo(
            targetUrl,
            getSourceContentType(session.source.type)
          );

          if (session.source.title) {
            const metadata = new chromeMedia.GenericMediaMetadata();
            metadata.title = session.source.title;
            mediaInfo.metadata = metadata;
          }

          const loadRequest = new chromeMedia.LoadRequest(mediaInfo);
          loadRequest.autoplay = wantsPlaying;
          loadRequest.currentTime = Math.max(0, (session.positionMs ?? 0) / 1000);
          await Promise.resolve(castSession.loadMedia(loadRequest));
          lastLoadedSourceUrlRef.current = targetUrl;
          mediaSession = castSession.getMediaSession();
        }

        if (!mediaSession) {
          return;
        }

        const targetPositionSeconds = Math.max(0, (session.positionMs ?? 0) / 1000);
        if (
          session.positionMs !== null &&
          Math.abs((mediaSession.currentTime ?? 0) - targetPositionSeconds) > 3
        ) {
          const seekRequest = new chromeMedia.SeekRequest();
          seekRequest.currentTime = targetPositionSeconds;
          await Promise.resolve(mediaSession.seek(seekRequest));
        }

        if (wantsPlaying && mediaSession.playerState === 'PAUSED') {
          await Promise.resolve(mediaSession.play());
        } else if (!wantsPlaying && mediaSession.playerState === 'PLAYING') {
          await Promise.resolve(mediaSession.pause());
        }
      } catch (syncError) {
        const message = syncError instanceof Error ? syncError.message : 'Failed to sync Cast media.';
        setError(message);
      } finally {
        syncInProgressRef.current = false;
        if (pendingSyncUpdateRef.current) {
          pendingSyncUpdateRef.current = false;
          setSyncRetryTick((value) => value + 1);
        }
      }
    })();
  }, [isConnected, session.playback, session.positionMs, session.renderer, session.source, syncRetryTick]);

  const startCasting = useCallback(async () => {
    try {
      setIsConnecting(true);
      setError(null);
      await ensureGoogleCastSdk();
      const castContext = getCastContext();
      if (!castContext) {
        throw new Error('Google Cast context unavailable.');
      }

      await castContext.requestSession();
    } catch (requestError) {
      const message = requestError instanceof Error ? requestError.message : 'Unable to start casting.';
      setError(message);
    } finally {
      setIsConnecting(false);
    }
  }, []);

  const stopCasting = useCallback(() => {
    const castContext = getCastContext();
    if (!castContext) {
      return;
    }

    syncSessionFromCastMedia();
    castContext.endCurrentSession(true);
    setIsConnected(false);
    setDeviceName(null);
    lastLoadedSourceUrlRef.current = null;
    lastSyncedCastPositionMsRef.current = null;
    if (sessionRef.current.renderer === 'cast') {
      commands.switchRenderer('local-web');
    }
  }, [commands, syncSessionFromCastMedia]);

  const toggleCasting = useCallback(async () => {
    if (isConnected) {
      stopCasting();
      return;
    }

    await startCasting();
  }, [isConnected, startCasting, stopCasting]);

  return useMemo(
    () => ({
      isAvailable,
      isConnected,
      isConnecting,
      deviceName,
      error,
      startCasting,
      stopCasting,
      toggleCasting,
    }),
    [deviceName, error, isAvailable, isConnected, isConnecting, startCasting, stopCasting, toggleCasting]
  );
};

export default useGoogleCastSender;
