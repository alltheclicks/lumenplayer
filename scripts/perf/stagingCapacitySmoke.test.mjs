import { describe, expect, it } from 'vitest';
import {
  DEFAULT_CAPACITY_CONCURRENCY,
  DEFAULT_CAPACITY_REQUESTS,
  buildCapacityEndpoints,
  normalizeOrigin,
  parsePositiveInt,
  percentile,
  renderCapacitySmokeMarkdown,
} from './stagingCapacitySmoke.mjs';

describe('staging capacity smoke helpers', () => {
  it('normalizes origins and parses positive integer env values', () => {
    expect(normalizeOrigin('https://app.example.test///')).toBe('https://app.example.test');
    expect(parsePositiveInt('40', DEFAULT_CAPACITY_REQUESTS)).toBe(40);
    expect(parsePositiveInt('bad', DEFAULT_CAPACITY_CONCURRENCY)).toBe(DEFAULT_CAPACITY_CONCURRENCY);
  });

  it('computes stable percentiles', () => {
    expect(percentile([1, 2, 3, 4, 5], 0.95)).toBe(5);
    expect(percentile([10, 20, 30, 40], 0.5)).toBe(20);
    expect(percentile([], 0.95)).toBe(0);
  });

  it('builds static app and proxy endpoints without provider media stream URLs', () => {
    const endpoints = buildCapacityEndpoints({
      appUrl: 'https://app.example.test',
      proxyUrl: 'https://proxy.example.test',
    });

    expect(endpoints.map((endpoint) => endpoint.id)).toEqual([
      'web-player',
      'web-manifest',
      'cast-receiver',
      'proxy-health',
    ]);
    expect(endpoints.map((endpoint) => endpoint.url).join('\n')).not.toContain('/live/');
    expect(endpoints.map((endpoint) => endpoint.url).join('\n')).not.toContain('/timeshift');
  });

  it('renders a concise report with scope guardrail', () => {
    const markdown = renderCapacitySmokeMarkdown({
      status: 'pass',
      appUrl: 'https://app.example.test',
      proxyUrl: 'https://proxy.example.test',
      requests: 10,
      concurrency: 2,
      timeoutMs: 1000,
      generatedAt: '2026-06-05T00:00:00.000Z',
      endpoints: [{
        id: 'web-player',
        requests: 10,
        ok: 10,
        failed: 0,
        p95Ms: 12.3,
        p99Ms: 15.4,
        maxMs: 16.7,
      }],
    });

    expect(markdown).toContain('Status: PASS');
    expect(markdown).toContain('does not request provider media streams');
  });
});
