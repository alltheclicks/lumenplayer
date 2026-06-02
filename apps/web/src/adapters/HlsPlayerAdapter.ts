import Hls, { type ErrorData } from 'hls.js';
import type {
  AudioTrackOption,
  MediaSource,
  PlaybackError,
  PlaybackState,
  PlayerAdapter,
  SubtitleTrackOption,
} from '@lumen/types';

const HLS_MIME_TYPE = 'application/vnd.apple.mpegurl';
const HLS_BUFFERING_RECOVERY_DELAY_MS = 4_000;
const HLS_BUFFERING_PROGRESS_TOLERANCE_SECONDS = 0.25;
const HLS_BUFFERING_MAX_RECOVERY_ATTEMPTS = 2;
const HLS_CATCHUP_SAFE_RETRY_START_POSITION_SECONDS = 75;
const HLS_CATCHUP_MAX_BUFFER_LENGTH_SECONDS = 90;
const HLS_CATCHUP_MAX_BUFFER_SIZE_MB = 180;
const HLS_LIVE_MAX_BUFFER_LENGTH_SECONDS = 30;
const HLS_LIVE_MAX_BUFFER_SIZE_MB = 60;

type StateListener = (state: PlaybackState) => void;
type ErrorListener = (error: PlaybackError) => void;
type TimeListener = (time: number) => void;
type AudioTracksListener = (tracks: AudioTrackOption[], selectedTrackId: string | null) => void;
type SubtitleTracksListener = (
  tracks: SubtitleTrackOption[],
  selectedTrackId: string | null
) => void;

interface ManifestResolvedEvent {
  requestedUrl: string;
  manifestUrl: string;
  finalUrl: string | null;
}

interface HlsPlayerAdapterOptions {
  preferNativeHls?: boolean;
  onManifestResolved?: (event: ManifestResolvedEvent) => void;
}

type PlaybackMetadataCarrier = MediaSource & {
  metadata?: {
    mode?: unknown;
    catchUpHlsStartupMode?: unknown;
    catchUpHlsStartPositionSeconds?: unknown;
  };
};

type CatchUpHlsStartupMode = 'progressive' | 'complete';

const parsePositiveFiniteNumber = (value: unknown): number => {
  const numericValue = typeof value === 'number'
    ? value
    : (typeof value === 'string' ? Number(value) : NaN);
  return Number.isFinite(numericValue) && numericValue > 0 ? numericValue : 0;
};

interface NativeAudioTrack {
  enabled?: boolean;
  language?: string;
  label?: string;
}

interface NativeAudioTrackListLike {
  length: number;
  [index: number]: NativeAudioTrack;
  addEventListener?: (event: string, handler: () => void) => void;
  removeEventListener?: (event: string, handler: () => void) => void;
}

interface NativeTextTrack {
  mode: string;
  language?: string;
  label?: string;
  kind?: string;
}

interface NativeTextTrackListLike {
  length: number;
  [index: number]: NativeTextTrack;
  addEventListener?: (event: string, handler: () => void) => void;
  removeEventListener?: (event: string, handler: () => void) => void;
}

export class HlsPlayerAdapter implements PlayerAdapter {
  private readonly video: HTMLVideoElement;
  private readonly preferNativeHls: boolean;
  private hls: Hls | null = null;
  private audioTracks: AudioTrackOption[] = [];
  private selectedAudioTrackId: string | null = null;
  private subtitleTracks: SubtitleTrackOption[] = [];
  private selectedSubtitleTrackId: string | null = null;
  private state: PlaybackState = 'idle';
  private readonly stateListeners = new Set<StateListener>();
  private readonly errorListeners = new Set<ErrorListener>();
  private readonly timeListeners = new Set<TimeListener>();
  private readonly audioTracksListeners = new Set<AudioTracksListener>();
  private readonly subtitleTracksListeners = new Set<SubtitleTracksListener>();
  private readonly removeVideoListeners: () => void;
  private readonly onManifestResolved?: (event: ManifestResolvedEvent) => void;
  private bufferingRecoveryTimer: ReturnType<typeof setTimeout> | null = null;
  private bufferingRecoveryAttempts = 0;
  private bufferingRecoveryEnabled = false;
  private bufferingRecoveryArmed = false;

