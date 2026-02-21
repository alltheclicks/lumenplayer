export const LIVE_PAUSE_STALE_THRESHOLD_MS = 90_000;

export const isLivePlaybackSource = (
  sourceMode: string | undefined,
  sourceChannelId: string | null
): boolean => {
  if (typeof sourceMode === 'string') {
    return sourceMode === 'live';
  }

  return typeof sourceChannelId === 'string' && sourceChannelId.length > 0;
};

export const shouldSnapToLiveOnResume = (
  pausedAtMs: number | null,
  nowMs: number,
  staleThresholdMs: number = LIVE_PAUSE_STALE_THRESHOLD_MS
): boolean => {
  if (pausedAtMs === null) {
    return false;
  }

  return nowMs - pausedAtMs >= staleThresholdMs;
};
