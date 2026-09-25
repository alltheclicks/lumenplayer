export interface PlaybackContentContext {
  kind?: string;
  id?: string;
  title?: string;
  episodeId?: string;
  seasonNumber?: number;
  episodeNumber?: number;
}

const text = (value: unknown): string | undefined => (
  typeof value === 'string' && value.trim() ? value.trim() : undefined
);

export const resolveSelectedPlaybackContext = (metadata: Record<string, unknown>) => {
  const kind = text(metadata.contentKind) ?? text(metadata.playbackMode);
  const onDemand = kind === 'vod' || kind === 'series' || kind === 'series-episode';
  return {
    channel: onDemand ? {} : {
      id: text(metadata.channelId) ?? (metadata.streamId != null ? String(metadata.streamId) : undefined),
      name: text(metadata.channelName) ?? text(metadata.title),
      category: text(metadata.channelCategory) ?? text(metadata.category),
    },
    content: {
      kind,
      id: text(metadata.contentId),
      title: text(metadata.contentTitle) ?? text(metadata.title) ?? text(metadata.channelName),
      episodeId: text(metadata.episodeId),
      seasonNumber: typeof metadata.seasonNumber === 'number' ? metadata.seasonNumber : undefined,
      episodeNumber: typeof metadata.episodeNumber === 'number' ? metadata.episodeNumber : undefined,
    } satisfies PlaybackContentContext,
  };
};
