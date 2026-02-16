import {
  createBenchmarkDataset,
  DEFAULT_BENCHMARK_CHANNEL_COUNT,
  DEFAULT_BENCHMARK_EPG_ENTRY_COUNT,
} from '@lumen/demo-data';
import type { Channel, PlayerChannel } from '@lumen/types';

export const BENCHMARK_NOW_MS = Date.UTC(2026, 1, 1, 12, 0, 0);

const mapBenchmarkChannel = (
  channel: Channel,
  index: number,
): PlayerChannel => ({
  id: channel.id,
  streamId: index + 1,
  source: 'xtream',
  number: channel.number,
  name: channel.name,
  logo: channel.logo,
  categoryId: channel.category,
  categoryName: channel.category,
  hasCatchUp: channel.hasCatchUp,
  catchUpDays: channel.hasCatchUp ? 7 : 0,
  epgChannelId: null,
  epg: channel.epg,
});

export const createMappedBenchmarkChannels = (): PlayerChannel[] => {
  const dataset = createBenchmarkDataset({
    channelCount: DEFAULT_BENCHMARK_CHANNEL_COUNT,
    epgEntryCount: DEFAULT_BENCHMARK_EPG_ENTRY_COUNT,
    nowMs: BENCHMARK_NOW_MS,
  });

  return dataset.channels.map(mapBenchmarkChannel);
};
