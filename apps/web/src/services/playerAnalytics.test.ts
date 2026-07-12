import { describe, expect, it } from 'vitest';
import {
  RRWEB_BLOCK_SELECTOR,
  buildCrashFingerprint,
  collectSafeDeviceSummary,
  maskReplayInput,
  boundOfflineAnalyticsBatches,
  resolveAnalyticsFlushTransport,
  shouldFlushAnalyticsQueue,
} from './playerAnalytics';
import { sanitizeTelemetryRecord } from './privacyRedaction';

describe('player analytics client safety helpers', () => {
  it('builds stable crash fingerprints while ignoring volatile numbers and URLs', () => {
    const first = buildCrashFingerprint(
      'TypeError',
      'Failed request 123',
      'at load (https://player.exyu.tv/assets/app-123.js:10:20)',
    );
    const second = buildCrashFingerprint(
      'TypeError',
      'Failed request 456',
      'at load (https://player.exyu.tv/assets/app-999.js:30:40)',
    );
    expect(first).toBe(second);
    expect(first).toMatch(/^v1-[a-f0-9]{8}$/);
  });

  it('keeps ordinary search and feedback text but strips credentials from diagnostics', () => {
    const safe = sanitizeTelemetryRecord({
      searchText: 'sportski kanali',
      feedbackText: 'slika zastane posle dva minuta',
      credentials: { username: 'viewer@example.com', password: 'secret-pass' },
      sourceUrl: 'https://provider.example/live/viewer/secret-pass/12.m3u8',
      stack: [
        'failed with Bearer abc.def',
        'https://edge.example/timeshift/viewer/secret-pass/1.ts?token=edge-secret',
      ],
    });
    const serialized = JSON.stringify(safe);
    expect(serialized).toContain('sportski kanali');
    expect(serialized).toContain('slika zastane posle dva minuta');
    expect(serialized).not.toContain('viewer@example.com');
    expect(serialized).not.toContain('secret-pass');
    expect(serialized).not.toContain('abc.def');
    expect(serialized).not.toContain('edge-secret');
  });

  it('does not attempt device fingerprinting outside a browser', () => {
    expect(collectSafeDeviceSummary()).toEqual({});
  });

  it('blocks all media surfaces and masks credential inputs without masking search text', () => {
    expect(RRWEB_BLOCK_SELECTOR).toContain('video');
    expect(RRWEB_BLOCK_SELECTOR).toContain('audio');
    expect(RRWEB_BLOCK_SELECTOR).toContain('canvas');
    const credential = {
      id: 'username',
      getAttribute: (name: string) => name === 'autocomplete' ? 'username' : null,
    } as unknown as HTMLElement;
    const search = {
      id: 'channel-search',
      getAttribute: (name: string) => name === 'type' ? 'search' : null,
    } as unknown as HTMLElement;
    expect(maskReplayInput('viewer-name', credential)).toBe('***********');
    expect(maskReplayInput('sportski kanali', search)).toBe('sportski kanali');
  });

  it('flushes at 25 events, prefers beacon on unload and bounds offline retries', () => {
    expect(shouldFlushAnalyticsQueue(24)).toBe(false);
    expect(shouldFlushAnalyticsQueue(25)).toBe(true);
    expect(resolveAnalyticsFlushTransport(true, true)).toBe('beacon');
    expect(resolveAnalyticsFlushTransport(true, false)).toBe('fetch');
    expect(resolveAnalyticsFlushTransport(false, true)).toBe('fetch');
    const bounded = Array.from({ length: 20 }, (_, index) => index)
      .reduce<number[]>((queue, entry) => boundOfflineAnalyticsBatches(queue, entry), []);
    expect(bounded).toEqual([10, 11, 12, 13, 14, 15, 16, 17, 18, 19]);
  });
});
