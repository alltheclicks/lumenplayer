import { describe, expect, it, vi } from 'vitest';
import { resolveCatchUpPlaybackSource } from './catchupSource';
import {
  clearCatchUpClientRebaseFailures,
  recordCatchUpClientRebaseFailure,
} from './catchupClientRebaseCompat';

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
    `http://edge6.castcdn.net:8080/timeshift_hls/user/pass/${durationSeconds}/${startTimestamp}/${streamId}.m3u8`,
  ],
  getCatchUpUrlVariants: (
    streamId: number,
    _startTimestamp: number,
    _durationSeconds: number,
  ) => [
    `http://smart.mediaking.fi:8080/streaming/timeshift.php?username=user&password=pass&stream=${streamId}&start=2026-03-06:10-00&duration=30&extension=m3u8`,
  ],
  getLegacyCatchUpUrlVariants: (
    streamId: number,
    _startTimestamp: number,
    durationSeconds: number,
  ) => [
    `http://smart.mediaking.fi:8080/timeshift/user/pass/${durationSeconds}/2026-03-06:10-00/${streamId}.ts`,
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
        transportMode: 'proxy-normalized',
        playbackUrl: 'http://localhost:8788/xui-api/https%3A%2F%2Fedge.example/streaming/timeshift.php?token=abc&__lumenTransport=normalized',
        assetState: 'ready',
        fallbackReason: 'gateway-normalized',
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

    expect(result.source.url).toContain('__lumenTransport=normalized');
    expect((result.source.metadata as Record<string, unknown>).gateway).toMatchObject({
      transportMode: 'proxy-normalized',
      assetKey: 'asset-1',
    });
  });

  it('does not use gateway remux playback when gateway returns a remuxed response', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        serverId: 'server-1',
        channelId: 'channel-1',
        programId: 'program-1',
        assetKey: 'asset-1',
        transportMode: 'proxy-remuxed',
        playbackUrl: 'http://localhost:8788/xui-api/https%3A%2F%2Fedge.example/timeshift/user/pass/1800/2026-03-08:08-30/112.ts?__lumenTransport=remux-hls',
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

    expect(result.source.url).not.toContain('__lumenTransport=remux-hls');
    expect(result.source.url.startsWith('https://login.example/')).toBe(true);
    expect((result.source.metadata as Record<string, unknown>).gateway).toBeNull();
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

  it('leads with the shadow attempt but keeps legacy timeshift.php attempts as fallbacks', async () => {
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
      // This test targets the shadow path; pin the orthogonal client-rebase
      // flag off so a dev .env with VITE_CATCHUP_CLIENT_REBASE=1 cannot make
      // the resolver skip the shadow attempt.
      clientRebase: false,
    });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(String(fetchImpl.mock.calls[0]?.[0])).toContain('/streaming/timeshift.php?username=user');
    // Shadow leads.
    expect(result.source.url).toBe('https://edge6.castcdn.net/streaming/timeshift_shadow.php?token=abc123');
    expect(result.transportPlan.initialAttempt.strategy).toBe('shadow-validation');
    // ...but legacy timeshift.php attempts remain as fallbacks, so a shadow
    // playback failure degrades to the old path instead of killing catch-up.
    expect(result.transportPlan.fallbackAttempts.length).toBeGreaterThan(0);
    expect(result.transportPlan.allAttempts.length).toBeGreaterThan(1);
    expect(result.transportPlan.fallbackAttempts.every(
      (attempt) => !attempt.url.includes('timeshift_shadow.php'),
    )).toBe(true);
    const fallbackUrls = (result.source.metadata as Record<string, unknown>).catchUpFallbackUrls as string[];
    expect(fallbackUrls.length).toBeGreaterThan(0);
    expect((result.source.metadata as Record<string, unknown>).catchUpAttemptStrategy).toBe('shadow-validation');
    expect(result.gateway).toMatchObject({
      serverId: 'shadow-validation',
      transportMode: 'provider-direct',
      fallbackReason: 'shadow-validation',
    });
  });

  it('gracefully falls back to the legacy gateway path when shadow validation is enabled but unavailable', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: false,
      url: 'http://smart.mediaking.fi:8080/streaming/timeshift.php',
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
      clientRebase: false,
    });

    // Shadow could not be resolved (ok:false) — instead of throwing and killing
    // catch-up, the resolver must fall through to the original timeshift.php
    // gateway path and return a playable source (the legacy, non-shadow path).
    expect(result.source.url).toBeTruthy();
    expect(result.source.url).not.toContain('timeshift_shadow.php');
    expect(result.transportPlan.initialAttempt.strategy).not.toBe('shadow-validation');
  });

  it('keeps known provider archive issues playable while carrying runtime failure evidence', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        serverId: 'server-1',
        channelId: 'channel-53',
        programId: 'program-1',
        assetKey: 'asset-1',
        transportMode: 'provider-direct',
        playbackUrl: 'https://edge.example/streaming/timeshift.php?token=abc',
        assetState: 'ready',
        fallbackReason: null,
        hotStart: true,
      }),
    });

    const result = await resolveCatchUpPlaybackSource({
      channel: {
        id: 'channel-53',
        name: 'KANAL 5',
        streamId: 53,
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

    expect(result.source.url).toBe('https://edge.example/streaming/timeshift.php?token=abc');
    expect(result.transportPlan.initialAttempt.strategy).toBe('gateway-resolved');
    expect(result.source.metadata).toMatchObject({
      mode: 'catchup',
      channelId: 'channel-53',
      streamId: 53,
      programId: 'program-1',
      catchUpWebProviderIssue: {
        reasonCode: 'unsupported-audio-codec',
        channelName: 'KANAL 5',
        summary: 'H.264 video + MP2 audio',
      },
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('keeps MediaKing catch-up on the user timeline start while retaining a provider safe-start recovery hint', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error('gateway unavailable'));

    const result = await resolveCatchUpPlaybackSource({
      channel: {
        id: 'channel-58',
        name: 'BHT 1',
        streamId: 58,
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
      shadowValidation: false,
    });

    expect(result.initialPositionSeconds).toBe(0);
    expect(result.source.metadata).toMatchObject({
      catchUpHlsStartupMode: 'progressive',
      catchUpHlsStartPositionSeconds: 0,
      catchUpProviderSafeStartPositionSeconds: 75,
    });
  });

  it('does not special-case N1 SRB by stream id when selecting provider safe-start', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error('gateway unavailable'));

    const result = await resolveCatchUpPlaybackSource({
      channel: {
        id: 'channel-399',
        name: 'N1 SRB',
        streamId: 399,
        source: 'xtream',
        catchUpDays: 7,
        hasCatchUp: true,
      },
      program: {
        id: 'program-1',
        title: 'Pregled dana',
        startTime: new Date('2026-03-06T10:00:00Z'),
        endTime: new Date('2026-03-06T10:50:00Z'),
      },
      urlBuilder: createShadowValidationUrlBuilder(),
      gatewayOptions: {
        fetchImpl: fetchImpl as typeof fetch,
      },
      shadowValidation: false,
    });

    expect(result.initialPositionSeconds).toBe(0);
    expect(result.source.metadata).toMatchObject({
      catchUpHlsStartupMode: 'progressive',
      catchUpHlsStartPositionSeconds: 0,
      catchUpProviderSafeStartPositionSeconds: 75,
    });
  });

  it('does not special-case PRVA by stream id when selecting provider safe-start', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error('gateway unavailable'));

    const result = await resolveCatchUpPlaybackSource({
      channel: {
        id: 'channel-109',
        name: 'PRVA',
        streamId: 109,
        source: 'xtream',
        catchUpDays: 7,
        hasCatchUp: true,
      },
      program: {
        id: 'program-1',
        title: 'Pobednik',
        startTime: new Date('2026-03-06T10:00:00Z'),
        endTime: new Date('2026-03-06T10:20:00Z'),
      },
      urlBuilder: createShadowValidationUrlBuilder(),
      gatewayOptions: {
        fetchImpl: fetchImpl as typeof fetch,
      },
      shadowValidation: false,
    });

    expect(result.initialPositionSeconds).toBe(0);
    expect(result.source.metadata).toMatchObject({
      catchUpHlsStartupMode: 'progressive',
      catchUpHlsStartPositionSeconds: 0,
      catchUpProviderSafeStartPositionSeconds: 75,
    });
  });

  it('leads with the client rebase path (metadata flag set, shadow skipped) when enabled', async () => {
    clearCatchUpClientRebaseFailures();
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
      clientRebase: true,
      clientRebaseSupported: true,
    });

    // Media stays direct and the rebase path leads. A small provider seed
    // request only prepares the shadow URL as an immediate fallback.
    expect(result.source.url).not.toContain('timeshift_shadow.php');
    expect(result.source.url).not.toContain('/xui-api/');
    expect(result.transportPlan.initialAttempt.strategy).not.toBe('shadow-validation');
    expect((result.source.metadata as Record<string, unknown>).catchUpClientRebase).toBe(true);
    expect((result.source.metadata as Record<string, unknown>).catchUpClientRebaseRequested).toBe(true);
    expect(result.gateway).toBeNull();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(String(fetchImpl.mock.calls[0]?.[0])).toContain('/streaming/timeshift.php');
    expect(String(fetchImpl.mock.calls[0]?.[0])).not.toContain('/catchup-gateway/');
    expect(result.transportPlan.fallbackAttempts[0]?.strategy).toBe('shadow-validation');
    expect(result.transportPlan.fallbackAttempts[0]?.url).toContain('timeshift_shadow.php');
  });

  it('sends known unsupported-audio channels straight to shadow instead of client rebase', async () => {
    clearCatchUpClientRebaseFailures();
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      url: 'https://edge6.castcdn.net/streaming/timeshift_shadow.php?token=mp2-token',
    });

    const result = await resolveCatchUpPlaybackSource({
      channel: {
        id: 'channel-mp2',
        name: 'KANAL 5',
        streamId: 53,
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
      clientRebase: true,
      clientRebaseSupported: true,
    });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(result.source.url).toBe(
      'https://edge6.castcdn.net/streaming/timeshift_shadow.php?token=mp2-token',
    );
    expect(result.transportPlan.initialAttempt.strategy).toBe('shadow-validation');
    expect((result.source.metadata as Record<string, unknown>).catchUpClientRebase).toBeUndefined();
  });

  it('restores the shadow path after a recorded client-rebase runtime failure', async () => {
    clearCatchUpClientRebaseFailures();
    recordCatchUpClientRebaseFailure(112, 'no-aac-audio');
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
      clientRebase: true,
      clientRebaseSupported: true,
    });

    // The compat-cache failure disables rebase for this channel, so the
    // resolver behaves exactly as before: shadow attempt leads again.
    expect(result.source.url).toBe('https://edge6.castcdn.net/streaming/timeshift_shadow.php?token=abc123');
    expect((result.source.metadata as Record<string, unknown>).catchUpClientRebase).toBeUndefined();
    clearCatchUpClientRebaseFailures();
  });

  it('uses provider shadow instead of pretending to rebase on native-HLS-only devices', async () => {
    clearCatchUpClientRebaseFailures();
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      url: 'https://edge6.castcdn.net/streaming/timeshift_shadow.php?token=native-token',
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
      clientRebase: true,
      clientRebaseSupported: false,
    });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(result.source.url).toContain('/streaming/timeshift_shadow.php?token=native-token');
    expect((result.source.metadata as Record<string, unknown>).catchUpClientRebase).toBeUndefined();
    expect(result.transportPlan.initialAttempt.strategy).toBe('shadow-validation');
  });
});
