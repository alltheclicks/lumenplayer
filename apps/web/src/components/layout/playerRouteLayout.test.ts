import { describe, expect, it } from 'vitest';
import { getAppShellRootClassName, isPlayerRoutePath } from './playerRouteLayout';

describe('playerRouteLayout', () => {
  it('detects player route variants', () => {
    expect(isPlayerRoutePath('/player')).toBe(true);
    expect(isPlayerRoutePath('/player/channel/42')).toBe(true);
    expect(isPlayerRoutePath('/vod')).toBe(false);
  });

  it('applies scroll-lock shell class only on player route', () => {
    expect(getAppShellRootClassName(true)).toContain('min-h-[100svh]');
    expect(getAppShellRootClassName(true)).toContain('max-w-[100vw]');
    expect(getAppShellRootClassName(true)).toContain('overflow-hidden');
    expect(getAppShellRootClassName(false)).toContain('min-h-screen');
  });
});
