import { beforeEach, describe, expect, it } from 'vitest';
import {
  applyKnownCatchUpHostAffinity,
  buildCatchUpTransportPlan,
  clearCatchUpHostAffinityMemory,
  rememberCatchUpHostAffinity,
  resolveCatchUpHostAffinity,
} from './catchupTransport';

const createUrlBuilder = () => ({
  getCatchUpRedirectUrlVariants: (
    streamId: number,
    startTimestamp: number,
    durationSeconds: number,
  ) => [
    `https://login.example/timeshift/user/pass/${durationSeconds}/${startTimestamp}/${streamId}.m3u8`,
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

describe('catch-up transport plan', () => {
  beforeEach(() => {
    clearCatchUpHostAffinityMemory();
  });

  it('prioritizes query startup ahead of redirect manifests and keeps minute-step fallback ahead of stream fallback', () => {
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
    expect(plan.allAttempts[2]?.strategy).toBe('redirect-primary');
    expect(plan.allAttempts[2]?.url.endsWith('.m3u8')).toBe(true);

    const startOffsetIndex = plan.allAttempts.findIndex((attempt) => attempt.strategy === 'start-offset');
    const streamFallbackIndex = plan.allAttempts.findIndex((attempt) => attempt.strategy === 'stream-fallback');

    expect(startOffsetIndex).toBeGreaterThan(2);
    expect(streamFallbackIndex).toBeGreaterThan(startOffsetIndex);

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
        `https://login.example/streaming/timeshift.php?stream=${streamId}&start=${startTimestamp}&duration=${durationSeconds}`,
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

    expect(plan.initialAttempt.url.startsWith('https://edge6.castcdn.net')).toBe(true);
  });
});
