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
      BUFFER_APPENDED: 'bufferAppended',
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
    readonly detachMedia = vi.fn();
    readonly stopLoad = vi.fn();
    readonly recoverMediaError = vi.fn();
    readonly destroy = vi.fn();
    readonly audioTracks: Array<{ name?: string; lang?: string; default?: boolean }> = [];
    readonly subtitleTracks: Array<{ name?: string; lang?: string; default?: boolean }> = [];
    readonly config: unknown;
    audioTrack = -1;
    subtitleTrack = -1;

    private readonly handlers = new Map<string, Array<(...args: unknown[]) => void>>();

    constructor(config?: unknown) {
      this.config = config;
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
      readyState: 0,
      videoWidth: 0,
      error: null,
      buffered: {
        length: 0,
        start: vi.fn(() => 0),
        end: vi.fn(() => 0),
      },
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

  it('uses progressive non-prefetch startup for live HLS', async () => {
    const video = createMockVideoElement();
    const adapter = new HlsPlayerAdapter(video);
    const source = {
      url: 'https://example.com/live.m3u8',
      type: 'hls' as const,
      title: 'Live',
      metadata: {
        mode: 'live',
      },
    };

    const loadPromise = adapter.load(source);
    const hls = hlsMockState.instances.at(-1);
    expect(hls).toBeDefined();
    expect(hls?.config).toMatchObject({
      enableWorker: false,
      lowLatencyMode: true,
      progressive: true,
      maxBufferLength: 30,
      maxMaxBufferLength: 600,
    });
    expect(hls?.config).not.toHaveProperty('startFragPrefetch');

    hls?.emit(hlsMockState.MockHls.Events.MANIFEST_LOADED, { url: source.url });
    hls?.emit(hlsMockState.MockHls.Events.MANIFEST_PARSED);
    await loadPromise;
  });

  it('retries live HLS startup immediately after a fatal media error', async () => {
    const video = createMockVideoElement();
    const adapter = new HlsPlayerAdapter(video);
    const source = {
      url: 'https://example.com/live.m3u8',
      type: 'hls' as const,
      title: 'Live',
      metadata: {
        mode: 'live',
      },
    };

    const loadPromise = adapter.load(source);
    const firstHls = hlsMockState.instances.at(-1);
    expect(firstHls).toBeDefined();

    firstHls?.emit(hlsMockState.MockHls.Events.ERROR, {
      fatal: true,
      type: hlsMockState.MockHls.ErrorTypes.MEDIA_ERROR,
      details: 'bufferAppendError',
    });

    expect(firstHls?.recoverMediaError).not.toHaveBeenCalled();
    expect(firstHls?.destroy).toHaveBeenCalledTimes(1);

    const retryHls = hlsMockState.instances.at(-1);
    expect(retryHls).toBeDefined();
    expect(retryHls).not.toBe(firstHls);
    expect(retryHls?.config).toMatchObject({
      enableWorker: false,
      progressive: true,
    });

    retryHls?.emit(hlsMockState.MockHls.Events.MANIFEST_LOADED, { url: source.url });
    retryHls?.emit(hlsMockState.MockHls.Events.MANIFEST_PARSED);
    await loadPromise;
  });

  it('ignores stale HLS errors after switching sources', async () => {
    const video = createMockVideoElement();
    const adapter = new HlsPlayerAdapter(video);
    const errors: unknown[] = [];
    adapter.onError((error) => errors.push(error));

    const firstSource = {
      url: 'https://example.com/live-a.m3u8',
      type: 'hls' as const,
      metadata: {
        mode: 'live',
      },
    };
    const firstLoadPromise = adapter.load(firstSource);
    const firstHls = hlsMockState.instances.at(-1);
    expect(firstHls).toBeDefined();
    firstHls?.emit(hlsMockState.MockHls.Events.MANIFEST_LOADED, { url: 'https://example.com/live-a.m3u8' });
    firstHls?.emit(hlsMockState.MockHls.Events.MANIFEST_PARSED);
    await firstLoadPromise;

    const secondSource = {
      url: 'https://example.com/live-b.m3u8',
      type: 'hls' as const,
      metadata: {
        mode: 'live',
      },
    };
    const secondLoadPromise = adapter.load(secondSource);
    const secondHls = hlsMockState.instances.at(-1);
    expect(secondHls).toBeDefined();
    expect(secondHls).not.toBe(firstHls);

    firstHls?.emit(hlsMockState.MockHls.Events.ERROR, {
      fatal: true,
      type: hlsMockState.MockHls.ErrorTypes.NETWORK_ERROR,
      details: 'manifestLoadError',
    });
    expect(errors).toEqual([]);

    secondHls?.emit(hlsMockState.MockHls.Events.MANIFEST_LOADED, { url: 'https://example.com/live-b.m3u8' });
    secondHls?.emit(hlsMockState.MockHls.Events.MANIFEST_PARSED);
    await secondLoadPromise;
  });

  it('restarts live HLS startup and resumes playback after post-manifest fatal media recovery', async () => {
    const video = createMockVideoElement();
    const adapter = new HlsPlayerAdapter(video);
    const source = {
      url: 'https://example.com/live.m3u8',
      type: 'hls' as const,
      title: 'Live',
      metadata: {
        mode: 'live',
      },
    };

    const loadPromise = adapter.load(source);
    const firstHls = hlsMockState.instances.at(-1);
    expect(firstHls).toBeDefined();
    firstHls?.emit(hlsMockState.MockHls.Events.MANIFEST_LOADED, { url: source.url });
    firstHls?.emit(hlsMockState.MockHls.Events.MANIFEST_PARSED);
    await loadPromise;

    const mutableVideo = video as unknown as {
      paused: boolean;
      currentTime: number;
      play: ReturnType<typeof vi.fn>;
    };
    mutableVideo.paused = false;
    mutableVideo.currentTime = 0;

    firstHls?.emit(hlsMockState.MockHls.Events.ERROR, {
      fatal: true,
      type: hlsMockState.MockHls.ErrorTypes.MEDIA_ERROR,
      details: 'bufferAppendError',
    });

    expect(firstHls?.recoverMediaError).not.toHaveBeenCalled();
    expect(firstHls?.destroy).toHaveBeenCalledTimes(1);

    const retryHls = hlsMockState.instances.at(-1);
    expect(retryHls).toBeDefined();
    expect(retryHls).not.toBe(firstHls);
    retryHls?.emit(hlsMockState.MockHls.Events.MANIFEST_LOADED, { url: source.url });
    retryHls?.emit(hlsMockState.MockHls.Events.MANIFEST_PARSED);
    await Promise.resolve();
    await Promise.resolve();

    expect(mutableVideo.play).toHaveBeenCalledTimes(1);
  });

  it('seeks live startup to the first progressive buffered range', async () => {
    const video = createMockVideoElement();
    const adapter = new HlsPlayerAdapter(video);
    const source = {
      url: 'https://example.com/live.m3u8',
      type: 'hls' as const,
      title: 'Live',
      metadata: {
        mode: 'live',
      },
    };

    const loadPromise = adapter.load(source);
    const hls = hlsMockState.instances.at(-1);
    expect(hls).toBeDefined();

    hls?.emit(hlsMockState.MockHls.Events.MANIFEST_LOADED, { url: source.url });
    hls?.emit(hlsMockState.MockHls.Events.MANIFEST_PARSED);
    await loadPromise;

    const mutableVideo = video as unknown as {
      buffered: {
        length: number;
        start: ReturnType<typeof vi.fn>;
      };
      currentTime: number;
      paused: boolean;
      play: ReturnType<typeof vi.fn>;
    };
    mutableVideo.currentTime = 0;
    mutableVideo.paused = false;
    mutableVideo.buffered.length = 1;
    mutableVideo.buffered.start.mockReturnValue(30);

    hls?.emit(hlsMockState.MockHls.Events.BUFFER_APPENDED);

    expect(mutableVideo.currentTime).toBeCloseTo(30.05, 2);
    expect(mutableVideo.play).toHaveBeenCalledTimes(1);
  });

  it('uses progressive fragment startup for catch-up archives', async () => {
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
    expect(hls).toBeDefined();
    expect(hls?.config).toMatchObject({
      enableWorker: true,
      lowLatencyMode: false,
      startPosition: -1,
      progressive: true,
      fragLoadingTimeOut: 60_000,
      startFragPrefetch: true,
      maxBufferLength: 90,
      maxMaxBufferLength: 600,
      maxBufferSize: 180 * 1000 * 1000,
    });

    hls?.emit(hlsMockState.MockHls.Events.MANIFEST_LOADED, { url: source.url });
    hls?.emit(hlsMockState.MockHls.Events.MANIFEST_PARSED);
    await loadPromise;
  });

  it('starts catch-up HLS from the metadata start position when provided', async () => {
    const video = createMockVideoElement();
    const adapter = new HlsPlayerAdapter(video);
    const source = {
      url: 'https://example.com/archive.m3u8',
      type: 'hls' as const,
      title: 'Archive',
      metadata: {
        mode: 'catchup',
        catchUpHlsStartPositionSeconds: 61,
      },
    };

    const loadPromise = adapter.load(source);
    const hls = hlsMockState.instances.at(-1);
    expect(hls).toBeDefined();
    expect(hls?.config).toMatchObject({
      startPosition: 61,
      progressive: true,
      startFragPrefetch: true,
    });

    hls?.emit(hlsMockState.MockHls.Events.MANIFEST_LOADED, { url: source.url });
    hls?.emit(hlsMockState.MockHls.Events.MANIFEST_PARSED);
    await loadPromise;
  });

  it('uses complete catch-up startup when requested by metadata', async () => {
    const video = createMockVideoElement();
    const adapter = new HlsPlayerAdapter(video);
    const source = {
      url: 'https://example.com/archive.m3u8',
      type: 'hls' as const,
      title: 'Archive',
      metadata: {
        mode: 'catchup',
        catchUpHlsStartupMode: 'complete',
        catchUpHlsStartPositionSeconds: 75,
      },
    };

    const loadPromise = adapter.load(source);
    const hls = hlsMockState.instances.at(-1);
    expect(hls).toBeDefined();
    expect(hls?.config).toMatchObject({
      startPosition: 75,
    });
    expect(hls?.config).not.toHaveProperty('progressive');
    expect(hls?.config).not.toHaveProperty('startFragPrefetch');

    hls?.emit(hlsMockState.MockHls.Events.MANIFEST_LOADED, { url: source.url });
    hls?.emit(hlsMockState.MockHls.Events.MANIFEST_PARSED);
    await loadPromise;
  });

  it('retries catch-up startup without progressive loading after a pre-playback fatal media error', async () => {
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
    const progressiveHls = hlsMockState.instances.at(-1);
    expect(progressiveHls).toBeDefined();
    expect(progressiveHls?.config).toMatchObject({
      progressive: true,
      startFragPrefetch: true,
    });

    progressiveHls?.emit(hlsMockState.MockHls.Events.ERROR, {
      fatal: true,
      type: hlsMockState.MockHls.ErrorTypes.MEDIA_ERROR,
      details: 'bufferAppendError',
    });

    expect(progressiveHls?.recoverMediaError).not.toHaveBeenCalled();
    expect(progressiveHls?.destroy).toHaveBeenCalledTimes(1);

    const completeHls = hlsMockState.instances.at(-1);
    expect(completeHls).toBeDefined();
    expect(completeHls).not.toBe(progressiveHls);
    expect(completeHls?.config).toMatchObject({
      startPosition: 75,
    });
    expect(completeHls?.config).not.toHaveProperty('progressive');
    expect(completeHls?.config).not.toHaveProperty('startFragPrefetch');

    completeHls?.emit(hlsMockState.MockHls.Events.MANIFEST_LOADED, { url: source.url });
    completeHls?.emit(hlsMockState.MockHls.Events.MANIFEST_PARSED);
    await loadPromise;
  });

  it('does not recover complete-mode catch-up fatal media errors before playback has started', async () => {
    const video = createMockVideoElement();
    const adapter = new HlsPlayerAdapter(video);
    const source = {
      url: 'https://example.com/archive.m3u8',
      type: 'hls' as const,
      title: 'Archive',
      metadata: {
        mode: 'catchup',
        catchUpHlsStartupMode: 'complete',
      },
    };
    const errors: unknown[] = [];
    adapter.onError((error) => errors.push(error));

    const loadPromise = adapter.load(source);
    const hls = hlsMockState.instances.at(-1);
    expect(hls).toBeDefined();
    expect(hls?.config).not.toHaveProperty('progressive');
    expect(hls?.config).not.toHaveProperty('startFragPrefetch');
    hls?.emit(hlsMockState.MockHls.Events.MANIFEST_LOADED, { url: source.url });
    hls?.emit(hlsMockState.MockHls.Events.MANIFEST_PARSED);
    await loadPromise;

    hls?.emit(hlsMockState.MockHls.Events.ERROR, {
      fatal: true,
      type: hlsMockState.MockHls.ErrorTypes.MEDIA_ERROR,
      details: 'bufferAppendError',
    });

    expect(hls?.recoverMediaError).not.toHaveBeenCalled();
    expect(hls?.destroy).toHaveBeenCalledTimes(1);
    expect(errors).toContainEqual(expect.objectContaining({
      code: 'MEDIA_ERROR',
      fatal: true,
    }));
  });

  it('recovers catch-up fatal media errors after playback has advanced', async () => {
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
    expect(hls).toBeDefined();
    hls?.emit(hlsMockState.MockHls.Events.MANIFEST_LOADED, { url: source.url });
    hls?.emit(hlsMockState.MockHls.Events.MANIFEST_PARSED);
    await loadPromise;

    video.currentTime = 5;
    (video as unknown as { dispatchEvent: (event: string) => void }).dispatchEvent('timeupdate');
    hls?.emit(hlsMockState.MockHls.Events.ERROR, {
      fatal: true,
      type: hlsMockState.MockHls.ErrorTypes.MEDIA_ERROR,
      details: 'bufferStalledError',
    });

    expect(hls?.recoverMediaError).toHaveBeenCalledTimes(1);
    expect(hls?.destroy).not.toHaveBeenCalled();
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
      mutableVideo.dispatchEvent('timeupdate');
      mutableVideo.dispatchEvent('waiting');
      await vi.advanceTimersByTimeAsync(4_000);

      expect(hls?.recoverMediaError).toHaveBeenCalledTimes(1);
      expect(video.play).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps buffering recovery active after a non-fatal HLS media error', async () => {
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
      mutableVideo.dispatchEvent('timeupdate');
      mutableVideo.dispatchEvent('waiting');
      hls?.emit(hlsMockState.MockHls.Events.ERROR, {
        fatal: false,
        type: hlsMockState.MockHls.ErrorTypes.MEDIA_ERROR,
        details: 'bufferStalledError',
      });

      expect(adapter.getState()).toBe('buffering');
      await vi.advanceTimersByTimeAsync(4_000);

      expect(hls?.recoverMediaError).toHaveBeenCalledTimes(1);
      expect(video.play).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not abort catch-up startup while the first archive fragment is still loading', async () => {
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
        readyState: number;
        videoWidth: number;
        dispatchEvent: (event: string) => void;
      };
      mutableVideo.paused = false;
      mutableVideo.currentTime = 0;
      mutableVideo.readyState = 2;
      mutableVideo.videoWidth = 1280;
      mutableVideo.dispatchEvent('waiting');
      await vi.advanceTimersByTimeAsync(8_000);

      expect(hls?.recoverMediaError).not.toHaveBeenCalled();
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
      (video as unknown as { dispatchEvent: (event: string) => void }).dispatchEvent('timeupdate');
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
