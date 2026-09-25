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
      FRAG_LOADING: 'fragLoading',
      FRAG_LOADED: 'fragLoaded',
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
    vi.restoreAllMocks();
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
      getAttribute: vi.fn((attribute: string) => (
        attribute === 'src' && video.src !== '' ? video.src : null
      )),
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

  it('applies wide-hole bridging only to client-rebased catch-up sessions', async () => {
    const video = createMockVideoElement();
    const adapter = new HlsPlayerAdapter(video);
    const rebaseSource = {
      url: 'https://example.com/rebased-archive.m3u8',
      type: 'hls' as const,
      title: 'Rebased archive',
      metadata: {
        mode: 'catchup',
        catchUpClientRebase: true,
      },
    };

    const rebaseLoadPromise = adapter.load(rebaseSource);
    const rebaseHls = hlsMockState.instances.at(-1);
    const rebaseConfig = rebaseHls?.config as Record<string, unknown>;
    expect(rebaseConfig.maxBufferHole).toBe(2);
    expect(rebaseConfig.stretchShortVideoTrack).toBe(true);
    expect(rebaseConfig.progressive).toBeUndefined();
    expect(rebaseConfig.maxBufferSize).toBe(96_000_000);
    rebaseHls?.emit(hlsMockState.MockHls.Events.MANIFEST_LOADED, { url: rebaseSource.url });
    rebaseHls?.emit(hlsMockState.MockHls.Events.MANIFEST_PARSED);
    await rebaseLoadPromise;

    const legacySource = {
      ...rebaseSource,
      url: 'https://example.com/legacy-archive.m3u8',
      metadata: { mode: 'catchup' },
    };
    const legacyLoadPromise = adapter.load(legacySource);
    const legacyHls = hlsMockState.instances.at(-1);
    const legacyConfig = legacyHls?.config as Record<string, unknown>;
    expect(legacyConfig.maxBufferHole).toBe(0.5);
    expect(legacyConfig.stretchShortVideoTrack).toBeUndefined();
    expect(legacyConfig.maxBufferSize).toBe(180_000_000);
    legacyHls?.emit(hlsMockState.MockHls.Events.MANIFEST_LOADED, { url: legacySource.url });
    legacyHls?.emit(hlsMockState.MockHls.Events.MANIFEST_PARSED);
    await legacyLoadPromise;
  });

  it('uses hls.js rebase even when native HLS is preferred', async () => {
    const video = createMockVideoElement();
    const mutableVideo = video as unknown as {
      canPlayType: ReturnType<typeof vi.fn>;
    };
    mutableVideo.canPlayType.mockReturnValue('probably');
    const adapter = new HlsPlayerAdapter(video, { preferNativeHls: true });
    const source = {
      url: 'https://example.com/rebased-native-capable.m3u8',
      type: 'hls' as const,
      metadata: {
        mode: 'catchup',
        catchUpClientRebase: true,
      },
    };

    const loadPromise = adapter.load(source);
    const hls = hlsMockState.instances.at(-1);
    expect(hls).toBeDefined();
    expect((hls?.config as Record<string, unknown>).fLoader).toBeDefined();
    expect(video.src).toBe('');
    hls?.emit(hlsMockState.MockHls.Events.MANIFEST_LOADED, { url: source.url });
    hls?.emit(hlsMockState.MockHls.Events.MANIFEST_PARSED);
    await loadPromise;
  });

  it('never silently sends a rebase session through native HLS when hls.js is unavailable', async () => {
    const video = createMockVideoElement();
    const mutableVideo = video as unknown as {
      canPlayType: ReturnType<typeof vi.fn>;
    };
    mutableVideo.canPlayType.mockReturnValue('probably');
    const onCatchUpRebaseFallback = vi.fn();
    const adapter = new HlsPlayerAdapter(video, {
      preferNativeHls: true,
      onCatchUpRebaseFallback,
    });
    vi.spyOn(hlsMockState.MockHls, 'isSupported').mockReturnValue(false);

    const source = {
      url: 'https://example.com/native-only.m3u8',
      type: 'hls' as const,
      metadata: {
        mode: 'catchup',
        catchUpClientRebase: true,
      },
    };

    await expect(adapter.load(source)).rejects.toThrow(
      'Client catch-up normalization requires Media Source Extensions.',
    );

    expect(onCatchUpRebaseFallback).toHaveBeenCalledWith({
      reason: 'hls-js-unsupported',
      sourceUrl: 'https://example.com/native-only.m3u8',
    });
    expect(video.src).toBe('');
  });

  it('reports waiting and hls.js buffer stalls only for active rebase sessions', async () => {
    const video = createMockVideoElement();
    const onCatchUpStall = vi.fn();
    const adapter = new HlsPlayerAdapter(video, { onCatchUpStall });
    const source = {
      url: 'https://example.com/rebased-archive.m3u8',
      type: 'hls' as const,
      title: 'Rebased archive',
      metadata: {
        mode: 'catchup',
        catchUpClientRebase: true,
      },
    };

    const loadPromise = adapter.load(source);
    const hls = hlsMockState.instances.at(-1);
    hls?.emit(hlsMockState.MockHls.Events.MANIFEST_LOADED, { url: source.url });
    hls?.emit(hlsMockState.MockHls.Events.MANIFEST_PARSED);
    await loadPromise;

    video.currentTime = 41.25;
    (video as unknown as { dispatchEvent: (event: string) => void }).dispatchEvent('waiting');
    hls?.emit(hlsMockState.MockHls.Events.ERROR, {
      fatal: false,
      type: hlsMockState.MockHls.ErrorTypes.MEDIA_ERROR,
      details: 'bufferStalledError',
    });

    expect(onCatchUpStall).toHaveBeenNthCalledWith(1, {
      trigger: 'waiting',
      currentTimeSeconds: 41.25,
      nearestBoundaryMediaTimeSeconds: null,
      distanceToBoundaryMs: null,
      videoHoleMs: null,
    });
    expect(onCatchUpStall).toHaveBeenNthCalledWith(2, {
      trigger: 'buffer-stalled',
      currentTimeSeconds: 41.25,
      nearestBoundaryMediaTimeSeconds: null,
      distanceToBoundaryMs: null,
      videoHoleMs: null,
    });

    const legacySource = {
      ...source,
      url: 'https://example.com/legacy-archive.m3u8',
      metadata: { mode: 'catchup' },
    };
    const legacyLoadPromise = adapter.load(legacySource);
    const legacyHls = hlsMockState.instances.at(-1);
    legacyHls?.emit(hlsMockState.MockHls.Events.MANIFEST_LOADED, { url: legacySource.url });
    legacyHls?.emit(hlsMockState.MockHls.Events.MANIFEST_PARSED);
    await legacyLoadPromise;
    (video as unknown as { dispatchEvent: (event: string) => void }).dispatchEvent('waiting');

    expect(onCatchUpStall).toHaveBeenCalledTimes(2);
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
    expect(hls?.config).not.toHaveProperty('startOnSegmentBoundary');

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

  it('seeks catch-up startup past the header-less dead zone to the first buffered keyframe', async () => {
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

    const mutableVideo = video as unknown as {
      buffered: {
        length: number;
        start: ReturnType<typeof vi.fn>;
      };
      currentTime: number;
      paused: boolean;
      play: ReturnType<typeof vi.fn>;
    };
    // hls.js drops the header-less frames at the segment head, so the first
    // buffered range begins at the first decodable keyframe (e.g. 1.8s in).
    mutableVideo.currentTime = 0;
    mutableVideo.paused = false;
    mutableVideo.buffered.length = 1;
    mutableVideo.buffered.start.mockReturnValue(1.8);

    hls?.emit(hlsMockState.MockHls.Events.BUFFER_APPENDED);

    expect(mutableVideo.currentTime).toBeCloseTo(1.85, 2);
    expect(mutableVideo.play).toHaveBeenCalledTimes(1);
  });

  it('does not seek catch-up startup backwards when already past the buffered keyframe', async () => {
    const video = createMockVideoElement();
    const adapter = new HlsPlayerAdapter(video);
    const source = {
      url: 'https://example.com/archive.m3u8',
      type: 'hls' as const,
      title: 'Archive',
      metadata: {
        mode: 'catchup',
        catchUpHlsStartPositionSeconds: 120,
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
    // User scrubbed to 120s; the buffered range starts at the keyframe behind
    // it. Scrubbed loads are excluded from the startup buffer snap entirely,
    // so playback must stay at the position the user picked.
    mutableVideo.currentTime = 120;
    mutableVideo.paused = false;
    mutableVideo.buffered.length = 1;
    mutableVideo.buffered.start.mockReturnValue(118.4);

    hls?.emit(hlsMockState.MockHls.Events.BUFFER_APPENDED);

    expect(mutableVideo.currentTime).toBe(120);
    expect(mutableVideo.play).not.toHaveBeenCalled();
  });

  it('does not snap a scrubbed catch-up start to the segment-head keyframe', async () => {
    const video = createMockVideoElement();
    const adapter = new HlsPlayerAdapter(video);
    const source = {
      url: 'https://example.com/archive.m3u8',
      type: 'hls' as const,
      title: 'Archive',
      metadata: {
        mode: 'catchup',
        catchUpHlsStartPositionSeconds: 145,
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
    // The first buffered chunk lands at the segment-head keyframe (121.5s)
    // while hls.js has not yet seeked the media element to the requested 145s
    // (currentTime is still 0). Snapping here would strand the user ~23s
    // before the position they picked; hls.js's own startPosition seek is the
    // one that must move the playhead.
    mutableVideo.currentTime = 0;
    mutableVideo.paused = false;
    mutableVideo.buffered.length = 1;
    mutableVideo.buffered.start.mockReturnValue(121.5);

    hls?.emit(hlsMockState.MockHls.Events.BUFFER_APPENDED);

    expect(mutableVideo.currentTime).toBe(0);
    expect(mutableVideo.play).not.toHaveBeenCalled();
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
      startPosition: 0.1,
      startOnSegmentBoundary: true,
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
    // A scrubbed start must never snap to the segment boundary — that would
    // pull the user back from the position they picked.
    expect(hls?.config).not.toHaveProperty('startOnSegmentBoundary');

    hls?.emit(hlsMockState.MockHls.Events.MANIFEST_LOADED, { url: source.url });
    hls?.emit(hlsMockState.MockHls.Events.MANIFEST_PARSED);
    await loadPromise;
  });

  it('starts default catch-up just past zero with a segment-boundary snap', async () => {
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
    // startPosition 0 would make hls.js's seekToStartPos a no-op and leave the
    // playhead stranded in the archive's header-less dead zone; a tiny positive
    // position plus startOnSegmentBoundary snaps onto the first buffered keyframe.
    expect(hls?.config).toMatchObject({
      startPosition: 0.1,
      startOnSegmentBoundary: true,
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
    // The complete-mode retry keeps the from-the-beginning start contract.
    expect(completeHls?.config).toMatchObject({
      startPosition: 0.1,
      startOnSegmentBoundary: true,
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

  it('reports a blocked autoplay under its own error code', async () => {
    const video = createMockVideoElement();
    const adapter = new HlsPlayerAdapter(video);
    const errors: { code: string }[] = [];
    adapter.onError((error) => errors.push(error));

    const autoplayRejection = new DOMException(
      'play() failed because the user did not interact with the document first.',
      'NotAllowedError',
    );
    vi.spyOn(video, 'play').mockRejectedValue(autoplayRejection);

    (video as unknown as { src: string }).src = 'https://example.com/stream-a.mp4';
    adapter.play();
    await Promise.resolve();
    await Promise.resolve();

    // A distinct code lets the recovery layer stop retrying and wait for a
    // user gesture instead of looping on play().
    expect(errors.map((error) => error.code)).toEqual(['PLAYBACK_AUTOPLAY_BLOCKED']);
  });

  it('keeps the generic start-failed code for non-autoplay play() rejections', async () => {
    const video = createMockVideoElement();
    const adapter = new HlsPlayerAdapter(video);
    const errors: { code: string }[] = [];
    adapter.onError((error) => errors.push(error));

    const abortRejection = new DOMException(
      'The play() request was interrupted by a new load request.',
      'AbortError',
    );
    vi.spyOn(video, 'play').mockRejectedValue(abortRejection);

    (video as unknown as { src: string }).src = 'https://example.com/stream-a.mp4';
    adapter.play();
    await Promise.resolve();
    await Promise.resolve();

    expect(errors.map((error) => error.code)).toEqual(['PLAYBACK_START_FAILED']);
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

  it('swallows a stale code-4 "Empty src" error when currentSrc still holds the detached blob URL', () => {
    const video = createMockVideoElement();
    const adapter = new HlsPlayerAdapter(video);
    const errors: unknown[] = [];
    adapter.onError((error) => errors.push(error));

    // After hls.destroy()/detachMedia() (live startup retry on tab refocus)
    // the src attribute is gone, but Chrome can still report the old MSE blob
    // URL via currentSrc when the queued "Empty src attribute" error fires.
    const mutableVideo = video as unknown as {
      src: string;
      currentSrc: string;
      error: { code: number; message: string } | null;
      dispatchEvent: (event: string) => void;
    };
    mutableVideo.src = '';
    mutableVideo.currentSrc = 'blob:http://localhost:8080/0bd28e91-stale';
    mutableVideo.error = {
      code: 4,
      message: 'MEDIA_ELEMENT_ERROR: Empty src attribute',
    };
    mutableVideo.dispatchEvent('error');

    expect(errors).toHaveLength(0);
  });

  it('recovers a catch-up element decode error in place instead of surfacing it', async () => {
    const video = createMockVideoElement();
    const adapter = new HlsPlayerAdapter(video);
    const errors: unknown[] = [];
    adapter.onError((error) => errors.push(error));
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
      error: { code: number; message: string } | null;
      dispatchEvent: (event: string) => void;
    };
    mutableVideo.error = {
      code: 3,
      message: 'PIPELINE_ERROR_DECODE',
    };
    mutableVideo.dispatchEvent('error');

    // Cheap in-place recovery keeps the playback position; the session layer
    // must not see the error (it would skip ahead +15s and reload).
    expect(hls?.recoverMediaError).toHaveBeenCalledTimes(1);
    expect(errors).toHaveLength(0);
  });

  it('surfaces a catch-up decode error once the in-place recovery budget is exhausted', async () => {
    const video = createMockVideoElement();
    const adapter = new HlsPlayerAdapter(video);
    const errors: Array<{ code: string; fatal: boolean }> = [];
    adapter.onError((error) => errors.push({ code: error.code, fatal: error.fatal }));
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
      error: { code: number; message: string } | null;
      dispatchEvent: (event: string) => void;
    };
    for (let attempt = 0; attempt < 5; attempt += 1) {
      mutableVideo.error = { code: 3, message: 'PIPELINE_ERROR_DECODE' };
      mutableVideo.dispatchEvent('error');
    }

    // 4 budgeted recoveries, then the 5th error escalates to the session layer.
    expect(hls?.recoverMediaError).toHaveBeenCalledTimes(4);
    expect(errors).toEqual([{ code: 'MEDIA_ELEMENT_3', fatal: false }]);
  });

  it('does not spend catch-up decode recovery on live sources', async () => {
    const video = createMockVideoElement();
    const adapter = new HlsPlayerAdapter(video);
    const errors: Array<{ code: string }> = [];
    adapter.onError((error) => errors.push({ code: error.code }));
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
    hls?.emit(hlsMockState.MockHls.Events.MANIFEST_LOADED, { url: source.url });
    hls?.emit(hlsMockState.MockHls.Events.MANIFEST_PARSED);
    await loadPromise;

    const mutableVideo = video as unknown as {
      error: { code: number; message: string } | null;
      dispatchEvent: (event: string) => void;
    };
    mutableVideo.error = { code: 3, message: 'PIPELINE_ERROR_DECODE' };
    mutableVideo.dispatchEvent('error');

    expect(hls?.recoverMediaError).not.toHaveBeenCalled();
    expect(errors).toEqual([{ code: 'MEDIA_ELEMENT_3' }]);
  });

  it('still surfaces a fatal code-4 error when a real native source is attached', () => {
    const video = createMockVideoElement();
    const adapter = new HlsPlayerAdapter(video);
    const errors: Array<{ code: string; fatal: boolean }> = [];
    adapter.onError((error) => errors.push({ code: error.code, fatal: error.fatal }));

    const mutableVideo = video as unknown as {
      src: string;
      currentSrc: string;
      error: { code: number; message: string } | null;
      dispatchEvent: (event: string) => void;
    };
    mutableVideo.src = 'https://example.com/stream.mp4';
    mutableVideo.currentSrc = 'https://example.com/stream.mp4';
    mutableVideo.error = {
      code: 4,
      message: 'MEDIA_ELEMENT_ERROR: Format error',
    };
    mutableVideo.dispatchEvent('error');

    expect(errors).toEqual([{ code: 'MEDIA_ELEMENT_4', fatal: true }]);
  });
});
