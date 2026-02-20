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
});
