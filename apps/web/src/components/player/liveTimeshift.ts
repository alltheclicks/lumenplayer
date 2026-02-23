import type { Program } from '@lumen/types';

const LIVE_TIMESHIFT_ACTIVATION_KEYS = new Set([
  'Enter',
  ' ',
  'Spacebar',
]);
const MIN_LIVE_TIMESHIFT_WINDOW_SECONDS = 120;
const LIVE_TIMESHIFT_EDGE_GUARD_SECONDS = 90;

const resolveProgramDurationSeconds = (program: Pick<Program, 'startTime' | 'endTime'>): number => {
  const durationSeconds = (program.endTime.getTime() - program.startTime.getTime()) / 1000;
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
    return 0;
  }

  return durationSeconds;
};

export const resolveLiveTimeshiftAvailableDurationSeconds = (
  program: Pick<Program, 'startTime' | 'endTime'>,
  nowMs = Date.now(),
): number => {
  const totalDurationSeconds = resolveProgramDurationSeconds(program);
  if (totalDurationSeconds <= 0) {
    return 0;
  }

  const elapsedSeconds = Math.floor((nowMs - program.startTime.getTime()) / 1000);
  const availableSeconds = Math.max(0, Math.min(totalDurationSeconds, elapsedSeconds));
  const isProgramInProgress = nowMs < program.endTime.getTime();
  if (!isProgramInProgress) {
    return availableSeconds;
  }

  // Keep a small guard behind live-edge to avoid requesting not-yet-generated segments.
  return Math.max(0, availableSeconds - LIVE_TIMESHIFT_EDGE_GUARD_SECONDS);
};

export const canStartLiveTimeshift = (
  hasCatchUp: boolean,
  currentProgram?: Program | null,
  nowMs = Date.now(),
  options: {
    allowWithoutCurrentProgramArchive?: boolean;
  } = {},
): boolean => {
  if (!hasCatchUp || !currentProgram) {
    return false;
  }

  const hasArchiveSignal = currentProgram.hasCatchUp || options.allowWithoutCurrentProgramArchive === true;
  return hasArchiveSignal &&
    resolveLiveTimeshiftAvailableDurationSeconds(currentProgram, nowMs) >= MIN_LIVE_TIMESHIFT_WINDOW_SECONDS;
};

export const resolveLiveTimeshiftPositionSeconds = (
  program: Pick<Program, 'startTime' | 'endTime'>,
  ratio: number,
  nowMs = Date.now(),
): number => {
  const durationSeconds = resolveLiveTimeshiftAvailableDurationSeconds(program, nowMs);
  if (durationSeconds <= 0) {
    return 0;
  }

  const clampedRatio = Math.max(0, Math.min(1, ratio));
  return durationSeconds * clampedRatio;
};

export const isLiveTimeshiftActivationKey = (key: string): boolean => (
  LIVE_TIMESHIFT_ACTIVATION_KEYS.has(key)
);
