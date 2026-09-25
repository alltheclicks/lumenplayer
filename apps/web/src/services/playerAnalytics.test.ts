import { describe, expect, it } from 'vitest';
import {
  RRWEB_BLOCK_SELECTOR,
  buildCrashFingerprint,
  collectSafeDeviceSummary,
  maskReplayInput,
  boundOfflineAnalyticsBatches,
  resolveAnalyticsFlushTransport,
  shouldFlushAnalyticsQueue,
  analyticsInteger,
  isDuplicateTelemetryOccurrence,
  isExtensionRuntimeError,
  mediaElementErrorDetails,
  normalizeClickCoordinates,
  resolveMediaAnalyticsEventName,
  resolveRebufferDurationMs,
  resolveAnalyticsEventChannel,
  resolveAnalyticsResponseDisposition,
  shouldCountAnalyticsError,
  shouldIgnoreMediaElementError,
  shouldStartRebufferMeasurement,
} from './playerAnalytics';
import { sanitizeTelemetryRecord } from './privacyRedaction';

describe('player analytics client safety helpers', () => {
  it('separates extension exceptions without hiding app failures called by an extension', () => {
    const error = new TypeError('Cannot read property');
    error.stack = 'TypeError: Cannot read property\n at run (chrome-extension://example/executor.js:1:2)';
    expect(isExtensionRuntimeError(error)).toBe(true);
    error.stack = 'TypeError: Cannot read property\n at app (https://player.exyu.tv/assets/player.js:1:2)\n at run (chrome-extension://example/executor.js:1:2)';
    expect(isExtensionRuntimeError(error)).toBe(false);
    expect(isExtensionRuntimeError(error, 'moz-extension://example/run.js')).toBe(true);
    expect(isExtensionRuntimeError(new Error('Script error.'))).toBe(false);
  });
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

  it('invalidates rejected analytics bindings instead of retrying them forever', () => {
    expect(resolveAnalyticsResponseDisposition(202)).toBe('accepted');
    expect(resolveAnalyticsResponseDisposition(401)).toBe('invalidate-binding');
    expect(resolveAnalyticsResponseDisposition(403)).toBe('invalidate-binding');
    expect(resolveAnalyticsResponseDisposition(429)).toBe('retry-later');
    expect(resolveAnalyticsResponseDisposition(503)).toBe('retry-later');
    expect(resolveAnalyticsResponseDisposition(400)).toBe('drop-batch');
  });

  it('normalizes database millisecond fields to finite integers', () => {
    expect(analyticsInteger(31_734.819)).toBe(31_735);
    expect(analyticsInteger(Number.POSITIVE_INFINITY)).toBeUndefined();
    expect(analyticsInteger('31734')).toBeUndefined();
  });

  it('normalizes pointer coordinates for responsive heatmaps', () => {
    expect(normalizeClickCoordinates(195, 422, 390, 844)).toEqual({
      xPercent: 50,
      yPercent: 50,
      viewportWidth: 390,
      viewportHeight: 844,
      viewportClass: 'mobile',
    });
    expect(normalizeClickCoordinates(720, 450, 1440, 900)?.viewportClass).toBe('desktop');
    expect(normalizeClickCoordinates(-1, 10, 390, 844)).toBeNull();
    expect(normalizeClickCoordinates(1, 1, 0, 844)).toBeNull();
  });

  it('inherits the current channel when a playback event omits channel metadata', () => {
    expect(resolveAnalyticsEventChannel(
      {},
      { id: '4095', name: 'ARENA PREMIUM 1', category: 'Sport' },
    )).toEqual({ id: '4095', name: 'ARENA PREMIUM 1', category: 'Sport' });
    expect(resolveAnalyticsEventChannel(
      { id: '1', name: 'RTS1' },
      { id: '4095', name: 'ARENA PREMIUM 1', category: 'Sport' },
    )).toEqual({ id: '1', name: 'RTS1', category: 'Sport' });
  });

  it('labels HTML media errors and suppresses only short duplicate bursts', () => {
    expect(mediaElementErrorDetails({ code: 3, message: '' })).toEqual({
      errorCode: 'MEDIA_ELEMENT_3',
      message: 'The media stream could not be decoded',
    });
    const previous = { fingerprint: 'MEDIA_ELEMENT_3:4095:2:0', occurredAtMs: 1_000 };
    expect(isDuplicateTelemetryOccurrence(previous, previous.fingerprint, 1_500, 1_000)).toBe(true);
    expect(isDuplicateTelemetryOccurrence(previous, previous.fingerprint, 2_000, 1_000)).toBe(false);
    expect(isDuplicateTelemetryOccurrence(previous, 'MEDIA_ELEMENT_2:4095:2:0', 1_500, 1_000)).toBe(false);
  });

  it('measures rebuffering only after active playback and outside channel startup', () => {
    expect(shouldStartRebufferMeasurement('waiting', true, true, false)).toBe(true);
    expect(shouldStartRebufferMeasurement('stalled', true, true, false)).toBe(true);
    expect(shouldStartRebufferMeasurement('waiting', false, true, false)).toBe(false);
    expect(shouldStartRebufferMeasurement('waiting', true, false, false)).toBe(false);
    expect(shouldStartRebufferMeasurement('waiting', true, true, true)).toBe(false);
    expect(shouldStartRebufferMeasurement('waiting', true, true, false, false)).toBe(false);
    expect(shouldStartRebufferMeasurement('pause', true, true, false)).toBe(false);
  });

  it('closes rebuffer spans at the foreground boundary without negative durations', () => {
    expect(resolveRebufferDurationMs(1_000, 3_500)).toBe(2_500);
    expect(resolveRebufferDurationMs(3_500, 1_000)).toBe(0);
  });

  it('counts only terminal playback failures as session errors', () => {
    expect(shouldCountAnalyticsError('playback.retry', 'warn', {
      terminal: false,
    })).toBe(false);
    expect(shouldCountAnalyticsError('playback.error', 'error', {
      fatal: true,
      terminal: false,
    })).toBe(false);
    expect(shouldCountAnalyticsError('playback.error', 'warn', {
      fatal: false,
      terminal: true,
    })).toBe(true);
    expect(shouldCountAnalyticsError('catalog.error', 'error', {})).toBe(true);
    expect(shouldCountAnalyticsError('catalog.error', 'info', {})).toBe(false);
  });

  it('keeps raw media-element errors separate from terminal playback failures', () => {
    expect(resolveMediaAnalyticsEventName('error')).toBe('playback.media_error');
    expect(resolveMediaAnalyticsEventName('playing')).toBe('playback.playing');
    expect(shouldCountAnalyticsError('playback.media_error', 'warn', {
      terminal: false,
    })).toBe(false);
  });

  it('drops transient empty-src media errors but keeps real unsupported-source failures', () => {
    expect(shouldIgnoreMediaElementError({
      code: 4,
      message: 'MEDIA_ELEMENT_ERROR: Empty src attribute',
    })).toBe(true);
    expect(shouldIgnoreMediaElementError({
      code: 4,
      message: 'The media source or format is unsupported',
    })).toBe(false);
    expect(shouldIgnoreMediaElementError({
      code: 3,
      message: 'The media stream could not be decoded',
    })).toBe(false);
  });
});
