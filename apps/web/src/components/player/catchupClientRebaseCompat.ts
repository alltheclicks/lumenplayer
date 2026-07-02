// Persisted per-channel verdicts for the client-side catch-up PTS rebase
// (mpegTsPtsRebase.ts). When a rebase session fails at runtime (MP2 mux,
// split PES headers, intra-file discontinuity, oversized joint error), the
// failure is recorded here so subsequent loads of the same channel skip the
// rebase attempt for a while and go straight to the legacy/shadow chain.
// Follows the storage pattern of catchupRuntimeCompatibility.ts.

interface StorageLike {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
  removeItem: (key: string) => void;
}

export interface CatchUpClientRebaseFailureRecord {
  version: 1;
  streamId: number;
  reason: string;
  updatedAtMs: number;
  expiresAtMs: number;
}

interface CachePayload {
  version: 1;
  records: Record<string, CatchUpClientRebaseFailureRecord>;
}

export interface CatchUpClientRebaseCompatOptions {
  nowMs?: number;
  ttlMs?: number;
  storage?: StorageLike | null;
}

const CACHE_STORAGE_KEY = 'lumen:catchup-client-rebase:v1';
const CACHE_VERSION = 1;
const MAX_CACHE_RECORDS = 60;

export const CATCH_UP_CLIENT_REBASE_FAILURE_TTL_MS = 30 * 60 * 1000;

let memoryRecords: Record<string, CatchUpClientRebaseFailureRecord> = {};

const resolveStorage = (): StorageLike | null => {
  if (typeof window === 'undefined' || !window.localStorage) {
    return null;
  }

  try {
    const testKey = `${CACHE_STORAGE_KEY}:test`;
    window.localStorage.setItem(testKey, '1');
    window.localStorage.removeItem(testKey);
    return window.localStorage;
  } catch {
    return null;
  }
};

const recordKey = (streamId: number): string => `stream:${Math.floor(streamId)}`;

const readRecords = (storage: StorageLike | null): Record<string, CatchUpClientRebaseFailureRecord> => {
  if (!storage) {
    return { ...memoryRecords };
  }

  try {
    const rawPayload = storage.getItem(CACHE_STORAGE_KEY);
    if (!rawPayload) {
      return { ...memoryRecords };
    }

    const parsed = JSON.parse(rawPayload) as Partial<CachePayload>;
    if (parsed.version !== CACHE_VERSION || !parsed.records || typeof parsed.records !== 'object') {
      return { ...memoryRecords };
    }

    return parsed.records;
  } catch {
    return { ...memoryRecords };
  }
};

const writeRecords = (
  storage: StorageLike | null,
  records: Record<string, CatchUpClientRebaseFailureRecord>,
): void => {
  const orderedRecords = Object.values(records)
    .sort((left, right) => right.updatedAtMs - left.updatedAtMs)
    .slice(0, MAX_CACHE_RECORDS)
    .reduce<Record<string, CatchUpClientRebaseFailureRecord>>((nextRecords, record) => {
      nextRecords[recordKey(record.streamId)] = record;
      return nextRecords;
    }, {});

  memoryRecords = orderedRecords;

  if (!storage) {
    return;
  }

  try {
    storage.setItem(CACHE_STORAGE_KEY, JSON.stringify({
      version: CACHE_VERSION,
      records: orderedRecords,
    }));
  } catch {
    memoryRecords = orderedRecords;
  }
};

const pruneExpired = (
  records: Record<string, CatchUpClientRebaseFailureRecord>,
  nowMs: number,
): Record<string, CatchUpClientRebaseFailureRecord> => (
  Object.values(records)
    .filter((record) => record.expiresAtMs > nowMs)
    .reduce<Record<string, CatchUpClientRebaseFailureRecord>>((nextRecords, record) => {
      nextRecords[recordKey(record.streamId)] = record;
      return nextRecords;
    }, {})
);

export const readCatchUpClientRebaseFailure = (
  streamId: number,
  options: CatchUpClientRebaseCompatOptions = {},
): CatchUpClientRebaseFailureRecord | null => {
  if (!Number.isFinite(streamId)) {
    return null;
  }

  const nowMs = options.nowMs ?? Date.now();
  const storage = options.storage === undefined ? resolveStorage() : options.storage;
  const records = pruneExpired(readRecords(storage), nowMs);
  return records[recordKey(streamId)] ?? null;
};

export const recordCatchUpClientRebaseFailure = (
  streamId: number,
  reason: string,
  options: CatchUpClientRebaseCompatOptions = {},
): CatchUpClientRebaseFailureRecord | null => {
  if (!Number.isFinite(streamId)) {
    return null;
  }

  const nowMs = options.nowMs ?? Date.now();
  const ttlMs = Math.max(1, options.ttlMs ?? CATCH_UP_CLIENT_REBASE_FAILURE_TTL_MS);
  const storage = options.storage === undefined ? resolveStorage() : options.storage;
  const records = pruneExpired(readRecords(storage), nowMs);
  const record: CatchUpClientRebaseFailureRecord = {
    version: CACHE_VERSION,
    streamId: Math.floor(streamId),
    reason,
    updatedAtMs: nowMs,
    expiresAtMs: nowMs + ttlMs,
  };

  writeRecords(storage, {
    ...records,
    [recordKey(streamId)]: record,
  });

  return record;
};

export const clearCatchUpClientRebaseFailures = (
  options: Pick<CatchUpClientRebaseCompatOptions, 'storage'> = {},
): void => {
  memoryRecords = {};
  const storage = options.storage === undefined ? resolveStorage() : options.storage;
  if (!storage) {
    return;
  }

  try {
    storage.removeItem(CACHE_STORAGE_KEY);
  } catch {
    memoryRecords = {};
  }
};
