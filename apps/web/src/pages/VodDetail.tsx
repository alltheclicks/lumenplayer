import { formatDuration } from '@lumen/core';
import { useOnDemandHistory } from '@/hooks/useOnDemandProgress';
import { resumablePositionMs } from '@/services/onDemandProgress';
import { useMemo } from 'react';
import { BRAND_NAME } from '@/config/brand';
import { useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Helmet } from 'react-helmet-async';
import { ArrowLeft, Clock3, Film, Star, UserRound } from 'lucide-react';
import type { XtreamVOD } from '@lumen/types';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { useSessionContext } from '@/context/session-context';
import { loadXtreamCredentials } from '@/services/xtreamCredentials';
import { xtreamCodesService } from '@/services/xtreamService';
import { emitWebObservabilityEvent } from '@/services/observability';

const DEMO_VOD_STREAM_URL = 'https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8';

type VodSessionSourceType = 'hls' | 'mp4';

interface VodDetailData {
  title: string;
  plot: string;
  cast: string;
  director: string;
  genre: string;
  duration: string;
  rating: string;
  poster: string;
  backdrop: string;
  tmdbId: string;
  releaseDate: string;
  streamId?: number;
  streamUrl: string;
  streamType: VodSessionSourceType;
}

const inferVodSourceType = (
  streamUrl: string,
  extension?: string
): VodSessionSourceType => {
  if (extension === 'm3u8' || streamUrl.includes('.m3u8')) {
    return 'hls';
  }

  return 'mp4';
};

