// Characterization tests (P4 step 1b): pin the XMLTV load/cache flow and channel
// matching before the module moves into @lumen/epg. The XML parsing itself needs
// a DOMParser, which the Node test environment lacks; it gets covered in step 3d
// when the parser becomes an injected dependency.
import type { PlayerChannel, Program } from '@lumen/types';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const fixtures = vi.hoisted(() => ({
  records: new Map<string, unknown>(),
  credentials: { server: 'https://Provider.test', username: 'Alice', password: 'secret' } as
    | { server: string; username: string; password: string }
    | null,
  xmlPayload: '<tv></tv>',
  setCredentials: vi.fn(),
  getXMLTVEPG: vi.fn(),
}));

vi.mock('@/services/storage', () => ({
  getAppStorage: () => ({
    get: async (key: string) => fixtures.records.get(key) ?? null,
    set: async (key: string, value: unknown) => {
      fixtures.records.set(key, value);
    },
    remove: async (key: string) => {
      fixtures.records.delete(key);
    },
  }),
}));
vi.mock('@/services/xtreamCredentials', () => ({
  loadXtreamCredentials: async () => fixtures.credentials,
}));
vi.mock('@/services/xtreamService', () => ({
  xtreamCodesService: {
    setCredentials: fixtures.setCredentials,
    getXMLTVEPG: fixtures.getXMLTVEPG,
  },
}));

import {
  clearXMLTVEPGCache,
  getXMLTVCacheTTL,
  loadXMLTVEPGMap,
  resolveXMLTVProgramsForChannel,
} from './xmltvEpg';

const CACHE_KEY = 'xmltv_epg_cache';
const SIGNATURE = 'https://provider.test|alice';
const SIX_HOURS_MS = 6 * 60 * 60 * 1000;

const cachedProgram = {
  id: 'rts1-1000-0',
  title: 'Dnevnik',
  description: 'Vesti',
  startTimeMs: 1_000,
  endTimeMs: 2_000,
  category: 'news',
  hasCatchUp: true,
};

const channel = (overrides: Partial<PlayerChannel> = {}): PlayerChannel => ({
  id: 'ch-1',
  streamId: 101,
  source: 'xtream',
  number: 1,
  name: 'RTS 1',
  logo: '',
  categoryId: '1',
  categoryName: 'News',
  hasCatchUp: true,
  catchUpDays: 7,
  epgChannelId: 'rts1.rs',
  epg: [],
  ...overrides,
});

beforeEach(() => {
  vi.useRealTimers();
  fixtures.records.clear();
  fixtures.credentials = { server: 'https://Provider.test', username: 'Alice', password: 'secret' };
  fixtures.setCredentials.mockReset();
  fixtures.getXMLTVEPG.mockReset();
  fixtures.getXMLTVEPG.mockImplementation(async () => fixtures.xmlPayload);
});

describe('loadXMLTVEPGMap', () => {
  it.each([
    ['no credentials', null],
    ['the demo account', { server: 'https://provider.test', username: 'demo', password: 'x' }],
    ['the placeholder server', { server: 'https://your-server.com', username: 'alice', password: 'x' }],
  ])('returns null without fetching for %s', async (_label, credentials) => {
    fixtures.credentials = credentials;

    await expect(loadXMLTVEPGMap()).resolves.toBeNull();
    expect(fixtures.getXMLTVEPG).not.toHaveBeenCalled();
  });

  it('serves a fresh cache for the same server and username (case-insensitive) as Program dates', async () => {
    fixtures.records.set(CACHE_KEY, {
      signature: SIGNATURE,
      fetchedAt: Date.now() - 1_000,
      programsByChannel: { 'rts1.rs': [cachedProgram] },
    });

    const result = await loadXMLTVEPGMap();

    expect(fixtures.getXMLTVEPG).not.toHaveBeenCalled();
    expect(result).toEqual({
      'rts1.rs': [{
        id: 'rts1-1000-0',
        title: 'Dnevnik',
        description: 'Vesti',
        startTime: new Date(1_000),
        endTime: new Date(2_000),
        category: 'news',
        hasCatchUp: true,
      }],
    });
  });

  it.each([
    ['the cache is older than maxAgeMs', { signature: SIGNATURE, ageMs: SIX_HOURS_MS }, {}],
    ['the cache belongs to another account', { signature: 'https://provider.test|bob', ageMs: 0 }, {}],
    ['forceRefresh is set', { signature: SIGNATURE, ageMs: 0 }, { forceRefresh: true }],
  ])('refetches when %s', async (_label, cache, options) => {
    fixtures.records.set(CACHE_KEY, {
      signature: cache.signature,
      fetchedAt: Date.now() - cache.ageMs,
      programsByChannel: { 'rts1.rs': [cachedProgram] },
    });

    await loadXMLTVEPGMap(options);

    expect(fixtures.setCredentials).toHaveBeenCalledWith(fixtures.credentials);
    expect(fixtures.getXMLTVEPG).toHaveBeenCalledTimes(1);
  });

  it('honours a custom maxAgeMs', async () => {
    fixtures.records.set(CACHE_KEY, {
      signature: SIGNATURE,
      fetchedAt: Date.now() - 5_000,
      programsByChannel: {},
    });

    await loadXMLTVEPGMap({ maxAgeMs: 1_000 });

    expect(fixtures.getXMLTVEPG).toHaveBeenCalledTimes(1);
  });

  it('caches the fetched result under the account signature (empty without a DOMParser)', async () => {
    vi.useFakeTimers({ now: 1_700_000_000_000 });

    const result = await loadXMLTVEPGMap();

    expect(result).toEqual({});
    expect(fixtures.records.get(CACHE_KEY)).toEqual({
      signature: SIGNATURE,
      fetchedAt: 1_700_000_000_000,
      programsByChannel: {},
    });
  });

  it('clearXMLTVEPGCache removes the cache entry', async () => {
    fixtures.records.set(CACHE_KEY, { signature: SIGNATURE, fetchedAt: 0, programsByChannel: {} });

    await clearXMLTVEPGCache();

    expect(fixtures.records.has(CACHE_KEY)).toBe(false);
  });

  it('uses a six hour default TTL', () => {
    expect(getXMLTVCacheTTL()).toBe(SIX_HOURS_MS);
  });
});

describe('resolveXMLTVProgramsForChannel', () => {
  const programs = (id: string): Program[] => [{
    id,
    title: id,
    description: '',
    startTime: new Date(0),
    endTime: new Date(1),
    category: 'show',
    hasCatchUp: false,
  }];

  it('returns null without a program map', () => {
    expect(resolveXMLTVProgramsForChannel(channel(), null)).toBeNull();
    expect(resolveXMLTVProgramsForChannel(channel(), undefined)).toBeNull();
  });

  it('matches epgChannelId first, then streamId, then id, case-insensitively', () => {
    const map = { 'rts1.rs': programs('epg'), '101': programs('stream'), 'ch-1': programs('id') };

    expect(resolveXMLTVProgramsForChannel(channel({ epgChannelId: ' RTS1.rs ' }), map)?.[0].id).toBe('epg');
    expect(resolveXMLTVProgramsForChannel(channel({ epgChannelId: null }), map)?.[0].id).toBe('stream');
    expect(resolveXMLTVProgramsForChannel(channel({ epgChannelId: 'other', streamId: 7, id: 'CH-1' }), map)?.[0].id).toBe('id');
  });

  it('returns null when nothing matches', () => {
    expect(resolveXMLTVProgramsForChannel(channel({ epgChannelId: 'x', streamId: 9, id: 'y' }), { 'rts1.rs': programs('epg') })).toBeNull();
  });
});
