import type { Program, XtreamEPGItem } from '@lumen/types';
import { xtreamCodesService } from './xtreamService';
import { mapXtreamEpgItemToProgram } from './epgProgramMapper';

interface ShortEpgFetcherConfig {
  fetchEpg: (streamId: number) => Promise<XtreamEPGItem[]>;
  fetchArchiveEpg?: (streamId: number) => Promise<XtreamEPGItem[]>;
  cacheTtlMs?: number;
  minRequestIntervalMs?: number;
  maxRateLimitRetries?: number;
  retryBackoffMs?: number;
}

interface CachedShortEpg {
  cachedAt: number;
  programs: Program[];
}

const DEFAULT_CACHE_TTL_MS = 2 * 60 * 1000;
const DEFAULT_MIN_REQUEST_INTERVAL_MS = 180;
const DEFAULT_MAX_RATE_LIMIT_RETRIES = 2;
const DEFAULT_RETRY_BACKOFF_MS = 400;
const DEFAULT_SHORT_EPG_LIMIT = 168;

type ProgramFetchOptions = {
  includeArchiveFallback?: boolean;
};

const buildCacheKey = (streamId: number, includeArchiveFallback: boolean): string => (
  `${streamId}:${includeArchiveFallback ? 'archive' : 'short'}`
);

const buildProgramSignature = (program: Program): string => (
  `${program.startTime.getTime()}:${program.endTime.getTime()}:${program.title.trim().toLowerCase()}`
);

const mergeArchiveFallbackPrograms = (
  shortPrograms: Program[],
  archivePrograms: Program[],
): Program[] => {
  if (archivePrograms.length === 0) {
    return shortPrograms;
  }

  const archiveSignatures = new Set(
    archivePrograms
      .filter((program) => program.hasCatchUp)
      .map((program) => buildProgramSignature(program)),
  );

  const mergedShortPrograms = shortPrograms.map((program) => (
    archiveSignatures.has(buildProgramSignature(program))
      ? { ...program, hasCatchUp: true }
      : program
  ));

  const knownSignatures = new Set(mergedShortPrograms.map((program) => buildProgramSignature(program)));
  const archiveOnlyPrograms = archivePrograms.filter((program) => {
    const signature = buildProgramSignature(program);
    if (knownSignatures.has(signature)) {
      return false;
    }

    knownSignatures.add(signature);
    return true;
  });

  return [...mergedShortPrograms, ...archiveOnlyPrograms]
    .sort((a, b) => a.startTime.getTime() - b.startTime.getTime());
};

const wait = async (ms: number): Promise<void> => {
  if (ms <= 0) {
    return;
  }

  await new Promise<void>((resolve) => {
    globalThis.setTimeout(resolve, ms);
  });
};

const isRateLimitedError = (error: unknown): boolean => {
  if (typeof error === 'object' && error !== null && 'status' in error) {
    const status = Number((error as { status?: unknown }).status);
    if (status === 429) {
      return true;
    }
  }

  const message = error instanceof Error ? error.message : String(error);
  return message.includes('429');
};

export const createShortEpgProgramFetcher = ({
  fetchEpg,
  fetchArchiveEpg,
  cacheTtlMs = DEFAULT_CACHE_TTL_MS,
  minRequestIntervalMs = DEFAULT_MIN_REQUEST_INTERVAL_MS,
  maxRateLimitRetries = DEFAULT_MAX_RATE_LIMIT_RETRIES,
  retryBackoffMs = DEFAULT_RETRY_BACKOFF_MS,
}: ShortEpgFetcherConfig) => {
  const cache = new Map<string, CachedShortEpg>();
  const inFlight = new Map<string, Promise<Program[]>>();
  let gate: Promise<void> = Promise.resolve();
  let nextAllowedAt = 0;

  const scheduleRequestSlot = async (): Promise<void> => {
    await (gate = gate.then(async () => {
      const now = Date.now();
      const waitMs = Math.max(0, nextAllowedAt - now);
      nextAllowedAt = now + waitMs + minRequestIntervalMs;
      await wait(waitMs);
    }));
  };

  const getCachedPrograms = (cacheKey: string, includeStale: boolean): Program[] | null => {
    const entry = cache.get(cacheKey);
    if (!entry) {
      return null;
    }

    if (includeStale) {
      return entry.programs;
    }

    const ageMs = Date.now() - entry.cachedAt;
    return ageMs <= cacheTtlMs ? entry.programs : null;
  };

  const loadPrograms = async (
    streamId: number,
    includeArchiveFallback: boolean,
    cacheKey: string,
  ): Promise<Program[]> => {
    for (let attempt = 0; attempt <= maxRateLimitRetries; attempt += 1) {
      await scheduleRequestSlot();

      try {
        const epg = await fetchEpg(streamId);
        const shortPrograms = epg.map(mapXtreamEpgItemToProgram);
        const shouldResolveArchiveFallback = includeArchiveFallback &&
          typeof fetchArchiveEpg === 'function' &&
          !shortPrograms.some((program) => program.hasCatchUp);
        const programs = shouldResolveArchiveFallback
          ? await (async () => {
            try {
              const archiveEpg = await fetchArchiveEpg(streamId);
              const archivePrograms = archiveEpg.map(mapXtreamEpgItemToProgram);
              return mergeArchiveFallbackPrograms(shortPrograms, archivePrograms);
            } catch {
              return shortPrograms;
            }
          })()
          : shortPrograms;

        cache.set(cacheKey, {
          cachedAt: Date.now(),
          programs,
        });
        return programs;
      } catch (error) {
        const isRateLimited = isRateLimitedError(error);
        const isFinalAttempt = attempt >= maxRateLimitRetries;

        if (!isRateLimited || isFinalAttempt) {
          const stalePrograms = getCachedPrograms(cacheKey, true);
          if (isRateLimited && stalePrograms) {
            return stalePrograms;
          }
          throw error;
        }

        await wait(retryBackoffMs * (attempt + 1));
      }
    }

    return [];
  };

  return {
    getPrograms: async (
      streamId: number,
      options: ProgramFetchOptions = {},
    ): Promise<Program[]> => {
      const includeArchiveFallback = options.includeArchiveFallback ?? false;
      const cacheKey = buildCacheKey(streamId, includeArchiveFallback);
      const cachedPrograms = getCachedPrograms(cacheKey, false);
      if (cachedPrograms) {
        return cachedPrograms;
      }

      const pending = inFlight.get(cacheKey);
      if (pending) {
        return pending;
      }

      const nextPromise = loadPrograms(streamId, includeArchiveFallback, cacheKey).finally(() => {
        inFlight.delete(cacheKey);
      });

      inFlight.set(cacheKey, nextPromise);
      return nextPromise;
    },
    clear: () => {
      cache.clear();
      inFlight.clear();
      gate = Promise.resolve();
      nextAllowedAt = 0;
    },
  };
};

const sharedShortEpgProgramFetcher = createShortEpgProgramFetcher({
  fetchEpg: async (streamId: number) => xtreamCodesService.getEPG(String(streamId), {
    limit: DEFAULT_SHORT_EPG_LIMIT,
  }),
  fetchArchiveEpg: async (streamId: number) => xtreamCodesService.getSimpleDataTable(streamId),
});

export const fetchChannelShortEpgPrograms = async (
  streamId: number,
  options: ProgramFetchOptions = {},
): Promise<Program[]> => (
  sharedShortEpgProgramFetcher.getPrograms(streamId, options)
);

export const clearChannelShortEpgProgramsCache = (): void => {
  sharedShortEpgProgramFetcher.clear();
};
