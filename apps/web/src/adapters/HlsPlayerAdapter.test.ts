import { describe, expect, it, vi } from 'vitest';
import { HlsPlayerAdapter } from './HlsPlayerAdapter';

const buildSource = (url: string) => ({
  url,
  type: 'mp4' as const,
  title: 'Test Source',
});

describe('HlsPlayerAdapter', () => {
  const createMockVideoElement = () => {
    const video = {
      src: '',
      currentTime: 0,
      duration: 0,
      volume: 1,
      error: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      removeAttribute: vi.fn((attribute: string) => {
        if (attribute === 'src') {
          video.src = '';
        }
      }),
      pause: vi.fn(),
      load: vi.fn(),
      play: vi.fn(async () => undefined),
      canPlayType: vi.fn(() => ''),
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

  it('ignores play() AbortError rejections during source transitions', async () => {
    const video = createMockVideoElement();
    const adapter = new HlsPlayerAdapter(video);
    const onError = vi.fn();
    adapter.onError(onError);
    vi.spyOn(video, 'play').mockRejectedValueOnce(new DOMException('Aborted', 'AbortError'));

    adapter.play();
    await Promise.resolve();
    await Promise.resolve();

    expect(onError).not.toHaveBeenCalled();
  });

  it('emits PLAYBACK_START_FAILED for non-abort play() rejections', async () => {
    const video = createMockVideoElement();
    const adapter = new HlsPlayerAdapter(video);
    const onError = vi.fn();
    adapter.onError(onError);
    vi.spyOn(video, 'play').mockRejectedValueOnce(new Error('NotAllowedError'));

    adapter.play();
    await Promise.resolve();
    await Promise.resolve();

    expect(onError).toHaveBeenCalledWith(expect.objectContaining({
      code: 'PLAYBACK_START_FAILED',
      fatal: false,
    }));
    expect(adapter.getState()).not.toBe('error');
  });

  it('extracts HTTP status from hls.js response payload when network details are missing', () => {
    const video = createMockVideoElement();
    const adapter = new HlsPlayerAdapter(video);
    const playbackError = (adapter as unknown as {
      mapHlsError: (value: unknown) => { details?: Record<string, unknown> };
    }).mapHlsError({
      type: 'networkError',
      details: 'fragLoadError',
      reason: 'HTTP status code: 502',
      fatal: false,
      response: {
        code: 502,
      },
    });

    expect(playbackError.details?.httpStatus).toBe(502);
  });

  it('extracts HTTP status from error reason text as final fallback', () => {
    const video = createMockVideoElement();
    const adapter = new HlsPlayerAdapter(video);
    const playbackError = (adapter as unknown as {
      mapHlsError: (value: unknown) => { details?: Record<string, unknown> };
    }).mapHlsError({
      type: 'networkError',
      details: 'fragLoadError',
      reason: 'segment request failed with status 404',
      fatal: false,
    });

    expect(playbackError.details?.httpStatus).toBe(404);
  });

  it('attempts hls media recovery on decode media-element errors', () => {
    const mediaErrorBackup = (globalThis as { MediaError?: unknown }).MediaError;
    if (typeof mediaErrorBackup === 'undefined') {
      (globalThis as { MediaError: { MEDIA_ERR_SRC_NOT_SUPPORTED: number; MEDIA_ERR_DECODE: number } }).MediaError = {
        MEDIA_ERR_SRC_NOT_SUPPORTED: 4,
        MEDIA_ERR_DECODE: 3,
      };
    }

    try {
      const video = createMockVideoElement();
      const adapter = new HlsPlayerAdapter(video);
      const onError = vi.fn();
      adapter.onError(onError);

      const recoverMediaError = vi.fn();
      (adapter as unknown as { hls: { recoverMediaError: () => void } }).hls = {
        recoverMediaError,
      };

      (video as unknown as { error: { code: number; message: string } }).error = {
        code: 3,
        message: 'decode error',
      };

      const errorListenerCall = (
        (video.addEventListener as unknown as { mock?: { calls?: unknown[][] } }).mock?.calls ?? []
      ).find((call) => call[0] === 'error');
      const errorListener = errorListenerCall?.[1] as (() => void) | undefined;
      expect(typeof errorListener).toBe('function');

      errorListener?.();

      expect(recoverMediaError).toHaveBeenCalledTimes(1);
      expect(onError).toHaveBeenCalledWith(expect.objectContaining({
        code: 'MEDIA_ELEMENT_3',
        fatal: false,
      }));
    } finally {
      if (typeof mediaErrorBackup === 'undefined') {
        delete (globalThis as { MediaError?: unknown }).MediaError;
      } else {
        (globalThis as { MediaError?: unknown }).MediaError = mediaErrorBackup;
      }
    }
  });
});
