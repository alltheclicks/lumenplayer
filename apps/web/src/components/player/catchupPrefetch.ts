import type { Program } from '@lumen/types';

export const CATCH_UP_PREFETCH_LOOKAHEAD_MS = 45_000;
export const CATCH_UP_PREFETCH_MAX_AGE_MS = 120_000;
export const CATCH_UP_PREFETCH_FAILURE_RETRY_MS = 15_000;

export const buildCatchUpPrefetchKey = (channelId: string, programId: string): string => (
  `${channelId}:${programId}`
);

export const isCatchUpPrefetchFresh = (
  resolvedAtMs: number,
  nowMs: number = Date.now(),
  maxAgeMs: number = CATCH_UP_PREFETCH_MAX_AGE_MS,
): boolean => (
  nowMs - resolvedAtMs <= maxAgeMs
);

export const isCatchUpPrefetchRetryDue = (
  failedAtMs: number,
  nowMs: number = Date.now(),
  retryDelayMs: number = CATCH_UP_PREFETCH_FAILURE_RETRY_MS,
): boolean => (
  nowMs - failedAtMs >= retryDelayMs
);

export const shouldPrefetchNextCatchUpProgram = ({
  currentProgram,
  nextProgram,
  positionMs,
  lookaheadMs = CATCH_UP_PREFETCH_LOOKAHEAD_MS,
}: {
  currentProgram: Pick<Program, 'startTime' | 'endTime'> | null;
  nextProgram: Pick<Program, 'id'> | null;
  positionMs: number | null;
  lookaheadMs?: number;
}): boolean => {
  if (!currentProgram || !nextProgram) {
    return false;
  }

  const durationMs = currentProgram.endTime.getTime() - currentProgram.startTime.getTime();
  if (!Number.isFinite(durationMs) || durationMs <= 0) {
    return false;
  }

  const normalizedPositionMs = Math.max(
    0,
    Math.min(durationMs, Math.floor(positionMs ?? 0)),
  );
  const remainingMs = durationMs - normalizedPositionMs;
  return remainingMs <= lookaheadMs;
};
