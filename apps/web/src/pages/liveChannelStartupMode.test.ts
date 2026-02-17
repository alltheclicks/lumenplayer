import { describe, expect, it } from 'vitest';
import { shouldAutoplaySource } from './liveChannelStartupMode';

const buildSettings = (overrides?: {
  autoplay?: boolean;
  liveChannelStartMode?: 'autoplay' | 'manual';
}) => ({
  theme: 'dark' as const,
  language: 'en' as const,
  player: {
    autoplay: true,
    liveChannelStartMode: 'autoplay' as const,
    defaultVolume: 80,
    preferNativeHls: false,
    ...overrides,
  },
});

describe('liveChannelStartupMode', () => {
  it('uses explicit live channel startup mode for live sources', () => {
    const autoplaySettings = buildSettings();
    const manualSettings = buildSettings({ liveChannelStartMode: 'manual' });

    expect(shouldAutoplaySource('live', autoplaySettings)).toBe(true);
    expect(shouldAutoplaySource('live', manualSettings)).toBe(false);
  });

  it('uses general source autoplay setting for non-live sources', () => {
    const noAutoplaySettings = buildSettings({ autoplay: false });

    expect(shouldAutoplaySource('vod', noAutoplaySettings)).toBe(false);
    expect(shouldAutoplaySource('series-episode', noAutoplaySettings)).toBe(false);
    expect(shouldAutoplaySource('catchup', noAutoplaySettings)).toBe(false);
    expect(shouldAutoplaySource(undefined, noAutoplaySettings)).toBe(false);
  });
});
