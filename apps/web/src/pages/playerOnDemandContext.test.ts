import { describe, expect, it } from 'vitest';
import { getPlayerOnDemandContext } from './playerOnDemandContext';

describe('getPlayerOnDemandContext', () => {
  it('returns null for live/catchup sources', () => {
    expect(getPlayerOnDemandContext({ mode: 'live' })).toBeNull();
    expect(getPlayerOnDemandContext({ mode: 'catchup' })).toBeNull();
  });

  it('returns VOD context with detail back path when vodId exists', () => {
    expect(getPlayerOnDemandContext({ mode: 'vod', vodId: '42' })).toEqual({
      title: 'VOD Playback',
      backPath: '/vod/42',
      backLabel: 'Back to VOD',
    });
  });

  it('falls back to catalog path when VOD id is missing', () => {
    expect(getPlayerOnDemandContext({ mode: 'vod' })).toEqual({
      title: 'VOD Playback',
      backPath: '/vod',
      backLabel: 'Back to VOD',
    });
  });

  it('returns series detail back path when series id exists', () => {
    expect(getPlayerOnDemandContext({ mode: 'series-episode', seriesId: '15' })).toEqual({
      title: 'Episode Playback',
      backPath: '/series/15',
      backLabel: 'Back to Series',
    });
  });

  it('falls back to series catalog path when series id is missing', () => {
    expect(getPlayerOnDemandContext({ mode: 'series-episode' })).toEqual({
      title: 'Episode Playback',
      backPath: '/series',
      backLabel: 'Back to Series',
    });
  });
});
