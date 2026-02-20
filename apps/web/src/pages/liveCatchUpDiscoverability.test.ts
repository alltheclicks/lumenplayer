import { describe, expect, it } from 'vitest';
import { resolveCatchUpClockActionTarget } from './liveCatchUpDiscoverability';

describe('liveCatchUpDiscoverability', () => {
  it('scrolls to in-page TV Unazad section when section is present', () => {
    expect(resolveCatchUpClockActionTarget(true)).toBe('scroll-to-section');
  });

  it('falls back to EPG route when in-page TV Unazad section is missing', () => {
    expect(resolveCatchUpClockActionTarget(false)).toBe('open-epg');
  });
});
