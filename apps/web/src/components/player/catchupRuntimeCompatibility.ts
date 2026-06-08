import type { SessionSource } from '@lumen/session-core';
import type { SourceBlockingError } from './sourceBlockingError';

export type CatchUpRuntimeCompatibilityStatus = 'playable' | 'unsupported';

export type CatchUpRuntimeCompatibilityReasonCode =
  | 'rendered-frame'
  | 'startup-timeout'
  | 'visible-loading-timeout'
  | 'manifest-no-frame'
  | 'load-failed'
  | 'playback-error'
  | 'seek-no-frame'
  | 'shadow-step-aside';

export interface CatchUpRuntimeCompatibilityRecord {
  version: 1;
  fingerprint: string;
  status: CatchUpRuntimeCompatibilityStatus;
  reasonCode: CatchUpRuntimeCompatibilityReasonCode;
  streamId: number | null;
  channelId: string | null;
  sourceKey: string;
  observedSourceKey: string | null;
  updatedAtMs: number;
  expiresAtMs: number;
}

interface CachePayload {
  version: 1;
  records: Record<string, CatchUpRuntimeCompatibilityRecord>;
}

interface StorageLike {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
  removeItem: (key: string) => void;
}

export interface CatchUpRuntimeCompatibilityCacheOptions {
  nowMs?: number;
  ttlMs?: number;
  storage?: StorageLike | null;
}

export interface CatchUpRuntimeCompatibilityRecordInput {
  status: CatchUpRuntimeCompatibilityStatus;
  reasonCode: CatchUpRuntimeCompatibilityReasonCode;
  observedUrl?: string | null;
}

const CACHE_STORAGE_KEY = 'lumen:catchup-runtime-compatibility:v1';
const CACHE_VERSION = 1;
const MAX_CACHE_RECORDS = 120;

export const CATCH_UP_RUNTIME_COMPATIBILITY_CACHE_TTL_MS = 30 * 60 * 1000;

let memoryRecords: Record<string, CatchUpRuntimeCompatibilityRecord> = {};

const parseRecord = (value: unknown): Record<string, unknown> | null => {
  if (!value || typeof value !== 'object') {
    return null;
  }

  return value as Record<string, unknown>;
};

