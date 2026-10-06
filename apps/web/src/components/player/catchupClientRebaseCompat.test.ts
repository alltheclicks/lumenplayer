// Characterization tests (P4 step 1b): pin the failure cache before it moves
// into @lumen/catchup-core with an injected storage adapter.
import { beforeEach, describe, expect, it } from 'vitest';
import {
  CATCH_UP_CLIENT_REBASE_FAILURE_TTL_MS,
  clearCatchUpClientRebaseFailures,
  readCatchUpClientRebaseFailure,
  recordCatchUpClientRebaseFailure,
} from './catchupClientRebaseCompat';

const STORAGE_KEY = 'lumen:catchup-client-rebase:v1';

const createStorage = () => {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => {
      data.set(key, value);
    },
    removeItem: (key: string) => {
      data.delete(key);
    },
  };
};

const failingStorage = () => ({
  getItem: () => {
    throw new Error('read failed');
  },
  setItem: () => {
    throw new Error('quota');
  },
  removeItem: () => {
    throw new Error('remove failed');
  },
});

beforeEach(() => {
  clearCatchUpClientRebaseFailures({ storage: null });
});

describe('catchupClientRebaseCompat', () => {
  it('records a failure with a 30 minute default TTL and reads it back', () => {
    const storage = createStorage();

    const record = recordCatchUpClientRebaseFailure(112, 'no-aac-audio', { storage, nowMs: 1_000 });

    expect(CATCH_UP_CLIENT_REBASE_FAILURE_TTL_MS).toBe(30 * 60 * 1000);
    expect(record).toEqual({
      version: 1,
      streamId: 112,
      reason: 'no-aac-audio',
      updatedAtMs: 1_000,
      expiresAtMs: 1_000 + CATCH_UP_CLIENT_REBASE_FAILURE_TTL_MS,
    });
    expect(readCatchUpClientRebaseFailure(112, { storage, nowMs: 2_000 })).toEqual(record);
  });

  it('persists a versioned payload keyed by the floored stream id', () => {
    const storage = createStorage();

    recordCatchUpClientRebaseFailure(7.9, 'split-pes', { storage, nowMs: 10 });

    const payload = JSON.parse(storage.data.get(STORAGE_KEY) ?? 'null');
    expect(payload).toEqual({
      version: 1,
      records: {
        'stream:7': expect.objectContaining({ streamId: 7, reason: 'split-pes' }),
      },
    });
    expect(readCatchUpClientRebaseFailure(7.2, { storage, nowMs: 20 })?.reason).toBe('split-pes');
  });

  it('expires records strictly at expiresAtMs', () => {
    const storage = createStorage();
    recordCatchUpClientRebaseFailure(5, 'mp2', { storage, nowMs: 0, ttlMs: 100 });

    expect(readCatchUpClientRebaseFailure(5, { storage, nowMs: 99 })).not.toBeNull();
    expect(readCatchUpClientRebaseFailure(5, { storage, nowMs: 100 })).toBeNull();
  });

  it('clamps the TTL to at least 1 ms', () => {
    const storage = createStorage();

    const record = recordCatchUpClientRebaseFailure(5, 'mp2', { storage, nowMs: 50, ttlMs: -10 });

    expect(record?.expiresAtMs).toBe(51);
  });

  it('overwrites the previous verdict for the same stream', () => {
    const storage = createStorage();
    recordCatchUpClientRebaseFailure(9, 'first', { storage, nowMs: 1 });

    recordCatchUpClientRebaseFailure(9, 'second', { storage, nowMs: 2 });

    expect(readCatchUpClientRebaseFailure(9, { storage, nowMs: 3 })?.reason).toBe('second');
  });

  it('prunes expired records when writing', () => {
    const storage = createStorage();
    recordCatchUpClientRebaseFailure(1, 'old', { storage, nowMs: 0, ttlMs: 10 });

    recordCatchUpClientRebaseFailure(2, 'new', { storage, nowMs: 20 });

    const payload = JSON.parse(storage.data.get(STORAGE_KEY) ?? 'null');
    expect(Object.keys(payload.records)).toEqual(['stream:2']);
  });

  it('keeps only the 60 most recently updated records', () => {
    const storage = createStorage();
    for (let streamId = 1; streamId <= 61; streamId += 1) {
      recordCatchUpClientRebaseFailure(streamId, 'x', { storage, nowMs: streamId });
    }

    const payload = JSON.parse(storage.data.get(STORAGE_KEY) ?? 'null');
    expect(Object.keys(payload.records)).toHaveLength(60);
    expect(readCatchUpClientRebaseFailure(1, { storage, nowMs: 100 })).toBeNull();
    expect(readCatchUpClientRebaseFailure(61, { storage, nowMs: 100 })).not.toBeNull();
  });

  it('ignores non-finite stream ids', () => {
    const storage = createStorage();

    expect(recordCatchUpClientRebaseFailure(Number.NaN, 'x', { storage })).toBeNull();
    expect(readCatchUpClientRebaseFailure(Number.POSITIVE_INFINITY, { storage })).toBeNull();
    expect(storage.data.size).toBe(0);
  });

  it('falls back to the in-memory records without storage', () => {
    recordCatchUpClientRebaseFailure(3, 'memory', { storage: null, nowMs: 0 });

    expect(readCatchUpClientRebaseFailure(3, { storage: null, nowMs: 1 })?.reason).toBe('memory');
  });

  it('falls back to the in-memory records when the stored payload is unusable', () => {
    const storage = createStorage();
    recordCatchUpClientRebaseFailure(4, 'kept-in-memory', { storage, nowMs: 0 });

    storage.data.set(STORAGE_KEY, '{broken');
    expect(readCatchUpClientRebaseFailure(4, { storage, nowMs: 1 })?.reason).toBe('kept-in-memory');

    storage.data.set(STORAGE_KEY, JSON.stringify({ version: 2, records: {} }));
    expect(readCatchUpClientRebaseFailure(4, { storage, nowMs: 1 })?.reason).toBe('kept-in-memory');
  });

  it('survives a storage that throws on every call', () => {
    const storage = failingStorage();

    expect(() => recordCatchUpClientRebaseFailure(8, 'quota', { storage, nowMs: 0 })).not.toThrow();
    expect(readCatchUpClientRebaseFailure(8, { storage, nowMs: 1 })?.reason).toBe('quota');
    expect(() => clearCatchUpClientRebaseFailures({ storage })).not.toThrow();
    expect(readCatchUpClientRebaseFailure(8, { storage, nowMs: 1 })).toBeNull();
  });

  it('clear removes both the stored payload and the in-memory records', () => {
    const storage = createStorage();
    recordCatchUpClientRebaseFailure(6, 'x', { storage, nowMs: 0 });

    clearCatchUpClientRebaseFailures({ storage });

    expect(storage.data.has(STORAGE_KEY)).toBe(false);
    expect(readCatchUpClientRebaseFailure(6, { storage, nowMs: 1 })).toBeNull();
    expect(readCatchUpClientRebaseFailure(6, { storage: null, nowMs: 1 })).toBeNull();
  });
});
