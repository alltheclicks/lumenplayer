import { describe, expect, it, vi } from 'vitest';
import { resolveCatchUpSessionSource } from './catchupGateway';
import { isCatchUpSessionSourceMetadata, parseSessionSourceMetadata } from './sessionSources';

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
  hasCatchUp: true,
  catchUpDays: 7,
};

const program = {
  id: 'program-1',
  title: 'Dnevnik 2',
  startTime: new Date('2026-02-23T19:00:00.000Z'),
  endTime: new Date('2026-02-23T19:30:00.000Z'),
};

describe('catch-up gateway session source', () => {
  it('uses gateway-resolved playback metadata when resolve succeeds', async () => {
    const fetchImpl = vi.fn(async () => (
      new Response(JSON.stringify({
        serverId: 'server-123',
        channelId: 'hrt-1',
        programId: 'program-1',
        assetKey: 'server-123:hrt-1:1771873200:1771875000:abcd',
        transportMode: 'proxy-remuxed',
        playbackUrl: 'https://proxy.example/xui-api/https%3A%2F%2Flogin.example/timeshift/user/pass/1800/1771873200/112.m3u8?__lumenTransport=remux-hls',
        assetState: 'preparing',
        fallbackReason: 'gateway-remux',
        hotStart: false,
      }), {
        status: 200,
        headers: {
          'content-type': 'application/json',
        },
      })
    ));

    const result = await resolveCatchUpSessionSource({
      channel,
      program,
      urlBuilder: createUrlBuilder(),
      gatewayOptions: {
        enabled: true,
        origin: 'https://proxy.example',
        fetchImpl,
      },
    });

    const metadata = parseSessionSourceMetadata(result.source.metadata);
    expect(result.source.url).toContain('__lumenTransport=remux-hls');
    expect(result.transportPlan.initialAttempt.strategy).toBe('gateway-resolved');
    expect(result.transportPlan.fallbackAttempts.length).toBeGreaterThan(0);
    expect(isCatchUpSessionSourceMetadata(metadata)).toBe(true);
    if (!isCatchUpSessionSourceMetadata(metadata)) {
      return;
    }

    expect(metadata.gateway).toEqual({
      serverId: 'server-123',
      assetKey: 'server-123:hrt-1:1771873200:1771875000:abcd',
      transportMode: 'proxy-remuxed',
      playbackUrl: 'https://proxy.example/xui-api/https%3A%2F%2Flogin.example/timeshift/user/pass/1800/1771873200/112.m3u8?__lumenTransport=remux-hls',
      assetState: 'preparing',
      fallbackReason: 'gateway-remux',
      hotStart: false,
    });
  });

  it('falls back to the local transport plan when gateway resolve fails', async () => {
    const result = await resolveCatchUpSessionSource({
      channel,
      program,
      urlBuilder: createUrlBuilder(),
      gatewayOptions: {
        enabled: true,
        origin: 'https://proxy.example',
        fetchImpl: vi.fn(async () => {
          throw new Error('network down');
        }),
      },
    });

    const metadata = parseSessionSourceMetadata(result.source.metadata);
    expect(result.source.url).toBe(
      'https://login.example/timeshift/user/pass/1800/1771873200/112.m3u8',
    );
    expect(result.transportPlan.initialAttempt.strategy).toBe('redirect-primary');
    expect(isCatchUpSessionSourceMetadata(metadata)).toBe(true);
    if (!isCatchUpSessionSourceMetadata(metadata)) {
      return;
    }

    expect(metadata.gateway).toBeUndefined();
  });
});
