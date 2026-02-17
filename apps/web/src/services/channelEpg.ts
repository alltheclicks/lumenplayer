import type { Program, XtreamEPGItem } from '@lumen/types';
import { xtreamCodesService } from './xtreamService';
import { mapXtreamEpgItemToProgram } from './epgProgramMapper';

interface ShortEpgFetcherConfig {
  fetchEpg: (streamId: number) => Promise<XtreamEPGItem[]>;
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
  cacheTtlMs = DEFAULT_CACHE_TTL_MS,
  minRequestIntervalMs = DEFAULT_MIN_REQUEST_INTERVAL_MS,
  maxRateLimitRetries = DEFAULT_MAX_RATE_LIMIT_RETRIES,
  retryBackoffMs = DEFAULT_RETRY_BACKOFF_MS,
}: ShortEpgFetcherConfig) => {
  const cache = new Map<number, CachedShortEpg>();
  const inFlight = new Map<number, Promise<Program[]>>();
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

  const getCachedPrograms = (streamId: number, includeStale: boolean): Program[] | null => {
    const entry = cache.get(streamId);
    if (!entry) {
      return null;
    }

    if (includeStale) {
      return entry.programs;
    }

    const ageMs = Date.now() - entry.cachedAt;
    return ageMs <= cacheTtlMs ? entry.programs : null;
  };

  const loadPrograms = async (streamId: number): Promise<Program[]> => {
    for (let attempt = 0; attempt <= maxRateLimitRetries; attempt += 1) {
      await scheduleRequestSlot();

      try {
        const epg = await fetchEpg(streamId);
        const programs = epg.map(mapXtreamEpgItemToProgram);
        cache.set(streamId, {
          cachedAt: Date.now(),
          programs,
        });
        return programs;
      } catch (error) {
        const isRateLimited = isRateLimitedError(error);
        const isFinalAttempt = attempt >= maxRateLimitRetries;

        if (!isRateLimited || isFinalAttempt) {
          const stalePrograms = getCachedPrograms(streamId, true);
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
    getPrograms: async (streamId: number): Promise<Program[]> => {
      const cachedPrograms = getCachedPrograms(streamId, false);
      if (cachedPrograms) {
        return cachedPrograms;
      }

      const pending = inFlight.get(streamId);
      if (pending) {
        return pending;
      }

      const nextPromise = loadPrograms(streamId).finally(() => {
        inFlight.delete(streamId);
      });

      inFlight.set(streamId, nextPromise);
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
  fetchEpg: async (streamId: number) => xtreamCodesService.getEPG(String(streamId)),
});

export const fetchChannelShortEpgPrograms = async (streamId: number): Promise<Program[]> => (
  sharedShortEpgProgramFetcher.getPrograms(streamId)
);

export const clearChannelShortEpgProgramsCache = (): void => {
  sharedShortEpgProgramFetcher.clear();
};
