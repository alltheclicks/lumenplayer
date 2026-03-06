import { describe, expect, it, vi } from 'vitest';
import { resolveCatchUpPlaybackSource } from './catchupSource';

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

describe('resolveCatchUpPlaybackSource', () => {
  it('uses gateway playback url when gateway resolve succeeds', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        serverId: 'server-1',
        channelId: 'channel-1',
        programId: 'program-1',
        assetKey: 'asset-1',
        transportMode: 'proxy-remuxed',
        playbackUrl: 'http://localhost:8788/xui-api/https%3A%2F%2Fedge.example/streaming/timeshift.php?token=abc&__lumenTransport=remux-hls',
        assetState: 'ready',
        fallbackReason: 'gateway-remux',
        hotStart: false,
      }),
    });

    const result = await resolveCatchUpPlaybackSource({
      channel: {
        id: 'channel-1',
        name: 'Channel 1',
        streamId: 112,
        source: 'xtream',
        catchUpDays: 7,
        hasCatchUp: true,
      },
      program: {
        id: 'program-1',
        title: 'Program 1',
        startTime: new Date('2026-03-06T10:00:00Z'),
        endTime: new Date('2026-03-06T10:30:00Z'),
      },
      urlBuilder: createUrlBuilder(),
      gatewayOptions: {
        enabled: true,
        debugOverride: true,
        origin: 'http://localhost:8788',
        fetchImpl: fetchImpl as typeof fetch,
      },
    });

    expect(result.source.url).toContain('__lumenTransport=remux-hls');
    expect((result.source.metadata as Record<string, unknown>).gateway).toMatchObject({
      transportMode: 'proxy-remuxed',
      assetKey: 'asset-1',
    });
  });

  it('falls back to local transport plan when gateway resolve fails', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error('boom'));

    const result = await resolveCatchUpPlaybackSource({
      channel: {
        id: 'channel-1',
        name: 'Channel 1',
        streamId: 112,
        source: 'xtream',
        catchUpDays: 7,
        hasCatchUp: true,
      },
      program: {
        id: 'program-1',
        title: 'Program 1',
        startTime: new Date('2026-03-06T10:00:00Z'),
        endTime: new Date('2026-03-06T10:30:00Z'),
      },
      urlBuilder: createUrlBuilder(),
      gatewayOptions: {
        enabled: true,
        debugOverride: true,
        origin: 'http://localhost:8788',
        fetchImpl: fetchImpl as typeof fetch,
      },
    });

    expect(result.source.url.startsWith('https://login.example/')).toBe(true);
    expect((result.source.metadata as Record<string, unknown>).gateway).toBeNull();
  });
});
