import { useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Helmet } from 'react-helmet-async';
import { ArrowLeft, Calendar, Clapperboard, Film, Star, UserRound } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { useSessionContext } from '@/context/session-context';
import { loadXtreamCredentials } from '@/services/xtreamCredentials';
import { xtreamCodesService } from '@/services/xtreamService';

const DEMO_EPISODE_STREAM_URL = 'https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8';

type OnDemandSourceType = 'hls' | 'mp4';

interface SeriesEpisodeItem {
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

interface SeriesDetailData {
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

const getBackdropPath = (rawBackdrop: unknown): string => {
  if (Array.isArray(rawBackdrop)) {
    return (typeof rawBackdrop[0] === 'string' ? rawBackdrop[0] : '') || '';
  }

  return typeof rawBackdrop === 'string' ? rawBackdrop : '';
};

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

const sanitizeCssUrl = (url: string): string => {
  return url.replace(/["'()\\]/g, (char) => encodeURIComponent(char));
};

const inferSourceType = (streamUrl: string, extension?: string): OnDemandSourceType => {
  if (extension === 'm3u8' || streamUrl.includes('.m3u8')) {
    return 'hls';
  }

  return 'mp4';
};

const fetchSeriesDetail = async (seriesId: string): Promise<SeriesDetailData> => {
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

  return {
    title: info.name ? String(info.name) : `Series ${seriesId}`,
    plot: info.plot ? String(info.plot) : 'No description available.',
    cast: info.cast ? String(info.cast) : '',
    director: info.director ? String(info.director) : '',
    genre: info.genre ? String(info.genre) : '',
    rating: info.rating_5based ? String(info.rating_5based) : info.rating ? String(info.rating) : '',
    cover: info.cover ? String(info.cover) : '',
    backdrop: getBackdropPath(info.backdrop_path),
    releaseDate: info.releaseDate ? String(info.releaseDate) : '',
    tmdbId: info.tmdb ? String(info.tmdb) : '',
    seasons,
  };
};

const SeriesDetail = () => {
  const navigate = useNavigate();
  const { commands } = useSessionContext();
  const params = useParams<{ seriesId: string }>();
  const seriesId = params.seriesId;

  const { data, isLoading, error } = useQuery({
    queryKey: ['series-detail', seriesId],
    queryFn: () => fetchSeriesDetail(seriesId ?? ''),
    enabled: Boolean(seriesId),
    staleTime: 5 * 60 * 1000,
  });

  const [selectedSeason, setSelectedSeason] = useState<number | null>(null);

  const metadata = useMemo(() => {
    if (!data) {
      return [];
    }

    return [
      { icon: Star, label: 'Rating', value: data.rating },
      { icon: Film, label: 'Genre', value: data.genre },
      { icon: UserRound, label: 'Director', value: data.director },
      { icon: Calendar, label: 'Release', value: data.releaseDate },
    ].filter((item) => item.value);
  }, [data]);

  const seasonOptions = data?.seasons ?? [];
  const effectiveSeason = selectedSeason ?? seasonOptions[0]?.seasonNumber ?? null;
  const activeSeason = seasonOptions.find((season) => season.seasonNumber === effectiveSeason) ?? null;

  const handlePlayEpisode = (episode: SeriesEpisodeItem) => {
    if (!data || !episode.streamUrl) {
      return;
    }

    commands.setSource(
      {
        url: episode.streamUrl,
        type: episode.streamType,
        title: `${data.title} - S${episode.seasonNumber}E${episode.episodeNumber > 0 ? episode.episodeNumber : '-'}`,
        metadata: {
          mode: 'series-episode',
          seriesId: seriesId ?? '',
          seasonNumber: episode.seasonNumber,
          episodeId: episode.id,
          episodeNumber: episode.episodeNumber,
        },
      },
      0
    );
    commands.play();
    navigate('/player');
  };

  return (
    <>
      <Helmet>
        <title>{data ? `${data.title} - Series` : 'Series Detail - IPTV Player'}</title>
      </Helmet>

      <div className="min-h-screen bg-background">
        <div
          className="h-52 w-full bg-cover bg-center md:h-64"
          style={{
            backgroundImage: data?.backdrop
              ? `linear-gradient(to bottom, transparent, hsl(var(--background))), url("${sanitizeCssUrl(data.backdrop)}")`
              : 'none',
          }}
        />

        <div className="mx-auto -mt-16 max-w-6xl px-4 pb-8 md:px-6">
          <Button variant="ghost" className="mb-4 gap-2" onClick={() => navigate('/series')}>
            <ArrowLeft className="h-4 w-4" />
            Back to Series
          </Button>

          {isLoading && (
            <p className="text-muted-foreground">Loading series detail...</p>
          )}

          {error && (
            <p className="text-destructive">
              Failed to load series detail: {error.message}
            </p>
          )}

          {!isLoading && !error && data && (
            <div className="grid gap-6 lg:grid-cols-[280px_1fr]">
              <Card className="overflow-hidden">
                <CardContent className="p-0">
                  <div className="aspect-[2/3] bg-muted">
                    {data.cover ? (
                      <img
                        src={data.cover}
                        alt={data.title}
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <div className="flex h-full items-center justify-center">
                        <Clapperboard className="h-8 w-8 text-muted-foreground" />
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>

              <div className="space-y-4">
                <h1 className="text-3xl font-bold tracking-tight">{data.title}</h1>
                <p className="text-sm leading-6 text-muted-foreground">{data.plot}</p>

                <div className="grid gap-3 sm:grid-cols-2">
                  {metadata.map((item) => (
                    <Card key={item.label}>
                      <CardContent className="flex items-center gap-3 p-4">
                        <item.icon className="h-4 w-4 text-muted-foreground" />
                        <div>
                          <p className="text-xs uppercase tracking-wide text-muted-foreground">{item.label}</p>
                          <p className="text-sm font-medium">{item.value}</p>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>

                {data.cast && (
                  <Card>
                    <CardContent className="p-4">
                      <p className="text-xs uppercase tracking-wide text-muted-foreground">Cast</p>
                      <p className="mt-1 text-sm">{data.cast}</p>
                    </CardContent>
                  </Card>
                )}

                {seasonOptions.length > 0 && (
                  <Card>
                    <CardContent className="space-y-4 p-4">
                      <div className="flex flex-wrap items-center gap-2">
                        {seasonOptions.map((season) => (
                          <Button
                            key={season.seasonNumber}
                            size="sm"
                            variant={effectiveSeason === season.seasonNumber ? 'default' : 'outline'}
                            onClick={() => setSelectedSeason(season.seasonNumber)}
                          >
                            Season {season.seasonNumber}
                          </Button>
                        ))}
                      </div>

                      <div className="space-y-2">
                        {activeSeason?.episodes.map((episode) => (
                          <div
                            key={episode.id}
                            className="rounded-lg border border-border/70 bg-card/60 p-3"
                          >
                            <div className="flex flex-wrap items-start justify-between gap-2">
                              <div>
                                <p className="text-sm font-medium">
                                  E{episode.episodeNumber > 0 ? episode.episodeNumber : '-'} • {episode.title}
                                </p>
                                <p className="text-xs text-muted-foreground">
                                  {episode.duration || episode.containerExtension.toUpperCase()}
                                </p>
                              </div>
                              <Button
                                size="sm"
                                onClick={() => handlePlayEpisode(episode)}
                                disabled={!episode.streamUrl}
                              >
                                Play Episode
                              </Button>
                            </div>
                            {episode.releaseDate && (
                              <p className="mt-1 text-xs text-muted-foreground">{episode.releaseDate}</p>
                            )}
                            {episode.plot && (
                              <p className="mt-2 line-clamp-3 text-xs text-muted-foreground">{episode.plot}</p>
                            )}
                          </div>
                        ))}
                      </div>
                    </CardContent>
                  </Card>
                )}

                <div className="flex flex-wrap gap-2">
                  {data.tmdbId && (
                    <Button
                      variant="outline"
                      onClick={() => window.open(`https://www.themoviedb.org/tv/${data.tmdbId}`, '_blank', 'noopener,noreferrer')}
                    >
                      Open TMDB
                    </Button>
                  )}
                  <Button variant="secondary" onClick={() => navigate('/player')}>
                    Open Player
                  </Button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );
};

export default SeriesDetail;
