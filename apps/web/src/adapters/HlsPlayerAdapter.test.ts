import { describe, expect, it, vi } from 'vitest';
import { HlsPlayerAdapter } from './HlsPlayerAdapter';

const buildSource = (url: string) => ({
  url,
  type: 'mp4' as const,
  title: 'Test Source',
});

describe('HlsPlayerAdapter', () => {
  const createMockVideoElement = () => {
    const eventHandlers = new Map<string, Set<() => void>>();
    const video = {
      src: '',
      currentSrc: '',
      currentTime: 0,
      duration: 0,
      volume: 1,
      paused: true,
      error: null,
      srcObject: null,
      addEventListener: vi.fn((event: string, handler: () => void) => {
        const handlers = eventHandlers.get(event) ?? new Set<() => void>();
        handlers.add(handler);
        eventHandlers.set(event, handlers);
      }),
      removeEventListener: vi.fn((event: string, handler: () => void) => {
        eventHandlers.get(event)?.delete(handler);
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
    };

    return {
      video: video as unknown as HTMLVideoElement,
      emit: (event: string) => {
        eventHandlers.get(event)?.forEach((handler) => handler());
      },
    };
  };

  const attachMockHlsToAdapter = (adapter: HlsPlayerAdapter) => {
    const mockHls = {
      stopLoad: vi.fn(),
      detachMedia: vi.fn(),
      destroy: vi.fn(),
      recoverMediaError: vi.fn(),
    };
    (adapter as unknown as { hls: unknown }).hls = mockHls;
    return mockHls;
  };

  it('flushes previous media source before switching to a new source', async () => {
    const { video } = createMockVideoElement();
    const loadSpy = vi.spyOn(video, 'load');
    const adapter = new HlsPlayerAdapter(video);

    await adapter.load(buildSource('https://example.com/stream-a.mp4'));
    await adapter.load(buildSource('https://example.com/stream-b.mp4'));

    expect(loadSpy).toHaveBeenCalledTimes(3);
    expect(video.src).toBe('https://example.com/stream-b.mp4');
  });

  it('still flushes media element when stop() is explicitly requested', async () => {
    const { video } = createMockVideoElement();
    const loadSpy = vi.spyOn(video, 'load');
    const adapter = new HlsPlayerAdapter(video);

    await adapter.load(buildSource('https://example.com/stream-a.mp4'));
    expect(loadSpy).toHaveBeenCalledTimes(1);

    adapter.stop();
    expect(loadSpy).toHaveBeenCalledTimes(2);
  });

  it('stops, detaches and destroys hls instance when switching sources', async () => {
    const { video } = createMockVideoElement();
    const adapter = new HlsPlayerAdapter(video);
    const mockHls = attachMockHlsToAdapter(adapter);

    await adapter.load(buildSource('https://example.com/stream-b.mp4'));

    expect(mockHls.stopLoad).toHaveBeenCalledTimes(1);
    expect(mockHls.detachMedia).toHaveBeenCalledTimes(1);
    expect(mockHls.destroy).toHaveBeenCalledTimes(1);
  });

  it('stops, detaches and destroys hls instance when stop() is called', () => {
    const { video } = createMockVideoElement();
    const adapter = new HlsPlayerAdapter(video);
    const mockHls = attachMockHlsToAdapter(adapter);

    adapter.stop();

    expect(mockHls.stopLoad).toHaveBeenCalledTimes(1);
    expect(mockHls.detachMedia).toHaveBeenCalledTimes(1);
    expect(mockHls.destroy).toHaveBeenCalledTimes(1);
  });

  it('emits ready after load without a synthetic paused state', async () => {
    const { video, emit } = createMockVideoElement();
    const adapter = new HlsPlayerAdapter(video);
    const states: string[] = [];

    adapter.onStateChange((state) => {
      states.push(state);
    });

    await adapter.load(buildSource('https://example.com/stream-a.mp4'));
    emit('pause');

    expect(states).toEqual(['loading', 'ready']);
    expect(adapter.getState()).toBe('ready');
  });

  it('still emits paused after real playback starts and then pauses', async () => {
    const { video, emit } = createMockVideoElement();
    const adapter = new HlsPlayerAdapter(video);
    const states: string[] = [];

    adapter.onStateChange((state) => {
      states.push(state);
    });

    await adapter.load(buildSource('https://example.com/stream-a.mp4'));
    emit('play');
    emit('pause');

    expect(states).toEqual(['loading', 'ready', 'playing', 'paused']);
    expect(adapter.getState()).toBe('paused');
  });

  it('attempts hls media recovery before surfacing MEDIA_ELEMENT_3', async () => {
    const { video, emit } = createMockVideoElement();
    const adapter = new HlsPlayerAdapter(video);
    const errors: string[] = [];
    const states: string[] = [];

    adapter.onError((error) => {
      errors.push(error.code);
    });
    adapter.onStateChange((state) => {
      states.push(state);
    });

    await adapter.load(buildSource('https://example.com/stream-a.mp4'));
    const mockHls = attachMockHlsToAdapter(adapter);
    (video as HTMLVideoElement & { error: MediaError | null }).error = {
      code: 3,
      message: 'decode error',
    } as MediaError;

    emit('error');

    expect(mockHls.recoverMediaError).toHaveBeenCalledTimes(1);
    expect(video.play).toHaveBeenCalledTimes(1);
    expect(errors).toEqual([]);
    expect(states.at(-1)).toBe('buffering');
  });
});
