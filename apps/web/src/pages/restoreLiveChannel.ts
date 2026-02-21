import type { PlayerChannel } from '@lumen/types';

type StartupSessionSource = {
  channelId?: string;
  metadata?: Record<string, unknown>;
} | null;

export const resolveStartupLiveChannel = (
  channels: PlayerChannel[],
  lastWatchedChannelId: string | null,
  preferredChannelId: string | null = null
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

  return channels[0];
};

export const shouldSnapSessionRestoreToLiveEdge = (source: StartupSessionSource): boolean => {
  if (!source) {
    return false;
  }

  const metadataMode = source.metadata?.mode;
  if (metadataMode === 'live') {
    return true;
  }

  return typeof source.channelId === 'string' && source.channelId.length > 0;
};
