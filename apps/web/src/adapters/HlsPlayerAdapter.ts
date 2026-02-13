import Hls, { type ErrorData } from 'hls.js';
import type {
  MediaSource,
  PlaybackError,
  PlaybackState,
  PlayerAdapter,
} from '@lumen/types';

const HLS_MIME_TYPE = 'application/vnd.apple.mpegurl';

type StateListener = (state: PlaybackState) => void;
type ErrorListener = (error: PlaybackError) => void;
type TimeListener = (time: number) => void;

export class HlsPlayerAdapter implements PlayerAdapter {
  private readonly video: HTMLVideoElement;
  private hls: Hls | null = null;
  private state: PlaybackState = 'idle';
  private readonly stateListeners = new Set<StateListener>();
  private readonly errorListeners = new Set<ErrorListener>();
  private readonly timeListeners = new Set<TimeListener>();
  private readonly removeVideoListeners: () => void;

  constructor(video: HTMLVideoElement) {
    this.video = video;
    this.removeVideoListeners = this.attachVideoListeners();
  }

  async load(source: MediaSource): Promise<void> {
    this.stop();
    this.clearHls();
    this.updateState('loading');

    if (this.isMixedContentBlocked(source.url)) {
      const error: PlaybackError = {
        code: 'MIXED_CONTENT',
        message: 'HTTPS page cannot access HTTP stream.',
        fatal: true,
      };
      this.emitError(error);
      throw new Error(error.message);
    }

    if (source.type === 'hls') {
      await this.loadHlsSource(source.url);
      return;
    }

    this.video.src = source.url;
    this.video.load();
    this.updateState('paused');
  }

  play(): void {
    this.video.play().catch(() => {
      this.emitError({
        code: 'PLAYBACK_START_FAILED',
        message: 'Unable to start playback.',
        fatal: false,
      });
    });
  }

  pause(): void {
    this.video.pause();
  }

  seek(time: number): void {
    this.video.currentTime = Math.max(0, time);
  }

  stop(): void {
    this.video.pause();
    this.video.removeAttribute('src');
    this.video.load();
    this.updateState('idle');
  }

  destroy(): void {
    this.clearHls();
    this.removeVideoListeners();
    this.stop();
    this.stateListeners.clear();
    this.errorListeners.clear();
    this.timeListeners.clear();
  }

  getCurrentTime(): number {
    return this.video.currentTime || 0;
  }

  getDuration(): number {
    return this.video.duration || 0;
  }

  getState(): PlaybackState {
    return this.state;
  }

  setVolume(volume: number): void {
    this.video.volume = Math.max(0, Math.min(1, volume));
  }

  getVolume(): number {
    return this.video.volume;
  }

  onStateChange(callback: StateListener): () => void {
    this.stateListeners.add(callback);
    return () => this.stateListeners.delete(callback);
  }

  onError(callback: ErrorListener): () => void {
    this.errorListeners.add(callback);
    return () => this.errorListeners.delete(callback);
  }

  onTimeUpdate(callback: TimeListener): () => void {
    this.timeListeners.add(callback);
    return () => this.timeListeners.delete(callback);
  }

  private async loadHlsSource(url: string): Promise<void> {
    if (Hls.isSupported()) {
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

      await new Promise<void>((resolve, reject) => {
        const onManifestParsed = () => {
          cleanup();
          this.updateState('paused');
          resolve();
        };

        const onHlsError = (_event: string, data: ErrorData) => {
          const mappedError = this.mapHlsError(data);
          this.emitError(mappedError);

          if (!data.fatal) {
            return;
          }

          cleanup();
          hls.destroy();
          reject(new Error(mappedError.message));
        };

        const cleanup = () => {
          hls.off(Hls.Events.MANIFEST_PARSED, onManifestParsed);
          hls.off(Hls.Events.ERROR, onHlsError);
        };

        hls.on(Hls.Events.MANIFEST_PARSED, onManifestParsed);
        hls.on(Hls.Events.ERROR, onHlsError);
        hls.loadSource(url);
        hls.attachMedia(this.video);
      });

      this.hls = hls;
      return;
    }

    if (this.video.canPlayType(HLS_MIME_TYPE)) {
      this.video.src = url;
      this.video.load();
      this.updateState('paused');
      return;
    }

    const error: PlaybackError = {
      code: 'HLS_NOT_SUPPORTED',
      message: 'Your browser does not support HLS playback.',
      fatal: true,
    };
    this.emitError(error);
    throw new Error(error.message);
  }

  private attachVideoListeners(): () => void {
    const handlePlay = () => this.updateState('playing');
    const handlePause = () => this.updateState('paused');
    const handleWaiting = () => this.updateState('buffering');
    const handleEnded = () => this.updateState('ended');
    const handleSeeking = () => this.updateState('seeking');
    const handleSeeked = () => this.updateState(this.video.paused ? 'paused' : 'playing');
    const handleTimeUpdate = () => {
      this.timeListeners.forEach((listener) => listener(this.video.currentTime));
    };
    const handleError = () => {
      const mediaError = this.video.error;
      if (!mediaError) {
        return;
      }

      this.emitError({
        code: `MEDIA_ELEMENT_${mediaError.code}`,
        message: mediaError.message || 'Playback error',
        fatal: mediaError.code === MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED,
      });
    };

    this.video.addEventListener('play', handlePlay);
    this.video.addEventListener('pause', handlePause);
    this.video.addEventListener('waiting', handleWaiting);
    this.video.addEventListener('ended', handleEnded);
    this.video.addEventListener('seeking', handleSeeking);
    this.video.addEventListener('seeked', handleSeeked);
    this.video.addEventListener('timeupdate', handleTimeUpdate);
    this.video.addEventListener('error', handleError);

    return () => {
      this.video.removeEventListener('play', handlePlay);
      this.video.removeEventListener('pause', handlePause);
      this.video.removeEventListener('waiting', handleWaiting);
      this.video.removeEventListener('ended', handleEnded);
      this.video.removeEventListener('seeking', handleSeeking);
      this.video.removeEventListener('seeked', handleSeeked);
      this.video.removeEventListener('timeupdate', handleTimeUpdate);
      this.video.removeEventListener('error', handleError);
    };
  }

  private clearHls(): void {
    if (!this.hls) {
      return;
    }
    this.hls.destroy();
    this.hls = null;
  }

  private mapHlsError(data: ErrorData): PlaybackError {
    if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
      return {
        code: 'NETWORK_ERROR',
        message: 'Network error while loading stream.',
        fatal: data.fatal,
        details: data.details,
      };
    }

    if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
      return {
        code: 'MEDIA_ERROR',
        message: 'Media error while decoding stream.',
        fatal: data.fatal,
        details: data.details,
      };
    }

    return {
      code: 'HLS_ERROR',
      message: data.details || 'Unknown HLS playback error.',
      fatal: data.fatal,
      details: data.details,
    };
  }

  private emitError(error: PlaybackError): void {
    this.updateState('error');
    this.errorListeners.forEach((listener) => listener(error));
  }

  private updateState(nextState: PlaybackState): void {
    if (this.state === nextState) {
      return;
    }
    this.state = nextState;
    this.stateListeners.forEach((listener) => listener(nextState));
  }

  private isMixedContentBlocked(url: string): boolean {
    if (typeof window === 'undefined') {
      return false;
    }
    return window.location.protocol === 'https:' && url.startsWith('http://');
  }
}

export default HlsPlayerAdapter;
