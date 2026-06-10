import { describe, expect, it } from 'vitest';

import { catchUpFirstSegmentLikelyInFlight } from './catchUpSegmentInFlight';

const GRACE_MS = 9_000;

describe('catchUpFirstSegmentLikelyInFlight', () => {
  it('returns false when diagnostics are missing', () => {
    expect(catchUpFirstSegmentLikelyInFlight(null, GRACE_MS)).toBe(false);
    expect(catchUpFirstSegmentLikelyInFlight(undefined, GRACE_MS)).toBe(false);
  });

  it('returns true while a fragment is actively in flight', () => {
    expect(
      catchUpFirstSegmentLikelyInFlight(
        {
          fragmentInFlight: true,
          lastFragmentLoadStartedAt: 1_000,
          lastFragmentLoadedAt: null,
        },
        GRACE_MS,
        2_000,
      ),
    ).toBe(true);
  });

  it('returns true for a slow first segment that started recently and has not landed', () => {
    // Started 5s ago (slow edge cache-miss), nothing loaded yet, within grace.
    expect(
      catchUpFirstSegmentLikelyInFlight(
        {
          fragmentInFlight: false,
          lastFragmentLoadStartedAt: 0,
          lastFragmentLoadedAt: null,
        },
        GRACE_MS,
        5_000,
      ),
    ).toBe(true);
  });

  it('returns false once the started fragment has finished loading', () => {
    expect(
      catchUpFirstSegmentLikelyInFlight(
        {
          fragmentInFlight: false,
          lastFragmentLoadStartedAt: 1_000,
          lastFragmentLoadedAt: 4_000,
        },
        GRACE_MS,
        5_000,
      ),
    ).toBe(false);
  });

  it('returns false when the in-flight grace window has elapsed (genuinely stalled)', () => {
    // Started 12s ago, never finished, past the 9s grace — give up, allow reseek.
    expect(
      catchUpFirstSegmentLikelyInFlight(
        {
          fragmentInFlight: false,
          lastFragmentLoadStartedAt: 0,
          lastFragmentLoadedAt: null,
        },
        GRACE_MS,
        12_000,
      ),
    ).toBe(false);
  });

  it('returns false when no fragment ever started', () => {
    expect(
      catchUpFirstSegmentLikelyInFlight(
        {
          fragmentInFlight: false,
          lastFragmentLoadStartedAt: null,
          lastFragmentLoadedAt: null,
        },
        GRACE_MS,
        5_000,
      ),
    ).toBe(false);
  });
});
