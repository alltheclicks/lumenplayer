import { beforeEach, describe, expect, it, vi } from 'vitest';

const fixtures = vi.hoisted(() => ({
  records: new Map<string, unknown>(),
  credentials: { server: 'https://provider.test', username: 'first', password: 'secret' },
  failWrites: false,
}));
vi.mock('./storage', () => ({
  loadStoredCredentials: async () => fixtures.credentials,
  getAppStorage: () => ({
    get: async (key: string) => fixtures.records.get(key),
    set: async (key: string, value: unknown) => {
      if (fixtures.failWrites) throw new Error('Quota exceeded');
      fixtures.records.set(key, value);
    },
  }),
}));
import { getOnDemandProgressScope, loadOnDemandProgress, saveOnDemandProgress } from './onDemandProgress';

describe('stored viewing progress', () => {
  beforeEach(() => {
    fixtures.records.clear();
    fixtures.credentials = { server: 'https://provider.test', username: 'first', password: 'secret' };
    fixtures.failWrites = false;
  });
  const entry = { key: 'vod:1', positionMs: 27_000, durationMs: 90_000, updatedAt: 1 };
  it('keeps accounts separate and survives a password change for the same account', async () => {
    const first = await getOnDemandProgressScope();
    expect(first).toBeTruthy();
    expect(first).not.toContain('secret');
    await saveOnDemandProgress(first!, entry);
    fixtures.credentials.username = 'second';
    expect(await loadOnDemandProgress()).toEqual({});
    fixtures.credentials.username = 'first';
    fixtures.credentials.password = 'new-secret';
    expect(await loadOnDemandProgress()).toEqual({ 'vod:1': entry });
  });
  it('serializes concurrent saves and keeps only the 200 most recent entries', async () => {
    const scope = (await getOnDemandProgressScope())!;
    await Promise.all(Array.from({ length: 202 }, (_, index) => saveOnDemandProgress(scope, {
      ...entry, key: `vod:${index}`, updatedAt: index,
    })));
    const saved = await loadOnDemandProgress();
    expect(Object.keys(saved)).toHaveLength(200);
    expect(saved['vod:0']).toBeUndefined();
    expect(saved['vod:201']).toBeDefined();
  });
  it('contains storage failures so they cannot interrupt playback', async () => {
    fixtures.failWrites = true;
    await expect(saveOnDemandProgress((await getOnDemandProgressScope())!, entry)).resolves.toBeUndefined();
  });
});
