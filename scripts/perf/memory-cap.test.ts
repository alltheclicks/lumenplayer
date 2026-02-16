import { describe, expect, it } from 'vitest';
import { MEMORY_CAP_THRESHOLD_MB, runMemoryCapBenchmark } from './memory-cap';

describe('LP-0328 memory benchmark', () => {
  it('keeps RSS under 200MB with 20k channels', () => {
    const result = runMemoryCapBenchmark();

    expect(result.firstChannelId.length).toBeGreaterThan(0);
    expect(result.rssMb).toBeLessThan(MEMORY_CAP_THRESHOLD_MB);
  });
});
