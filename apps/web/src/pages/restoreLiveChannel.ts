import type { PlayerChannel } from '@lumen/types';

export const resolveStartupLiveChannel = (
  channels: PlayerChannel[],
  lastWatchedChannelId: string | null
): PlayerChannel | null => {
  if (channels.length === 0) {
    return null;
  }

  if (lastWatchedChannelId) {
    const matchedChannel = channels.find((channel) => channel.id === lastWatchedChannelId);
    if (matchedChannel) {
      return matchedChannel;
    }
  }

  return channels[0];
};
