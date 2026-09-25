import type { SeriesDetailData } from './seriesDetail';

export const adjacentEpisodes = (series: SeriesDetailData | undefined, episodeId?: string) => {
  const episodes = series?.seasons.flatMap(season => season.episodes) ?? [];
  const index = episodes.findIndex(episode => episode.id === episodeId);
  if (index < 0) return { previous: undefined, next: undefined };
  return {
    previous: episodes.slice(0, index).reverse().find(episode => episode.streamUrl),
    next: episodes.slice(index + 1).find(episode => episode.streamUrl),
  };
};
