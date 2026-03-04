import { beforeEach, describe, expect, it } from 'vitest';
import {
  applyKnownCatchUpHostAffinity,
  buildCatchUpTransportPlan,
  clearCatchUpHostAffinityMemory,
  isCredentialPathCatchUpUrl,
  isCredentialQueryCatchUpUrl,
  rememberCatchUpHostAffinity,
  resolveCatchUpHostAffinity,
  shouldApplyHostAffinityToAttempt,
  toCatchUpProxyUrl,
} from './catchupTransport';

const createUrlBuilder = () => ({
  getCatchUpRedirectUrlVariants: (
    streamId: number,
    startTimestamp: number,
    durationSeconds: number,
  ) => [
    `https://login.example/timeshift/user/pass/${durationSeconds}/${startTimestamp}/${streamId}.ts`,
  ],
  getCatchUpUrlVariants: (
    streamId: number,
    startTimestamp: number,
    durationSeconds: number,
  ) => [
    `https://login.example/streaming/timeshift.php?stream=${streamId}&start=${startTimestamp}&duration=${durationSeconds}`,
  ],
  getLegacyCatchUpUrlVariants: (
    streamId: number,
    startTimestamp: number,
    durationSeconds: number,
  ) => [
    `https://login.example/timeshift/user/pass/${durationSeconds}/${startTimestamp}/${streamId}.m3u8`,
  ],
});

const createDenseUrlBuilder = () => ({
  getCatchUpRedirectUrlVariants: (
    streamId: number,
    startTimestamp: number,
    durationSeconds: number,
  ) => [
    `https://login.example/timeshift/user/pass/${durationSeconds}/${startTimestamp}/${streamId}.ts`,
    `https://login.example/timeshift/user/pass/${durationSeconds}/${startTimestamp}/${streamId}.m3u8`,
    `https://login.example/timeshift/user/pass/${durationSeconds}/${startTimestamp}/${streamId}.ts?fmt=alt`,
    `https://login.example/timeshift/user/pass/${durationSeconds}/${startTimestamp}/${streamId}.m3u8?fmt=alt`,
  ],
  getCatchUpUrlVariants: (
    streamId: number,
    startTimestamp: number,
    durationSeconds: number,
  ) => [
    `https://login.example/streaming/timeshift.php?stream=${streamId}&start=${startTimestamp}&duration=${durationSeconds}`,
    `https://login.example/streaming/timeshift.php?stream=${streamId}&start=${startTimestamp}&duration=${durationSeconds}&extension=m3u8`,
  ],
  getLegacyCatchUpUrlVariants: (
    streamId: number,
    startTimestamp: number,
    durationSeconds: number,
  ) => [
    `https://login.example/timeshift/user/pass/${durationSeconds}/${startTimestamp}/${streamId}.m3u8?legacy=1`,
  ],
});

const createShortDurationVariantBuilder = () => ({
  getCatchUpRedirectUrlVariants: (
    streamId: number,
    startTimestamp: number,
    durationSeconds: number,
  ) => [
    `https://login.example/timeshift/user/pass/${durationSeconds}/${startTimestamp}/${streamId}.ts`,
  ],
  getCatchUpUrlVariants: (
    streamId: number,
    startTimestamp: number,
    durationSeconds: number,
  ) => [
    `https://login.example/streaming/timeshift.php?stream=${streamId}&start=${startTimestamp}&duration=${durationSeconds}&extension=m3u8`,
    `https://login.example/streaming/timeshift.php?stream=${streamId}&start=${startTimestamp}&duration=${Math.max(1, Math.round(durationSeconds / 60))}&extension=m3u8`,
  ],
  getLegacyCatchUpUrlVariants: (
    streamId: number,
    startTimestamp: number,
    durationSeconds: number,
  ) => [
    `https://login.example/timeshift/user/pass/${durationSeconds}/${startTimestamp}/${streamId}.m3u8`,
  ],
});

