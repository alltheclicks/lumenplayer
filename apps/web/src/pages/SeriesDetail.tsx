import { fetchSeriesDetail, type SeriesEpisodeItem } from '@/services/seriesDetail';
import { formatDuration } from '@lumen/core';
import { useOnDemandHistory } from '@/hooks/useOnDemandProgress';
import { resumablePositionMs } from '@/services/onDemandProgress';
import { useEffect, useMemo, useState } from 'react';
import { BRAND_NAME } from '@/config/brand';
import { useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Helmet } from 'react-helmet-async';
import { ArrowLeft, Calendar, Clapperboard, Film, Star, UserRound } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { useSessionContext } from '@/context/session-context';
import { useSwitchToLiveMode } from '@/pages/switchToLiveMode';
import { emitWebObservabilityEvent } from '@/services/observability';

const parsePositiveInteger = (value: string | null): number | null => {
  if (!value || Number.isNaN(Number(value))) {
    return null;
  }

  const normalized = Math.trunc(Number(value));
  return normalized > 0 ? normalized : null;
};

const sanitizeCssUrl = (url: string): string => {
  return url.replace(/["'()\\]/g, (char) => encodeURIComponent(char));
};


const SeriesDetail = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const [isCoverBroken, setIsCoverBroken] = useState(false);
  const { commands } = useSessionContext();
  const history = useOnDemandHistory();
  const switchToLiveMode = useSwitchToLiveMode();
  const params = useParams<{ seriesId: string }>();
  const seriesId = params.seriesId;
  const catalogBackPath = useMemo(() => {
    const requestedBackPath = (searchParams.get('back') ?? '').trim();
    if (requestedBackPath.startsWith('/series')) {
      return requestedBackPath;
    }

    return '/series';
  }, [searchParams]);

  const { data, isLoading, error } = useQuery({
    queryKey: ['series-detail', seriesId],
    queryFn: () => fetchSeriesDetail(seriesId ?? ''),
    enabled: Boolean(seriesId),
    staleTime: 5 * 60 * 1000,
  });

  const contextSeason = parsePositiveInteger(searchParams.get('season'));
  const contextEpisodeId = (searchParams.get('episode') ?? '').trim() || null;

  const metadata = useMemo(() => {
    if (!data) {
      return [];
    }

    return [
      { icon: Star, label: 'Ocena', value: data.rating },
      { icon: Film, label: 'Žanr', value: data.genre },
      { icon: UserRound, label: 'Režija', value: data.director },
      { icon: Calendar, label: 'Premijera', value: data.releaseDate },
    ].filter((item) => item.value);
  }, [data]);

  useEffect(() => {
    setIsCoverBroken(false);
  }, [data?.cover]);

  const seasonOptions = data?.seasons ?? [];
  const activeSeason = seasonOptions.find((season) => season.seasonNumber === contextSeason)
    ?? seasonOptions[0]
    ?? null;
  const effectiveSeason = activeSeason?.seasonNumber ?? null;

  const handlePlayEpisode = (episode: SeriesEpisodeItem, fromStart = false) => {
    if (!data || !episode.streamUrl) {
      return;
    }

    const nextParams = new URLSearchParams(location.search);
    nextParams.set('season', String(episode.seasonNumber));
    nextParams.set('episode', episode.id);
    setSearchParams(nextParams, { replace: true });
    const query = nextParams.toString();
    const backPath = query.length > 0
      ? `${location.pathname}?${query}`
      : location.pathname;

    emitWebObservabilityEvent({
      name: 'playback.source-selected',
      metadata: {
        contentKind: 'series',
        playbackMode: 'series-episode',
        contentId: seriesId ?? '',
        contentTitle: data.title,
        seasonNumber: episode.seasonNumber,
        episodeId: episode.id,
        episodeNumber: episode.episodeNumber,
      },
    });

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
          backPath,
        },
      },
      fromStart ? 0 : resumablePositionMs(history.entries[`series:${seriesId}:${episode.id}`])
    );
    commands.play();
    navigate('/player');
  };

  return (
    <>
      <Helmet>
        <title>{data ? `${data.title} - ${BRAND_NAME}` : `Serija - ${BRAND_NAME}`}</title>
      </Helmet>

      <div className="bg-background">
        <div
          className="h-28 w-full bg-cover bg-center md:h-72"
          style={{
            backgroundImage: data?.backdrop
              ? `linear-gradient(to bottom, transparent, hsl(var(--background))), url("${sanitizeCssUrl(data.backdrop)}")`
              : 'none',
          }}
        />

        <div className="mx-auto -mt-12 max-w-6xl px-4 pb-8 md:px-6">
          <Button variant="ghost" className="mb-4 gap-2" onClick={() => navigate(catalogBackPath)}>
            <ArrowLeft className="h-4 w-4" />
            Nazad na katalog
          </Button>

          {isLoading && (
            <p className="text-muted-foreground">Učitavanje detalja serije...</p>
          )}

          {error && (
            <p className="text-destructive">
              Neuspešno učitavanje detalja serije: {error.message}
            </p>
          )}

          {!isLoading && !error && data && (
            <div className="grid grid-cols-[7rem_minmax(0,1fr)] gap-4 md:grid-cols-[280px_1fr] md:gap-6">
              <Card className="col-span-2 w-24 self-start overflow-hidden border-border/70 bg-card/80 md:col-span-1 md:w-full">
                <CardContent className="p-0">
                  <div className="aspect-[2/3] bg-muted">
                    {data.cover && !isCoverBroken ? (
                      <img
                        src={data.cover}
                        alt={data.title}
                        loading="lazy"
                        onError={() => {
                          setIsCoverBroken(true);
                        }}
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

              <div className="col-span-2 min-w-0 space-y-4 md:col-span-1">
                <h1 className="text-2xl font-bold tracking-tight md:text-3xl">{data.title}</h1>
                {seasonOptions.length > 0 && (
                  <Card className="border-border/70 bg-card/70">
                    <CardContent className="space-y-4 p-4">
                      <div className="flex flex-wrap items-center gap-2">
                        {seasonOptions.map((season) => (
                          <Button
                            key={season.seasonNumber}
                            size="sm"
                            variant={effectiveSeason === season.seasonNumber ? 'default' : 'outline'}
                            onClick={() => {
                              const nextParams = new URLSearchParams(searchParams);
                              nextParams.set('season', String(season.seasonNumber));
                              nextParams.delete('episode');
                              setSearchParams(nextParams, { replace: true });
                            }}
                          >
                            Sezona {season.seasonNumber}
                          </Button>
                        ))}
                      </div>

                      <div className="space-y-2">
                        {activeSeason?.episodes.map((episode) => {
                          const resumeMs = resumablePositionMs(history.entries[`series:${seriesId}:${episode.id}`]);
                          const isContextEpisode = contextEpisodeId !== null && contextEpisodeId === episode.id;
                          return (
                            <div
                              key={episode.id}
                              className={`rounded-lg border p-3 ${
                                isContextEpisode
                                  ? 'border-primary/60 bg-primary/10'
                                  : 'border-border/70 bg-card/60'
                              }`}
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
                                <div className="flex flex-wrap gap-2">
                                <Button
                                  size="sm"
                                  onClick={() => handlePlayEpisode(episode)}
                                  disabled={!episode.streamUrl || history.isLoading}
                                >
                                  {resumeMs > 0 ? `Nastavi od ${formatDuration(resumeMs / 1000)}` : 'Gledaj epizodu'}
                                </Button>
                                {resumeMs > 0 && <Button size="sm" variant="outline" onClick={() => handlePlayEpisode(episode, true)}>Od početka</Button>}
                                </div>
                              </div>
                              {episode.releaseDate && (
                                <p className="mt-1 text-xs text-muted-foreground">{episode.releaseDate}</p>
                              )}
                              {episode.plot && (
                                <p className="mt-2 line-clamp-3 text-xs text-muted-foreground">{episode.plot}</p>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </CardContent>
                  </Card>
                )}

                <p className="text-sm leading-6 text-muted-foreground">{data.plot}</p>

                <div className="grid gap-3 sm:grid-cols-2">
                  {metadata.map((item) => (
                    <Card key={item.label} className="border-border/70 bg-card/70">
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
                  <Card className="border-border/70 bg-card/70">
                    <CardContent className="p-4">
                      <p className="text-xs uppercase tracking-wide text-muted-foreground">Uloge</p>
                      <p className="mt-1 text-sm">{data.cast}</p>
                    </CardContent>
                  </Card>
                )}



                <div className="flex flex-wrap gap-2">
                  <Button variant="outline" onClick={() => navigate(catalogBackPath)}>
                    Nazad na katalog
                  </Button>
                  {data.tmdbId && (
                    <Button
                      variant="outline"
                      onClick={() => window.open(`https://www.themoviedb.org/tv/${data.tmdbId}`, '_blank', 'noopener,noreferrer')}
                    >
                      Otvori TMDB
                    </Button>
                  )}
                  <Button variant="secondary" onClick={() => switchToLiveMode()}>
                    TV uživo
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
