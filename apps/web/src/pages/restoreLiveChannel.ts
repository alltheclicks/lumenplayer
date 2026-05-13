import type { PlayerChannel } from '@lumen/types';

type StartupSessionSource = {
  channelId?: string;
  metadata?: Record<string, unknown>;
} | null;

interface ResolveStartupLiveChannelOptions {
  preferCatchUp?: boolean;
}

export const resolveStartupLiveChannel = (
  channels: PlayerChannel[],
  lastWatchedChannelId: string | null,
  preferredChannelId: string | null = null,
  options: ResolveStartupLiveChannelOptions = {},
): PlayerChannel | null => {
  if (channels.length === 0) {
    return null;
  }

  if (preferredChannelId) {
    const preferredChannel = channels.find((channel) => channel.id === preferredChannelId);
    if (preferredChannel) {
      return preferredChannel;
    }
  }

  if (lastWatchedChannelId) {
    const matchedChannel = channels.find((channel) => channel.id === lastWatchedChannelId);
    if (matchedChannel) {
      return matchedChannel;
    }
  }

  if (options.preferCatchUp) {
    const firstCatchUpChannel = channels.find((channel) => channel.hasCatchUp);
    if (firstCatchUpChannel) {
      return firstCatchUpChannel;
    }
  }

  return channels[0];
};

export const shouldSnapSessionRestoreToLiveEdge = (source: StartupSessionSource): boolean => {
  if (!source) {
    return false;
  }

  const metadataMode = source.metadata?.mode;
  if (typeof metadataMode === 'string') {
    return metadataMode === 'live';
  }

  return typeof source.channelId === 'string' && source.channelId.length > 0;
};
