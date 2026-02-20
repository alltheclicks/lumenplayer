import type { SessionState } from '@lumen/session-core';
import type { PlaybackError } from '@lumen/types';

export const sessionWantsPlayback = (session: SessionState): boolean => (
  session.playback === 'playing' || session.playback === 'buffering'
);

const isLiveSourceMode = (session: SessionState): boolean => {
  if (!session.source) {
    return false;
  }

  const metadataMode = session.source.metadata?.mode;
  if (metadataMode === 'live') {
    return true;
  }

  return typeof session.source.channelId === 'string' && session.source.channelId.length > 0;
};

export const shouldResumePlaybackAfterPictureInPictureExit = (
  session: SessionState,
  isVideoPaused: boolean
): boolean => {
  if (!isVideoPaused) {
    return false;
  }

  if (!sessionWantsPlayback(session)) {
    return false;
  }

  return isLiveSourceMode(session);
};

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

export const shouldKeepPendingAutoplayOnIdle = (
  session: SessionState,
  pendingAutoplaySourceUrl: string | null
): boolean => (
  shouldHoldPauseSyncOnSourceStartup(session, pendingAutoplaySourceUrl)
);

export const shouldRetryPendingAutoplayAfterPausedEvent = (
  session: SessionState,
  pendingAutoplaySourceUrl: string | null,
  retryCount: number,
  maxRetries: number
): boolean => {
  if (!shouldHoldPauseSyncOnSourceStartup(session, pendingAutoplaySourceUrl)) {
    return false;
  }

  return retryCount < maxRetries;
};

export const shouldShowBlockingPlaybackError = (playbackError: PlaybackError): boolean => (
  playbackError.fatal
);

export const shouldClearPendingAutoplayOnPlaybackError = (
  playbackError: PlaybackError
): boolean => (
  playbackError.fatal
);
