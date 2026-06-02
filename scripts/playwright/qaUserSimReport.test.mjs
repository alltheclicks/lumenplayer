import { describe, expect, it } from 'vitest';
import {
  buildXtreamActionSuccessCounts,
  classifyXtreamFailureSeverity,
  summarizeXtreamActionSuccesses,
} from './qaUserSimReport.mjs';

describe('QA user simulation network reporting', () => {
  it('keeps critical provider actions as blockers when a 429 did not recover', () => {
    expect(classifyXtreamFailureSeverity({
      action: 'get_series',
      kind: 'response',
      status: 429,
    })).toBe('critical');
  });

  it('downgrades recovered 429s to warnings for the same Xtream action', () => {
    const successCounts = buildXtreamActionSuccessCounts([
      { action: 'get_series', status: 200 },
      { action: 'get_live_streams', status: 200 },
    ]);

    expect(classifyXtreamFailureSeverity({
      action: 'get_series',
      kind: 'response',
      status: 429,
    }, successCounts)).toBe('non-critical');
  });

  it('does not let successful calls hide 403, 5xx, or failed requests', () => {
    const successCounts = buildXtreamActionSuccessCounts([{ action: 'get_series', status: 200 }]);

    expect(classifyXtreamFailureSeverity({
      action: 'get_series',
      kind: 'response',
      status: 403,
    }, successCounts)).toBe('critical');
    expect(classifyXtreamFailureSeverity({
      action: 'get_series',
      kind: 'response',
      status: 503,
    }, successCounts)).toBe('critical');
    expect(classifyXtreamFailureSeverity({
      action: 'unknown_action',
      kind: 'requestfailed',
    }, successCounts)).toBe('critical');
  });

  it('summarizes successful Xtream actions for the report', () => {
    const summary = summarizeXtreamActionSuccesses([
      { action: 'get_series', status: 200 },
      { action: 'get_series', status: 200 },
      { action: 'get_series', status: 204 },
      { action: '', status: 200 },
    ]);

    expect(summary.get('get_series')?.total).toBe(3);
    expect(summary.get('get_series')?.statuses.get(200)).toBe(2);
    expect(summary.get('get_series')?.statuses.get(204)).toBe(1);
    expect(summary.has('')).toBe(false);
  });
});
