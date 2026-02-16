import { filterChannels } from '@lumen/core';
import { createMappedBenchmarkChannels } from './benchmark-channel-fixture';

export const MEMORY_CAP_THRESHOLD_MB = 200;

export interface MemoryCapBenchmarkResult {
  rssMb: number;
  baselineRssMb: number;
  deltaMb: number;
  firstChannelId: string;
}

const toMegabytes = (bytes: number): number => bytes / (1024 * 1024);

const collectRssMb = (): number => toMegabytes(process.memoryUsage().rss);

export const runMemoryCapBenchmark = (): MemoryCapBenchmarkResult => {
  const baselineRssMb = collectRssMb();
  const mappedChannels = createMappedBenchmarkChannels();
  const filteredChannels = filterChannels(mappedChannels, '');
  const firstChannel = filteredChannels[0];

  if (!firstChannel) {
    throw new Error('Memory benchmark did not produce a first channel.');
  }

  const rssMb = collectRssMb();

  return {
    rssMb,
    baselineRssMb,
    deltaMb: rssMb - baselineRssMb,
    firstChannelId: firstChannel.id,
  };
};
