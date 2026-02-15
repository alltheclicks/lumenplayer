import { useRef, useEffect, useState, useCallback, forwardRef, useImperativeHandle } from 'react';
import { AlertCircle, Loader2, WifiOff, ShieldAlert } from 'lucide-react';
import { useSessionContext } from '@/context/session-context';
import { HlsPlayerAdapter } from '@/adapters/HlsPlayerAdapter';
import type { PlaybackError } from '@lumen/types';
import type { SessionState } from '@lumen/session-core';

export interface VideoPlayerProps {
  poster?: string;
  autoPlay?: boolean;
  preferNativeHls?: boolean;
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
}

type PlayerError = {
  type: 'network' | 'mixed-content' | 'format' | 'unknown';
  message: string;
  details?: string;
};

const wantsPlayback = (session: SessionState): boolean => (
  session.playback === 'playing' || session.playback === 'buffering'
);

const VideoPlayer = forwardRef<VideoPlayerHandle, VideoPlayerProps>(({
  poster,
  autoPlay = true,
  preferNativeHls = false,
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
  const [error, setError] = useState<PlayerError | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const playbackWantsPlaying = wantsPlayback(session);

  useEffect(() => {
    sessionRef.current = session;
  }, [session]);

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
  }));

  const mapPlaybackError = useCallback((playbackError: PlaybackError): PlayerError => {
    if (playbackError.code === 'MIXED_CONTENT') {
      return {
        type: 'mixed-content',
        message: 'Cannot load stream',
        details: 'HTTPS page cannot access HTTP stream. Use HTTPS stream source or open app via HTTP.',
      };
    }

    if (playbackError.code === 'NETWORK_ERROR') {
      return {
        type: 'network',
        message: 'Network error',
        details: 'Check your internet connection and stream availability.',
      };
    }

    if (playbackError.code === 'MEDIA_ERROR' || playbackError.code === 'HLS_NOT_SUPPORTED') {
      return {
        type: 'format',
        message: 'Stream format not supported',
        details: playbackError.message,
      };
    }

    return {
      type: 'unknown',
      message: 'Playback error',
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
        setIsPlaying(true);
        setIsLoading(false);
        onCanPlay?.();

        if (!wantsPlayback(currentSession)) {
          commands.play();
        }
        return;
      }

      if (state === 'paused') {
        setIsPlaying(false);
        setIsLoading(false);

        if (currentSession.source && wantsPlayback(currentSession)) {
          commands.pause();
        }
        return;
      }

      if (state === 'ended') {
        setIsPlaying(false);
        setIsLoading(false);
        onEnded?.();
        return;
      }

      if (state === 'idle') {
        setIsPlaying(false);
        setIsLoading(false);
      }
    });

    const unsubscribeError = adapter.onError((playbackError) => {
      setError(mapPlaybackError(playbackError));
      setIsLoading(false);
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
      adapter.destroy();
      if (adapterRef.current === adapter) {
        adapterRef.current = null;
      }
    };
  }, [commands, mapPlaybackError, onCanPlay, onEnded, onError, preferNativeHls]);

  useEffect(() => {
    const adapter = adapterRef.current;
    if (!adapter) {
      return;
    }

    isApplyingSessionSeekRef.current = false;
    lastReportedPositionMsRef.current = null;

    if (!src) {
      setError(null);
      setIsLoading(false);
      setIsPlaying(false);
      adapter.stop();
      return;
    }

    let cancelled = false;
    setError(null);
    setIsLoading(true);

    void adapter.load({
      url: src,
      type: src.includes('.m3u8') ? 'hls' : 'mp4',
    }).then(() => {
      if (cancelled) {
        return;
      }

      setIsLoading(false);
      onCanPlay?.();
      if (autoPlay && wantsPlayback(sessionRef.current)) {
        adapter.play();
      }
    }).catch((loadError: unknown) => {
      if (cancelled) {
        return;
      }

      setIsLoading(false);
      const message = loadError instanceof Error ? loadError.message : 'Failed to load stream';
      setError((prev) => prev ?? {
        type: 'unknown',
        message: 'Cannot load stream',
        details: message,
      });
      onError?.(message);
    });

    return () => {
      cancelled = true;
    };
  }, [autoPlay, onCanPlay, onError, src]);

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

    if (!session.source) {
      adapter.pause();
      return;
    }

    if (playbackWantsPlaying) {
      adapter.play();
      return;
    }

    adapter.pause();
  }, [playbackWantsPlaying, session.source]);

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

      {isLoading && !error && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/50 z-10">
          <Loader2 className="w-12 h-12 text-primary animate-spin" />
        </div>
      )}

      {error && <ErrorDisplay error={error} />}
    </div>
  );
});

VideoPlayer.displayName = 'VideoPlayer';

export default VideoPlayer;
