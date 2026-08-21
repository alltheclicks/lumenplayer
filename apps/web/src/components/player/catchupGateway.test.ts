import { describe, expect, it, vi } from 'vitest';
import { resolveCatchUpGatewayPlayback } from './catchupGateway';

describe('resolveCatchUpGatewayPlayback', () => {
  it('returns normalized gateway metadata for valid resolve payload', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        serverId: 'server-1',
        channelId: 'channel-1',
        programId: 'program-1',
        assetKey: 'asset-1',
        transportMode: 'proxy-normalized',
        playbackUrl: 'http://localhost:8788/xui-api/https%3A%2F%2Fedge.example/streaming/timeshift.php?token=abc&__lumenTransport=normalized',
        assetState: 'ready',
        fallbackReason: 'gateway-normalized',
        hotStart: true,
      }),
    });

    const result = await resolveCatchUpGatewayPlayback({
      channel: {
        id: 'channel-1',
        hasCatchUp: true,
        catchUpDays: 7,
      },
      program: {
        id: 'program-1',
      },
      streamId: 112,
      startTimestamp: 1_772_000_000,
      durationSeconds: 1800,
      sourceCandidates: {
        redirectUrls: ['https://edge.example/streaming/timeshift.php?token=abc'],
        queryUrls: [],
        legacyUrls: [],
      },
      gatewayOptions: {
        enabled: true,
        debugOverride: true,
        origin: 'http://localhost:8788',
        fetchImpl: fetchImpl as typeof fetch,
      },
    });

    expect(result).toEqual({
      serverId: 'server-1',
      assetKey: 'asset-1',
      transportMode: 'proxy-normalized',
      playbackUrl: 'http://localhost:8788/xui-api/https%3A%2F%2Fedge.example/streaming/timeshift.php?token=abc&__lumenTransport=normalized',
      assetState: 'ready',
      fallbackReason: 'gateway-normalized',
      hotStart: true,
    });
  });

  it('rejects payloads with invalid enum values', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        serverId: 'server-1',
        channelId: 'channel-1',
        programId: 'program-1',
        assetKey: 'asset-1',
        transportMode: 'broken-mode',
        playbackUrl: 'http://localhost:8788/play.m3u8',
        assetState: 'ready',
        fallbackReason: null,
        hotStart: false,
      }),
    });

    const result = await resolveCatchUpGatewayPlayback({
      channel: {
        id: 'channel-1',
        hasCatchUp: true,
        catchUpDays: 7,
      },
      program: {
        id: 'program-1',
      },
      streamId: 112,
      startTimestamp: 1_772_000_000,
      durationSeconds: 1800,
      sourceCandidates: {
        redirectUrls: ['https://edge.example/streaming/timeshift.php?token=abc'],
        queryUrls: [],
        legacyUrls: [],
      },
      gatewayOptions: {
        enabled: true,
        debugOverride: true,
        origin: 'http://localhost:8788',
        fetchImpl: fetchImpl as typeof fetch,
      },
    });

    expect(result).toBeNull();
  });

  it('auto-enables gateway for mediaking catch-up origins when gateway origin is available', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        serverId: 'server-1',
        channelId: 'channel-1',
        programId: 'program-1',
        assetKey: 'asset-1',
        transportMode: 'proxy-normalized',
        playbackUrl: 'http://127.0.0.1:8080/xui-api/http%3A%2F%2Fsmart.mediaking.fi%3A8080/streaming/timeshift.php?token=abc&__lumenTransport=normalized',
        assetState: 'ready',
        fallbackReason: 'gateway-normalized',
        hotStart: false,
      }),
    });

    const result = await resolveCatchUpGatewayPlayback({
      channel: {
        id: 'channel-1',
        hasCatchUp: true,
        catchUpDays: 7,
      },
      program: {
        id: 'program-1',
      },
      streamId: 112,
      startTimestamp: 1_772_000_000,
      durationSeconds: 1800,
      sourceCandidates: {
        redirectUrls: ['http://edge6.castcdn.net:8080/timeshift_hls/user/pass/1800/2026-03-08:08-30/112.m3u8'],
        queryUrls: [],
        legacyUrls: ['http://smart.mediaking.fi:8080/timeshift/user/pass/1800/2026-03-08:08-30/112.ts'],
      },
      gatewayOptions: {
        origin: 'http://localhost:8788',
        fetchImpl: fetchImpl as typeof fetch,
      },
    });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(result?.transportMode).toBe('proxy-normalized');
    expect(result?.playbackUrl).toBe(
      'http://localhost:8788/xui-api/http%3A%2F%2Fsmart.mediaking.fi%3A8080/streaming/timeshift.php?token=abc&__lumenTransport=normalized',
    );
  });

  it('honors an explicit gateway disable even for an auto-gateway host', async () => {
    const fetchImpl = vi.fn();

    const result = await resolveCatchUpGatewayPlayback({
      channel: {
        id: 'channel-1',
        hasCatchUp: true,
        catchUpDays: 7,
      },
      program: {
        id: 'program-1',
      },
      streamId: 112,
      startTimestamp: 1_772_000_000,
      durationSeconds: 1800,
      sourceCandidates: {
        redirectUrls: ['http://edge6.castcdn.net:8080/timeshift_hls/user/pass/1800/2026-03-08:08-30/112.m3u8'],
        queryUrls: [],
        legacyUrls: [],
      },
      gatewayOptions: {
        enabled: false,
        origin: 'http://localhost:8788',
        fetchImpl: fetchImpl as typeof fetch,
      },
    });

    expect(result).toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('rejects proxy-remuxed playback responses for the web beta path', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        serverId: 'server-1',
        channelId: 'channel-1',
        programId: 'program-1',
        assetKey: 'asset-1',
        transportMode: 'proxy-remuxed',
        playbackUrl: 'http://127.0.0.1:8080/xui-api/http%3A%2F%2Fsmart.mediaking.fi%3A8080/timeshift/user/pass/1800/2026-03-08:08-30/112.ts?__lumenTransport=remux-hls',
        assetState: 'ready',
        fallbackReason: 'gateway-remux',
        hotStart: false,
      }),
    });

    const result = await resolveCatchUpGatewayPlayback({
      channel: {
        id: 'channel-1',
        hasCatchUp: true,
        catchUpDays: 7,
      },
      program: {
        id: 'program-1',
      },
      streamId: 112,
      startTimestamp: 1_772_000_000,
      durationSeconds: 1800,
      sourceCandidates: {
        redirectUrls: ['http://edge6.castcdn.net:8080/timeshift_hls/user/pass/1800/2026-03-08:08-30/112.m3u8'],
        queryUrls: [],
        legacyUrls: ['http://smart.mediaking.fi:8080/timeshift/user/pass/1800/2026-03-08:08-30/112.ts'],
      },
      gatewayOptions: {
        origin: 'http://localhost:8788',
        fetchImpl: fetchImpl as typeof fetch,
      },
    });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(result).toBeNull();
  });
});
