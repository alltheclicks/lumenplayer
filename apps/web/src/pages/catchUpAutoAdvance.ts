import type { PlayerChannel } from '@lumen/types';

type CatchUpProgram = PlayerChannel['epg'][number];

export const resolveNextCatchUpProgram = (
  programs: CatchUpProgram[],
  activeProgramId: string | undefined,
): CatchUpProgram | null => {
  if (!activeProgramId) {
    return null;
  }

  const orderedPrograms = [...programs].sort(
    (left, right) => left.startTime.getTime() - right.startTime.getTime()
  );
  const activeIndex = orderedPrograms.findIndex((program) => program.id === activeProgramId);
  if (activeIndex < 0) {
    return null;
  }

  return orderedPrograms[activeIndex + 1] ?? null;
};

