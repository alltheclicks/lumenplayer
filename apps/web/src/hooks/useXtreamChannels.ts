/**
 * useXtreamChannels Hook
 *
 * Fetches live channels and categories from Xtream Codes API.
 */

import { useQuery } from '@tanstack/react-query';
import { mapXtreamCategory, mapXtreamChannel } from '@lumen/api';
import { channels as mockChannels } from '@lumen/demo-data';
import type { PlayerCategory, PlayerChannel, Program } from '@lumen/types';
import {
  loadXtreamCredentials,
} from '@/services/xtreamCredentials';
import { xtreamCodesService } from '@/services/xtreamService';

interface UseXtreamChannelsResult {
  channels: PlayerChannel[];
  categories: PlayerCategory[];
  isLoading: boolean;
  error: Error | null;
  refetch: () => void;
}

/**
 * Generate mock EPG data for a channel.
 */
const generateMockEPG = (channelId: string, hasCatchUp: boolean): Program[] => {
  const programs: Program[] = [];
  const now = new Date();
  const startDate = new Date(now);
  startDate.setDate(startDate.getDate() - 7);
  startDate.setHours(6, 0, 0, 0);

  const programTitles = [
    'Morning Show', 'News', 'Movie', 'Series',
    'Documentary', 'Sports', 'Music', 'Evening News',
    'Talk Show', 'Quiz', 'Reality Show', 'Comedy'
  ];

  let currentTime = new Date(startDate);
  const endDate = new Date(now);
  endDate.setDate(endDate.getDate() + 1);

  while (currentTime < endDate) {
    const programIndex = Math.floor(Math.random() * programTitles.length);
    const duration = [30, 45, 60, 90, 120][Math.floor(Math.random() * 5)];
    const endTime = new Date(currentTime.getTime() + duration * 60000);

    programs.push({
      id: `${channelId}-${currentTime.getTime()}`,
      title: programTitles[programIndex],
      description: `Description for ${programTitles[programIndex]}`,
      startTime: new Date(currentTime),
      endTime: endTime,
      category: 'show',
      hasCatchUp: hasCatchUp && currentTime < now,
    });

    currentTime = endTime;
  }

  return programs;
};

const mapMockChannel = (channel: typeof mockChannels[0], index: number): PlayerChannel => ({
  id: channel.id,
  streamId: index + 1,
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

const getMockCategories = (): PlayerCategory[] => {
  const categorySet = new Set<string>();
  mockChannels.forEach(ch => categorySet.add(ch.category));
  return Array.from(categorySet).map(cat => ({
    id: cat,
    name: cat.charAt(0).toUpperCase() + cat.slice(1),
  }));
};

const fetchXtreamChannels = async (): Promise<{
  channels: PlayerChannel[];
  categories: PlayerCategory[];
}> => {
  const credentials = await loadXtreamCredentials();

  if (!credentials ||
      credentials.username === 'demo' ||
      credentials.server.includes('your-server.com')) {
    return {
      channels: mockChannels.map((ch, idx) => mapMockChannel(ch, idx)),
      categories: getMockCategories(),
    };
  }

  xtreamCodesService.setCredentials(credentials);

  const [xtreamCategories, xtreamStreams] = await Promise.all([
    xtreamCodesService.getLiveCategories(),
    xtreamCodesService.getLiveStreams(),
  ]);

  const categories = xtreamCategories.map(mapXtreamCategory);
  const channels = xtreamStreams.map((stream, idx) =>
    mapXtreamChannel(stream, idx, xtreamCategories, generateMockEPG)
  );

  return { channels, categories };
};

export const useXtreamChannels = (): UseXtreamChannelsResult => {
  const {
    data,
    isLoading,
    error,
    refetch,
  } = useQuery({
    queryKey: ['xtream-channels'],
    queryFn: fetchXtreamChannels,
    staleTime: 5 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
    retry: 2,
    refetchOnWindowFocus: false,
  });

  return {
    channels: data?.channels || [],
    categories: data?.categories || [],
    isLoading,
    error: error as Error | null,
    refetch,
  };
};

export default useXtreamChannels;
