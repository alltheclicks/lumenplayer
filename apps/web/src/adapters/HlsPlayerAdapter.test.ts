import { describe, expect, it, vi } from 'vitest';

const hlsMockState = vi.hoisted(() => {
  const instances: MockHls[] = [];

  class MockHls {
    static readonly Events = {
      MEDIA_ATTACHED: 'mediaAttached',
      MANIFEST_PARSED: 'manifestParsed',
      MANIFEST_LOADED: 'manifestLoaded',
      ERROR: 'error',
      AUDIO_TRACKS_UPDATED: 'audioTracksUpdated',
      AUDIO_TRACK_SWITCHED: 'audioTrackSwitched',
      SUBTITLE_TRACKS_UPDATED: 'subtitleTracksUpdated',
      SUBTITLE_TRACK_SWITCH: 'subtitleTrackSwitch',
    } as const;

    static readonly ErrorTypes = {
      NETWORK_ERROR: 'networkError',
      MEDIA_ERROR: 'mediaError',
      OTHER_ERROR: 'otherError',
    } as const;

    static isSupported(): boolean {
      return true;
    }

    readonly on = vi.fn((event: string, handler: (...args: unknown[]) => void) => {
      const handlers = this.handlers.get(event) ?? [];
      handlers.push(handler);
      this.handlers.set(event, handlers);
    });

    readonly off = vi.fn((event: string, handler: (...args: unknown[]) => void) => {
      const handlers = this.handlers.get(event) ?? [];
      this.handlers.set(event, handlers.filter((entry) => entry !== handler));
    });

    readonly loadSource = vi.fn();
    readonly attachMedia = vi.fn();
    readonly recoverMediaError = vi.fn();
    readonly destroy = vi.fn();
    readonly audioTracks: Array<{ name?: string; lang?: string; default?: boolean }> = [];
    readonly subtitleTracks: Array<{ name?: string; lang?: string; default?: boolean }> = [];
    audioTrack = -1;
    subtitleTrack = -1;

    private readonly handlers = new Map<string, Array<(...args: unknown[]) => void>>();

    constructor(_config?: unknown) {
      instances.push(this);
    }

    emit(event: string, data?: unknown): void {
      for (const handler of this.handlers.get(event) ?? []) {
        handler(event, data);
      }
    }
  }

  return { MockHls, instances };
});

vi.mock('hls.js', () => ({
  __esModule: true,
  default: hlsMockState.MockHls,
  ErrorTypes: hlsMockState.MockHls.ErrorTypes,
}));

import { HlsPlayerAdapter } from './HlsPlayerAdapter';

const buildSource = (url: string) => ({
  url,
  type: 'mp4' as const,
  title: 'Test Source',
});