  constructor(video: HTMLVideoElement, options: HlsPlayerAdapterOptions = {}) {
    this.video = video;
    this.preferNativeHls = options.preferNativeHls ?? false;
    this.onManifestResolved = options.onManifestResolved;
    this.removeVideoListeners = this.attachVideoListeners();
  }

  async load(source: MediaSource): Promise<void> {
    this.clearHls();
    this.resetPlaybackState(false);
    this.updateState('loading');
    this.bufferingRecoveryEnabled = (
      (source as PlaybackMetadataCarrier).metadata?.mode === 'catchup'
    );
    this.bufferingRecoveryArmed = false;

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
      const sourceMode = (source as PlaybackMetadataCarrier).metadata?.mode;
      const catchUpStartPositionSeconds = parsePositiveFiniteNumber(
        (source as PlaybackMetadataCarrier).metadata?.catchUpHlsStartPositionSeconds,
      );
      const catchUpStartupMode = (
        (source as PlaybackMetadataCarrier).metadata?.catchUpHlsStartupMode === 'complete'
          ? 'complete'
          : 'progressive'
      );
      await this.loadHlsSource(
        source.url,
        sourceMode === 'live',
        sourceMode === 'catchup',
        0,
        catchUpStartupMode,
        catchUpStartPositionSeconds,
      );
      return;
    }