const parseString = (value: unknown): string | null => {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const parseFiniteNumber = (value: unknown): number | null => {
  const parsed = typeof value === 'number'
    ? value
    : (typeof value === 'string' ? Number(value) : NaN);

  return Number.isFinite(parsed) ? parsed : null;
};

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

const stableHash = (value: string): string => {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return (hash >>> 0).toString(36);
};

const normalizePathSegment = (segment: string): string => {
  if (!segment) {
    return '';
  }

  const decodedSegment = decodeURIComponent(segment).trim();
  if (!decodedSegment) {
    return '';
  }

  if (/^\d+$/.test(decodedSegment)) {
    return decodedSegment;
  }

  if (/^[a-z0-9._-]{1,32}$/i.test(decodedSegment)) {
    return decodedSegment.toLowerCase();
  }

  return ':opaque';
};

export const buildCatchUpRuntimeSourceKey = (urlValue: string | null | undefined): string => {
  const rawUrl = parseString(urlValue);
  if (!rawUrl) {
    return 'source:none';
  }

  try {
    const url = new URL(rawUrl, 'https://lumen.local');
    const queryKeys = Array.from(new Set(Array.from(url.searchParams.keys())))
      .map((key) => key.toLowerCase())
      .filter((key) => (
        key !== 'username' &&
        key !== 'password' &&
        key !== 'token' &&
        key !== 'auth' &&
        key !== 'key'
      ))
      .sort()
      .join(',');
    const rawPathSegments = url.pathname.split('/');
    const credentialRootIndex = rawPathSegments.findIndex((segment) => (
      ['timeshift_hls', 'live', 'movie', 'series'].includes(
        decodeURIComponent(segment).trim().toLowerCase(),
      )
    ));
    const normalizedPath = rawPathSegments
      .map((segment, index) => (
        credentialRootIndex >= 0 &&
        (index === credentialRootIndex + 1 || index === credentialRootIndex + 2)
          ? ':credential'
          : normalizePathSegment(segment)
      ))
      .join('/');

    return [
      url.protocol === 'http:' || url.protocol === 'https:' ? url.protocol : 'url:',
      url.host.toLowerCase(),
      normalizedPath,
      queryKeys,
    ].join('|');
  } catch {
    return `source:${stableHash(rawUrl.replace(/[?#].*$/, ''))}`;
  }
};

const readPayload = (storage: StorageLike | null): CachePayload => {
  if (!storage) {
    return {
      version: CACHE_VERSION,
      records: { ...memoryRecords },
    };
  }

  try {
    const rawPayload = storage.getItem(CACHE_STORAGE_KEY);
    if (!rawPayload) {
      return {
        version: CACHE_VERSION,
        records: { ...memoryRecords },
      };
    }

    const parsed = JSON.parse(rawPayload) as Partial<CachePayload>;
    if (parsed.version !== CACHE_VERSION || !parsed.records || typeof parsed.records !== 'object') {
      return {
        version: CACHE_VERSION,
        records: { ...memoryRecords },
      };
    }

    return {
      version: CACHE_VERSION,
      records: parsed.records,
    };
  } catch {
    return {
      version: CACHE_VERSION,
      records: { ...memoryRecords },
    };
  }
};

const writePayload = (storage: StorageLike | null, records: Record<string, CatchUpRuntimeCompatibilityRecord>): void => {
  const orderedRecords = Object.values(records)
    .sort((left, right) => right.updatedAtMs - left.updatedAtMs)
    .slice(0, MAX_CACHE_RECORDS)
    .reduce<Record<string, CatchUpRuntimeCompatibilityRecord>>((nextRecords, record) => {
      nextRecords[record.fingerprint] = record;
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

const pruneExpiredRecords = (
  records: Record<string, CatchUpRuntimeCompatibilityRecord>,
  nowMs: number,
): Record<string, CatchUpRuntimeCompatibilityRecord> => (
  Object.values(records)
    .filter((record) => record.expiresAtMs > nowMs)
    .reduce<Record<string, CatchUpRuntimeCompatibilityRecord>>((nextRecords, record) => {
      nextRecords[record.fingerprint] = record;
      return nextRecords;
    }, {})
);

export const resolveCatchUpRuntimeCompatibilityFingerprint = (
  source: SessionSource | null | undefined,
): string | null => {
  const metadata = parseRecord(source?.metadata);
  if (metadata?.mode !== 'catchup') {
    return null;
  }

  const streamId = parseFiniteNumber(metadata.streamId);
  const startTimestamp = parseFiniteNumber(metadata.startTimestamp)
    ?? parseFiniteNumber(metadata.catchUpStartTimestamp);
  const durationSeconds = parseFiniteNumber(metadata.durationSeconds)
    ?? parseFiniteNumber(metadata.catchUpDurationSeconds);
  const gateway = parseRecord(metadata.gateway);
  const sourceKey = buildCatchUpRuntimeSourceKey(source?.url);
  const gatewayKey = buildCatchUpRuntimeSourceKey(parseString(gateway?.playbackUrl));
  const transportMode = parseString(gateway?.transportMode) ?? 'direct';
  const signature = [
    'catchup-runtime-v1',
    streamId === null ? 'stream:unknown' : `stream:${Math.floor(streamId)}`,
    startTimestamp === null ? 'start:unknown' : `start:${Math.floor(startTimestamp / 60)}`,
    durationSeconds === null ? 'duration:unknown' : `duration:${Math.floor(durationSeconds / 60)}`,
    transportMode,
    sourceKey,
    gatewayKey,
  ].join('|');

  return `catchup:${streamId === null ? 'unknown' : Math.floor(streamId)}:${stableHash(signature)}`;
};

export const getCachedCatchUpRuntimeCompatibility = (
  source: SessionSource | null | undefined,
  options: CatchUpRuntimeCompatibilityCacheOptions = {},
): CatchUpRuntimeCompatibilityRecord | null => {
  const fingerprint = resolveCatchUpRuntimeCompatibilityFingerprint(source);
  if (!fingerprint) {
    return null;
  }

  const nowMs = options.nowMs ?? Date.now();
  const storage = options.storage === undefined ? resolveStorage() : options.storage;
  const payload = readPayload(storage);
  const records = pruneExpiredRecords(payload.records, nowMs);
  const record = records[fingerprint] ?? null;
  if (Object.keys(records).length !== Object.keys(payload.records).length) {
    writePayload(storage, records);
  }

  return record;
};

export const recordCatchUpRuntimeCompatibilityResult = (
  source: SessionSource | null | undefined,
  input: CatchUpRuntimeCompatibilityRecordInput,
  options: CatchUpRuntimeCompatibilityCacheOptions = {},
): CatchUpRuntimeCompatibilityRecord | null => {
  const fingerprint = resolveCatchUpRuntimeCompatibilityFingerprint(source);
  if (!fingerprint) {
    return null;
  }

  const metadata = parseRecord(source?.metadata);
  const nowMs = options.nowMs ?? Date.now();
  const ttlMs = Math.max(1, options.ttlMs ?? CATCH_UP_RUNTIME_COMPATIBILITY_CACHE_TTL_MS);
  const storage = options.storage === undefined ? resolveStorage() : options.storage;
  const payload = readPayload(storage);
  const records = pruneExpiredRecords(payload.records, nowMs);
  const record: CatchUpRuntimeCompatibilityRecord = {
    version: CACHE_VERSION,
    fingerprint,
    status: input.status,
    reasonCode: input.reasonCode,
    streamId: parseFiniteNumber(metadata?.streamId),
    channelId: parseString(metadata?.channelId),
    sourceKey: buildCatchUpRuntimeSourceKey(source?.url),
    observedSourceKey: input.observedUrl ? buildCatchUpRuntimeSourceKey(input.observedUrl) : null,
    updatedAtMs: nowMs,
    expiresAtMs: nowMs + ttlMs,
  };

  writePayload(storage, {
    ...records,
    [fingerprint]: record,
  });

  return record;
};

export const clearCatchUpRuntimeCompatibilityCache = (
  options: Pick<CatchUpRuntimeCompatibilityCacheOptions, 'storage'> = {},
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

export const resolveCatchUpRuntimeCompatibilityBlockingError = (
  source: SessionSource | null | undefined,
  record: CatchUpRuntimeCompatibilityRecord | null,
): SourceBlockingError | null => {
  const metadata = parseRecord(source?.metadata);
  if (metadata?.mode !== 'catchup' || record?.status !== 'unsupported') {
    return null;
  }

  const channelName = parseString(source?.title)?.split(' - ')[0]
    ?? parseString(metadata.title)
    ?? 'Ovaj kanal';

  return {
    type: 'format',
    message: 'Snimak za TV unazad nije dostupan u web playeru',
    details: `${channelName} trenutno ne može da se gleda unazad u ovom browseru. Poslednja provera trenutnog catch-up source-a nije dobila podržan audio/video format ili prvi video kadar u očekivanom roku. Live kanal može raditi normalno. Nije do vašeg uređaja niti do Lumen playera.`,
    primaryAction: 'switch-to-live',
    primaryActionLabel: `Gledaj ${channelName} uživo`,
  };
};
