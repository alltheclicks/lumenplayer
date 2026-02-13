import { useRef, useEffect, useState, useCallback, forwardRef, useImperativeHandle } from 'react';
import { AlertCircle, Loader2, WifiOff, ShieldAlert } from 'lucide-react';
import { useSessionContext } from '@/context/session-context';
import { HlsPlayerAdapter } from '@/adapters/HlsPlayerAdapter';
import type { PlaybackError } from '@lumen/types';

export interface VideoPlayerProps {
  poster?: string;
  autoPlay?: boolean;
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

const VideoPlayer = forwardRef<VideoPlayerHandle, VideoPlayerProps>(({
  poster,
  autoPlay = true,
  onError,
  onEnded,
  onCanPlay,
  className = '',
}, ref) => {
  const { session, commands } = useSessionContext();
  const src = session.source?.url ?? '';
  const videoRef = useRef<HTMLVideoElement>(null);
  const adapterRef = useRef<HlsPlayerAdapter | null>(null);
  const isApplyingSessionSeekRef = useRef(false);
  const lastReportedPositionMsRef = useRef<number | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<PlayerError | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const playbackWantsPlaying =
    session.playback === 'playing' || session.playback === 'buffering';

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
    if (!src || !videoRef.current) return;

    const video = videoRef.current;
    let cancelled = false;

    setIsLoading(true);
    setError(null);
    isApplyingSessionSeekRef.current = false;
    lastReportedPositionMsRef.current = null;

    const adapter = new HlsPlayerAdapter(video);
    adapterRef.current = adapter;

    const unsubscribeState = adapter.onStateChange((state) => {
      if (cancelled) {
        return;
      }

      if (state === 'loading' || state === 'buffering') {
        setIsLoading(true);
        return;
      }

      if (state === 'playing') {
        setIsPlaying(true);
      } else if (state === 'paused' || state === 'ended' || state === 'idle') {
        setIsPlaying(false);
      }

      if (state !== 'error') {
        setIsLoading(false);
      }
    });

    const unsubscribeError = adapter.onError((playbackError) => {
      if (cancelled) {
        return;
      }
      setError(mapPlaybackError(playbackError));
      setIsLoading(false);
      onError?.(playbackError.message);
    });

    void adapter.load({
      url: src,
      type: src.includes('.m3u8') ? 'hls' : 'mp4',
    }).then(() => {
      if (cancelled) {
        return;
      }
      if (autoPlay && playbackWantsPlaying) {
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
      unsubscribeState();
      unsubscribeError();
      adapter.destroy();
      if (adapterRef.current === adapter) {
        adapterRef.current = null;
      }
    };
  }, [autoPlay, mapPlaybackError, onError, playbackWantsPlaying, src]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const handlePlay = () => {
      setIsPlaying(true);
      if (!playbackWantsPlaying) {
        commands.play();
      }
    };

    const handlePause = () => {
      setIsPlaying(false);
      if (session.source && playbackWantsPlaying) {
        commands.pause();
      }
    };

    const handleEnded = () => {
      setIsPlaying(false);
      onEnded?.();
    };

    const handleCanPlay = () => {
      setIsLoading(false);
      onCanPlay?.();
    };

    const handleWaiting = () => {
      setIsLoading(true);
    };

    const handlePlaying = () => {
      setIsLoading(false);
    };

    const handleTimeUpdate = () => {
      if (!session.source) {
        return;
      }

      const currentPositionMs = Math.floor(video.currentTime * 1000);
      if (isApplyingSessionSeekRef.current) {
        if (
          session.positionMs === null ||
          Math.abs(currentPositionMs - session.positionMs) < 500
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
        session.positionMs !== null &&
        Math.abs(currentPositionMs - session.positionMs) < 1000
      ) {
        return;
      }

      lastReportedPositionMsRef.current = currentPositionMs;
      commands.seek(currentPositionMs);
    };

    const handleError = () => {
      const mediaError = video.error;
      if (mediaError) {
        let errorMessage = 'Playback error';
        switch (mediaError.code) {
          case MediaError.MEDIA_ERR_ABORTED:
            errorMessage = 'Playback aborted';
            break;
          case MediaError.MEDIA_ERR_NETWORK:
            errorMessage = 'Network error';
            break;
          case MediaError.MEDIA_ERR_DECODE:
            errorMessage = 'Decode error';
            break;
          case MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED:
            errorMessage = 'Format not supported';
            break;
        }
        setError({
          type: 'unknown',
          message: errorMessage,
          details: mediaError.message,
        });
        onError?.(errorMessage);
      }
    };

    video.addEventListener('play', handlePlay);
    video.addEventListener('pause', handlePause);
    video.addEventListener('timeupdate', handleTimeUpdate);
    video.addEventListener('ended', handleEnded);
    video.addEventListener('canplay', handleCanPlay);
    video.addEventListener('waiting', handleWaiting);
    video.addEventListener('playing', handlePlaying);
    video.addEventListener('error', handleError);

    return () => {
      video.removeEventListener('play', handlePlay);
      video.removeEventListener('pause', handlePause);
      video.removeEventListener('timeupdate', handleTimeUpdate);
      video.removeEventListener('ended', handleEnded);
      video.removeEventListener('canplay', handleCanPlay);
      video.removeEventListener('waiting', handleWaiting);
      video.removeEventListener('playing', handlePlaying);
      video.removeEventListener('error', handleError);
    };
  }, [
    commands,
    onCanPlay,
    onEnded,
    onError,
    playbackWantsPlaying,
    session.positionMs,
    session.source,
  ]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !session.source || session.positionMs === null) {
      return;
    }

    const targetTime = session.positionMs / 1000;
    if (Math.abs(video.currentTime - targetTime) < 1) {
      return;
    }

    isApplyingSessionSeekRef.current = true;
    video.currentTime = targetTime;
  }, [session.positionMs, session.source]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) {
      return;
    }

    if (!session.source) {
      if (!video.paused) {
        video.pause();
      }
      return;
    }

    if (playbackWantsPlaying) {
      if (video.paused) {
        video.play().catch(() => {});
      }
      return;
    }

    if (!video.paused) {
      video.pause();
    }
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
