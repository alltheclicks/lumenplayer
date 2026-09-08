import { loadXtreamCredentials } from '@/services/xtreamCredentials';
import { xtreamCodesService } from '@/services/xtreamService';
import { resolveSeriesArtworkUrl, resolveSeriesBackdropUrl } from '@/pages/seriesArtwork';

const DEMO_EPISODE_STREAM_URL = 'https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8';

type OnDemandSourceType = 'hls' | 'mp4';

export interface SeriesEpisodeItem {
  id: string;
  seasonNumber: number;
  episodeNumber: number;
  title: string;
  containerExtension: string;
  streamUrl: string;
  streamType: OnDemandSourceType;
  duration?: string;
  releaseDate?: string;
  plot?: string;
}

interface SeriesSeasonGroup {
  seasonNumber: number;
  episodes: SeriesEpisodeItem[];
}

export interface SeriesDetailData {
  title: string;
  plot: string;
  cast: string;
  director: string;
  genre: string;
  rating: string;
  cover: string;
  backdrop: string;
  releaseDate: string;
  tmdbId: string;
  seasons: SeriesSeasonGroup[];
}

const parseEpisodeNumber = (value: unknown): number => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === 'string' && value.length > 0 && !Number.isNaN(Number(value))) {
    return Number(value);
  }

  return 0;
};

const parseSeasonNumber = (seasonKey: string): number => {
  const trimmed = seasonKey.trim();
  if (trimmed.length === 0 || Number.isNaN(Number(trimmed))) {
    return 0;
  }

  return Number(trimmed);
};

const inferSourceType = (streamUrl: string, extension?: string): OnDemandSourceType => {
  if (extension === 'm3u8' || streamUrl.includes('.m3u8')) {
    return 'hls';
  }

  return 'mp4';
};

export const fetchSeriesDetail = async (seriesId: string): Promise<SeriesDetailData> => {
  const credentials = await loadXtreamCredentials();

  if (!credentials ||
      credentials.username === 'demo' ||
      credentials.server.includes('your-server.com')) {
    return {
      title: `Demo Series #${seriesId}`,
      plot: 'Demo series metadata preview. Connect Xtream credentials to load real provider data.',
      cast: 'Demo Cast',
      director: 'Demo Director',
      genre: 'Drama',
      rating: '8.1',
      cover: '',
      backdrop: '',
      releaseDate: '2024-01-01',
      tmdbId: '',
      seasons: [
        {
          seasonNumber: 1,
          episodes: [
            {
              id: `${seriesId}-s1e1`,
              seasonNumber: 1,
              episodeNumber: 1,
              title: 'Pilot',
              containerExtension: 'mp4',
              streamUrl: DEMO_EPISODE_STREAM_URL,
              streamType: 'hls',
              duration: '45m',
              releaseDate: '2024-01-01',
            },
            {
              id: `${seriesId}-s1e2`,
              seasonNumber: 1,
              episodeNumber: 2,
              title: 'Second Episode',
              containerExtension: 'mp4',
              streamUrl: DEMO_EPISODE_STREAM_URL,
              streamType: 'hls',
              duration: '44m',
              releaseDate: '2024-01-08',
            },
          ],
        },
      ],
    };
  }

  xtreamCodesService.setCredentials(credentials);
  const seriesInfo = await xtreamCodesService.getSeriesInfo(seriesId);
  const info = seriesInfo.info ?? {};

  const seasons = Object.entries(seriesInfo.episodes ?? {})
    .map(([seasonKey, episodes]) => {
      const seasonNumber = parseSeasonNumber(seasonKey);
      const mappedEpisodes = episodes
        .map((episode) => {
          const episodeInfo = (episode.info ?? {}) as Record<string, unknown>;
          const episodeNumber = parseEpisodeNumber(episode.episode_num);
          const title = typeof episode.title === 'string' && episode.title.length > 0
            ? episode.title
            : typeof episodeInfo.title === 'string' && episodeInfo.title.length > 0
              ? episodeInfo.title
              : `Episode ${episodeNumber > 0 ? episodeNumber : '-'}`;
          const id = String(episode.id);
          const rawDirectSource = episode.direct_source;
          const directSource = typeof rawDirectSource === 'string' && rawDirectSource.trim().length > 0
            ? rawDirectSource.trim()
            : '';
          const numericEpisodeId = parseEpisodeNumber(episode.id);
          const containerExtension = typeof episode.container_extension === 'string' && episode.container_extension.length > 0
            ? episode.container_extension
            : 'mp4';
          const streamUrl = directSource || (
            numericEpisodeId > 0
              ? xtreamCodesService.getSeriesEpisodeStreamUrl(numericEpisodeId, containerExtension)
              : ''
          );

          return {
            id,
            seasonNumber,
            episodeNumber,
            title,
            containerExtension,
            streamUrl,
            streamType: inferSourceType(streamUrl, containerExtension),
            duration: typeof episodeInfo.duration === 'string'
              ? episodeInfo.duration
              : undefined,
            releaseDate: typeof episodeInfo.releaseDate === 'string'
              ? episodeInfo.releaseDate
              : undefined,
            plot: typeof episodeInfo.plot === 'string'
              ? episodeInfo.plot
              : undefined,
          };
        })
        .sort((a, b) => a.episodeNumber - b.episodeNumber);

      return {
        seasonNumber,
        episodes: mappedEpisodes,
      };
    })
    .sort((a, b) => a.seasonNumber - b.seasonNumber);

  const infoRecord = info as Record<string, unknown>;

  return {
    title: info.name ? String(info.name) : `Series ${seriesId}`,
    plot: info.plot ? String(info.plot) : 'Opis nije dostupan.',
    cast: info.cast ? String(info.cast) : '',
    director: info.director ? String(info.director) : '',
    genre: info.genre ? String(info.genre) : '',
    rating: info.rating_5based ? String(info.rating_5based) : info.rating ? String(info.rating) : '',
    cover: resolveSeriesArtworkUrl(infoRecord),
    backdrop: resolveSeriesBackdropUrl(infoRecord),
    releaseDate: info.releaseDate ? String(info.releaseDate) : '',
    tmdbId: info.tmdb ? String(info.tmdb) : '',
    seasons,
  };
};