describe('catch-up transport plan', () => {
  beforeEach(() => {
    clearCatchUpHostAffinityMemory();
  });

  it('prioritizes redirect-first startup with aggressive retries before minute-step fallback', () => {
    const plan = buildCatchUpTransportPlan({
      urlBuilder: createUrlBuilder(),
      streamId: 112,
      startTimestamp: 1_771_617_623,
      durationSeconds: 1800,
      fallbackStreamIds: [2927],
      primaryRetries: 2,
      minuteStepOffsets: [-1, 1],
      streamFallbackOffsets: [0],
    });

    expect(plan.initialAttempt.strategy).toBe('redirect-primary');
    expect(plan.allAttempts[1]?.strategy).toBe('primary-retry');
    expect(plan.allAttempts[2]?.strategy).toBe('primary-retry');

    const startOffsetIndex = plan.allAttempts.findIndex((attempt) => attempt.strategy === 'start-offset');
    const streamFallbackIndex = plan.allAttempts.findIndex((attempt) => attempt.strategy === 'stream-fallback');

    expect(startOffsetIndex).toBeGreaterThan(2);
    expect(streamFallbackIndex).toBeGreaterThan(startOffsetIndex);

    const startOffsetAttempt = plan.allAttempts[startOffsetIndex];
    expect(startOffsetAttempt?.offsetMinutes).toBe(-1);
  });

  it('keeps stream fallback attempts inside max attempt window when primary variants are dense', () => {
    const plan = buildCatchUpTransportPlan({
      urlBuilder: createDenseUrlBuilder(),
      streamId: 112,
      startTimestamp: 1_771_617_623,
      durationSeconds: 1800,
      fallbackStreamIds: [2927],
      primaryRetries: 3,
    });

    expect(plan.allAttempts.length).toBeLessThanOrEqual(48);
    expect(plan.allAttempts.some((attempt) => attempt.strategy === 'stream-fallback')).toBe(true);
    expect(plan.allAttempts.some((attempt) => attempt.streamId === 2927)).toBe(true);
  });

  it('moves short-duration query variants to the end of the attempt plan', () => {
    const plan = buildCatchUpTransportPlan({
      urlBuilder: createShortDurationVariantBuilder(),
      streamId: 381,
      startTimestamp: 1_771_698_600,
      durationSeconds: 3600,
      primaryRetries: 0,
      minuteStepOffsets: [-1, 1],
      streamFallbackOffsets: [0],
    });

    const isShortDurationVariant = (url: string): boolean => (
      /[?&]duration=60(?:&|$)/.test(url)
    );
    const shortIndexes = plan.allAttempts
      .map((attempt, index) => (isShortDurationVariant(attempt.url) ? index : -1))
      .filter((index) => index >= 0);
    const longIndexes = plan.allAttempts
      .map((attempt, index) => (!isShortDurationVariant(attempt.url) ? index : -1))
      .filter((index) => index >= 0);

    expect(shortIndexes.length).toBeGreaterThan(0);
    expect(Math.min(...shortIndexes)).toBeGreaterThan(Math.max(...longIndexes));
  });

  it('prioritizes manifest redirect variants before ts redirect variants for startup and retries', () => {
    const plan = buildCatchUpTransportPlan({
      urlBuilder: createDenseUrlBuilder(),
      streamId: 381,
      startTimestamp: 1_771_698_600,
      durationSeconds: 3600,
      primaryRetries: 1,
      minuteStepOffsets: [1],
      streamFallbackOffsets: [0],
    });

    expect(plan.allAttempts[0]?.strategy).toBe('redirect-primary');
    expect(plan.allAttempts[0]?.url.includes('.m3u8')).toBe(true);

    const firstManifestRedirectIndex = plan.allAttempts.findIndex((attempt) => (
      attempt.strategy === 'redirect-primary' && attempt.url.includes('.m3u8')
    ));
    const firstTsRedirectIndex = plan.allAttempts.findIndex((attempt) => (
      attempt.strategy === 'redirect-primary' && attempt.url.includes('.ts')
    ));
    const firstPrimaryRetryIndex = plan.allAttempts.findIndex((attempt) => (
      attempt.strategy === 'primary-retry'
    ));

    expect(firstManifestRedirectIndex).toBeGreaterThanOrEqual(0);
    expect(firstTsRedirectIndex).toBeGreaterThan(firstManifestRedirectIndex);
    expect(firstPrimaryRetryIndex).toBeGreaterThan(firstTsRedirectIndex);
    expect(plan.allAttempts[firstPrimaryRetryIndex]?.url.includes('.m3u8')).toBe(true);
  });

  it('stores host affinity and rewrites direct catch-up requests to preferred edge host', () => {
    rememberCatchUpHostAffinity(
      'https://login.example/timeshift/user/pass/30/2026-02-23:22-37/112.ts',
      'https://edge6.castcdn.net/streaming/timeshift.php?token=abc',
    );

    expect(
      resolveCatchUpHostAffinity('https://login.example/timeshift/user/pass/30/2026-02-23:22-35/112.ts'),
    ).toBe('https://edge6.castcdn.net');

    expect(
      applyKnownCatchUpHostAffinity('https://login.example/timeshift/user/pass/30/2026-02-23:22-35/112.ts'),
    ).toBe('https://edge6.castcdn.net/timeshift/user/pass/30/2026-02-23:22-35/112.ts');
  });

  it('rewrites encoded xui proxy target when host affinity is known', () => {
    rememberCatchUpHostAffinity(
      'http://localhost:8080/xui-api/http%3A%2F%2Flogin.example%3A8080/streaming/timeshift.php?stream=112',
      'https://edge6.castcdn.net/streaming/timeshift.php?token=abc',
    );

    const rewritten = applyKnownCatchUpHostAffinity(
      'http://localhost:8080/xui-api/http%3A%2F%2Flogin.example%3A8080/streaming/timeshift.php?stream=112&start=2026-02-23:22-37',
    );

    expect(rewritten).toContain('/xui-api/https%3A%2F%2Fedge6.castcdn.net/streaming/timeshift.php');
    expect(rewritten).toContain('start=2026-02-23:22-37');
  });

  it('applies remembered host affinity while building the next catch-up plan', () => {
    rememberCatchUpHostAffinity(
      'https://login.example/timeshift/user/pass/30/2026-02-23:22-37/112.ts',
      'https://edge6.castcdn.net/streaming/timeshift.php?token=abc',
    );

    const plan = buildCatchUpTransportPlan({
      urlBuilder: createUrlBuilder(),
      streamId: 112,
      startTimestamp: 1_771_617_620,
      durationSeconds: 1800,
      fallbackStreamIds: [],
      primaryRetries: 1,
      minuteStepOffsets: [-1],
      streamFallbackOffsets: [0],
    });

    // Credential-path redirect-primary URLs must NOT be rewritten to edge host
    expect(plan.initialAttempt.url.startsWith('https://login.example')).toBe(true);
    expect(plan.initialAttempt.strategy).toBe('redirect-primary');

    // But primary-query (token-based) URLs SHOULD be rewritten to edge host
    const primaryQueryAttempt = plan.allAttempts.find((a) => a.strategy === 'primary-query');
    expect(primaryQueryAttempt).toBeDefined();
    expect(primaryQueryAttempt!.url).toContain('edge6.castcdn.net');
  });

  it('rewrites direct edge requests back through xui proxy when runtime origin differs', () => {
    expect(
      toCatchUpProxyUrl('https://edge6.castcdn.net/streaming/timeshift.php?token=abc&seg=1.ts'),
    ).toBe(
      'http://localhost/xui-api/https%3A%2F%2Fedge6.castcdn.net/streaming/timeshift.php?token=abc&seg=1.ts',
    );
  });

  it('keeps already proxied requests unchanged', () => {
    const proxiedUrl = 'http://localhost:8080/xui-api/https%3A%2F%2Fedge6.castcdn.net/streaming/timeshift.php?token=abc';
    expect(toCatchUpProxyUrl(proxiedUrl)).toBe(proxiedUrl);
  });

  it('detects credential-path catch-up URLs correctly', () => {
    expect(isCredentialPathCatchUpUrl(
      'https://login.example/timeshift/user/pass/3600/2026-02-21:18-31/381.m3u8'
    )).toBe(true);

    expect(isCredentialPathCatchUpUrl(
      'http://localhost:8080/xui-api/http%3A%2F%2Fserv2.mediaking.fi%3A8080/timeshift/fica/fF2024BG2025/3600/2026-02-21:18-31/381.m3u8'
    )).toBe(true);

    expect(isCredentialPathCatchUpUrl(
      'https://login.example/streaming/timeshift.php?stream=381&start=123456&duration=3600'
    )).toBe(false);

    expect(isCredentialPathCatchUpUrl(
      'http://localhost:8080/xui-api/http%3A%2F%2Fserv2.mediaking.fi%3A8080/streaming/timeshift.php?stream=381&duration=3600'
    )).toBe(false);
  });

  it('blocks host affinity rewrite for credential-path URLs but allows for query URLs', () => {
    expect(shouldApplyHostAffinityToAttempt(
      'https://login.example/timeshift/user/pass/3600/2026-02-21:18-31/381.m3u8'
    )).toBe(false);

    expect(shouldApplyHostAffinityToAttempt(
      'https://login.example/streaming/timeshift.php?stream=381&start=123456&duration=3600'
    )).toBe(true);

    expect(shouldApplyHostAffinityToAttempt(
      'http://localhost:8080/xui-api/http%3A%2F%2Fserv2.mediaking.fi%3A8080/timeshift/fica/fF2024BG2025/3600/2026-02-21:18-31/381.m3u8'
    )).toBe(false);

    expect(shouldApplyHostAffinityToAttempt(
      'http://localhost:8080/xui-api/http%3A%2F%2Fserv2.mediaking.fi%3A8080/streaming/timeshift.php?stream=381&duration=3600'
    )).toBe(true);
  });

  it('detects query-credential catch-up URLs with username/password params', () => {
    expect(isCredentialQueryCatchUpUrl(
      'http://localhost:8080/xui-api/http%3A%2F%2Fserv2.mediaking.fi%3A8080/streaming/timeshift.php?username=fica&password=fF2024BG2025&stream=381&start=2026-02-21:18-31&duration=3600&extension=m3u8'
    )).toBe(true);

    expect(isCredentialQueryCatchUpUrl(
      'https://login.example/streaming/timeshift.php?username=fica&password=pass123&stream=381&duration=3600'
    )).toBe(true);

    expect(isCredentialQueryCatchUpUrl(
      'https://login.example/streaming/timeshift.php?stream=381&duration=3600'
    )).toBe(false);

    expect(isCredentialQueryCatchUpUrl(
      'https://edge.example/streaming/timeshift.php?token=abc123&seg=0_30068736.ts'
    )).toBe(false);
  });

  it('blocks host affinity rewrite for query-credential URLs', () => {
    expect(shouldApplyHostAffinityToAttempt(
      'http://localhost:8080/xui-api/http%3A%2F%2Fserv2.mediaking.fi%3A8080/streaming/timeshift.php?username=fica&password=fF2024BG2025&stream=381&start=2026-02-21:18-31&duration=3600&extension=m3u8'
    )).toBe(false);

    expect(shouldApplyHostAffinityToAttempt(
      'https://edge.example/streaming/timeshift.php?token=abc123'
    )).toBe(true);
  });
});
