import { describe, expect, it, vi } from 'vitest';
import {
  isIosLikeDevice,
  isPlayerFullscreenActive,
  togglePlayerFullscreen,
} from './playerFullscreen';

const createContainer = (video?: Record<string, unknown>) => ({
  contains: (element: unknown) => element === video,
  querySelector: () => video ?? null,
}) as unknown as HTMLElement;

const createDocument = (overrides: Record<string, unknown> = {}) => ({
  fullscreenElement: null,
  ...overrides,
}) as unknown as Document;

const iphoneNavigator = {
  userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 Brave/1.79 Mobile/15E148 Safari/604.1',
  platform: 'iPhone',
  maxTouchPoints: 5,
};

describe('player fullscreen capability handling', () => {
  it('uses the standard fullscreen API when supported', async () => {
    const requestFullscreen = vi.fn().mockResolvedValue(undefined);
    const container = Object.assign(createContainer(), { requestFullscreen });

    await expect(togglePlayerFullscreen(container, createDocument())).resolves.toEqual({
      ok: true,
      active: true,
      method: 'standard',
    });
    expect(requestFullscreen).toHaveBeenCalledOnce();
  });

  it('falls back to native iOS video fullscreen without throwing', async () => {
    const webkitEnterFullscreen = vi.fn();
    const container = createContainer({ webkitEnterFullscreen });

    await expect(togglePlayerFullscreen(container, createDocument())).resolves.toEqual({
      ok: true,
      active: true,
      method: 'webkit-video',
    });
    expect(webkitEnterFullscreen).toHaveBeenCalledOnce();
  });

  it('falls back to native video when the standard request rejects', async () => {
    const webkitEnterFullscreen = vi.fn();
    const container = Object.assign(createContainer({ webkitEnterFullscreen }), {
      requestFullscreen: vi.fn().mockRejectedValue(new DOMException('denied', 'NotAllowedError')),
    });

    const result = await togglePlayerFullscreen(container, createDocument());
    expect(result).toMatchObject({ ok: true, active: true, method: 'webkit-video' });
  });

  it('enters native video fullscreen synchronously on iOS before trying element fullscreen', async () => {
    const webkitEnterFullscreen = vi.fn();
    const requestFullscreen = vi.fn().mockRejectedValue(new DOMException('denied', 'NotAllowedError'));
    const container = Object.assign(createContainer({ webkitEnterFullscreen }), {
      requestFullscreen,
    });

    const resultPromise = togglePlayerFullscreen(container, createDocument(), iphoneNavigator);
    expect(webkitEnterFullscreen).toHaveBeenCalledOnce();
    expect(requestFullscreen).not.toHaveBeenCalled();
    await expect(resultPromise).resolves.toMatchObject({
      ok: true,
      active: true,
      method: 'webkit-video',
    });
  });

  it('recognizes modern iPad desktop-mode user agents', () => {
    expect(isIosLikeDevice({
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15)',
      platform: 'MacIntel',
      maxTouchPoints: 5,
    })).toBe(true);
  });

  it('reports unsupported capabilities instead of generating an unhandled exception', async () => {
    await expect(togglePlayerFullscreen(createContainer(), createDocument())).resolves.toEqual({
      ok: false,
      active: false,
      method: 'unsupported',
    });
  });

  it('recognizes native video fullscreen state', () => {
    const container = createContainer({ webkitDisplayingFullscreen: true });
    expect(isPlayerFullscreenActive(container, createDocument())).toBe(true);
  });
});
