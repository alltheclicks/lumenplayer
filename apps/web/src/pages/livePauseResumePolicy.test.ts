import { describe, expect, it } from 'vitest';
import {
  LIVE_PAUSE_STALE_THRESHOLD_MS,
  isLivePlaybackSource,
  shouldSnapToLiveOnResume,
} from './livePauseResumePolicy';

describe('isLivePlaybackSource', () => {
  it('returns true for explicit live mode', () => {
    expect(isLivePlaybackSource('live', null)).toBe(true);
  });

  it('returns false for explicit non-live modes', () => {
    expect(isLivePlaybackSource('vod', '10')).toBe(false);
    expect(isLivePlaybackSource('series-episode', '10')).toBe(false);
    expect(isLivePlaybackSource('catchup', '10')).toBe(false);
  });

  it('falls back to channel id only when mode is not explicit', () => {
    expect(isLivePlaybackSource(undefined, '10')).toBe(true);
    expect(isLivePlaybackSource(undefined, null)).toBe(false);
  });
});

describe('shouldSnapToLiveOnResume', () => {
  it('returns false when pause timestamp is missing', () => {
    expect(shouldSnapToLiveOnResume(null, Date.now())).toBe(false);
  });

  it('returns false while pause window is still fresh', () => {
    const now = Date.now();
    const pausedAt = now - (LIVE_PAUSE_STALE_THRESHOLD_MS - 1);
    expect(shouldSnapToLiveOnResume(pausedAt, now)).toBe(false);
  });

  it('returns true once pause window becomes stale', () => {
    const now = Date.now();
    const pausedAt = now - LIVE_PAUSE_STALE_THRESHOLD_MS;
    expect(shouldSnapToLiveOnResume(pausedAt, now)).toBe(true);
  });
});
