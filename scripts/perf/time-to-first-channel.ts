import { performance } from 'node:perf_hooks';
import { filterChannels } from '@lumen/core';
import {
  createBenchmarkDataset,
  DEFAULT_BENCHMARK_CHANNEL_COUNT,
  DEFAULT_BENCHMARK_EPG_ENTRY_COUNT,
} from '@lumen/demo-data';
import type { PlayerChannel } from '@lumen/types';

export const TIME_TO_FIRST_CHANNEL_THRESHOLD_MS = 3000;

export interface TimeToFirstChannelSample {
  elapsedMs: number;
  channelId: string;
}

export interface TimeToFirstChannelBenchmarkResult {
  samples: TimeToFirstChannelSample[];
  medianMs: number;
  p95Ms: number;
  maxMs: number;
}

interface RunOptions {
  warmupRuns?: number;
  sampleRuns?: number;
}

const DEFAULT_WARMUP_RUNS = 1;
const DEFAULT_SAMPLE_RUNS = 20;
const BENCHMARK_NOW_MS = Date.UTC(2026, 1, 1, 12, 0, 0);

const mapBenchmarkChannel = (
  channel: ReturnType<typeof createBenchmarkDataset>['channels'][number],
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

const sortNumbersAscending = (values: number[]): number[] => [...values].sort((a, b) => a - b);

const percentile = (values: number[], percentileRank: number): number => {
  if (values.length === 0) {
    return 0;
  }

  const sorted = sortNumbersAscending(values);
  const clampedRank = Math.min(100, Math.max(0, percentileRank));
  const position = (clampedRank / 100) * (sorted.length - 1);
  const lowerIndex = Math.floor(position);
  const upperIndex = Math.ceil(position);
  const interpolationWeight = position - lowerIndex;
  const lowerValue = sorted[lowerIndex];
  const upperValue = sorted[upperIndex];

  return lowerValue + ((upperValue - lowerValue) * interpolationWeight);
};

const runSingleSample = (): TimeToFirstChannelSample => {
  const startedAt = performance.now();

  const dataset = createBenchmarkDataset({
    channelCount: DEFAULT_BENCHMARK_CHANNEL_COUNT,
    epgEntryCount: DEFAULT_BENCHMARK_EPG_ENTRY_COUNT,
    nowMs: BENCHMARK_NOW_MS,
  });

  const mappedChannels = dataset.channels.map(mapBenchmarkChannel);
  const filteredChannels = filterChannels(mappedChannels, '');
  const firstChannel = filteredChannels[0];

  if (!firstChannel) {
    throw new Error('Benchmark dataset did not produce a first channel.');
  }

  return {
    elapsedMs: performance.now() - startedAt,
    channelId: firstChannel.id,
  };
};

export const runTimeToFirstChannelBenchmark = (
  options: RunOptions = {},
): TimeToFirstChannelBenchmarkResult => {
  const warmupRuns = options.warmupRuns ?? DEFAULT_WARMUP_RUNS;
  const sampleRuns = options.sampleRuns ?? DEFAULT_SAMPLE_RUNS;

  for (let run = 0; run < warmupRuns; run += 1) {
    runSingleSample();
  }

  const samples: TimeToFirstChannelSample[] = [];
  for (let run = 0; run < sampleRuns; run += 1) {
    samples.push(runSingleSample());
  }

  const elapsedValues = samples.map((sample) => sample.elapsedMs);
  return {
    samples,
    medianMs: percentile(elapsedValues, 50),
    p95Ms: percentile(elapsedValues, 95),
    maxMs: percentile(elapsedValues, 100),
  };
};
