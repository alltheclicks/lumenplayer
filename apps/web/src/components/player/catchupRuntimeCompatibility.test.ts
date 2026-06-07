import { beforeEach, describe, expect, it } from 'vitest';
import type { SessionSource } from '@lumen/session-core';
import {
  buildCatchUpRuntimeSourceKey,
  clearCatchUpRuntimeCompatibilityCache,
  getCachedCatchUpRuntimeCompatibility,
  recordCatchUpRuntimeCompatibilityResult,
  resolveCatchUpRuntimeCompatibilityBlockingError,
  resolveCatchUpRuntimeCompatibilityFingerprint,
} from './catchupRuntimeCompatibility';

const createStorage = () => {
  const values = new Map<string, string>();

  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
    removeItem: (key: string) => {
      values.delete(key);
    },
  };
};

const createCatchUpSource = (overrides: Partial<SessionSource> = {}): SessionSource => ({
  url: 'https://edge.example/timeshift_hls/realUser/secretPass/30/2026-06-03:08-00/260.m3u8?token=super-secret-token',
  type: 'hls',
  title: 'AMC - Film',
  channelId: 'channel-260',
  metadata: {
    mode: 'catchup',
    channelId: 'channel-260',
    streamId: 260,
    programId: 'program-1',
    startTimestamp: 1780473600,
    durationSeconds: 1800,
    gateway: {
      serverId: 'provider',
      assetKey: 'asset-1',
      transportMode: 'provider-direct',
      playbackUrl: 'https://edge.example/streaming/timeshift.php?username=realUser&password=secretPass&token=super-secret-token&stream=260',
      assetState: 'ready',
      fallbackReason: null,
      hotStart: true,
    },
  },
  ...overrides,
});

describe('catch-up runtime compatibility', () => {
  beforeEach(() => {
    clearCatchUpRuntimeCompatibilityCache({ storage: null });
  });

  it('builds a current-source fingerprint only for catch-up sources', () => {
    expect(resolveCatchUpRuntimeCompatibilityFingerprint(createCatchUpSource())).toMatch(/^catchup:260:/);
    expect(resolveCatchUpRuntimeCompatibilityFingerprint({
      url: 'https://edge.example/live/realUser/secretPass/260.m3u8',
      type: 'hls',
      metadata: {
        mode: 'live',
        channelId: 'channel-260',
        streamId: 260,
      },
    })).toBeNull();
  });

  it('redacts provider credentials from source keys', () => {
    const sourceKey = buildCatchUpRuntimeSourceKey(
      'https://edge.example/timeshift_hls/realUser/secretPass/30/2026-06-03:08-00/260.m3u8?token=super-secret-token',
    );
    const querySourceKey = buildCatchUpRuntimeSourceKey(
      'https://edge.example/streaming/timeshift.php?username=realUser&password=secretPass&token=super-secret-token&stream=260',
    );

    expect(sourceKey).not.toContain('realUser');
    expect(sourceKey).not.toContain('secretPass');
    expect(sourceKey).not.toContain('super-secret-token');
    expect(querySourceKey).not.toContain('realUser');
    expect(querySourceKey).not.toContain('secretPass');
    expect(querySourceKey).not.toContain('super-secret-token');
  });

  it('records and expires runtime compatibility results through a short cache', () => {
    const storage = createStorage();
    const source = createCatchUpSource();
    const recorded = recordCatchUpRuntimeCompatibilityResult(source, {
      status: 'unsupported',
      reasonCode: 'playback-error',
      observedUrl: 'https://edge.example/streaming/timeshift.php?token=super-secret-token',
    }, {
      nowMs: 1_000,
      ttlMs: 500,
      storage,
    });

    expect(recorded?.status).toBe('unsupported');
    expect(recorded?.sourceKey).not.toContain('secretPass');
    expect(recorded?.observedSourceKey).not.toContain('super-secret-token');
    expect(getCachedCatchUpRuntimeCompatibility(source, {
      nowMs: 1_250,
      storage,
    })?.reasonCode).toBe('playback-error');
    expect(getCachedCatchUpRuntimeCompatibility(source, {
      nowMs: 1_501,
      storage,
    })).toBeNull();
  });

  it('turns a cached unsupported result into a catch-up overlay error', () => {
    const storage = createStorage();
    const source = createCatchUpSource();
    const record = recordCatchUpRuntimeCompatibilityResult(source, {
      status: 'unsupported',
      reasonCode: 'manifest-no-frame',
    }, {
      nowMs: 1_000,
      storage,
    });
    const error = resolveCatchUpRuntimeCompatibilityBlockingError(source, record);

    expect(error).toEqual({
      type: 'format',
      message: 'Snimak za TV unazad nije dostupan u web playeru',
      details: 'AMC trenutno ne može da se gleda unazad u ovom browseru. Poslednja provera trenutnog catch-up source-a nije dobila podržan audio/video format ili prvi video kadar u očekivanom roku. Live kanal može raditi normalno. Nije do vašeg uređaja niti do Lumen playera.',
      primaryAction: 'switch-to-live',
      primaryActionLabel: 'Gledaj AMC uživo',
    });
  });

  it('does not show an overlay for cached playable results', () => {
    const storage = createStorage();
    const source = createCatchUpSource();
    const record = recordCatchUpRuntimeCompatibilityResult(source, {
      status: 'playable',
      reasonCode: 'rendered-frame',
    }, {
      nowMs: 1_000,
      storage,
    });

    expect(resolveCatchUpRuntimeCompatibilityBlockingError(source, record)).toBeNull();
  });
});
