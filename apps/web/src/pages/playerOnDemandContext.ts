type SessionSourceMode = 'live' | 'catchup' | 'vod' | 'series-episode';

export interface PlayerOnDemandMetadata {
  mode?: SessionSourceMode;
  vodId?: string;
  seriesId?: string;
  seasonNumber?: number;
  episodeId?: string;
  backPath?: string;
}

export interface PlayerOnDemandContext {
  title: 'VOD Playback' | 'Episode Playback';
  backPath: string;
  backLabel: 'Back to VOD' | 'Back to Series';
}

const normalizeIdSegment = (value: string | undefined): string | null => {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : null;
};

const normalizeBackPath = (value: string | undefined): string | null => {
  const trimmed = value?.trim();
  if (!trimmed || !trimmed.startsWith('/') || trimmed.startsWith('//')) {
    return null;
  }

  return trimmed;
};

const normalizeSeasonNumber = (value: number | undefined): number | null => {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return null;
  }

  const integerValue = Math.trunc(value);
  return integerValue > 0 ? integerValue : null;
};

const buildSeriesBackPath = (
  seriesId: string | undefined,
  seasonNumber: number | undefined,
  episodeId: string | undefined
): string => {
  const normalizedSeriesId = normalizeIdSegment(seriesId);
  const basePath = normalizedSeriesId ? `/series/${normalizedSeriesId}` : '/series';
  const query = new URLSearchParams();
  const normalizedSeasonNumber = normalizeSeasonNumber(seasonNumber);
  const normalizedEpisodeId = normalizeIdSegment(episodeId);

  if (normalizedSeasonNumber !== null) {
    query.set('season', String(normalizedSeasonNumber));
  }

  if (normalizedEpisodeId) {
    query.set('episode', normalizedEpisodeId);
  }

  const queryString = query.toString();
  return queryString.length > 0 ? `${basePath}?${queryString}` : basePath;
};

export const getPlayerOnDemandContext = (
  metadata: PlayerOnDemandMetadata
): PlayerOnDemandContext | null => {
  if (metadata.mode === 'vod') {
    const vodId = normalizeIdSegment(metadata.vodId);
    const fallbackBackPath = vodId ? `/vod/${vodId}` : '/vod';
    return {
      title: 'VOD Playback',
      backPath: normalizeBackPath(metadata.backPath) ?? fallbackBackPath,
      backLabel: 'Back to VOD',
    };
  }

  if (metadata.mode === 'series-episode') {
    const fallbackBackPath = buildSeriesBackPath(
      metadata.seriesId,
      metadata.seasonNumber,
      metadata.episodeId
    );
    return {
      title: 'Episode Playback',
      backPath: normalizeBackPath(metadata.backPath) ?? fallbackBackPath,
      backLabel: 'Back to Series',
    };
  }

  return null;
};