const sanitizeCssUrl = (url: string): string => {
  return url.replace(/["'()\\]/g, (char) => encodeURIComponent(char));
};

const fetchVodDetail = async (vodId: string): Promise<VodDetailData> => {
  const credentials = await loadXtreamCredentials();

  if (!credentials ||
      credentials.username === 'demo' ||
      credentials.server.includes('your-server.com')) {
    return {
      title: `Demo Movie #${vodId}`,
      plot: 'Demo mode metadata preview. Connect a real Xtream account to load provider details.',
      cast: 'Demo Cast',
      director: 'Demo Director',
      genre: 'Drama',
      duration: '01:45:00',
      rating: '7.5',
      poster: '',
      backdrop: '',
      tmdbId: '',
      releaseDate: '',
      streamId: Number(vodId),
      streamUrl: DEMO_VOD_STREAM_URL,
      streamType: 'hls' as VodSessionSourceType,
    };
  }

  xtreamCodesService.setCredentials(credentials);
  const vodInfo = await xtreamCodesService.getVODInfo(vodId);
  const info = vodInfo.info ?? {};
  const movieData = (vodInfo.movie_data ?? {}) as Partial<XtreamVOD>;
  const rawStreamId = movieData.stream_id;
  const streamId = typeof rawStreamId === 'number'
    ? rawStreamId
    : Number(rawStreamId);
  const extension = typeof movieData.container_extension === 'string' &&
      movieData.container_extension.length > 0
    ? movieData.container_extension
    : 'mp4';
  const directSource = typeof movieData.direct_source === 'string'
    ? movieData.direct_source.trim()
    : '';
  const streamUrl = directSource || (
    Number.isFinite(streamId)
      ? xtreamCodesService.getVODStreamUrl(streamId, extension)
      : ''
  );
  const streamType = inferVodSourceType(streamUrl, extension);

  const backdrop = Array.isArray(info.backdrop_path)
    ? info.backdrop_path[0] || ''
    : typeof info.backdrop_path === 'string'
      ? info.backdrop_path
      : '';

  return {
    title: info.name || info.o_name || vodInfo.movie_data?.name || `Movie ${vodId}`,
    plot: info.plot || 'Opis nije dostupan.',
    cast: info.cast || '',
    director: info.director || '',
    genre: info.genre || '',
    duration: info.duration || '',
    rating: String(info.rating_5based || info.rating || ''),
    poster: info.movie_image || vodInfo.movie_data?.stream_icon || '',
    backdrop,
    tmdbId: info.tmdb_id ? String(info.tmdb_id) : '',
    releaseDate: info.release_date || info.releasedate || '',
    streamId: Number.isFinite(streamId) ? streamId : undefined,
    streamUrl,
    streamType,
  };
};

const VodDetail = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const { commands } = useSessionContext();
  const history = useOnDemandHistory();
  const params = useParams<{ vodId: string }>();
  const vodId = params.vodId;
  const catalogBackPath = useMemo(() => {
    const requestedBackPath = (searchParams.get('back') ?? '').trim();
    if (requestedBackPath.startsWith('/vod')) {
      return requestedBackPath;
    }

    return '/vod';
  }, [searchParams]);
  const onDemandBackPath = useMemo(() => {
    const pathWithQuery = `${location.pathname}${location.search}${location.hash}`;
    if (pathWithQuery.startsWith('/vod')) {
      return pathWithQuery;
    }

    return vodId ? `/vod/${vodId}` : '/vod';
  }, [location.hash, location.pathname, location.search, vodId]);

  const { data, isLoading, error } = useQuery({
    queryKey: ['vod-detail', vodId],
    queryFn: () => fetchVodDetail(vodId ?? ''),
    enabled: Boolean(vodId),
    staleTime: 5 * 60 * 1000,
  });

  const resumeMs = resumablePositionMs(history.entries[`vod:${vodId}`]);
  const handlePlayVod = (fromStart = false) => {
    if (!data?.streamUrl) {
      navigate('/player');
      return;
    }

    emitWebObservabilityEvent({
      name: 'playback.source-selected',
      metadata: {
        contentKind: 'vod',
        playbackMode: 'vod',
        contentId: vodId ?? '',
        contentTitle: data.title,
        streamId: data.streamId,
      },
    });

    commands.setSource(
      {
        url: data.streamUrl,
        type: data.streamType,
        title: data.title,
        metadata: {
          mode: 'vod',
          vodId: vodId ?? '',
          streamId: data.streamId,
          backPath: onDemandBackPath,
        },
      },
      fromStart ? 0 : resumeMs
    );
    commands.play();
    navigate('/player');
  };

  const metadata = useMemo(() => {
    if (!data) {
      return [];
    }

    return [
      { icon: Clock3, label: 'Trajanje', value: data.duration },
      { icon: Star, label: 'Ocena', value: data.rating },
      { icon: Film, label: 'Žanr', value: data.genre },
      { icon: UserRound, label: 'Režija', value: data.director },
    ].filter((item) => item.value);
  }, [data]);

  return (
    <>
      <Helmet>
        <title>{data ? `${data.title} - ${BRAND_NAME}` : `Film - ${BRAND_NAME}`}</title>
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
            <p className="text-muted-foreground">Učitavanje detalja filma...</p>
          )}

          {error && (
            <p className="text-destructive">
              Neuspešno učitavanje detalja filma: {error.message}
            </p>
          )}

          {!isLoading && !error && data && (
            <div className="grid grid-cols-[7rem_minmax(0,1fr)] gap-4 md:grid-cols-[280px_1fr] md:gap-6">
              <Card className="col-span-2 w-24 self-start overflow-hidden border-border/70 bg-card/80 md:col-span-1 md:w-full">
                <CardContent className="p-0">
                  <div className="aspect-[2/3] bg-muted">
                    {data.poster ? (
                      <img
                        src={data.poster}
                        alt={data.title}
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <div className="flex h-full items-center justify-center">
                        <Film className="h-8 w-8 text-muted-foreground" />
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>

              <div className="col-span-2 min-w-0 space-y-4 md:col-span-1">
                <h1 className="text-2xl font-bold tracking-tight md:text-3xl">{data.title}</h1>
                <div className="flex flex-wrap gap-2">
                  <Button onClick={() => handlePlayVod()} disabled={!data.streamUrl || history.isLoading}>
                    {resumeMs > 0 ? `Nastavi od ${formatDuration(resumeMs / 1000)}` : 'Gledaj film'}
                  </Button>
                  {resumeMs > 0 && <Button variant="outline" onClick={() => handlePlayVod(true)}>Od početka</Button>}
                </div>
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
                      onClick={() => window.open(`https://www.themoviedb.org/movie/${data.tmdbId}`, '_blank', 'noopener,noreferrer')}
                    >
                      Otvori TMDB
                    </Button>
                  )}
                  {data.releaseDate && (
                    <Button variant="secondary" disabled>
                      Premijera {data.releaseDate}
                    </Button>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );
};

export default VodDetail;
