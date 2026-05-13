import { describe, expect, it } from 'vitest';
import {
  buildCatchUpPrefetchKey,
  isCatchUpPrefetchFresh,
  isCatchUpPrefetchRetryDue,
  shouldPrefetchNextCatchUpProgram,
} from './catchupPrefetch';

const buildProgram = (startMs: number, endMs: number) => ({
  id: `${startMs}-${endMs}`,
  startTime: new Date(startMs),
  endTime: new Date(endMs),
});

describe('buildCatchUpPrefetchKey', () => {
  it('builds a stable cache key from channel and program ids', () => {
    expect(buildCatchUpPrefetchKey('75', 'program-1')).toBe('75:program-1');
  });
});

describe('isCatchUpPrefetchFresh', () => {
  it('returns true when the prefetched result is within the max age window', () => {
    expect(isCatchUpPrefetchFresh(1_000, 2_000, 2_000)).toBe(true);
  });

  it('returns false when the prefetched result is stale', () => {
    expect(isCatchUpPrefetchFresh(1_000, 4_500, 2_000)).toBe(false);
  });
});

describe('isCatchUpPrefetchRetryDue', () => {
  it('waits for the configured backoff window before retrying a failed prefetch', () => {
    expect(isCatchUpPrefetchRetryDue(1_000, 10_000, 15_000)).toBe(false);
    expect(isCatchUpPrefetchRetryDue(1_000, 20_000, 15_000)).toBe(true);
  });
});

describe('shouldPrefetchNextCatchUpProgram', () => {
  it('returns false when there is no next program', () => {
    const currentProgram = buildProgram(0, 60_000);
    expect(
      shouldPrefetchNextCatchUpProgram({
        currentProgram,
        nextProgram: null,
        positionMs: 55_000,
      }),
    ).toBe(false);
  });

  it('returns false when there is still enough time left in the current program', () => {
    const currentProgram = buildProgram(0, 120_000);
    const nextProgram = buildProgram(120_000, 180_000);
    expect(
      shouldPrefetchNextCatchUpProgram({
        currentProgram,
        nextProgram,
        positionMs: 20_000,
        lookaheadMs: 30_000,
      }),
    ).toBe(false);
  });

  it('returns true once playback enters the lookahead window near the program end', () => {
    const currentProgram = buildProgram(0, 120_000);
    const nextProgram = buildProgram(120_000, 180_000);
    expect(
      shouldPrefetchNextCatchUpProgram({
        currentProgram,
        nextProgram,
        positionMs: 95_000,
        lookaheadMs: 30_000,
      }),
    ).toBe(true);
  });
});
