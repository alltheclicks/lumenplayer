import type { SessionSource } from '@lumen/session-core';
import type { SourceBlockingError } from './sourceBlockingError';

export type PlayerErrorState = {
  error: SourceBlockingError;
  source: SessionSource | null;
};

export const buildPlayerErrorState = (
  error: SourceBlockingError,
  source: SessionSource | null | undefined,
): PlayerErrorState => ({
  error,
  source: source ?? null,
});

export const resolvePlayerErrorActionSource = (
  errorState: PlayerErrorState | null,
  _currentSource: SessionSource | null | undefined,
): SessionSource | null => errorState?.source ?? null;
