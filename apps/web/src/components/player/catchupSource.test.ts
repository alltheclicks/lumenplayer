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

const createShadowValidationUrlBuilder = () => ({
  getCatchUpRedirectUrlVariants: (
    streamId: number,
    startTimestamp: number,
    durationSeconds: number,
  ) => [
    `http://edge6.castcdn.net:8080/timeshift_hls/fica/fF2024BG2025/${durationSeconds}/${startTimestamp}/${streamId}.m3u8`,
  ],
  getCatchUpUrlVariants: (
    streamId: number,
    _startTimestamp: number,
    _durationSeconds: number,
  ) => [
    `http://smart.mediaking.fi:8080/streaming/timeshift.php?username=fica&password=fF2024BG2025&stream=${streamId}&start=2026-03-06:10-00&duration=30&extension=m3u8`,
  ],
  getLegacyCatchUpUrlVariants: (
    streamId: number,
    _startTimestamp: number,
    durationSeconds: number,
  ) => [
    `http://smart.mediaking.fi:8080/timeshift/fica/fF2024BG2025/${durationSeconds}/2026-03-06:10-00/${streamId}.ts`,
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
      shadowValidation: false,
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
      shadowValidation: false,
    });

    expect(result.source.url.startsWith('https://login.example/')).toBe(true);
    expect((result.source.metadata as Record<string, unknown>).gateway).toBeNull();
  });

  it('uses a shadow-only transport plan when shadow validation resolves a tokenized edge manifest', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      url: 'https://edge6.castcdn.net/streaming/timeshift.php?token=abc123',
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
      urlBuilder: createShadowValidationUrlBuilder(),
      gatewayOptions: {
        fetchImpl: fetchImpl as typeof fetch,
      },
      shadowValidation: true,
    });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(String(fetchImpl.mock.calls[0]?.[0])).toContain('/streaming/timeshift.php?username=fica');
    expect(result.source.url).toBe('https://edge6.castcdn.net/streaming/timeshift_shadow.php?token=abc123');
    expect(result.transportPlan.allAttempts).toHaveLength(1);
    expect(result.transportPlan.fallbackAttempts).toHaveLength(0);
    expect((result.source.metadata as Record<string, unknown>).catchUpFallbackUrls).toEqual([]);
    expect(result.gateway).toMatchObject({
      serverId: 'shadow-validation',
      transportMode: 'provider-direct',
      fallbackReason: 'shadow-validation',
    });
  });

  it('fails fast instead of silently falling back when shadow validation is enabled but unavailable', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: false,
      url: 'http://smart.mediaking.fi:8080/streaming/timeshift.php',
    });

    await expect(resolveCatchUpPlaybackSource({
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
      urlBuilder: createShadowValidationUrlBuilder(),
      gatewayOptions: {
        fetchImpl: fetchImpl as typeof fetch,
      },
      shadowValidation: true,
    })).rejects.toThrow('catchup_shadow_validation_unavailable');
  });
});
