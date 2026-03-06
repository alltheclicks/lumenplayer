import { describe, expect, it } from 'vitest';
import { normalizeRestoredSessionSource } from './restoreSessionSource';

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

const createChannel = (overrides: Partial<{
  id: string;
  streamId: number;
  name: string;
  hasCatchUp: boolean;
}> = {}) => ({
  id: overrides.id ?? 'hrt-1',
  streamId: overrides.streamId ?? 112,
  source: 'xtream' as const,
  streamUrl: undefined,
  number: 1,
  name: overrides.name ?? 'HRT 1',
  logo: '',
  categoryId: 'cat-1',
  categoryName: 'General',
  hasCatchUp: overrides.hasCatchUp ?? true,
  catchUpDays: 7,
  epgChannelId: 'epg-1',
  epg: [],
});

const resolveLiveSourceUrl = (channel: { streamId: number }) => (
  `https://live.example/${channel.streamId}.m3u8`
);

describe('normalizeRestoredSessionSource', () => {
  it('snaps persisted live playback back to the live edge of the same channel', () => {
    const channel = createChannel();
    const result = normalizeRestoredSessionSource({
      source: {
        url: 'https://edge.example/stale-live.m3u8',
        type: 'hls',
        title: 'HRT 1',
        channelId: channel.id,
        metadata: {
          mode: 'live',
          channelId: channel.id,
          streamId: channel.streamId,
        },
      },
      positionMs: 45_000,
      channels: [channel],
      fallbackStreamIdsByChannelId: new Map(),
      urlBuilder: createUrlBuilder(),
      resolveLiveSourceUrl,
    });

    expect(result.normalizedSource?.url).toBe('https://live.example/112.m3u8');
    expect(result.normalizedPositionMs).toBe(0);
    expect(result.notice).toBeUndefined();
  });

  it('rebuilds persisted catch-up playback from canonical metadata instead of stale runtime URLs', () => {
    const channel = createChannel();
    const result = normalizeRestoredSessionSource({
      source: {
        url: 'https://edge6.castcdn.net/streaming/timeshift.php?token=stale',
        type: 'hls',
        title: 'HRT 1 - Dnevnik 2',
        channelId: channel.id,
        metadata: {
          mode: 'catchup',
          channelId: channel.id,
          streamId: channel.streamId,
          catchUpProgramId: 'program-1',
          catchUpStartTimestamp: 1771873200,
          catchUpDurationSeconds: 1800,
          catchUpAttemptIndex: 3,
          catchUpFallbackUrls: [
            'https://edge6.castcdn.net/streaming/timeshift.php?token=other',
          ],
          title: 'Dnevnik 2',
        },
      },
      positionMs: 420_000,
      channels: [channel],
      fallbackStreamIdsByChannelId: new Map([[channel.id, [2927]]]),
      urlBuilder: createUrlBuilder(),
      resolveLiveSourceUrl,
    });

    expect(result.normalizedSource?.url).toBe(
      'https://login.example/timeshift/user/pass/1800/1771873200/112.m3u8',
    );
    expect(result.normalizedSource?.metadata).toEqual({
      mode: 'catchup',
      channelId: channel.id,
      streamId: channel.streamId,
      programId: 'program-1',
      startTimestamp: 1771873200,
      durationSeconds: 1800,
      fallbackStreamIds: [2927],
      title: 'Dnevnik 2',
    });
    expect(result.normalizedPositionMs).toBe(420_000);
  });

  it('falls back to live when persisted catch-up lacks canonical restore data', () => {
    const channel = createChannel();
    const result = normalizeRestoredSessionSource({
      source: {
        url: 'https://edge6.castcdn.net/streaming/timeshift.php?token=stale',
        type: 'hls',
        title: 'HRT 1 - Broken restore',
        channelId: channel.id,
        metadata: {
          mode: 'catchup',
          channelId: channel.id,
          streamId: channel.streamId,
        },
      },
      positionMs: 0,
      channels: [channel],
      fallbackStreamIdsByChannelId: new Map(),
      urlBuilder: createUrlBuilder(),
      resolveLiveSourceUrl,
    });

    expect(result.normalizedSource?.url).toBe('https://live.example/112.m3u8');
    expect(result.normalizedPositionMs).toBe(0);
    expect(result.notice).toEqual({
      title: 'TV unazad je vraćen na uživo',
      description: 'Poslednja emisija nema dovoljno podataka za bezbedan restore, pa je otvoren live kanal.',
    });
  });
});
