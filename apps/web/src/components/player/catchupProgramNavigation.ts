import type { Program } from '@lumen/types';

type CatchUpProgramLike = Pick<Program, 'id' | 'startTime' | 'endTime' | 'hasCatchUp'>;

export const findCatchUpProgramById = <T extends CatchUpProgramLike>(
  programs: readonly T[],
  programId: string,
): T | null => (
  programs.find((program) => program.id === programId) ?? null
);

export const findNextCatchUpProgram = <T extends CatchUpProgramLike>(
  programs: readonly T[],
  currentProgram: T,
  now: Date = new Date(),
): T | null => {
  const nowMs = now.getTime();

  return programs
    .filter((program) => (
      program.hasCatchUp &&
      program.endTime.getTime() <= nowMs &&
      program.startTime.getTime() > currentProgram.startTime.getTime()
    ))
    .sort((left, right) => left.startTime.getTime() - right.startTime.getTime())[0] ?? null;
};
