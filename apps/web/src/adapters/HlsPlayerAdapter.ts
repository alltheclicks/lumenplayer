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

type StateListener = (state: PlaybackState) => void;
type ErrorListener = (error: PlaybackError) => void;
type TimeListener = (time: number) => void;
type AudioTracksListener = (tracks: AudioTrackOption[], selectedTrackId: string | null) => void;
type SubtitleTracksListener = (
  tracks: SubtitleTrackOption[],
  selectedTrackId: string | null
) => void;

interface HlsPlayerAdapterOptions {
  preferNativeHls?: boolean;
}

interface NativeAudioTrack {
  enabled?: boolean;
  language?: string;
  label?: string;
}

interface NativeAudioTrackListLike {
  length: number;
  [index: number]: NativeAudioTrack;
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

  constructor(video: HTMLVideoElement, options: HlsPlayerAdapterOptions = {}) {
    this.video = video;
    this.preferNativeHls = options.preferNativeHls ?? false;
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
    this.audioTracks = [];
    this.selectedAudioTrackId = null;
    this.subtitleTracks = [];
    this.selectedSubtitleTrackId = null;
    this.emitAudioTracksChange();
    this.emitSubtitleTracksChange();
    this.updateState('idle');
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

  private async loadHlsSource(url: string): Promise<void> {
    if (this.preferNativeHls && this.video.canPlayType(HLS_MIME_TYPE)) {
      this.video.src = url;
      this.video.load();
      this.syncNativeAudioTracks();
      this.syncNativeSubtitleTracks();
      this.updateState('paused');
      return;
    }

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
      this.hls = hls;

      try {
        await new Promise<void>((resolve, reject) => {
          const onManifestParsed = () => {
            this.syncHlsAudioTracks(hls.audioTrack);
            this.syncHlsSubtitleTracks(hls.subtitleTrack);
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

          const cleanup = () => {
            hls.off(Hls.Events.MANIFEST_PARSED, onManifestParsed);
            hls.off(Hls.Events.ERROR, onHlsError);
            hls.off(Hls.Events.AUDIO_TRACKS_UPDATED, onAudioTracksUpdated);
            hls.off(Hls.Events.AUDIO_TRACK_SWITCHED, onAudioTrackSwitched);
            hls.off(Hls.Events.SUBTITLE_TRACKS_UPDATED, onSubtitleTracksUpdated);
            hls.off(Hls.Events.SUBTITLE_TRACK_SWITCH, onSubtitleTrackSwitched);
          };

          hls.on(Hls.Events.MANIFEST_PARSED, onManifestParsed);
          hls.on(Hls.Events.ERROR, onHlsError);
          hls.on(Hls.Events.AUDIO_TRACKS_UPDATED, onAudioTracksUpdated);
          hls.on(Hls.Events.AUDIO_TRACK_SWITCHED, onAudioTrackSwitched);
          hls.on(Hls.Events.SUBTITLE_TRACKS_UPDATED, onSubtitleTracksUpdated);
          hls.on(Hls.Events.SUBTITLE_TRACK_SWITCH, onSubtitleTrackSwitched);
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
    const handleLoadedMetadata = () => {
      this.syncNativeAudioTracks();
      this.syncNativeSubtitleTracks();
    };

    this.video.addEventListener('play', handlePlay);
    this.video.addEventListener('pause', handlePause);
    this.video.addEventListener('waiting', handleWaiting);
    this.video.addEventListener('ended', handleEnded);
    this.video.addEventListener('seeking', handleSeeking);
    this.video.addEventListener('seeked', handleSeeked);
    this.video.addEventListener('timeupdate', handleTimeUpdate);
    this.video.addEventListener('error', handleError);
    this.video.addEventListener('loadedmetadata', handleLoadedMetadata);

    const nativeTextTracks = this.getNativeTextTracks();
    const nativeTextTracksTarget = nativeTextTracks as (
      NativeTextTrackListLike & { addEventListener?: (event: string, handler: () => void) => void }
    ) | null;

    nativeTextTracksTarget?.addEventListener?.('change', handleLoadedMetadata);

    return () => {
      this.video.removeEventListener('play', handlePlay);
      this.video.removeEventListener('pause', handlePause);
      this.video.removeEventListener('waiting', handleWaiting);
      this.video.removeEventListener('ended', handleEnded);
      this.video.removeEventListener('seeking', handleSeeking);
      this.video.removeEventListener('seeked', handleSeeked);
      this.video.removeEventListener('timeupdate', handleTimeUpdate);
      this.video.removeEventListener('error', handleError);
      this.video.removeEventListener('loadedmetadata', handleLoadedMetadata);
      (
        nativeTextTracks as (
          NativeTextTrackListLike & { removeEventListener?: (event: string, handler: () => void) => void }
        ) | null
      )?.removeEventListener?.('change', handleLoadedMetadata);
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
        isDefault: index === 0,
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
}

export default HlsPlayerAdapter;
