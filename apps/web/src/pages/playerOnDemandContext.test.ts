import { describe, expect, it } from 'vitest';
import { getPlayerOnDemandContext } from './playerOnDemandContext';

describe('getPlayerOnDemandContext', () => {
  it('returns null for live/catchup sources', () => {
    expect(getPlayerOnDemandContext({ mode: 'live' })).toBeNull();
    expect(getPlayerOnDemandContext({ mode: 'catchup' })).toBeNull();
  });

  it('returns VOD context with detail back path when vodId exists', () => {
    expect(getPlayerOnDemandContext({ mode: 'vod', vodId: '42' })).toEqual({
      title: 'Film',
      backPath: '/vod/42',
      backLabel: 'Nazad na film',
    });
  });

  it('falls back to catalog path when VOD id is missing', () => {
    expect(getPlayerOnDemandContext({ mode: 'vod' })).toEqual({
      title: 'Film',
      backPath: '/vod',
      backLabel: 'Nazad na film',
    });
  });

  it('returns series detail back path when series id exists', () => {
    expect(getPlayerOnDemandContext({ mode: 'series-episode', seriesId: '15' })).toEqual({
      title: 'Epizoda',
      backPath: '/series/15',
      backLabel: 'Nazad na seriju',
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
      title: 'Epizoda',
      backPath: '/series/15?season=2&episode=15-s2e6',
      backLabel: 'Nazad na seriju',
    });
  });

  it('falls back to series catalog path when series id is missing', () => {
    expect(getPlayerOnDemandContext({ mode: 'series-episode' })).toEqual({
      title: 'Epizoda',
      backPath: '/series',
      backLabel: 'Nazad na seriju',
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
      title: 'Film',
      backPath: '/vod/42?ref=watching',
      backLabel: 'Nazad na film',
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
      title: 'Epizoda',
      backPath: '/series/15',
      backLabel: 'Nazad na seriju',
    });
  });
});
