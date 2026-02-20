import type { Program } from '@lumen/types';

export const canStartLiveTimeshift = (
  hasCatchUp: boolean,
  currentProgram?: Program | null
): boolean => {
  if (!hasCatchUp || !currentProgram) {
    return false;
  }

  return currentProgram.endTime.getTime() > currentProgram.startTime.getTime();
};

export const resolveLiveTimeshiftPositionSeconds = (
  program: Pick<Program, 'startTime' | 'endTime'>,
  ratio: number
): number => {
  const durationSeconds = (program.endTime.getTime() - program.startTime.getTime()) / 1000;
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
    return 0;
  }

  const clampedRatio = Math.max(0, Math.min(1, ratio));
  return durationSeconds * clampedRatio;
};
