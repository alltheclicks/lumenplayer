import { beforeEach, describe, expect, it } from 'vitest';
import {
  applyKnownCatchUpHostAffinity,
  buildCatchUpTransportPlan,
  clearCatchUpHostAffinityMemory,
  rememberCatchUpHostAffinity,
  resolveCatchUpFinalHost,
  resolveCatchUpHostAffinity,
} from './catchupTransport';

const createUrlBuilder = () => ({
  getCatchUpRedirectUrlVariants: (
    streamId: number,
    startTimestamp: number,
    durationSeconds: number,
  ) => [
    `https://login.example/timeshift_hls/user/pass/${durationSeconds}/${startTimestamp}/${streamId}.m3u8`,
    `https://login.example/timeshift/user/pass/${durationSeconds}/${startTimestamp}/${streamId}.m3u8`,
    `https://login.example/timeshift/user/pass/${durationSeconds}/${startTimestamp}/${streamId}.ts`,
  ],
  getCatchUpUrlVariants: (
    streamId: number,
    startTimestamp: number,
    durationSeconds: number,
  ) => [
    `https://login.example/streaming/timeshift.php?stream=${streamId}&start=${startTimestamp}&duration=${durationSeconds}&extension=m3u8`,
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

  it('keeps query startup ahead of direct redirect manifests and keeps minute-step fallback ahead of stream fallback', () => {
    const plan = buildCatchUpTransportPlan({
      urlBuilder: createUrlBuilder(),
      streamId: 112,
      startTimestamp: 1_771_617_623,
      durationSeconds: 1800,
      fallbackStreamIds: [2927],
      primaryRetries: 1,
      minuteStepOffsets: [-1, 1],
      streamFallbackOffsets: [0],
    });

    expect(plan.initialAttempt.strategy).toBe('primary-query');
    expect(plan.initialAttempt.url).toContain('/streaming/timeshift.php');
    expect(plan.allAttempts[1]?.strategy).toBe('primary-retry');
    const redirectAttempt = plan.allAttempts.find((attempt) => (
      attempt.strategy === 'redirect-primary' && attempt.url.includes('/timeshift_hls/')
    ));
    expect(redirectAttempt?.url).toContain('/timeshift_hls/');

    const startOffsetIndex = plan.allAttempts.findIndex((attempt) => attempt.strategy === 'start-offset');
    const streamFallbackIndex = plan.allAttempts.findIndex((attempt) => attempt.strategy === 'stream-fallback');

    expect(startOffsetIndex).toBeGreaterThan(plan.allAttempts.indexOf(redirectAttempt ?? plan.allAttempts[0]!));
    if (streamFallbackIndex >= 0) {
      expect(streamFallbackIndex).toBeGreaterThan(startOffsetIndex);
    }

    const startOffsetAttempt = plan.allAttempts[startOffsetIndex];
    expect(startOffsetAttempt?.offsetMinutes).toBe(-1);
  });

  it('keeps transport redirects behind query variants when no manifest is available', () => {
    const tsOnlyBuilder = {
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
      ],
      getLegacyCatchUpUrlVariants: () => [],
    };

    const plan = buildCatchUpTransportPlan({
      urlBuilder: tsOnlyBuilder,
      streamId: 112,
      startTimestamp: 1_771_617_623,
      durationSeconds: 1800,
      fallbackStreamIds: [],
      primaryRetries: 1,
      minuteStepOffsets: [],
      streamFallbackOffsets: [],
    });

    expect(plan.initialAttempt.strategy).toBe('primary-query');
    expect(plan.allAttempts[1]?.strategy).toBe('primary-retry');
    expect(plan.allAttempts[2]?.strategy).toBe('redirect-primary');
    expect(plan.allAttempts).toHaveLength(3);
  });

  it('caps the transport plan at sixteen attempts while preserving deeper fallback coverage', () => {
    const plan = buildCatchUpTransportPlan({
      urlBuilder: createUrlBuilder(),
      streamId: 112,
      startTimestamp: 1_771_617_623,
      durationSeconds: 1800,
      fallbackStreamIds: [2927, 2928, 2929, 2930],
    });

    expect(plan.allAttempts.length).toBeLessThanOrEqual(16);
    expect(plan.allAttempts.some((attempt) => attempt.strategy === 'start-offset')).toBe(true);
  });

  it('prepends persisted gateway playback when rebuilding a restore transport plan', () => {
    const plan = buildCatchUpTransportPlan({
      urlBuilder: createUrlBuilder(),
      streamId: 112,
      startTimestamp: 1_771_617_623,
      durationSeconds: 1800,
      fallbackStreamIds: [2927],
      gatewaySelection: {
        serverId: 'server-1',
        assetKey: 'asset-1',
        transportMode: 'proxy-normalized',
        playbackUrl: 'http://localhost:8788/xui-api/https%3A%2F%2Fedge.example/streaming/timeshift.php?token=abc',
        assetState: 'ready',
        fallbackReason: 'gateway-normalized',
        hotStart: true,
      },
    });

    expect(plan.initialAttempt.strategy).toBe('gateway-resolved');
    expect(plan.initialAttempt.url).toContain('token=abc');
  });

  it('stores host affinity but keeps credentialed direct catch-up requests on the login host', () => {
    rememberCatchUpHostAffinity(
      'https://login.example/timeshift/user/pass/30/2026-02-23:22-37/112.ts',
      'https://edge6.castcdn.net/streaming/timeshift.php?token=abc',
    );

    expect(
      resolveCatchUpHostAffinity('https://login.example/timeshift/user/pass/30/2026-02-23:22-35/112.ts'),
    ).toBe('https://edge6.castcdn.net');
    expect(
      resolveCatchUpFinalHost('https://login.example/timeshift/user/pass/30/2026-02-23:22-35/112.ts'),
    ).toBe('https://edge6.castcdn.net');

    expect(
      applyKnownCatchUpHostAffinity('https://login.example/timeshift/user/pass/30/2026-02-23:22-35/112.ts'),
    ).toBe('https://login.example/timeshift/user/pass/30/2026-02-23:22-35/112.ts');
  });

  it('resolves the direct request origin as final host when no redirect affinity was learned', () => {
    expect(
      resolveCatchUpHostAffinity('http://oveu.mediaking.fi:8080/streaming/timeshift_shadow.php?token=abc'),
    ).toBeNull();
    expect(
      resolveCatchUpFinalHost('http://oveu.mediaking.fi:8080/streaming/timeshift_shadow.php?token=abc'),
    ).toBe('http://oveu.mediaking.fi:8080');
  });

  it('keeps encoded xui proxy credentialed generator URLs on the login host', () => {
    rememberCatchUpHostAffinity(
      'http://localhost:8080/xui-api/http%3A%2F%2Flogin.example%3A8080/streaming/timeshift.php?stream=112',
      'https://edge6.castcdn.net/streaming/timeshift.php?token=abc',
    );

    const rewritten = applyKnownCatchUpHostAffinity(
      'http://localhost:8080/xui-api/http%3A%2F%2Flogin.example%3A8080/streaming/timeshift.php?stream=112&start=2026-02-23:22-37',
    );

    expect(rewritten).toContain('/xui-api/http%3A%2F%2Flogin.example%3A8080/streaming/timeshift.php');
    expect(rewritten).toContain('start=2026-02-23:22-37');
  });

  it('rewrites tokenized xui proxy timeshift URLs when host affinity is known', () => {
    rememberCatchUpHostAffinity(
      'http://localhost:8080/xui-api/http%3A%2F%2Flogin.example%3A8080/streaming/timeshift.php?stream=112',
      'https://edge6.castcdn.net/streaming/timeshift.php?token=abc',
    );

    const rewritten = applyKnownCatchUpHostAffinity(
      'http://localhost:8080/xui-api/http%3A%2F%2Flogin.example%3A8080/streaming/timeshift.php?token=abc',
    );

    expect(rewritten).toContain('/xui-api/https%3A%2F%2Fedge6.castcdn.net/streaming/timeshift_shadow.php');
    expect(rewritten).toContain('token=abc');
  });

  it('rewrites tokenized xui proxy timeshift_hls URLs when host affinity is known', () => {
    rememberCatchUpHostAffinity(
      'http://localhost:8080/xui-api/http%3A%2F%2Flogin.example%3A8080/streaming/timeshift_hls.php?stream=112',
      'https://edge6.castcdn.net/streaming/timeshift_hls.php?token=abc',
    );

    const rewritten = applyKnownCatchUpHostAffinity(
      'http://localhost:8080/xui-api/http%3A%2F%2Flogin.example%3A8080/streaming/timeshift_hls.php?token=abc',
    );

    expect(rewritten).toContain('/xui-api/https%3A%2F%2Fedge6.castcdn.net/streaming/timeshift_hls.php');
    expect(rewritten).toContain('token=abc');
  });

  it('still starts on the login-host query generator even when direct redirect manifests exist', () => {
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

    expect(plan.initialAttempt.strategy).toBe('primary-query');
    expect(plan.initialAttempt.url).toContain('/streaming/timeshift.php');
  });

  it('suppresses legacy browser fallback when primary query is direct edge timeshift_hls', () => {
    const plan = buildCatchUpTransportPlan({
      urlBuilder: {
        ...createUrlBuilder(),
        getCatchUpUrlVariants: (
          streamId: number,
          startTimestamp: number,
          durationSeconds: number,
        ) => [
          `http://edge6.castcdn.net:8080/timeshift_hls/user/pass/${durationSeconds}/${startTimestamp}/${streamId}.m3u8`,
        ],
        getCatchUpRedirectUrlVariants: () => [],
        getLegacyCatchUpUrlVariants: (
          streamId: number,
          startTimestamp: number,
          durationSeconds: number,
        ) => [
          `https://smart.mediaking.fi:8080/timeshift/user/pass/${durationSeconds}/${startTimestamp}/${streamId}.ts`,
        ],
      },
      streamId: 112,
      startTimestamp: 1_771_617_600,
      durationSeconds: 1_800,
      fallbackStreamIds: [],
      primaryRetries: 0,
      minuteStepOffsets: [],
      streamFallbackOffsets: [],
    });

    expect(plan.allAttempts.some((attempt) => attempt.strategy === 'legacy')).toBe(false);
  });
});
