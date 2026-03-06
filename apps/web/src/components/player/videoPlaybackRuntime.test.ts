import { describe, expect, it } from 'vitest';

import type { CatchUpTransportAttempt } from './catchupTransport';
import type { CatchUpSessionSourceMetadata } from './sessionSources';
import {
  mapCatchUpAttemptPositionToSessionPosition,
  mapCatchUpSessionPositionToAttemptPosition,
  normalizeCatchUpAttemptRetryKey,
  resolveNextCatchUpAttemptIndex,
} from './videoPlaybackRuntime';

const buildAttempt = (
  overrides: Partial<CatchUpTransportAttempt> = {},
): CatchUpTransportAttempt => ({
  url: 'http://serv2.mediaking.fi:8080/timeshift/fica/pass/148/2026-03-05:08-30/112.m3u8',
  streamId: 112,
  startTimestamp: 1772695800,
  durationSeconds: 8880,
  offsetMinutes: 0,
  strategy: 'redirect-primary',
  ...overrides,
});

const metadata: CatchUpSessionSourceMetadata = {
  mode: 'catchup',
  channelId: '112',
  streamId: 112,
  programId: '38308258',
  startTimestamp: 1772695800,
  durationSeconds: 8880,
  fallbackStreamIds: [],
  title: 'Jutarnji program',
  source: 'xtream',
};

describe('normalizeCatchUpAttemptRetryKey', () => {
  it('removes retry cache-busting params', () => {
    expect(
      normalizeCatchUpAttemptRetryKey(
        'http://serv2.mediaking.fi:8080/timeshift/fica/pass/148/2026-03-05:08-30/112.m3u8?_retry=1&_ts=123',
      ),
    ).toBe('http://serv2.mediaking.fi:8080/timeshift/fica/pass/148/2026-03-05:08-30/112.m3u8');
  });
});

describe('resolveNextCatchUpAttemptIndex', () => {
  it('keeps sequential order for startup failures', () => {
    const attempts = [
      buildAttempt(),
      buildAttempt({
        strategy: 'primary-retry',
        url: 'http://serv2.mediaking.fi:8080/timeshift/fica/pass/148/2026-03-05:08-30/112.m3u8?_retry=1&_ts=123',
      }),
      buildAttempt({
        strategy: 'primary-query',
        url: 'http://serv2.mediaking.fi:8080/streaming/timeshift.php?username=fica&password=pass&stream=112&start=2026-03-05%3A08-30&duration=148&extension=m3u8',
      }),
    ];

    expect(resolveNextCatchUpAttemptIndex({
      attempts,
      currentAttemptIndex: 0,
      failureKind: 'startup',
    })).toBe(1);
  });

  it('skips retry clones of the same transport after runtime failures', () => {
    const attempts = [
      buildAttempt(),
      buildAttempt({
        strategy: 'primary-retry',
        url: 'http://serv2.mediaking.fi:8080/timeshift/fica/pass/148/2026-03-05:08-30/112.m3u8?_retry=1&_ts=123',
      }),
      buildAttempt({
        strategy: 'primary-query',
        url: 'http://serv2.mediaking.fi:8080/streaming/timeshift.php?username=fica&password=pass&stream=112&start=2026-03-05%3A08-30&duration=148&extension=m3u8',
      }),
    ];

    expect(resolveNextCatchUpAttemptIndex({
      attempts,
      currentAttemptIndex: 0,
      failureKind: 'runtime',
    })).toBe(2);
  });

  it('returns -1 when only equivalent retries remain after a runtime failure', () => {
    const attempts = [
      buildAttempt(),
      buildAttempt({
        strategy: 'primary-retry',
        url: 'http://serv2.mediaking.fi:8080/timeshift/fica/pass/148/2026-03-05:08-30/112.m3u8?_retry=1&_ts=123',
      }),
    ];

    expect(resolveNextCatchUpAttemptIndex({
      attempts,
      currentAttemptIndex: 0,
      failureKind: 'runtime',
    })).toBe(-1);
  });
});

describe('catch-up position mapping', () => {
  it('keeps positions unchanged for canonical attempts', () => {
    const attempt = buildAttempt();

    expect(mapCatchUpSessionPositionToAttemptPosition({
      metadata,
      attempt,
      sessionPositionMs: 41_000,
    })).toBe(41_000);

    expect(mapCatchUpAttemptPositionToSessionPosition({
      metadata,
      attempt,
      attemptPositionMs: 41_000,
    })).toBe(41_000);
  });

  it('shifts seek position when fallback starts earlier', () => {
    const attempt = buildAttempt({
      startTimestamp: metadata.startTimestamp - 60,
      offsetMinutes: -1,
      strategy: 'start-offset',
    });

    expect(mapCatchUpSessionPositionToAttemptPosition({
      metadata,
      attempt,
      sessionPositionMs: 41_000,
    })).toBe(101_000);

    expect(mapCatchUpAttemptPositionToSessionPosition({
      metadata,
      attempt,
      attemptPositionMs: 101_000,
    })).toBe(41_000);
  });

  it('clamps seek position when fallback starts later', () => {
    const attempt = buildAttempt({
      startTimestamp: metadata.startTimestamp + 60,
      offsetMinutes: 1,
      strategy: 'start-offset',
    });

    expect(mapCatchUpSessionPositionToAttemptPosition({
      metadata,
      attempt,
      sessionPositionMs: 41_000,
    })).toBe(0);

    expect(mapCatchUpAttemptPositionToSessionPosition({
      metadata,
      attempt,
      attemptPositionMs: 15_000,
    })).toBe(75_000);
  });
});
