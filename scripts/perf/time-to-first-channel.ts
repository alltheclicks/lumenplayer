import { performance } from 'node:perf_hooks';
import { filterChannels } from '@lumen/core';
import { createMappedBenchmarkChannels } from './benchmark-channel-fixture';

export const TIME_TO_FIRST_CHANNEL_THRESHOLD_MS = 3000;

export interface TimeToFirstChannelSample {
  elapsedMs: number;
  channelId: string;
}

export interface TimeToFirstChannelBenchmarkResult {
  samples: TimeToFirstChannelSample[];
  medianMs: number;
  p95Ms: number;
  p99Ms: number;
  maxMs: number;
}

interface RunOptions {
  warmupRuns?: number;
  sampleRuns?: number;
}

const DEFAULT_WARMUP_RUNS = 1;
const DEFAULT_SAMPLE_RUNS = 20;

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
  const mappedChannels = createMappedBenchmarkChannels();
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
    p99Ms: percentile(elapsedValues, 99),
    maxMs: percentile(elapsedValues, 100),
  };
};