    this.video.src = source.url;
    this.video.load();
    this.updateState('paused');
  }

  play(): void {
    this.video.play().catch((error: unknown) => {
      const message = error instanceof Error && error.message
        ? `Unable to start playback: ${error.name}: ${error.message}`
        : 'Unable to start playback.';
      this.emitError({
        code: 'PLAYBACK_START_FAILED',
        message,
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
    this.clearHls();
    this.resetPlaybackState(true);
  }

  destroy(): void {
    this.clearHls();
    this.removeVideoListeners();
    this.stop();
    this.stateListeners.clear();
    this.errorListeners.clear();
    this.timeListeners.clear();
    this.audioTracksListeners.clear();
    this.subtitleTracksListeners.clear();
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

  getAudioTracks(): AudioTrackOption[] {
    return this.audioTracks;
  }

  getSelectedAudioTrackId(): string | null {
    return this.selectedAudioTrackId;
  }

  getSubtitleTracks(): SubtitleTrackOption[] {
    return this.subtitleTracks;
  }

  getSelectedSubtitleTrackId(): string | null {
    return this.selectedSubtitleTrackId;
  }

  setAudioTrack(trackId: string): boolean {
    const selectedTrack = this.audioTracks.find((track) => track.id === trackId);
    if (!selectedTrack) {
      return false;
    }

    if (this.hls) {
      const hlsIndex = this.parseTrackIndex(trackId, 'hls-');
      if (hlsIndex === null || hlsIndex < 0 || hlsIndex >= this.hls.audioTracks.length) {
        return false;
      }
      this.hls.audioTrack = hlsIndex;
      this.selectedAudioTrackId = trackId;
      this.emitAudioTracksChange();
      return true;
    }

    const nativeAudioTracks = this.getNativeAudioTracks();
    if (nativeAudioTracks) {
      const nativeIndex = this.parseTrackIndex(trackId, 'native-');
      if (nativeIndex === null || nativeIndex < 0 || nativeIndex >= nativeAudioTracks.length) {
        return false;
      }

      for (let index = 0; index < nativeAudioTracks.length; index += 1) {
        nativeAudioTracks[index].enabled = index === nativeIndex;
      }

      this.syncNativeAudioTracks();
      return true;
    }

    return false;
  }

  setSubtitleTrack(trackId: string | null): boolean {
    if (trackId !== null) {
      const selectedTrack = this.subtitleTracks.find((track) => track.id === trackId);
      if (!selectedTrack) {
        return false;
      }
    }

    if (this.hls) {
      if (trackId === null) {
        this.hls.subtitleTrack = -1;
        this.selectedSubtitleTrackId = null;
        this.emitSubtitleTracksChange();
        return true;
      }

      const hlsIndex = this.parseTrackIndex(trackId, 'hls-subtitle-');
      if (hlsIndex === null || hlsIndex < 0 || hlsIndex >= this.hls.subtitleTracks.length) {
        return false;
      }

      this.hls.subtitleTrack = hlsIndex;
      this.selectedSubtitleTrackId = trackId;
      this.emitSubtitleTracksChange();
      return true;
    }

    const nativeTextTracks = this.getNativeTextTracks();
    if (nativeTextTracks) {
      if (trackId === null) {
        for (let index = 0; index < nativeTextTracks.length; index += 1) {
          nativeTextTracks[index].mode = 'disabled';
        }
        this.syncNativeSubtitleTracks();
        return true;
      }

      const nativeIndex = this.parseTrackIndex(trackId, 'native-subtitle-');
      if (nativeIndex === null || nativeIndex < 0 || nativeIndex >= nativeTextTracks.length) {
        return false;
      }

      for (let index = 0; index < nativeTextTracks.length; index += 1) {
        nativeTextTracks[index].mode = index === nativeIndex ? 'showing' : 'disabled';
      }

      this.syncNativeSubtitleTracks();
      return true;
    }

    return false;
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

  onAudioTracksChange(callback: AudioTracksListener): () => void {
    this.audioTracksListeners.add(callback);
    callback(this.audioTracks, this.selectedAudioTrackId);
    return () => this.audioTracksListeners.delete(callback);
  }

  onSubtitleTracksChange(callback: SubtitleTracksListener): () => void {
    this.subtitleTracksListeners.add(callback);
    callback(this.subtitleTracks, this.selectedSubtitleTrackId);
    return () => this.subtitleTracksListeners.delete(callback);
  }

  private async loadHlsSource(
    url: string,
    isLiveSource = false,
    isCatchUpSource = false,
    liveStartupMediaRetryCount = 0,
    catchUpStartupMode: CatchUpHlsStartupMode = 'progressive',
    catchUpStartPositionSeconds = 0,
  ): Promise<void> {
    if (this.preferNativeHls && this.video.canPlayType(HLS_MIME_TYPE)) {
      this.video.src = url;
      this.video.load();
      this.syncNativeAudioTracks();
      this.syncNativeSubtitleTracks();
      this.updateState('paused');
      return;
    }

    if (Hls.isSupported()) {
      const useProgressiveCatchUpStartup = isCatchUpSource && catchUpStartupMode === 'progressive';
      const shouldUseProgressiveLoading = isLiveSource || useProgressiveCatchUpStartup;
      const safeCatchUpStartPositionSeconds = (
        isCatchUpSource && catchUpStartPositionSeconds > 0
          ? Math.max(0, catchUpStartPositionSeconds)
          : -1
      );
      const hls = new Hls({
        enableWorker: !isLiveSource,
        lowLatencyMode: isLiveSource,
        startPosition: safeCatchUpStartPositionSeconds,
        ...(shouldUseProgressiveLoading ? { progressive: true } : {}),
        ...(useProgressiveCatchUpStartup ? {
          fragLoadingTimeOut: 60_000,
          startFragPrefetch: true,
        } : {}),
        backBufferLength: 90,
        maxBufferLength: isCatchUpSource
          ? HLS_CATCHUP_MAX_BUFFER_LENGTH_SECONDS
          : HLS_LIVE_MAX_BUFFER_LENGTH_SECONDS,
        maxMaxBufferLength: 600,
        maxBufferSize: (
          isCatchUpSource
            ? HLS_CATCHUP_MAX_BUFFER_SIZE_MB
            : HLS_LIVE_MAX_BUFFER_SIZE_MB
        ) * 1000 * 1000,
        maxBufferHole: 0.5,
        startLevel: -1,
      });
      this.hls = hls;

      try {
        await new Promise<void>((resolve, reject) => {
          let mediaErrorRecoveryAttempted = false;
          let liveStartupBufferSeekApplied = false;
          let startupSettled = false;

          const resolveStartup = () => {
            startupSettled = true;
            resolve();
          };

          const rejectStartup = (error: Error) => {
            startupSettled = true;
            reject(error);
          };

          const seekLiveStartupToBufferedRange = () => {
            if (!isLiveSource || liveStartupBufferSeekApplied) {
              return;
            }

            const buffered = this.video.buffered;
            if (!buffered || buffered.length === 0) {
              return;
            }

            let bufferStart: number;
            try {
              bufferStart = buffered.start(0);
            } catch {
              return;
            }

            if (!Number.isFinite(bufferStart)) {
              return;
            }

            const currentTime = this.video.currentTime || 0;
            if (currentTime + 0.1 >= bufferStart) {
              return;
            }

            liveStartupBufferSeekApplied = true;
            this.video.currentTime = bufferStart + 0.05;
            if (!this.video.paused) {
              this.video.play().catch(() => {
                // The normal autoplay recovery path will retry play() if this fails.
              });
            }
          };

          const onManifestParsed = () => {
            this.syncHlsAudioTracks(hls.audioTrack);
            this.syncHlsSubtitleTracks(hls.subtitleTrack);
            cleanupStartupListeners();
            this.updateState('paused');
            resolveStartup();
          };

          const onManifestLoaded = (
            _event: string,
            data: {
              url?: string;
              networkDetails?: unknown;
            },
          ) => {
            const manifestUrl = typeof data.url === 'string' && data.url.length > 0
              ? data.url
              : url;
            this.onManifestResolved?.({
              requestedUrl: url,
              manifestUrl,
              finalUrl: HlsPlayerAdapter.resolveNetworkResponseUrl(
                data.networkDetails,
                manifestUrl,
              ),
            });
          };

          const onHlsError = (_event: string, data: ErrorData) => {
            if (this.hls !== hls) {
              return;
            }

            if (data.fatal && data.type === Hls.ErrorTypes.MEDIA_ERROR) {
              if (
                isLiveSource &&
                liveStartupMediaRetryCount < 1 &&
                (this.video.currentTime || 0) <= 0.25
              ) {
                cleanupStartupListeners();
                hls.destroy();
                if (this.hls === hls) {
                  this.hls = null;
                }

                const shouldResumePlayback = !this.video.paused;
                this.updateState('loading');
                const retryStartup = this.loadHlsSource(
                  url,
                  isLiveSource,
                  isCatchUpSource,
                  liveStartupMediaRetryCount + 1,
                ).then(() => {
                  if (shouldResumePlayback) {
                    this.play();
                  }
                });

                if (startupSettled) {
                  retryStartup.catch((error: unknown) => {
                    const mappedError = this.mapHlsError(data);
                    this.emitError({
                      ...mappedError,
                      message: error instanceof Error ? error.message : mappedError.message,
                    });
                  });
                } else {
                  retryStartup.then(resolveStartup).catch((error: unknown) => {
                    rejectStartup(error instanceof Error
                      ? error
                      : new Error('Media error while decoding stream.'));
                  });
                }
                return;
              }

              if (
                isCatchUpSource &&
                !this.bufferingRecoveryArmed &&
                (this.video.currentTime || 0) <= 0.25
              ) {
                if (catchUpStartupMode === 'progressive') {
                  cleanupStartupListeners();
                  hls.destroy();
                  if (this.hls === hls) {
                    this.hls = null;
                  }

                  const shouldResumePlayback = !this.video.paused;
                  this.updateState('loading');
                  const retryStartPositionSeconds = Math.max(
                    catchUpStartPositionSeconds,
                    HLS_CATCHUP_SAFE_RETRY_START_POSITION_SECONDS,
                  );
                  const retryStartup = this.loadHlsSource(
                    url,
                    isLiveSource,
                    isCatchUpSource,
                    liveStartupMediaRetryCount,
                    'complete',
                    retryStartPositionSeconds,
                  ).then(() => {
                    if (shouldResumePlayback) {
                      this.play();
                    }
                  });

                  if (startupSettled) {
                    retryStartup.catch((error: unknown) => {
                      const mappedError = this.mapHlsError(data);
                      this.emitError({
                        ...mappedError,
                        message: error instanceof Error ? error.message : mappedError.message,
                      });
                    });
                  } else {
                    retryStartup.then(resolveStartup).catch((error: unknown) => {
                      rejectStartup(error instanceof Error
                        ? error
                        : new Error('Media error while decoding stream.'));
                    });
                  }
                  return;
                }

                const mappedError = this.mapHlsError(data);
                this.emitError(mappedError);
                cleanupStartupListeners();
                hls.destroy();
                if (this.hls === hls) {
                  this.hls = null;
                }
                rejectStartup(new Error(mappedError.message));
                return;
              }

              if (!mediaErrorRecoveryAttempted) {
                mediaErrorRecoveryAttempted = true;
                hls.recoverMediaError();
                return;
              }

              const mappedError = this.mapHlsError(data);
              this.emitError(mappedError);
              cleanupStartupListeners();
              hls.destroy();
              reject(new Error(mappedError.message));
              return;
            }

            const mappedError = this.mapHlsError(data);
            this.emitError(mappedError);

            if (!data.fatal) {
              return;
            }

            cleanupStartupListeners();
            hls.destroy();
            reject(new Error(mappedError.message));
          };

          const onAudioTracksUpdated = () => {
            this.syncHlsAudioTracks(hls.audioTrack);
          };

          const onAudioTrackSwitched = () => {
            this.syncHlsAudioTracks(hls.audioTrack);
          };

          const onSubtitleTracksUpdated = () => {
            this.syncHlsSubtitleTracks(hls.subtitleTrack);
          };

          const onSubtitleTrackSwitched = () => {
            this.syncHlsSubtitleTracks(hls.subtitleTrack);
          };

          const onBufferAppended = () => {
            seekLiveStartupToBufferedRange();
          };

          const cleanupStartupListeners = () => {
            hls.off(Hls.Events.MANIFEST_PARSED, onManifestParsed);
            hls.off(Hls.Events.MANIFEST_LOADED, onManifestLoaded);
          };

          hls.on(Hls.Events.MANIFEST_LOADED, onManifestLoaded);
          hls.on(Hls.Events.MANIFEST_PARSED, onManifestParsed);
          hls.on(Hls.Events.ERROR, onHlsError);
          hls.on(Hls.Events.AUDIO_TRACKS_UPDATED, onAudioTracksUpdated);
          hls.on(Hls.Events.AUDIO_TRACK_SWITCHED, onAudioTrackSwitched);
          hls.on(Hls.Events.SUBTITLE_TRACKS_UPDATED, onSubtitleTracksUpdated);
          hls.on(Hls.Events.SUBTITLE_TRACK_SWITCH, onSubtitleTrackSwitched);
          hls.on(Hls.Events.BUFFER_APPENDED, onBufferAppended);
          hls.loadSource(url);
          hls.attachMedia(this.video);
        });
      } catch (error) {
        if (this.hls === hls) {
          this.hls = null;
        }
        throw error;
      }

      return;
    }

    if (this.video.canPlayType(HLS_MIME_TYPE)) {
      this.video.src = url;
      this.video.load();
      this.syncNativeAudioTracks();
      this.syncNativeSubtitleTracks();
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

  private static resolveNetworkResponseUrl(
    networkDetails: unknown,
    fallbackUrl: string,
  ): string | null {
    if (!networkDetails || typeof networkDetails !== 'object') {
      return fallbackUrl || null;
    }

    const details = networkDetails as {
      responseURL?: unknown;
      url?: unknown;
    };
    if (typeof details.responseURL === 'string' && details.responseURL.length > 0) {
      return details.responseURL;
    }
    if (typeof details.url === 'string' && details.url.length > 0) {
      return details.url;
    }

    return fallbackUrl || null;
  }

  private attachVideoListeners(): () => void {
    const handlePlaying = () => {
      this.bufferingRecoveryArmed = true;
      this.resetBufferingRecovery();
      this.updateState('playing');
    };
    const handlePause = () => {
      this.clearBufferingRecoveryTimer();
      this.updateState('paused');
    };
    const handleWaiting = () => {
      this.updateState('buffering');
      this.scheduleBufferingRecovery();
    };
    const handleEnded = () => {
      this.bufferingRecoveryArmed = false;
      this.resetBufferingRecovery();
      this.updateState('ended');
    };
    const handleSeeking = () => {
      this.clearBufferingRecoveryTimer();
      this.updateState('seeking');
    };
    const handleSeeked = () => {
      this.clearBufferingRecoveryTimer();
      this.updateState(this.video.paused ? 'paused' : 'playing');
    };
    const handleTimeUpdate = () => {
      if ((this.video.currentTime || 0) > 0.25) {
        this.bufferingRecoveryArmed = true;
      }
      this.resetBufferingRecovery();
      this.timeListeners.forEach((listener) => listener(this.video.currentTime));
    };
    const handleError = () => {
      const mediaError = this.video.error;
      if (!mediaError) {
        return;
      }

      const isSrcNotSupported = mediaError.code === MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED;
      const isManagedByHls = this.hls !== null;

      this.emitError({
        code: `MEDIA_ELEMENT_${mediaError.code}`,
        message: mediaError.message || 'Playback error',
        // When hls.js is attached, code 4 can be emitted during segment retries
        // and should not immediately hard-stop playback/fallback flow.
        fatal: isSrcNotSupported && !isManagedByHls,
      });
    };
    const handleLoadedMetadata = () => {
      this.syncNativeAudioTracks();
      this.syncNativeSubtitleTracks();
    };
    const handleNativeAudioTracksChange = () => {
      this.syncNativeAudioTracks();
    };
    const handleNativeTextTracksChange = () => {
      this.syncNativeSubtitleTracks();
    };

    this.video.addEventListener('playing', handlePlaying);
    this.video.addEventListener('pause', handlePause);
    this.video.addEventListener('waiting', handleWaiting);
    this.video.addEventListener('ended', handleEnded);
    this.video.addEventListener('seeking', handleSeeking);
    this.video.addEventListener('seeked', handleSeeked);
    this.video.addEventListener('timeupdate', handleTimeUpdate);
    this.video.addEventListener('error', handleError);
    this.video.addEventListener('loadedmetadata', handleLoadedMetadata);

    const nativeAudioTracks = this.getNativeAudioTracks();
    const nativeTextTracks = this.getNativeTextTracks();

    nativeAudioTracks?.addEventListener?.('change', handleNativeAudioTracksChange);
    nativeAudioTracks?.addEventListener?.('addtrack', handleNativeAudioTracksChange);
    nativeAudioTracks?.addEventListener?.('removetrack', handleNativeAudioTracksChange);
    nativeTextTracks?.addEventListener?.('change', handleNativeTextTracksChange);
    nativeTextTracks?.addEventListener?.('addtrack', handleNativeTextTracksChange);
    nativeTextTracks?.addEventListener?.('removetrack', handleNativeTextTracksChange);

    return () => {
      this.video.removeEventListener('playing', handlePlaying);
      this.video.removeEventListener('pause', handlePause);
      this.video.removeEventListener('waiting', handleWaiting);
      this.video.removeEventListener('ended', handleEnded);
      this.video.removeEventListener('seeking', handleSeeking);
      this.video.removeEventListener('seeked', handleSeeked);
      this.video.removeEventListener('timeupdate', handleTimeUpdate);
      this.video.removeEventListener('error', handleError);
      this.video.removeEventListener('loadedmetadata', handleLoadedMetadata);
      nativeAudioTracks?.removeEventListener?.('change', handleNativeAudioTracksChange);
      nativeAudioTracks?.removeEventListener?.('addtrack', handleNativeAudioTracksChange);
      nativeAudioTracks?.removeEventListener?.('removetrack', handleNativeAudioTracksChange);
      nativeTextTracks?.removeEventListener?.('change', handleNativeTextTracksChange);
      nativeTextTracks?.removeEventListener?.('addtrack', handleNativeTextTracksChange);
      nativeTextTracks?.removeEventListener?.('removetrack', handleNativeTextTracksChange);
    };
  }

  private clearHls(): void {
    this.resetBufferingRecovery();
    if (!this.hls) {
      return;
    }
    this.hls.stopLoad();
    this.hls.detachMedia();
    this.hls.destroy();
    this.hls = null;
  }

  private resetPlaybackState(flushMediaElement: boolean): void {
    this.resetBufferingRecovery();
    this.video.pause();
    this.video.removeAttribute('src');
    if (flushMediaElement) {
      this.video.load();
    }
    this.audioTracks = [];
    this.selectedAudioTrackId = null;
    this.subtitleTracks = [];
    this.selectedSubtitleTrackId = null;
    this.bufferingRecoveryArmed = false;
    this.emitAudioTracksChange();
    this.emitSubtitleTracksChange();
    this.updateState('idle');
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
    if (error.fatal) {
      this.updateState('error');
    }
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

  private syncHlsAudioTracks(selectedIndex: number): void {
    if (!this.hls) {
      this.audioTracks = [];
      this.selectedAudioTrackId = null;
      this.emitAudioTracksChange();
      return;
    }

    this.audioTracks = this.hls.audioTracks.map((track, index) => ({
      id: `hls-${index}`,
      label: track.name || track.lang || `Track ${index + 1}`,
      language: track.lang || null,
      isDefault: Boolean(track.default),
    }));

    const safeSelectedIndex = (
      selectedIndex >= 0 && selectedIndex < this.audioTracks.length
    ) ? selectedIndex : 0;
    this.selectedAudioTrackId = this.audioTracks.length > 0
      ? this.audioTracks[safeSelectedIndex]?.id ?? null
      : null;
    this.emitAudioTracksChange();
  }

  private syncHlsSubtitleTracks(selectedIndex: number): void {
    if (!this.hls) {
      this.subtitleTracks = [];
      this.selectedSubtitleTrackId = null;
      this.emitSubtitleTracksChange();
      return;
    }

    this.subtitleTracks = this.hls.subtitleTracks.map((track, index) => ({
      id: `hls-subtitle-${index}`,
      label: track.name || track.lang || `Subtitle ${index + 1}`,
      language: track.lang || null,
      isDefault: Boolean(track.default),
    }));

    if (selectedIndex < 0 || selectedIndex >= this.subtitleTracks.length) {
      this.selectedSubtitleTrackId = null;
      this.emitSubtitleTracksChange();
      return;
    }

    this.selectedSubtitleTrackId = this.subtitleTracks[selectedIndex]?.id ?? null;
    this.emitSubtitleTracksChange();
  }

  private syncNativeAudioTracks(): void {
    const nativeAudioTracks = this.getNativeAudioTracks();
    if (!nativeAudioTracks || nativeAudioTracks.length === 0) {
      this.audioTracks = [];
      this.selectedAudioTrackId = null;
      this.emitAudioTracksChange();
      return;
    }

    const mappedTracks: AudioTrackOption[] = [];
    let selectedId: string | null = null;

    for (let index = 0; index < nativeAudioTracks.length; index += 1) {
      const track = nativeAudioTracks[index];
      const id = `native-${index}`;
      mappedTracks.push({
        id,
        label: track.label || track.language || `Track ${index + 1}`,
        language: track.language || null,
        isDefault: index === 0,
      });

      if (track.enabled) {
        selectedId = id;
      }
    }

    this.audioTracks = mappedTracks;
    this.selectedAudioTrackId = selectedId ?? mappedTracks[0]?.id ?? null;
    this.emitAudioTracksChange();
  }

  private syncNativeSubtitleTracks(): void {
    const nativeTextTracks = this.getNativeTextTracks();
    if (!nativeTextTracks || nativeTextTracks.length === 0) {
      this.subtitleTracks = [];
      this.selectedSubtitleTrackId = null;
      this.emitSubtitleTracksChange();
      return;
    }

    const mappedTracks: SubtitleTrackOption[] = [];
    let selectedId: string | null = null;

    for (let index = 0; index < nativeTextTracks.length; index += 1) {
      const track = nativeTextTracks[index];
      const kind = track.kind?.toLowerCase() ?? '';
      if (kind && kind !== 'subtitles' && kind !== 'captions') {
        continue;
      }

      const id = `native-subtitle-${index}`;
      mappedTracks.push({
        id,
        label: track.label || track.language || `Subtitle ${mappedTracks.length + 1}`,
        language: track.language || null,
        isDefault: mappedTracks.length === 0,
      });

      if (track.mode === 'showing' || track.mode === 'hidden') {
        selectedId = id;
      }
    }

    this.subtitleTracks = mappedTracks;
    this.selectedSubtitleTrackId = selectedId;
    this.emitSubtitleTracksChange();
  }

  private getNativeAudioTracks(): NativeAudioTrackListLike | null {
    const elementWithTracks = this.video as HTMLVideoElement & { audioTracks?: NativeAudioTrackListLike };
    return elementWithTracks.audioTracks ?? null;
  }

  private getNativeTextTracks(): NativeTextTrackListLike | null {
    const elementWithTracks = this.video as HTMLVideoElement & { textTracks?: NativeTextTrackListLike };
    return elementWithTracks.textTracks ?? null;
  }

  private parseTrackIndex(trackId: string, prefix: string): number | null {
    if (!trackId.startsWith(prefix)) {
      return null;
    }

    const numericIndex = Number(trackId.slice(prefix.length));
    if (!Number.isInteger(numericIndex)) {
      return null;
    }

    return numericIndex;
  }

  private emitAudioTracksChange(): void {
    this.audioTracksListeners.forEach((listener) => {
      listener(this.audioTracks, this.selectedAudioTrackId);
    });
  }

  private emitSubtitleTracksChange(): void {
    this.subtitleTracksListeners.forEach((listener) => {
      listener(this.subtitleTracks, this.selectedSubtitleTrackId);
    });
  }

  private clearBufferingRecoveryTimer(): void {
    if (this.bufferingRecoveryTimer !== null) {
      clearTimeout(this.bufferingRecoveryTimer);
      this.bufferingRecoveryTimer = null;
    }
  }

  private resetBufferingRecovery(): void {
    this.clearBufferingRecoveryTimer();
    this.bufferingRecoveryAttempts = 0;
  }

  private scheduleBufferingRecovery(): void {
    if (
      !this.bufferingRecoveryEnabled ||
      !this.bufferingRecoveryArmed ||
      !this.hls ||
      this.video.paused ||
      this.bufferingRecoveryAttempts >= HLS_BUFFERING_MAX_RECOVERY_ATTEMPTS
    ) {
      return;
    }

    this.clearBufferingRecoveryTimer();
    const checkpointSeconds = this.video.currentTime || 0;
    this.bufferingRecoveryTimer = setTimeout(() => {
      this.bufferingRecoveryTimer = null;

      if (!this.hls || this.video.paused || this.state !== 'buffering') {
        return;
      }

      const currentTime = this.video.currentTime || 0;
      if (
        Math.abs(currentTime - checkpointSeconds) >
        HLS_BUFFERING_PROGRESS_TOLERANCE_SECONDS
      ) {
        this.resetBufferingRecovery();
        return;
      }

      this.bufferingRecoveryAttempts += 1;
      this.hls.recoverMediaError();
      this.video.play().catch(() => {
        // Ignore autoplay rejections; this recovery path is best-effort only.
      });

      if (this.bufferingRecoveryAttempts < HLS_BUFFERING_MAX_RECOVERY_ATTEMPTS) {
        this.scheduleBufferingRecovery();
      }
    }, HLS_BUFFERING_RECOVERY_DELAY_MS);
  }
}

export default HlsPlayerAdapter;
