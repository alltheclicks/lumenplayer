import { describe, expect, it } from 'vitest';
import {
  resolveCatchUpTimelineDurationSeconds,
  resolveTimelineSeekPositionSeconds,
} from './timelineSeek';

describe('resolveTimelineSeekPositionSeconds', () => {
  it('maps a pointer position to a catch-up timeline position', () => {
    expect(resolveTimelineSeekPositionSeconds({
      clientX: 150,
      timelineLeft: 100,
      timelineWidth: 200,
      durationSeconds: 400,
      fallbackPositionSeconds: 30,
    })).toBe(100);
  });

  it('clamps pointer seeks before and after the timeline', () => {
    expect(resolveTimelineSeekPositionSeconds({
      clientX: 50,
      timelineLeft: 100,
      timelineWidth: 200,
      durationSeconds: 400,
      fallbackPositionSeconds: 30,
    })).toBe(0);

    expect(resolveTimelineSeekPositionSeconds({
      clientX: 350,
      timelineLeft: 100,
      timelineWidth: 200,
      durationSeconds: 400,
      fallbackPositionSeconds: 30,
    })).toBe(400);
  });

  it('keeps the current position when layout has no usable width', () => {
    expect(resolveTimelineSeekPositionSeconds({
      clientX: 100,
      timelineLeft: 100,
      timelineWidth: 0,
      durationSeconds: 400,
      fallbackPositionSeconds: 90,
    })).toBe(90);
  });

  it('never returns NaN for invalid pointer data', () => {
    expect(resolveTimelineSeekPositionSeconds({
      clientX: Number.NaN,
      timelineLeft: 100,
      timelineWidth: 200,
      durationSeconds: 400,
      fallbackPositionSeconds: 90,
    })).toBe(90);

    expect(resolveTimelineSeekPositionSeconds({
      clientX: undefined,
      timelineLeft: 100,
      timelineWidth: 200,
      durationSeconds: 400,
      fallbackPositionSeconds: 90,
    })).toBe(90);
  });

  it('keeps the full catch-up timeline when playback uses a shifted media window', () => {
    expect(resolveCatchUpTimelineDurationSeconds({
      baseDurationSeconds: 3000,
      mediaDurationSeconds: 33,
      mediaOffsetSeconds: 1020,
      toleranceSeconds: 5,
    })).toBe(3000);
  });

  it('caps the catch-up timeline to a shorter unshifted media duration', () => {
    expect(resolveCatchUpTimelineDurationSeconds({
      baseDurationSeconds: 8400,
      mediaDurationSeconds: 3000,
      mediaOffsetSeconds: 0,
      toleranceSeconds: 5,
    })).toBe(3000);
  });
});
