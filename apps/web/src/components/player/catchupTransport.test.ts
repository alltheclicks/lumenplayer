import { beforeEach, describe, expect, it } from 'vitest';
import {
  applyKnownCatchUpHostAffinity,
  buildCatchUpTransportPlan,
  clearCatchUpHostAffinityMemory,
  rememberCatchUpHostAffinity,
  resolveCatchUpHostAffinity,
  resolveCatchUpTransportMode,
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
    `https://login.example/timeshift/user/pass/${durationSeconds}/${startTimestamp}/${streamId}.m3u8?legacy=1`,
  ],
});

describe('catch-up transport plan', () => {
  beforeEach(() => {
    clearCatchUpHostAffinityMemory();
  });

  it('prioritizes redirect-first startup with a single primary retry before minute-step fallback', () => {
    const plan = buildCatchUpTransportPlan({
      urlBuilder: createUrlBuilder(),
      streamId: 112,
      startTimestamp: 1_771_617_623,
      durationSeconds: 1800,
      fallbackStreamIds: [2927],
      minuteStepOffsets: [-1, 1],
      streamFallbackOffsets: [0],
    });

    expect(plan.initialAttempt.strategy).toBe('redirect-primary');
    expect(plan.initialAttempt.url.endsWith('.m3u8')).toBe(true);
    expect(plan.allAttempts[1]?.strategy).toBe('primary-retry');
    expect(plan.allAttempts[2]?.strategy).toBe('primary-query');

    const startOffsetIndex = plan.allAttempts.findIndex((attempt) => attempt.strategy === 'start-offset');
    const streamFallbackIndex = plan.allAttempts.findIndex((attempt) => attempt.strategy === 'stream-fallback');

    expect(startOffsetIndex).toBeGreaterThan(1);
    expect(streamFallbackIndex).toBeGreaterThan(startOffsetIndex);
    expect(plan.allAttempts).toHaveLength(15);

    const startOffsetAttempt = plan.allAttempts[startOffsetIndex];
    expect(startOffsetAttempt?.offsetMinutes).toBe(-1);
    expect(plan.allAttempts.at(-1)?.strategy).toBe('legacy');
  });

  it('keeps manifest variants ahead of ts redirect fallbacks', () => {
    const plan = buildCatchUpTransportPlan({
      urlBuilder: createUrlBuilder(),
      streamId: 112,
      startTimestamp: 1_771_617_623,
      durationSeconds: 1800,
      fallbackStreamIds: [],
      minuteStepOffsets: [],
      streamFallbackOffsets: [],
    });

    expect(plan.allAttempts[0]?.url.endsWith('.m3u8')).toBe(true);
    expect(plan.allAttempts[1]?.url.includes('_retry=1')).toBe(true);
    expect(plan.allAttempts[1]?.url.endsWith('.m3u8')).toBe(false);
    expect(plan.allAttempts[2]?.strategy).toBe('primary-query');
    expect(plan.allAttempts[3]?.url.endsWith('.ts')).toBe(true);
  });

  it('caps the transport plan at sixteen attempts', () => {
    const plan = buildCatchUpTransportPlan({
      urlBuilder: createUrlBuilder(),
      streamId: 112,
      startTimestamp: 1_771_617_623,
      durationSeconds: 1800,
      fallbackStreamIds: [2927, 2928, 2929, 2930],
    });

    expect(plan.allAttempts.length).toBeLessThanOrEqual(16);
    expect(plan.allAttempts.at(-1)?.strategy).toBe('legacy');
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

  it('marks proxied attempts as proxy-normalized and attaches proxy-local metadata', () => {
    const proxiedUrlBuilder = {
      getCatchUpRedirectUrlVariants: (
        streamId: number,
        startTimestamp: number,
        durationSeconds: number,
      ) => [
        `http://localhost:8080/xui-api/https%3A%2F%2Flogin.example/timeshift/user/pass/${durationSeconds}/${startTimestamp}/${streamId}.m3u8`,
      ],
      getCatchUpUrlVariants: () => [],
      getLegacyCatchUpUrlVariants: () => [],
    };

    const plan = buildCatchUpTransportPlan({
      urlBuilder: proxiedUrlBuilder,
      programId: 'program-1',
      streamId: 112,
      startTimestamp: 1_771_617_620,
      durationSeconds: 1800,
      fallbackStreamIds: [],
      minuteStepOffsets: [],
      streamFallbackOffsets: [],
    });

    expect(resolveCatchUpTransportMode(plan.initialAttempt.url)).toBe('proxy-normalized');
    expect(plan.initialAttempt.url).toContain('__lumenProgramId=program-1');
    expect(plan.initialAttempt.url).toContain('__lumenStreamId=112');
  });

  it('inserts a proxy-remux fallback after the primary retry when enabled', () => {
    const proxiedUrlBuilder = {
      getCatchUpRedirectUrlVariants: (
        streamId: number,
        startTimestamp: number,
        durationSeconds: number,
      ) => [
        `http://localhost:8080/xui-api/https%3A%2F%2Flogin.example/timeshift/user/pass/${durationSeconds}/${startTimestamp}/${streamId}.m3u8`,
      ],
      getCatchUpUrlVariants: (
        streamId: number,
        startTimestamp: number,
        durationSeconds: number,
      ) => [
        `http://localhost:8080/xui-api/https%3A%2F%2Flogin.example/streaming/timeshift.php?stream=${streamId}&start=${startTimestamp}&duration=${durationSeconds}`,
      ],
      getLegacyCatchUpUrlVariants: () => [],
    };

    const plan = buildCatchUpTransportPlan({
      urlBuilder: proxiedUrlBuilder,
      channelId: 'rts-1',
      programId: 'program-1',
      streamId: 112,
      startTimestamp: 1_771_617_620,
      durationSeconds: 1800,
      includeProxyRemuxFallback: true,
      fallbackStreamIds: [],
      minuteStepOffsets: [],
      streamFallbackOffsets: [],
    });

    expect(plan.allAttempts[0]?.strategy).toBe('redirect-primary');
    expect(plan.allAttempts[1]?.strategy).toBe('primary-retry');
    expect(plan.allAttempts[2]?.strategy).toBe('proxy-remux');
    expect(resolveCatchUpTransportMode(plan.allAttempts[2]?.url ?? '')).toBe('proxy-remuxed');
    expect(plan.allAttempts[2]?.url).toContain('__lumenTransport=remux-hls');
    expect(plan.allAttempts[2]?.url).toContain('__lumenFallbackReason=boundary-stall');
  });
});
