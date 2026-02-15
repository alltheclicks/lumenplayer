import type { Channel, Program } from "@lumen/types";

const generateEPG = (
  channelId: string,
  programs: string[],
  channelHasCatchUp: boolean,
): Program[] => {
  const epg: Program[] = [];
  const now = new Date();
  const startDate = new Date(now);
  startDate.setDate(startDate.getDate() - 7);
  startDate.setHours(6, 0, 0, 0);

  let currentTime = new Date(startDate);
  const endDate = new Date(now);
  endDate.setDate(endDate.getDate() + 1);

  while (currentTime < endDate) {
    const programIndex = Math.floor(Math.random() * programs.length);
    const duration = [30, 45, 60, 90, 120][Math.floor(Math.random() * 5)];
    const endTime = new Date(currentTime.getTime() + duration * 60000);

    epg.push({
      id: `${channelId}-${currentTime.getTime()}`,
      title: programs[programIndex],
      description: `Description for ${programs[programIndex]}.`,
      startTime: new Date(currentTime),
      endTime: endTime,
      category: "show",
      hasCatchUp: channelHasCatchUp && currentTime < now,
    });

    currentTime = endTime;
  }

  return epg;
};

const defaultPrograms = [
  "Morning Show",
  "News",
  "Movie",
  "Series",
  "Documentary",
  "Sports",
  "Music",
  "Evening News",
  "Talk Show",
  "Quiz",
  "Reality Show",
  "Comedy",
];

export interface BenchmarkDatasetOptions {
  channelCount?: number;
  epgEntryCount?: number;
  categoryCount?: number;
  minEpgPerChannel?: number;
  nowMs?: number;
}

export interface BenchmarkDataset {
  channels: Channel[];
  channelCount: number;
  epgEntryCount: number;
  categories: string[];
}

export const DEFAULT_BENCHMARK_CHANNEL_COUNT = 20_000;
export const DEFAULT_BENCHMARK_EPG_ENTRY_COUNT = 50_000;

const benchmarkProgramTitles = [
  "Daily News",
  "Live Sports",
  "Movie Special",
  "Morning Show",
  "Talk Panel",
  "Documentary Hour",
  "Kids Block",
  "Evening Prime",
  "Night Replay",
  "Music Mix",
];

const benchmarkDurationMinutes = [15, 30, 45, 60, 90];

const normalizeCount = (value: number | undefined, fallback: number, minimum: number): number => {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return fallback;
  }

  return Math.max(minimum, Math.floor(value));
};

const buildBenchmarkCategories = (count: number): string[] => (
  Array.from({ length: count }, (_, index) => `benchmark-cat-${index + 1}`)
);

export const createBenchmarkDataset = (
  options: BenchmarkDatasetOptions = {},
): BenchmarkDataset => {
  const channelCount = normalizeCount(options.channelCount, DEFAULT_BENCHMARK_CHANNEL_COUNT, 1);
  const requestedEpgEntryCount = normalizeCount(
    options.epgEntryCount,
    DEFAULT_BENCHMARK_EPG_ENTRY_COUNT,
    0,
  );
  const minEpgPerChannel = normalizeCount(options.minEpgPerChannel, 0, 0);
  const epgEntryCount = Math.max(requestedEpgEntryCount, channelCount * minEpgPerChannel);
  const categoryCount = normalizeCount(options.categoryCount, 32, 1);
  const categories = buildBenchmarkCategories(categoryCount);

  const nowMs = normalizeCount(options.nowMs, Date.now(), 0);
  const channels: Channel[] = Array.from({ length: channelCount }, (_, index) => ({
    id: `bench-ch-${index + 1}`,
    number: index + 1,
    name: `Benchmark Channel ${index + 1}`,
    logo: "CH",
    category: categories[index % categories.length],
    hasCatchUp: index % 4 !== 0,
    isFavorite: false,
    epg: [],
  }));

  const channelCursorMs = Array.from(
    { length: channelCount },
    (_, index) => nowMs - ((index % 6) + 1) * 60 * 60 * 1000,
  );

  for (let entryIndex = 0; entryIndex < epgEntryCount; entryIndex += 1) {
    const channelIndex = entryIndex % channelCount;
    const channel = channels[channelIndex];
    const startMs = channelCursorMs[channelIndex];
    const duration =
      benchmarkDurationMinutes[(entryIndex + channelIndex) % benchmarkDurationMinutes.length];
    const endMs = startMs + duration * 60 * 1000;
    const title =
      benchmarkProgramTitles[(entryIndex * 13 + channelIndex) % benchmarkProgramTitles.length];

    channel.epg.push({
      id: `bench-${channel.id}-epg-${entryIndex + 1}`,
      title,
      description: `Synthetic benchmark program ${entryIndex + 1} for ${channel.name}.`,
      startTime: new Date(startMs),
      endTime: new Date(endMs),
      category: "benchmark",
      hasCatchUp: channel.hasCatchUp && endMs < nowMs,
    });

    channelCursorMs[channelIndex] = endMs;
  }

  for (let channelIndex = 0; channelIndex < channels.length; channelIndex += 1) {
    const channel = channels[channelIndex];
    const currentProgram = channel.epg.find((program) => (
      program.startTime.getTime() <= nowMs && program.endTime.getTime() > nowMs
    ));

    if (currentProgram) {
      channel.currentProgram = currentProgram;
    }
  }

  return {
    channels,
    channelCount,
    epgEntryCount,
    categories,
  };
};

export const generateBenchmarkChannels = (options: BenchmarkDatasetOptions = {}): Channel[] => (
  createBenchmarkDataset(options).channels
);

export const channels: Channel[] = [
  {
    id: "ch1",
    number: 1,
    name: "Channel 1",
    logo: "\u{1F4FA}",
    category: "general",
    hasCatchUp: true,
    isFavorite: false,
    epg: generateEPG("ch1", defaultPrograms, true),
  },
  {
    id: "ch2",
    number: 2,
    name: "Channel 2",
    logo: "\u{1F4FA}",
    category: "general",
    hasCatchUp: true,
    isFavorite: false,
    epg: generateEPG("ch2", defaultPrograms, true),
  },
  {
    id: "ch3",
    number: 3,
    name: "Sports Channel",
    logo: "\u26BD",
    category: "sports",
    hasCatchUp: false,
    isFavorite: false,
    epg: generateEPG(
      "ch3",
      ["Football", "Basketball", "Tennis", "Sports News"],
      false,
    ),
  },
  {
    id: "ch4",
    number: 4,
    name: "Movie Channel",
    logo: "\u{1F3AC}",
    category: "movies",
    hasCatchUp: true,
    isFavorite: false,
    epg: generateEPG(
      "ch4",
      ["Action Movie", "Comedy", "Drama", "Thriller"],
      true,
    ),
  },
  {
    id: "ch5",
    number: 5,
    name: "News 24",
    logo: "\u{1F4F0}",
    category: "news",
    hasCatchUp: true,
    isFavorite: false,
    epg: generateEPG(
      "ch5",
      ["Breaking News", "World News", "Local News", "Weather"],
      true,
    ),
  },
];

export { generateEPG, defaultPrograms };
