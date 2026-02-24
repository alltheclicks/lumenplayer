import { afterEach, describe, expect, it, vi } from 'vitest';
import { ManifestRuntimeGateError } from '@/adapters/HlsPlayerAdapter';
import {
  createCatchUpFallbackSignalFromLoadError,
  createCatchUpFallbackSignalFromPlaybackError,
  evaluateCatchUpRuntimePayload,
  normalizeContentType,
  probeCatchUpRuntimePayload,
  resolveCatchUpFallbackReason,
  resolveUrlHost,
  shouldApplyCatchUpRuntimeGate,
} from './catchupRuntimeGate';

describe('catchupRuntimeGate', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('classifies manifest content types as playable for runtime', () => {
    const result = evaluateCatchUpRuntimePayload({
      requestedUrl: 'https://login.example/timeshift/user/pass/30/2026-02-23:23-15/112.ts',
      manifestUrl: 'https://edge6.castcdn.net/streaming/timeshift.php?token=abc',
      finalUrl: 'https://edge6.castcdn.net/streaming/timeshift.php?token=abc',
      httpStatus: 200,
      contentType: 'application/x-mpegurl; charset=utf-8',
    });

    expect(result.isPlayableForRuntime).toBe(true);
    expect(result.fallbackReason).toBeNull();
    expect(result.contentType).toBe('application/x-mpegurl');
  });

  it('classifies 200 video/mp2t token payload as non-playable for browser runtime', () => {
    const result = evaluateCatchUpRuntimePayload({
      requestedUrl: 'https://login.example/timeshift/user/pass/30/2026-02-23:23-15/112.ts',
      manifestUrl: 'https://edge6.castcdn.net/streaming/timeshift.php?token=abc',
      finalUrl: 'https://edge6.castcdn.net/streaming/timeshift.php?token=abc',
      httpStatus: 200,
      contentType: 'video/mp2t',
    });

    expect(result.isPlayableForRuntime).toBe(false);
    expect(result.fallbackReason).toBe('non_playable_payload');
    expect(result.contentType).toBe('video/mp2t');
  });

  it('builds non-playable fallback signal from manifest runtime gate errors', () => {
    const runtimeGateError = new ManifestRuntimeGateError(
      {
        requestedUrl: 'https://login.example/timeshift/user/pass/30/2026-02-23:23-15/112.ts',
        manifestUrl: 'https://edge6.castcdn.net/streaming/timeshift.php?token=abc',
        finalUrl: 'https://edge6.castcdn.net/streaming/timeshift.php?token=abc',
        httpStatus: 200,
        contentType: 'video/mp2t',
      },
      {
        isPlayableForRuntime: false,
        fallbackReason: 'non_playable_payload',
      },
    );

    const signal = createCatchUpFallbackSignalFromLoadError(runtimeGateError);
    expect(signal.errorCode).toBe('NON_PLAYABLE_PAYLOAD');
    expect(signal.fallbackReason).toBe('non_playable_payload');
    expect(signal.httpStatus).toBe(200);
    expect(signal.contentType).toBe('video/mp2t');
    expect(signal.finalUrlHost).toBe('edge6.castcdn.net');
    expect(signal.isPlayableForRuntime).toBe(false);
  });

  it('maps playback error details into fallback signal metadata', () => {
    const signal = createCatchUpFallbackSignalFromPlaybackError({
      code: 'MEDIA_ERROR',
      message: 'Media decode failed',
      fatal: true,
      details: {
        httpStatus: 502,
        contentType: 'text/html; charset=utf-8',
        finalUrl: 'https://edge6.castcdn.net/streaming/timeshift.php?token=abc',
        isPlayableForRuntime: false,
      },
    });

    expect(signal.errorCode).toBe('MEDIA_ERROR');
    expect(signal.fallbackReason).toBe('media_error');
    expect(signal.httpStatus).toBe(502);
    expect(signal.contentType).toBe('text/html');
    expect(signal.finalUrlHost).toBe('edge6.castcdn.net');
    expect(signal.isPlayableForRuntime).toBe(false);
  });

  it('keeps runtime gate scoped to catch-up mode (live remains untouched)', () => {
    expect(shouldApplyCatchUpRuntimeGate('catchup')).toBe(true);
    expect(shouldApplyCatchUpRuntimeGate('live')).toBe(false);
    expect(shouldApplyCatchUpRuntimeGate('vod')).toBe(false);
    expect(shouldApplyCatchUpRuntimeGate(undefined)).toBe(false);
  });

  it('normalizes helper outputs consistently', () => {
    expect(normalizeContentType('VIDEO/MP2T; charset=utf-8')).toBe('video/mp2t');
    expect(normalizeContentType(null)).toBeNull();
    expect(resolveUrlHost('https://edge6.castcdn.net/streaming/timeshift.php?token=abc'))
      .toBe('edge6.castcdn.net');
    expect(resolveUrlHost('/not-a-full-url')).toBeNull();
    expect(resolveCatchUpFallbackReason('LOAD_TIMEOUT')).toBe('timeout');
    expect(resolveCatchUpFallbackReason('NETWORK_ERROR')).toBe('network_error');
  });

  it('probes catch-up payload headers before startup', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      url: 'https://edge6.castcdn.net/streaming/timeshift.php?token=abc',
      status: 200,
      headers: {
        get: (name: string) => (name.toLowerCase() === 'content-type' ? 'video/mp2t' : null),
      },
      body: {
        cancel: vi.fn().mockResolvedValue(undefined),
      },
    } as unknown as Response);

    const result = await probeCatchUpRuntimePayload(
      'https://login.example/timeshift/user/pass/30/2026-02-23:23-15/112.ts',
      2000,
    );

    expect(result).toEqual({
      finalUrl: 'https://edge6.castcdn.net/streaming/timeshift.php?token=abc',
      httpStatus: 200,
      contentType: 'video/mp2t',
    });
  });
});
