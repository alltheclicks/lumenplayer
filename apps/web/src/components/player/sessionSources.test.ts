import { describe, expect, it } from 'vitest';
import {
  buildCatchUpSessionSource,
  isCatchUpSessionSourceMetadata,
  parseSessionSourceMetadata,
} from './sessionSources';

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

const channel = {
  id: 'hrt-1',
  name: 'HRT 1',
  streamId: 112,
  source: 'xtream' as const,
};

const program = {
  id: 'program-1',
  title: 'Dnevnik 2',
  startTime: new Date('2026-02-23T19:00:00.000Z'),
  endTime: new Date('2026-02-23T19:30:00.000Z'),
};

describe('sessionSources', () => {
  it('parses legacy catch-up metadata into the canonical descriptor', () => {
    const parsed = parseSessionSourceMetadata({
      mode: 'catchup',
      channelId: 'hrt-1',
      streamId: '112',
      catchUpProgramId: 'program-1',
      catchUpStartTimestamp: '1771873200',
      catchUpDurationSeconds: '1800',
      catchUpFallbackUrls: [
        'https://login.example/timeshift/user/pass/1800/1771873200/2927.ts',
      ],
      title: 'Dnevnik 2',
    });

    expect(isCatchUpSessionSourceMetadata(parsed)).toBe(true);
    if (!isCatchUpSessionSourceMetadata(parsed)) {
      return;
    }

    expect(parsed).toMatchObject({
      mode: 'catchup',
      channelId: 'hrt-1',
      streamId: 112,
      programId: 'program-1',
      startTimestamp: 1771873200,
      durationSeconds: 1800,
      fallbackStreamIds: [2927],
      title: 'Dnevnik 2',
    });
  });

  it('builds a canonical catch-up source while preserving runtime attempt metadata', () => {
    const result = buildCatchUpSessionSource({
      channel,
      program,
      urlBuilder: createUrlBuilder(),
      fallbackStreamIds: [2927, 2927],
    });

    expect(result.source.url).toBe(
      'https://login.example/streaming/timeshift.php?stream=112&start=1771873200&duration=1800',
    );
    expect(result.source.metadata).toMatchObject({
      mode: 'catchup',
      channelId: 'hrt-1',
      streamId: 112,
      programId: 'program-1',
      startTimestamp: 1771873200,
      durationSeconds: 1800,
      fallbackStreamIds: [2927],
      title: 'Dnevnik 2',
      source: 'xtream',
      catchUpProgramId: 'program-1',
      catchUpStartTimestamp: 1771873200,
      catchUpDurationSeconds: 1800,
      catchUpFallbackUrls: expect.any(Array),
    });
    expect((result.source.metadata as Record<string, unknown>).catchUpAttemptPlan).toBeInstanceOf(Array);
    expect(result.transportPlan.allAttempts.length).toBeGreaterThan(1);
  });
});
