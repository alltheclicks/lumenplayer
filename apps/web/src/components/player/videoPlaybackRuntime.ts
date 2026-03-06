import type { CatchUpTransportAttempt } from './catchupTransport';
import type { CatchUpSessionSourceMetadata } from './sessionSources';

type FailureKind = 'startup' | 'runtime' | 'load';

const RETRY_SEARCH_PARAMS = ['_retry', '_ts'] as const;

export const normalizeCatchUpAttemptRetryKey = (url: string): string => {
  try {
    const parsed = new URL(url, 'http://localhost');
    for (const key of RETRY_SEARCH_PARAMS) {
      parsed.searchParams.delete(key);
    }
    parsed.hash = '';
    return parsed.toString();
  } catch {
    return url;
  }
};

export const resolveNextCatchUpAttemptIndex = ({
  attempts,
  currentAttemptIndex,
  failureKind,
}: {
  attempts: CatchUpTransportAttempt[];
  currentAttemptIndex: number;
  failureKind: FailureKind;
}): number => {
  const nextAttemptIndex = currentAttemptIndex + 1;
  if (nextAttemptIndex >= attempts.length) {
    return -1;
  }

  if (failureKind !== 'runtime') {
    return nextAttemptIndex;
  }

  const currentAttempt = attempts[currentAttemptIndex];
  if (!currentAttempt) {
    return nextAttemptIndex;
  }

  const currentRetryKey = normalizeCatchUpAttemptRetryKey(currentAttempt.url);
  for (let index = nextAttemptIndex; index < attempts.length; index += 1) {
    const candidate = attempts[index];
    if (!candidate) {
      continue;
    }

    if (normalizeCatchUpAttemptRetryKey(candidate.url) === currentRetryKey) {
      continue;
    }

    return index;
  }

  return -1;
};

const clampPositionMs = (positionMs: number, durationSeconds: number): number => (
  Math.max(0, Math.min(positionMs, Math.max(1, durationSeconds) * 1000))
);

const resolveCatchUpAttemptOffsetMs = (
  metadata: CatchUpSessionSourceMetadata,
  attempt: CatchUpTransportAttempt,
): number => (
  (attempt.startTimestamp - metadata.startTimestamp) * 1000
);

export const mapCatchUpSessionPositionToAttemptPosition = ({
  metadata,
  attempt,
  sessionPositionMs,
}: {
  metadata: CatchUpSessionSourceMetadata;
  attempt: CatchUpTransportAttempt;
  sessionPositionMs: number;
}): number => clampPositionMs(
  sessionPositionMs - resolveCatchUpAttemptOffsetMs(metadata, attempt),
  attempt.durationSeconds,
);

export const mapCatchUpAttemptPositionToSessionPosition = ({
  metadata,
  attempt,
  attemptPositionMs,
}: {
  metadata: CatchUpSessionSourceMetadata;
  attempt: CatchUpTransportAttempt;
  attemptPositionMs: number;
}): number => clampPositionMs(
  attemptPositionMs + resolveCatchUpAttemptOffsetMs(metadata, attempt),
  metadata.durationSeconds,
);
