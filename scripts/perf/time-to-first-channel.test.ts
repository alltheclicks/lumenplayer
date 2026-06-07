import { describe, expect, it } from 'vitest';
import {
  runTimeToFirstChannelBenchmark,
  TIME_TO_FIRST_CHANNEL_THRESHOLD_MS,
} from './time-to-first-channel';

describe('LP-0327 time-to-first-channel benchmark', () => {
  it('keeps p95 time-to-first-channel under 3 seconds for the 20k dataset', () => {
    const result = runTimeToFirstChannelBenchmark();
    console.info('[perf:ttfc]', {
      samples: result.samples.length,
      medianMs: Number(result.medianMs.toFixed(3)),
      p95Ms: Number(result.p95Ms.toFixed(3)),
      p99Ms: Number(result.p99Ms.toFixed(3)),
      maxMs: Number(result.maxMs.toFixed(3)),
    });

    expect(result.samples.length).toBeGreaterThan(0);
    expect(result.p95Ms).toBeLessThan(TIME_TO_FIRST_CHANNEL_THRESHOLD_MS);
    expect(result.maxMs).toBeLessThan(TIME_TO_FIRST_CHANNEL_THRESHOLD_MS);
  });
});