describe('HlsPlayerAdapter', () => {
  const createMockVideoElement = () => {
    const listeners = new Map<string, Set<() => void>>();
    const video = {
      src: '',
      currentTime: 0,
      duration: 0,
      volume: 1,
      paused: false,
      error: null,
      addEventListener: vi.fn((event: string, handler: () => void) => {
        const handlers = listeners.get(event) ?? new Set<() => void>();
        handlers.add(handler);
        listeners.set(event, handlers);
      }),
      removeEventListener: vi.fn((event: string, handler: () => void) => {
        listeners.get(event)?.delete(handler);
      }),
      removeAttribute: vi.fn((attribute: string) => {
        if (attribute === 'src') {
          video.src = '';
        }
      }),
      pause: vi.fn(() => {
        video.paused = true;
      }),
      load: vi.fn(),
      play: vi.fn(async () => {
        video.paused = false;
      }),
      canPlayType: vi.fn(() => ''),
      dispatchEvent: (event: string) => {
        for (const handler of listeners.get(event) ?? []) {
          handler();
        }
      },
    };

    return video as unknown as HTMLVideoElement;
  };

  it('avoids extra media-element flush when switching sources through load()', async () => {
    const video = createMockVideoElement();
    const loadSpy = vi.spyOn(video, 'load');
    const adapter = new HlsPlayerAdapter(video);

    await adapter.load(buildSource('https://example.com/stream-a.mp4'));
    await adapter.load(buildSource('https://example.com/stream-b.mp4'));

    expect(loadSpy).toHaveBeenCalledTimes(2);
    expect(video.src).toBe('https://example.com/stream-b.mp4');
  });

  it('still flushes media element when stop() is explicitly requested', async () => {
    const video = createMockVideoElement();
    const loadSpy = vi.spyOn(video, 'load');
    const adapter = new HlsPlayerAdapter(video);

    await adapter.load(buildSource('https://example.com/stream-a.mp4'));
    expect(loadSpy).toHaveBeenCalledTimes(1);

    adapter.stop();
    expect(loadSpy).toHaveBeenCalledTimes(2);
  });

  it('recovers fatal HLS media errors instead of destroying playback immediately', async () => {
    const video = createMockVideoElement();
    const adapter = new HlsPlayerAdapter(video);
    const source = {
      url: 'https://example.com/archive.m3u8',
      type: 'hls' as const,
      title: 'Archive',
    };

    const loadPromise = adapter.load(source);
    const hls = hlsMockState.instances.at(-1);
    expect(hls).toBeDefined();

    hls?.emit(hlsMockState.MockHls.Events.MANIFEST_LOADED, { url: source.url });
    hls?.emit(hlsMockState.MockHls.Events.MANIFEST_PARSED);
    await loadPromise;

    hls?.emit(hlsMockState.MockHls.Events.ERROR, {
      fatal: true,
      type: hlsMockState.MockHls.ErrorTypes.MEDIA_ERROR,
      details: 'bufferStalledError',
    });

    expect(hls?.recoverMediaError).toHaveBeenCalledTimes(1);
    expect(hls?.destroy).not.toHaveBeenCalled();
  });

  it('rejects startup after a second fatal HLS media error recovery attempt', async () => {
    const video = createMockVideoElement();
    const adapter = new HlsPlayerAdapter(video);
    const source = {
      url: 'https://example.com/archive.m3u8',
      type: 'hls' as const,
      title: 'Archive',
    };

    const loadPromise = adapter.load(source);
    const hls = hlsMockState.instances.at(-1);
    expect(hls).toBeDefined();

    hls?.emit(hlsMockState.MockHls.Events.ERROR, {
      fatal: true,
      type: hlsMockState.MockHls.ErrorTypes.MEDIA_ERROR,
      details: 'bufferStalledError',
    });
    hls?.emit(hlsMockState.MockHls.Events.ERROR, {
      fatal: true,
      type: hlsMockState.MockHls.ErrorTypes.MEDIA_ERROR,
      details: 'bufferStalledError',
    });

    expect(hls?.recoverMediaError).toHaveBeenCalledTimes(1);
    expect(hls?.destroy).toHaveBeenCalledTimes(1);
    await expect(loadPromise).rejects.toThrow('Media error while decoding stream.');
  });

  it('attempts HLS media recovery when buffering stalls without progress', async () => {
    vi.useFakeTimers();

    try {
      const video = createMockVideoElement();
      const adapter = new HlsPlayerAdapter(video);
      const source = {
        url: 'https://example.com/archive.m3u8',
        type: 'hls' as const,
        title: 'Archive',
        metadata: {
          mode: 'catchup',
        },
      };

      const loadPromise = adapter.load(source);
      const hls = hlsMockState.instances.at(-1);
      hls?.emit(hlsMockState.MockHls.Events.MANIFEST_LOADED, { url: source.url });
      hls?.emit(hlsMockState.MockHls.Events.MANIFEST_PARSED);
      await loadPromise;

      const mutableVideo = video as unknown as {
        paused: boolean;
        currentTime: number;
        dispatchEvent: (event: string) => void;
      };
      mutableVideo.paused = false;
      mutableVideo.currentTime = 229;
      mutableVideo.dispatchEvent('waiting');
      await vi.advanceTimersByTimeAsync(4_000);

      expect(hls?.recoverMediaError).toHaveBeenCalledTimes(1);
      expect(video.play).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('cancels buffering recovery when playback time advances again', async () => {
    vi.useFakeTimers();

    try {
      const video = createMockVideoElement();
      const adapter = new HlsPlayerAdapter(video);
      const source = {
        url: 'https://example.com/archive.m3u8',
        type: 'hls' as const,
        title: 'Archive',
        metadata: {
          mode: 'catchup',
        },
      };

      const loadPromise = adapter.load(source);
      const hls = hlsMockState.instances.at(-1);
      hls?.emit(hlsMockState.MockHls.Events.MANIFEST_LOADED, { url: source.url });
      hls?.emit(hlsMockState.MockHls.Events.MANIFEST_PARSED);
      await loadPromise;

      video.currentTime = 229;
      (video as unknown as { dispatchEvent: (event: string) => void }).dispatchEvent('waiting');
      video.currentTime = 230.5;
      (video as unknown as { dispatchEvent: (event: string) => void }).dispatchEvent('timeupdate');
      await vi.advanceTimersByTimeAsync(4_000);

      expect(hls?.recoverMediaError).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});
