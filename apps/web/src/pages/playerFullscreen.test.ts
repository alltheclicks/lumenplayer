import { describe, expect, it, vi } from 'vitest';
import { isPlayerFullscreenActive, togglePlayerFullscreen } from './playerFullscreen';

const createContainer = (video?: Record<string, unknown>) => ({
  contains: (element: unknown) => element === video,
  querySelector: () => video ?? null,
}) as unknown as HTMLElement;

const createDocument = (overrides: Record<string, unknown> = {}) => ({
  fullscreenElement: null,
  ...overrides,
}) as unknown as Document;

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
