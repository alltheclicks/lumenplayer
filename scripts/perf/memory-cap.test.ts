import { describe, expect, it } from 'vitest';
import { MEMORY_CAP_THRESHOLD_MB, runMemoryCapBenchmark } from './memory-cap';

describe('LP-0328 memory benchmark', () => {
  it('keeps RSS under 200MB with 20k channels', () => {
    const result = runMemoryCapBenchmark();
    const memoryBudgetAfterBaselineMb = Math.max(
      0,
      MEMORY_CAP_THRESHOLD_MB - result.baselineRssMb,
    );
    console.info('[perf:rss]', {
      samples: 1,
      baselineRssMb: Number(result.baselineRssMb.toFixed(3)),
      peakRssMb: Number(result.rssMb.toFixed(3)),
      p95RssMb: Number(result.rssMb.toFixed(3)),
      deltaMb: Number(result.deltaMb.toFixed(3)),
    });

    expect(result.firstChannelId.length).toBeGreaterThan(0);
    expect(result.rssMb).toBeLessThan(MEMORY_CAP_THRESHOLD_MB);
    expect(result.deltaMb).toBeLessThan(memoryBudgetAfterBaselineMb);
  });
});
