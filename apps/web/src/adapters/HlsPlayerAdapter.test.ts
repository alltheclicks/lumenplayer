import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const hlsMockState = vi.hoisted(() => {
  const instances: MockHls[] = [];

  class MockLoader {
    context: unknown = null;
    stats = {};

    load(): void {
      // The unit tests exercise adapter configuration, not hls.js network loading.
    }

    abort(): void {
      // No-op.
    }

    destroy(): void {
      // No-op.
    }
  }

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

    static readonly DefaultConfig = {
      loader: MockLoader,
    };

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
    readonly startLoad = vi.fn();
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

const TS_PACKET_SIZE = 188;
const PMT_PID = 0x1000;
const VIDEO_PID = 0x0100;
const AUDIO_PID = 0x0101;

const buildSection = (tableId: number, body: number[]): Uint8Array => {
  const sectionLength = body.length + 4;
  const section = new Uint8Array(3 + sectionLength);
  section[0] = tableId;
  section[1] = 0xb0 | ((sectionLength >> 8) & 0x0f);
  section[2] = sectionLength & 0xff;
  section.set(body, 3);
  return section;
};

const buildPacket = (pid: number, payload: Uint8Array, payloadUnitStart = true): Uint8Array => {
  const packet = new Uint8Array(TS_PACKET_SIZE);
  packet.fill(0xff);
  packet[0] = 0x47;
  packet[1] = ((payloadUnitStart ? 0x40 : 0) | ((pid >> 8) & 0x1f));
  packet[2] = pid & 0xff;
  packet[3] = 0x10;
  let offset = 4;
  if (payloadUnitStart) {
    packet[offset] = 0;
    offset += 1;
  }
  packet.set(payload.subarray(0, TS_PACKET_SIZE - offset), offset);
  return packet;
};

const concatPackets = (packets: Uint8Array[]): Uint8Array => {
  const output = new Uint8Array(packets.length * TS_PACKET_SIZE);
  packets.forEach((packet, index) => {
    output.set(packet, index * TS_PACKET_SIZE);
  });
  return output;
};

const buildLiveMpegAudioSegment = (): Uint8Array => {
  const pat = buildSection(0x00, [
    0x00, 0x01,
    0xc1,
    0x00,
    0x00,
    0x00, 0x01,
    0xe0 | ((PMT_PID >> 8) & 0x1f), PMT_PID & 0xff,
  ]);
  const pmt = buildSection(0x02, [
    0x00, 0x01,
    0xc1,
    0x00,
    0x00,
    0xe0 | ((VIDEO_PID >> 8) & 0x1f), VIDEO_PID & 0xff,
    0xf0, 0x00,
    0x1b, 0xe0 | ((VIDEO_PID >> 8) & 0x1f), VIDEO_PID & 0xff, 0xf0, 0x00,
    0x03, 0xe0 | ((AUDIO_PID >> 8) & 0x1f), AUDIO_PID & 0xff, 0xf0, 0x00,
  ]);

  return concatPackets([
    buildPacket(0, pat),
    buildPacket(PMT_PID, pmt),
    buildPacket(VIDEO_PID, new Uint8Array([0x00, 0x00, 0x01, 0xe0]), false),
    buildPacket(AUDIO_PID, new Uint8Array([0xff, 0xfd, 0x00, 0x00]), false),
  ]);
};

const waitForNextHlsInstance = async (previousCount: number) => {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    await Promise.resolve();
    await new Promise((resolve) => globalThis.setTimeout(resolve, 0));
    if (hlsMockState.instances.length > previousCount) {
      return hlsMockState.instances.at(-1);
    }
  }

  return undefined;
};

const createDeferred = <T,>() => {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });

  return { promise, resolve, reject };
};

