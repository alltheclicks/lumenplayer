type SessionSourceMode = 'live' | 'catchup' | 'vod' | 'series-episode';

export interface PlayerOnDemandMetadata {
  mode?: SessionSourceMode;
  vodId?: string;
  seriesId?: string;
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

export const getPlayerOnDemandContext = (
  metadata: PlayerOnDemandMetadata
): PlayerOnDemandContext | null => {
  if (metadata.mode === 'vod') {
    const vodId = normalizeIdSegment(metadata.vodId);
    return {
      title: 'VOD Playback',
      backPath: vodId ? `/vod/${vodId}` : '/vod',
      backLabel: 'Back to VOD',
    };
  }

  if (metadata.mode === 'series-episode') {
    const seriesId = normalizeIdSegment(metadata.seriesId);
    return {
      title: 'Episode Playback',
      backPath: seriesId ? `/series/${seriesId}` : '/series',
      backLabel: 'Back to Series',
    };
  }

  return null;
};
