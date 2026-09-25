import { describe, expect, it } from 'vitest';
import { onDemandProgressKey, resumablePositionMs } from './onDemandProgress';

describe('on-demand resume positions', () => {
  const entry = { key: 'vod:1', positionMs: 27_000, durationMs: 90_000, updatedAt: 1 };
  it('retains a partially watched film or episode', () => {
    expect(resumablePositionMs(entry)).toBe(27_000);
    expect(resumablePositionMs({ ...entry, positionMs: 0 })).toBe(0);
  });
  it('restarts completed content and rejects corrupt or unknown durations', () => {
    for (const positionMs of [87_000, 90_000, 100_000, NaN, Infinity]) {
      expect(resumablePositionMs({ ...entry, positionMs })).toBe(0);
    }
    expect(resumablePositionMs({ ...entry, durationMs: 0 })).toBe(0);
  });
  it('separates films from episodes and ignores live/catch-up', () => {
    expect(onDemandProgressKey({ mode: 'vod', vodId: '1' })).toBe('vod:1');
    expect(onDemandProgressKey({ mode: 'series-episode', seriesId: '1', episodeId: '2' })).toBe('series:1:2');
    expect(onDemandProgressKey({ mode: 'live', vodId: '1' })).toBeNull();
  });
});
