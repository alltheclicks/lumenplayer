import { beforeEach, describe, expect, it } from 'vitest';
import {
  applyKnownCatchUpHostAffinity,
  buildCatchUpTransportPlan,
  clearCatchUpHostAffinityMemory,
  parseShadowHosts,
  rememberCatchUpHostAffinity,
  resolveCatchUpFallbackAttemptUrl,
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

  it('tries CastCDN minute-offset query generators before path redirects', () => {
    const plan = buildCatchUpTransportPlan({
      urlBuilder: {
        getCatchUpRedirectUrlVariants: (
          streamId: number,
          startTimestamp: number,
          durationSeconds: number,
        ) => [
          `https://gw.castcdn.net/timeshift/user/pass/${durationSeconds}/${startTimestamp}/${streamId}.m3u8`,
          `https://gw.castcdn.net/timeshift/user/pass/${durationSeconds}/${startTimestamp}/${streamId}.ts`,
        ],
        getCatchUpUrlVariants: (
          streamId: number,
          startTimestamp: number,
          durationSeconds: number,
        ) => [
          `https://gw.castcdn.net/streaming/timeshift.php?stream=${streamId}&start=${startTimestamp}&duration=${Math.floor(durationSeconds / 60)}&extension=m3u8`,
          `https://gw.castcdn.net/streaming/timeshift.php?stream=${streamId}&start=${startTimestamp}&duration=${durationSeconds}&extension=m3u8`,
        ],
        getLegacyCatchUpUrlVariants: () => [],
      },
      streamId: 105,
      startTimestamp: 1_779_914_400,
      durationSeconds: 8_400,
      fallbackStreamIds: [],
      primaryRetries: 0,
      minuteStepOffsets: [-1],
      streamFallbackOffsets: [],
    });

    const offsetQueryIndex = plan.allAttempts.findIndex((attempt) => (
      attempt.strategy === 'start-offset' &&
      attempt.offsetMinutes === -1 &&
      attempt.url.includes('/streaming/timeshift.php')
    ));
    const firstRedirectIndex = plan.allAttempts.findIndex((attempt) => (
      attempt.strategy === 'redirect-primary'
    ));

    expect(offsetQueryIndex).toBeGreaterThan(0);
    expect(firstRedirectIndex).toBeGreaterThan(offsetQueryIndex);
    expect(plan.allAttempts[offsetQueryIndex]?.url).toContain('duration=8400');
  });

  it('prefers full-second CastCDN query duration for primary startup', () => {
    const plan = buildCatchUpTransportPlan({
      urlBuilder: {
        getCatchUpRedirectUrlVariants: () => [],
        getCatchUpUrlVariants: (
          streamId: number,
          startTimestamp: number,
          durationSeconds: number,
        ) => [
          `https://gw.castcdn.net/streaming/timeshift.php?stream=${streamId}&start=${startTimestamp}&duration=${Math.floor(durationSeconds / 60)}&extension=m3u8`,
          `https://gw.castcdn.net/streaming/timeshift.php?stream=${streamId}&start=${startTimestamp}&duration=${durationSeconds}&extension=m3u8`,
        ],
        getLegacyCatchUpUrlVariants: () => [],
      },
      streamId: 399,
      startTimestamp: 1_778_892_600,
      durationSeconds: 3_000,
      fallbackStreamIds: [],
      primaryRetries: 0,
      minuteStepOffsets: [],
      streamFallbackOffsets: [],
    });

    expect(plan.initialAttempt.strategy).toBe('primary-query');
    expect(plan.initialAttempt.url).toContain('duration=3000');
    expect(plan.allAttempts[1]?.url).toContain('duration=50');
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

  it('does not repeat the same primary catch-up URL by default', () => {
    const plan = buildCatchUpTransportPlan({
      urlBuilder: createUrlBuilder(),
      streamId: 112,
      startTimestamp: 1_771_617_623,
      durationSeconds: 1800,
      fallbackStreamIds: [],
      minuteStepOffsets: [-1],
      streamFallbackOffsets: [],
    });

    expect(plan.initialAttempt.strategy).toBe('primary-query');
    expect(plan.allAttempts.some((attempt) => attempt.strategy === 'primary-retry')).toBe(false);
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

  it('decays host affinity after the TTL so a stale edge host is no longer preferred (M1.4-a)', () => {
    const requestUrl = 'https://login.example/timeshift/user/pass/30/2026-02-23:22-37/112.ts';
    const lookupUrl = 'https://login.example/timeshift/user/pass/30/2026-02-23:22-35/112.ts';
    const t0 = 1_000_000;
    rememberCatchUpHostAffinity(
      requestUrl,
      'https://edge6.castcdn.net/streaming/timeshift.php?token=abc',
      t0,
    );

    // Within TTL: affinity still applies.
    expect(resolveCatchUpHostAffinity(lookupUrl, t0 + 60_000)).toBe('https://edge6.castcdn.net');

    // After TTL (30 min): affinity is dropped and falls back to no preference.
    const afterTtl = t0 + 30 * 60 * 1000 + 1;
    expect(resolveCatchUpHostAffinity(lookupUrl, afterTtl)).toBeNull();
    // Eviction is permanent for that origin until re-learned.
    expect(resolveCatchUpHostAffinity(lookupUrl, afterTtl + 1)).toBeNull();
  });

  it('re-learning host affinity refreshes the decay window (M1.4-a)', () => {
    const requestUrl = 'https://login.example/timeshift/user/pass/30/2026-02-23:22-37/112.ts';
    const lookupUrl = 'https://login.example/timeshift/user/pass/30/2026-02-23:22-35/112.ts';
    const t0 = 2_000_000;
    rememberCatchUpHostAffinity(requestUrl, 'https://edge6.castcdn.net/streaming/timeshift.php?token=a', t0);

    // Re-learn just before expiry resets rememberedAt.
    const refreshAt = t0 + 29 * 60 * 1000;
    rememberCatchUpHostAffinity(requestUrl, 'https://edge6.castcdn.net/streaming/timeshift.php?token=b', refreshAt);

    // Original window would have expired, but the refresh keeps it valid.
    expect(resolveCatchUpHostAffinity(lookupUrl, t0 + 31 * 60 * 1000)).toBe('https://edge6.castcdn.net');
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

  it('does not rewrite credentialed generator fallback attempts onto the archive host', () => {
    rememberCatchUpHostAffinity(
      'http://127.0.0.1:8788/xui-api/http%3A%2F%2Fserv2.mediaking.fi%3A8080/streaming/timeshift.php?username=user&password=pass&stream=109',
      'http://127.0.0.1:8788/xui-api/http%3A%2F%2Foveu.mediaking.fi%3A8080/streaming/timeshift.php?token=abc',
    );

    const fallbackUrl = 'http://127.0.0.1:8788/xui-api/http%3A%2F%2Fserv2.mediaking.fi%3A8080/streaming/timeshift.php?username=user&password=pass&stream=109&start=2026-05-15%3A05-55&duration=245&extension=m3u8';

    expect(resolveCatchUpFallbackAttemptUrl(
      fallbackUrl,
      'http://oveu.mediaking.fi:8080',
    )).toBe(fallbackUrl);
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

  describe('parseShadowHosts', () => {
    it('parses a comma-separated host list, trimming and lowercasing', () => {
      expect(parseShadowHosts('Oveu.MediaKing.fi, serv2.mediaking.fi')).toEqual([
        'oveu.mediaking.fi',
        'serv2.mediaking.fi',
      ]);
    });

    it('returns an empty list for undefined or blank input', () => {
      expect(parseShadowHosts(undefined)).toEqual([]);
      expect(parseShadowHosts('   ')).toEqual([]);
      expect(parseShadowHosts(',, ,')).toEqual([]);
    });
  });
});
