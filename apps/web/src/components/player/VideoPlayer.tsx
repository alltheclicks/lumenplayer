import { useRef, useEffect, useState, useCallback, forwardRef, useImperativeHandle } from 'react';
import Hls from 'hls.js';
import { AlertCircle, Loader2, WifiOff, ShieldAlert } from 'lucide-react';
import { useSessionContext } from '@/context/session-context';

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
  const hlsRef = useRef<Hls | null>(null);
  const isApplyingSessionSeekRef = useRef(false);
  const lastReportedPositionMsRef = useRef<number | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<PlayerError | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const playbackWantsPlaying =
    session.playback === 'playing' || session.playback === 'buffering';

  useImperativeHandle(ref, () => ({
    play: () => videoRef.current?.play(),
    pause: () => videoRef.current?.pause(),
    seek: (time: number) => {
      if (videoRef.current) {
        videoRef.current.currentTime = time;
      }
    },
    setVolume: (volume: number) => {
      if (videoRef.current) {
        videoRef.current.volume = Math.max(0, Math.min(1, volume));
      }
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
    getCurrentTime: () => videoRef.current?.currentTime || 0,
    getDuration: () => videoRef.current?.duration || 0,
    isPlaying: () => isPlaying,
  }));

  const isMixedContent = useCallback(() => {
    if (typeof window === 'undefined') return false;
    const isHttpsSite = window.location.protocol === 'https:';
    const isHttpSource = src.startsWith('http://');
    return isHttpsSite && isHttpSource;
  }, [src]);

  const destroyHls = useCallback(() => {
    if (hlsRef.current) {
      hlsRef.current.destroy();
      hlsRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (!src || !videoRef.current) return;

    setIsLoading(true);
    setError(null);
    isApplyingSessionSeekRef.current = false;
    lastReportedPositionMsRef.current = null;

    if (isMixedContent()) {
      setError({
        type: 'mixed-content',
        message: 'Cannot load stream',
        details: 'HTTPS page cannot access HTTP stream. Use HTTPS version of IPTV server or access app via HTTP.',
      });
      setIsLoading(false);
      onError?.('Mixed content blocked');
      return;
    }

    const video = videoRef.current;
    const isHls = src.includes('.m3u8');

    if (isHls) {
      if (Hls.isSupported()) {
        destroyHls();

        const hls = new Hls({
          enableWorker: true,
          lowLatencyMode: true,
          backBufferLength: 90,
          maxBufferLength: 30,
          maxMaxBufferLength: 600,
          maxBufferSize: 60 * 1000 * 1000,
          maxBufferHole: 0.5,
          startLevel: -1,
        });

        hls.loadSource(src);
        hls.attachMedia(video);

        hls.on(Hls.Events.MANIFEST_PARSED, () => {
          setIsLoading(false);
          if (autoPlay && playbackWantsPlaying) {
            video.play().catch(() => {});
          }
        });

        hls.on(Hls.Events.ERROR, (_, data) => {
          if (data.fatal) {
            switch (data.type) {
              case Hls.ErrorTypes.NETWORK_ERROR:
                setError({
                  type: 'network',
                  message: 'Network error',
                  details: 'Check your internet connection and server availability.',
                });
                hls.startLoad();
                break;
              case Hls.ErrorTypes.MEDIA_ERROR:
                setError({
                  type: 'format',
                  message: 'Media error',
                  details: 'Stream format not supported.',
                });
                hls.recoverMediaError();
                break;
              default:
                setError({
                  type: 'unknown',
                  message: 'Unknown error',
                  details: data.details || 'Please try again.',
                });
                destroyHls();
                break;
            }
            onError?.(data.details || 'HLS error');
          }
        });

        hlsRef.current = hls;
      } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
        video.src = src;
        setIsLoading(false);
        if (autoPlay && playbackWantsPlaying) {
          video.play().catch(() => {});
        }
      } else {
        setError({
          type: 'format',
          message: 'HLS not supported',
          details: 'Your browser does not support HLS streaming.',
        });
        setIsLoading(false);
        onError?.('HLS not supported');
      }
    } else {
      video.src = src;
      setIsLoading(false);
      if (autoPlay && playbackWantsPlaying) {
        video.play().catch(() => {});
      }
    }

    return () => {
      if (video) {
        video.pause();
        video.src = '';
        video.load();
      }
      destroyHls();
    };
  }, [autoPlay, destroyHls, isMixedContent, onError, playbackWantsPlaying, src]);

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
