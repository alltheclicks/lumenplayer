const clamp = (value: number, min: number, max: number): number => (
  Math.max(min, Math.min(max, value))
);

export const resolveTimelineSeekPositionSeconds = ({
  clientX,
  timelineLeft,
  timelineWidth,
  durationSeconds,
  fallbackPositionSeconds,
}: {
  clientX?: number;
  timelineLeft: number;
  timelineWidth: number;
  durationSeconds: number;
  fallbackPositionSeconds: number;
}): number => {
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
    return 0;
  }

  const fallbackPosition = clamp(
    Number.isFinite(fallbackPositionSeconds) ? fallbackPositionSeconds : 0,
    0,
    durationSeconds,
  );

  if (
    !Number.isFinite(clientX) ||
    !Number.isFinite(timelineLeft) ||
    !Number.isFinite(timelineWidth) ||
    timelineWidth <= 0
  ) {
    return fallbackPosition;
  }

  const ratio = (clientX - timelineLeft) / timelineWidth;
  if (!Number.isFinite(ratio)) {
    return fallbackPosition;
  }

  return clamp(ratio, 0, 1) * durationSeconds;
};

export const resolveCatchUpTimelineDurationSeconds = ({
  baseDurationSeconds,
  mediaDurationSeconds,
  mediaOffsetSeconds = 0,
  toleranceSeconds = 5,
}: {
  baseDurationSeconds: number;
  mediaDurationSeconds: number | null | undefined;
  mediaOffsetSeconds?: number;
  toleranceSeconds?: number;
}): number => {
  const safeBaseDurationSeconds = Math.max(
    0,
    Number.isFinite(baseDurationSeconds) ? baseDurationSeconds : 0,
  );
  if (safeBaseDurationSeconds <= 0) {
    return 0;
  }

  const safeMediaOffsetSeconds = Math.max(
    0,
    Number.isFinite(mediaOffsetSeconds) ? mediaOffsetSeconds : 0,
  );
  if (safeMediaOffsetSeconds > 0) {
    return safeBaseDurationSeconds;
  }

  const safeMediaDurationSeconds = typeof mediaDurationSeconds === 'number' &&
    Number.isFinite(mediaDurationSeconds)
    ? mediaDurationSeconds
    : 0;
  const safeToleranceSeconds = Math.max(
    0,
    Number.isFinite(toleranceSeconds) ? toleranceSeconds : 0,
  );
  if (
    safeMediaDurationSeconds > 0 &&
    safeMediaDurationSeconds < safeBaseDurationSeconds - safeToleranceSeconds
  ) {
    return Math.max(1, Math.min(safeBaseDurationSeconds, safeMediaDurationSeconds));
  }

  return safeBaseDurationSeconds;
};
