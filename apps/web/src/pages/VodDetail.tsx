import { useMemo } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Helmet } from 'react-helmet-async';
import { ArrowLeft, Clock3, Film, Star, UserRound } from 'lucide-react';
import type { XtreamVOD } from '@lumen/types';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { useSessionContext } from '@/context/session-context';
import { loadXtreamCredentials } from '@/services/xtreamCredentials';
import { xtreamCodesService } from '@/services/xtreamService';

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
    plot: info.plot || 'No description available.',
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
  const { commands } = useSessionContext();
  const params = useParams<{ vodId: string }>();
  const vodId = params.vodId;
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

  const handlePlayVod = () => {
    if (!data?.streamUrl) {
      navigate('/player');
      return;
    }

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
      0
    );
    commands.play();
    navigate('/player');
  };

  const metadata = useMemo(() => {
    if (!data) {
      return [];
    }

    return [
      { icon: Clock3, label: 'Duration', value: data.duration },
      { icon: Star, label: 'Rating', value: data.rating },
      { icon: Film, label: 'Genre', value: data.genre },
      { icon: UserRound, label: 'Director', value: data.director },
    ].filter((item) => item.value);
  }, [data]);

  return (
    <>
      <Helmet>
        <title>{data ? `${data.title} - VOD` : 'VOD Detail - IPTV Player'}</title>
      </Helmet>

      <div className="bg-background">
        <div
          className="h-52 w-full bg-cover bg-center md:h-64"
          style={{
            backgroundImage: data?.backdrop ? `linear-gradient(to bottom, transparent, hsl(var(--background))), url(${data.backdrop})` : 'none',
          }}
        />

        <div className="mx-auto -mt-16 max-w-5xl px-4 pb-8 md:px-6">
          <Button variant="ghost" className="mb-4 gap-2" onClick={() => navigate('/vod')}>
            <ArrowLeft className="h-4 w-4" />
            Back to VOD
          </Button>

          {isLoading && (
            <p className="text-muted-foreground">Loading movie details...</p>
          )}

          {error && (
            <p className="text-destructive">
              Failed to load VOD detail: {error.message}
            </p>
          )}

          {!isLoading && !error && data && (
            <div className="grid gap-6 md:grid-cols-[280px_1fr]">
              <Card className="overflow-hidden">
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

                <div className="flex flex-wrap gap-2">
                  <Button onClick={handlePlayVod}>Play in Player</Button>
                  {data.tmdbId && (
                    <Button
                      variant="outline"
                      onClick={() => window.open(`https://www.themoviedb.org/movie/${data.tmdbId}`, '_blank', 'noopener,noreferrer')}
                    >
                      Open TMDB
                    </Button>
                  )}
                  {data.releaseDate && (
                    <Button variant="secondary" disabled>
                      Released {data.releaseDate}
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
