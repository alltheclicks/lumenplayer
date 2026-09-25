import { describe, expect, it } from 'vitest';
import { adjacentEpisodes } from './seriesNavigation';
import type { SeriesDetailData, SeriesEpisodeItem } from './seriesDetail';

describe('episode navigation', () => {
  const episode = (id: string, seasonNumber: number, streamUrl = 'episode.mp4'): SeriesEpisodeItem => ({
    id, seasonNumber, episodeNumber: Number(id), title: id, streamUrl, streamType: 'mp4', containerExtension: 'mp4',
  });
  const series = { seasons: [
    { seasonNumber: 1, episodes: [episode('1', 1), episode('2', 1, '')] },
    { seasonNumber: 2, episodes: [episode('3', 2), episode('4', 2)] },
  ] } as SeriesDetailData;
  it('crosses season boundaries while skipping unavailable sources', () => {
    expect(adjacentEpisodes(series, '1').next?.id).toBe('3');
    expect(adjacentEpisodes(series, '3').previous?.id).toBe('1');
  });
  it('does not wrap the last episode or guess an unknown current episode', () => {
    expect(adjacentEpisodes(series, '4').next).toBeUndefined();
    expect(adjacentEpisodes(series, 'unknown')).toEqual({ previous: undefined, next: undefined });
  });
});