describe('HlsPlayerAdapter', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new Error('fetch disabled in unit tests');
    }));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const createMockVideoElement = () => {
    const listeners = new Map<string, Set<() => void>>();
    const video = {
      src: '',
      currentSrc: '',
      srcObject: null as object | null,
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
    const mutableVideo = video as unknown as {
      srcObject: object | null;
    };
    const loadSpy = vi.spyOn(video, 'load');
    const adapter = new HlsPlayerAdapter(video);

    await adapter.load(buildSource('https://example.com/stream-a.mp4'));
    mutableVideo.srcObject = {};
    expect(loadSpy).toHaveBeenCalledTimes(1);

    adapter.stop();
    expect(loadSpy).toHaveBeenCalledTimes(2);
    expect(video.src).toBe('');
    expect(mutableVideo.srcObject).toBeNull();
  });

  it('stops competing playback before loading a new adapter source', async () => {
    const firstVideo = createMockVideoElement();
    const secondVideo = createMockVideoElement();
    const firstAdapter = new HlsPlayerAdapter(firstVideo);
    const secondAdapter = new HlsPlayerAdapter(secondVideo);

    await firstAdapter.load(buildSource('https://example.com/stream-a.mp4'));
    vi.mocked(firstVideo.pause).mockClear();
    vi.mocked(firstVideo.load).mockClear();

    await secondAdapter.load(buildSource('https://example.com/stream-b.mp4'));

    expect(firstVideo.pause).toHaveBeenCalledTimes(1);
    expect(firstVideo.load).toHaveBeenCalledTimes(1);
    expect(firstVideo.src).toBe('');
    expect(secondVideo.src).toBe('https://example.com/stream-b.mp4');

    firstAdapter.destroy();
    secondAdapter.destroy();
  });

  it('flushes native HLS playback when switching away from a native HLS source', async () => {
    const video = createMockVideoElement();
    const mutableVideo = video as unknown as {
      canPlayType: ReturnType<typeof vi.fn>;
    };
    mutableVideo.canPlayType.mockReturnValue('probably');
    const loadSpy = vi.spyOn(video, 'load');
    const adapter = new HlsPlayerAdapter(video, { preferNativeHls: true });

    await adapter.load({
      url: 'https://example.com/live.m3u8',
      type: 'hls' as const,
    });
    expect(loadSpy).toHaveBeenCalledTimes(1);

    await adapter.load(buildSource('https://example.com/stream-b.mp4'));

    expect(loadSpy).toHaveBeenCalledTimes(3);
    expect(video.src).toBe('https://example.com/stream-b.mp4');
  });

  it('flushes hls.js media when switching from live HLS to catch-up HLS', async () => {
    const video = createMockVideoElement();
    const loadSpy = vi.spyOn(video, 'load');
    const adapter = new HlsPlayerAdapter(video);
    const liveSource = {
      url: 'https://example.com/live.m3u8',
      type: 'hls' as const,
      title: 'Live',
      metadata: {
        mode: 'live',
      },
    };
    const catchUpSource = {
      url: 'https://example.com/archive.m3u8',
      type: 'hls' as const,
      title: 'Archive',
      metadata: {
        mode: 'catchup',
      },
    };

    const liveLoadPromise = adapter.load(liveSource);
    const liveHls = hlsMockState.instances.at(-1);
    expect(liveHls).toBeDefined();
    liveHls?.emit(hlsMockState.MockHls.Events.MANIFEST_LOADED, { url: liveSource.url });
    liveHls?.emit(hlsMockState.MockHls.Events.MANIFEST_PARSED);
    await liveLoadPromise;
    expect(loadSpy).not.toHaveBeenCalled();

    const catchUpLoadPromise = adapter.load(catchUpSource);
    const catchUpHls = hlsMockState.instances.at(-1);

    expect(liveHls?.stopLoad).toHaveBeenCalledTimes(1);
    expect(liveHls?.detachMedia).toHaveBeenCalledTimes(1);
    expect(liveHls?.destroy).toHaveBeenCalledTimes(1);
    expect(loadSpy).toHaveBeenCalledTimes(1);
    expect(catchUpHls).toBeDefined();
    expect(catchUpHls).not.toBe(liveHls);

    catchUpHls?.emit(hlsMockState.MockHls.Events.MANIFEST_LOADED, { url: catchUpSource.url });
    catchUpHls?.emit(hlsMockState.MockHls.Events.MANIFEST_PARSED);
    await catchUpLoadPromise;
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

  it('surfaces the upstream HTTP status on network errors (409 shadow step-aside)', async () => {
    const video = createMockVideoElement();
    const adapter = new HlsPlayerAdapter(video);
    const source = {
      url: 'https://example.com/archive.m3u8',
      type: 'hls' as const,
      title: 'Archive',
    };

    const errors: Array<{ code: string; httpStatus?: number }> = [];
    adapter.onError((error) => {
      errors.push({ code: error.code, httpStatus: error.httpStatus });
    });

    const loadPromise = adapter.load(source);
    const hls = hlsMockState.instances.at(-1);
    expect(hls).toBeDefined();

    hls?.emit(hlsMockState.MockHls.Events.ERROR, {
      fatal: true,
      type: hlsMockState.MockHls.ErrorTypes.NETWORK_ERROR,
      details: 'manifestLoadError',
      networkDetails: { response: { code: 409 } },
    });

    await expect(loadPromise).rejects.toThrow();
    expect(errors.some((entry) => entry.code === 'NETWORK_ERROR' && entry.httpStatus === 409)).toBe(true);
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
      // M1.1-a: live now runs on the web worker.
      enableWorker: true,
      // M1.1-b: live defaults to standard latency mode (no LL-HLS markers probed).
      lowLatencyMode: false,
      progressive: true,
      maxBufferLength: 30,
      maxMaxBufferLength: 600,
      // M1.1-c: live keeps only a short back-buffer tail.
      backBufferLength: 30,
    });
    expect(hls?.config).not.toHaveProperty('startFragPrefetch');
    // M1.1-d: structured load policies are attached for both loaders.
    const liveConfig = hls?.config as {
      fragLoadPolicy?: { default?: { errorRetry?: { backoff?: string } } };
      playlistLoadPolicy?: { default?: { errorRetry?: { maxRetryDelayMs?: number } } };
    };
    expect(liveConfig.fragLoadPolicy?.default?.errorRetry?.backoff).toBe('exponential');
    expect(liveConfig.playlistLoadPolicy?.default?.errorRetry?.maxRetryDelayMs).toBe(8_000);

    hls?.emit(hlsMockState.MockHls.Events.MANIFEST_LOADED, { url: source.url });
    hls?.emit(hlsMockState.MockHls.Events.MANIFEST_PARSED);
    await loadPromise;
  });

  it('uses a video-only fragment loader for live MPEG audio TS streams', async () => {
    const manifest = [
      '#EXTM3U',
      '#EXT-X-VERSION:3',
      '#EXT-X-TARGETDURATION:10',
      '#EXTINF:10.000000,',
      'segment-1.ts',
    ].join('\n');
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(new Response(manifest, { status: 200 }))
      .mockResolvedValueOnce(new Response(buildLiveMpegAudioSegment().slice().buffer, { status: 200 })));
    const video = createMockVideoElement();
    const mutableVideo = video as unknown as {
      canPlayType: ReturnType<typeof vi.fn>;
    };
    mutableVideo.canPlayType.mockReturnValue('probably');
    const onUnsupportedAudioCodec = vi.fn();
    const adapter = new HlsPlayerAdapter(video, { onUnsupportedAudioCodec });
    const source = {
      url: 'https://example.com/live.m3u8',
      type: 'hls' as const,
      title: 'Live',
      metadata: {
        mode: 'live',
        streamId: 75,
      },
    };

    const previousCount = hlsMockState.instances.length;
    const loadPromise = adapter.load(source);

    const hls = await waitForNextHlsInstance(previousCount);
    expect(hls).toBeDefined();
    expect(globalThis.fetch).toHaveBeenCalledTimes(2);
    expect(hls?.config).toMatchObject({
      enableWorker: true,
      lowLatencyMode: false,
      maxBufferLength: 30,
    });
    expect(hls?.config).not.toHaveProperty('progressive');
    expect(hls?.config).toHaveProperty('fLoader');
    expect(video.src).toBe('');
    expect(onUnsupportedAudioCodec).toHaveBeenCalledWith({
      unsupportedAudioCodec: 'mp2',
      sourceUrl: source.url,
      playbackMode: 'live',
    });

    hls?.emit(hlsMockState.MockHls.Events.MANIFEST_LOADED, { url: source.url });
    hls?.emit(hlsMockState.MockHls.Events.MANIFEST_PARSED);
    await loadPromise;
  });

  it('cancels pending live MPEG preflight when playback is stopped before HLS attaches', async () => {
    const manifest = [
      '#EXTM3U',
      '#EXT-X-VERSION:3',
      '#EXT-X-TARGETDURATION:10',
      '#EXTINF:10.000000,',
      'segment-1.ts',
    ].join('\n');
    const manifestResponse = createDeferred<Response>();
    vi.stubGlobal('fetch', vi.fn()
      .mockReturnValueOnce(manifestResponse.promise)
      .mockResolvedValueOnce(new Response(buildLiveMpegAudioSegment().slice().buffer, { status: 200 })));
    const video = createMockVideoElement();
    const adapter = new HlsPlayerAdapter(video);
    const source = {
      url: 'https://example.com/live.m3u8',
      type: 'hls' as const,
      title: 'Live',
      metadata: {
        mode: 'live',
        streamId: 75,
      },
    };
    const previousCount = hlsMockState.instances.length;

    const loadPromise = adapter.load(source);
    await Promise.resolve();
    adapter.stop();
    manifestResponse.resolve(new Response(manifest, { status: 200 }));

    await expect(loadPromise).rejects.toThrow('Playback load was cancelled.');
    expect(hlsMockState.instances).toHaveLength(previousCount);
  });

  it('lets a newer source win when an older live preflight resolves late', async () => {
    const manifest = [
      '#EXTM3U',
      '#EXT-X-VERSION:3',
      '#EXT-X-TARGETDURATION:10',
      '#EXTINF:10.000000,',
      'segment-1.ts',
    ].join('\n');
    const manifestResponse = createDeferred<Response>();
    vi.stubGlobal('fetch', vi.fn()
      .mockReturnValueOnce(manifestResponse.promise)
      .mockResolvedValueOnce(new Response(buildLiveMpegAudioSegment().slice().buffer, { status: 200 })));
    const video = createMockVideoElement();
    const adapter = new HlsPlayerAdapter(video);
    const staleSource = {
      url: 'https://example.com/live-a.m3u8',
      type: 'hls' as const,
      title: 'Live A',
      metadata: {
        mode: 'live',
        streamId: 75,
      },
    };
    const nextSource = {
      url: 'https://example.com/live-b.m3u8',
      type: 'hls' as const,
      title: 'Live B',
      metadata: {
        mode: 'live',
      },
    };
    const previousCount = hlsMockState.instances.length;

    const staleLoadPromise = adapter.load(staleSource);
    await Promise.resolve();
    const nextLoadPromise = adapter.load(nextSource);
    const nextHls = hlsMockState.instances.at(-1);
    expect(nextHls).toBeDefined();
    expect(hlsMockState.instances).toHaveLength(previousCount + 1);

    nextHls?.emit(hlsMockState.MockHls.Events.MANIFEST_LOADED, { url: nextSource.url });
    nextHls?.emit(hlsMockState.MockHls.Events.MANIFEST_PARSED);
    await nextLoadPromise;

    manifestResponse.resolve(new Response(manifest, { status: 200 }));
    await expect(staleLoadPromise).rejects.toThrow('Playback load was cancelled.');
    expect(hlsMockState.instances).toHaveLength(previousCount + 1);
    expect(nextHls?.loadSource).toHaveBeenCalledWith(nextSource.url);
  });

  it('does not apply catch-up start metadata to live HLS startup', async () => {
    const video = createMockVideoElement();
    const adapter = new HlsPlayerAdapter(video);
    const source = {
      url: 'https://example.com/live.m3u8',
      type: 'hls' as const,
      title: 'Live',
      metadata: {
        mode: 'live',
        catchUpHlsStartPositionSeconds: 120,
      },
    };

    const loadPromise = adapter.load(source);
    const hls = hlsMockState.instances.at(-1);
    expect(hls).toBeDefined();
    expect(hls?.config).toMatchObject({
      startPosition: -1,
      lowLatencyMode: false,
      progressive: true,
    });

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
      enableWorker: true,
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

  it('keeps recovering live media errors after playback progress and new buffers', async () => {
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
      currentTime: number;
      readyState: number;
      videoWidth: number;
    };
    mutableVideo.currentTime = 12;
    mutableVideo.readyState = 2;
    mutableVideo.videoWidth = 1920;

    hls?.emit(hlsMockState.MockHls.Events.ERROR, {
      fatal: true,
      type: hlsMockState.MockHls.ErrorTypes.MEDIA_ERROR,
      details: 'bufferAppendError',
    });
    hls?.emit(hlsMockState.MockHls.Events.BUFFER_APPENDED);
    hls?.emit(hlsMockState.MockHls.Events.ERROR, {
      fatal: true,
      type: hlsMockState.MockHls.ErrorTypes.MEDIA_ERROR,
      details: 'bufferAppendError',
    });

    expect(hls?.recoverMediaError).toHaveBeenCalledTimes(2);
    expect(hls?.destroy).not.toHaveBeenCalled();
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
      startPosition: 0,
      progressive: true,
      fragLoadingTimeOut: 60_000,
      startFragPrefetch: true,
      maxBufferLength: 90,
      maxMaxBufferLength: 600,
      maxBufferSize: 180 * 1000 * 1000,
      // M1.1-c: catch-up keeps the wide back-buffer scrub window.
      backBufferLength: 90,
    });

    hls?.emit(hlsMockState.MockHls.Events.MANIFEST_LOADED, { url: source.url });
    hls?.emit(hlsMockState.MockHls.Events.MANIFEST_PARSED);
    await loadPromise;
  });

  it('enables low-latency mode for live HLS only when the manifest advertises LL-HLS (M1.1-b)', async () => {
    const manifest = [
      '#EXTM3U',
      '#EXT-X-VERSION:9',
      '#EXT-X-TARGETDURATION:4',
      '#EXT-X-SERVER-CONTROL:CAN-BLOCK-RELOAD=YES,PART-HOLD-BACK=1.0',
      '#EXT-X-PART-INF:PART-TARGET=1.0',
      '#EXTINF:4.000000,',
      'segment-1.ts',
    ].join('\n');
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(new Response(manifest, { status: 200 }))
      // Empty TS body -> no MP2/HEVC detected, so this stays a clean live source.
      .mockResolvedValueOnce(new Response(new ArrayBuffer(0), { status: 200 })));
    const video = createMockVideoElement();
    const adapter = new HlsPlayerAdapter(video);
    const source = {
      url: 'https://example.com/live.m3u8',
      type: 'hls' as const,
      title: 'Live LL',
      metadata: {
        mode: 'live',
        streamId: 42,
      },
    };

    const previousCount = hlsMockState.instances.length;
    const loadPromise = adapter.load(source);
    const hls = await waitForNextHlsInstance(previousCount);
    expect(hls).toBeDefined();
    expect(hls?.config).toMatchObject({
      enableWorker: true,
      lowLatencyMode: true,
    });

    hls?.emit(hlsMockState.MockHls.Events.MANIFEST_LOADED, { url: source.url });
    hls?.emit(hlsMockState.MockHls.Events.MANIFEST_PARSED);
    await loadPromise;
  });

  it('does not retry auth-rejected loads (shouldRetry bails on 403) (M1.1-d)', async () => {
    const video = createMockVideoElement();
    const adapter = new HlsPlayerAdapter(video);
    const source = {
      url: 'https://example.com/live.m3u8',
      type: 'hls' as const,
      title: 'Live',
      metadata: { mode: 'live' },
    };

    const loadPromise = adapter.load(source);
    const hls = hlsMockState.instances.at(-1);
    expect(hls).toBeDefined();

    const shouldRetry = (hls?.config as {
      fragLoadPolicy?: {
        default?: {
          errorRetry?: {
            shouldRetry?: (
              retryConfig: unknown,
              retryCount: number,
              isTimeout: boolean,
              loaderResponse: { code?: number } | undefined,
              retry: boolean,
            ) => boolean;
          };
        };
      };
    }).fragLoadPolicy?.default?.errorRetry?.shouldRetry;
    expect(typeof shouldRetry).toBe('function');
    // 403 -> never retry; a normal 5xx within budget -> retry.
    expect(shouldRetry?.(null, 0, false, { code: 403 }, true)).toBe(false);
    expect(shouldRetry?.(null, 0, false, { code: 401 }, true)).toBe(false);
    expect(shouldRetry?.({ maxNumRetry: 4 }, 0, false, { code: 502 }, true)).toBe(true);

    hls?.emit(hlsMockState.MockHls.Events.MANIFEST_LOADED, { url: source.url });
    hls?.emit(hlsMockState.MockHls.Events.MANIFEST_PARSED);
    await loadPromise;
  });

  it('recovers a fatal NETWORK_ERROR after startup with a throttled startLoad (M1.1-e)', async () => {
    vi.useFakeTimers();
    try {
      const video = createMockVideoElement();
      const adapter = new HlsPlayerAdapter(video);
      const source = {
        url: 'https://example.com/live.m3u8',
        type: 'hls' as const,
        title: 'Live',
        metadata: { mode: 'live' },
      };

      const loadPromise = adapter.load(source);
      const hls = hlsMockState.instances.at(-1);
      expect(hls).toBeDefined();

      // Settle startup so the post-manifest recovery path is active.
      hls?.emit(hlsMockState.MockHls.Events.MANIFEST_LOADED, { url: source.url });
      hls?.emit(hlsMockState.MockHls.Events.MANIFEST_PARSED);
      await loadPromise;

      hls?.emit(hlsMockState.MockHls.Events.ERROR, {
        fatal: true,
        type: hlsMockState.MockHls.ErrorTypes.NETWORK_ERROR,
        details: 'fragLoadError',
        networkDetails: { response: { code: 502 } },
      });

      // Recovery is throttled — startLoad must not fire immediately.
      expect(hls?.startLoad).not.toHaveBeenCalled();
      expect(hls?.destroy).not.toHaveBeenCalled();

      vi.advanceTimersByTime(3_000);
      expect(hls?.startLoad).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not retry a fatal NETWORK_ERROR with an auth status (403) (M1.1-e)', async () => {
    vi.useFakeTimers();
    try {
      const video = createMockVideoElement();
      const adapter = new HlsPlayerAdapter(video);
      const source = {
        url: 'https://example.com/live.m3u8',
        type: 'hls' as const,
        title: 'Live',
        metadata: { mode: 'live' },
      };

      const loadPromise = adapter.load(source);
      const hls = hlsMockState.instances.at(-1);
      hls?.emit(hlsMockState.MockHls.Events.MANIFEST_LOADED, { url: source.url });
      hls?.emit(hlsMockState.MockHls.Events.MANIFEST_PARSED);
      await loadPromise;

      hls?.emit(hlsMockState.MockHls.Events.ERROR, {
        fatal: true,
        type: hlsMockState.MockHls.ErrorTypes.NETWORK_ERROR,
        details: 'fragLoadError',
        networkDetails: { response: { code: 403 } },
      });

      vi.advanceTimersByTime(3_000);
      // Auth failure: no throttled recovery, the stream is torn down instead.
      expect(hls?.startLoad).not.toHaveBeenCalled();
      expect(hls?.destroy).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
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

  it('starts catch-up HLS from the first archive position by default', async () => {
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
      startPosition: 0,
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

  it('retries catch-up startup without progressive loading at the requested start position', async () => {
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
      startPosition: 0,
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

  it('keeps recovering consecutive catch-up media errors before surfacing the failure', async () => {
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
    const errors: unknown[] = [];
    adapter.onError((error) => errors.push(error));

    const loadPromise = adapter.load(source);
    const hls = hlsMockState.instances.at(-1);
    expect(hls).toBeDefined();
    hls?.emit(hlsMockState.MockHls.Events.MANIFEST_LOADED, { url: source.url });
    hls?.emit(hlsMockState.MockHls.Events.MANIFEST_PARSED);
    await loadPromise;

    const mutableVideo = video as unknown as {
      currentTime: number;
      readyState: number;
      videoWidth: number;
    };
    mutableVideo.currentTime = 30;
    mutableVideo.readyState = 2;
    mutableVideo.videoWidth = 1920;

    // Four consecutive decode errors without fresh BUFFER_APPENDED data should
    // each trigger a cheap recoverMediaError() rather than tearing playback down
    // (which would push the session layer into a 15s skip + reload gap).
    for (let attempt = 0; attempt < 4; attempt += 1) {
      hls?.emit(hlsMockState.MockHls.Events.ERROR, {
        fatal: true,
        type: hlsMockState.MockHls.ErrorTypes.MEDIA_ERROR,
        details: 'bufferAppendError',
      });
    }

    expect(hls?.recoverMediaError).toHaveBeenCalledTimes(4);
    expect(hls?.destroy).not.toHaveBeenCalled();
    expect(errors).not.toContainEqual(expect.objectContaining({
      code: 'MEDIA_ERROR',
      fatal: true,
    }));

    // Exhausting the budget surfaces the error so the session layer can fall back.
    hls?.emit(hlsMockState.MockHls.Events.ERROR, {
      fatal: true,
      type: hlsMockState.MockHls.ErrorTypes.MEDIA_ERROR,
      details: 'bufferAppendError',
    });

    expect(hls?.recoverMediaError).toHaveBeenCalledTimes(4);
    expect(hls?.destroy).toHaveBeenCalledTimes(1);
    expect(errors).toContainEqual(expect.objectContaining({
      code: 'MEDIA_ERROR',
      fatal: true,
    }));
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

  it('does not call video.play() when no source is attached', () => {
    const video = createMockVideoElement();
    const playSpy = vi.spyOn(video, 'play');
    const adapter = new HlsPlayerAdapter(video);

    // No load() yet: no hls, empty src. Autoplay-recovery could call play()
    // here; the guard must skip it to avoid the "Empty src" error flood.
    adapter.play();

    expect(playSpy).not.toHaveBeenCalled();
  });

  it('calls video.play() once a native source src is set', () => {
    const video = createMockVideoElement();
    const playSpy = vi.spyOn(video, 'play');
    const adapter = new HlsPlayerAdapter(video);

    (video as unknown as { src: string }).src = 'https://example.com/stream-a.mp4';
    adapter.play();

    expect(playSpy).toHaveBeenCalledTimes(1);
  });

  it('swallows a code-4 media error when no real source is attached', () => {
    const video = createMockVideoElement();
    const adapter = new HlsPlayerAdapter(video);
    const errors: unknown[] = [];
    adapter.onError((error) => errors.push(error));

    // Simulate the transient teardown/attach "Empty src" media error.
    (video as unknown as { error: { code: number; message: string } }).error = {
      code: 4,
      message: 'MEDIA_ELEMENT_ERROR: Empty src attribute',
    };
    (video as unknown as { dispatchEvent: (event: string) => void }).dispatchEvent('error');

    expect(errors).toHaveLength(0);
  });
});
