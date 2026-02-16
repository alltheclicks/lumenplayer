import type { SessionState } from '@lumen/session-core';
import type { PlaybackError } from '@lumen/types';

export const sessionWantsPlayback = (session: SessionState): boolean => (
  session.playback === 'playing' || session.playback === 'buffering'
);

export const shouldHoldPauseSyncOnSourceStartup = (
  session: SessionState,
  pendingAutoplaySourceUrl: string | null
): boolean => {
  if (!pendingAutoplaySourceUrl) {
    return false;
  }

  const currentSourceUrl = session.source?.url ?? null;
  if (!currentSourceUrl) {
    return false;
  }

  return currentSourceUrl === pendingAutoplaySourceUrl && sessionWantsPlayback(session);
};

export const shouldShowBlockingPlaybackError = (playbackError: PlaybackError): boolean => (
  playbackError.fatal
);

export const shouldClearPendingAutoplayOnPlaybackError = (
  playbackError: PlaybackError
): boolean => (
  playbackError.fatal
);
