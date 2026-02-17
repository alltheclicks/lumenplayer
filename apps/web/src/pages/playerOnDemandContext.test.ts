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

  it('keeps series playback season/episode context in fallback back path', () => {
    expect(
      getPlayerOnDemandContext({
        mode: 'series-episode',
        seriesId: '15',
        seasonNumber: 2,
        episodeId: '15-s2e6',
      })
    ).toEqual({
      title: 'Episode Playback',
      backPath: '/series/15?season=2&episode=15-s2e6',
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

  it('prefers explicit app back path when provided', () => {
    expect(
      getPlayerOnDemandContext({
        mode: 'vod',
        vodId: '42',
        backPath: '/vod/42?ref=watching',
      })
    ).toEqual({
      title: 'VOD Playback',
      backPath: '/vod/42?ref=watching',
      backLabel: 'Back to VOD',
    });
  });

  it('ignores unsafe explicit back paths and keeps deterministic fallback', () => {
    expect(
      getPlayerOnDemandContext({
        mode: 'series-episode',
        seriesId: '15',
        backPath: 'https://example.com/phishing',
      })
    ).toEqual({
      title: 'Episode Playback',
      backPath: '/series/15',
      backLabel: 'Back to Series',
    });
  });
});
