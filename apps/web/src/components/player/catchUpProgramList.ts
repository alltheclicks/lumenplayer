import type { Program } from '@lumen/types';

export const groupArchivedCatchUpProgramsByDate = (
  programs: readonly Program[],
  now = new Date(),
): Map<string, Program[]> => {
  const grouped = new Map<string, Program[]>();

  for (const program of programs) {
    if (!program.hasCatchUp || !(program.endTime < now)) {
      continue;
    }

    const dateKey = program.startTime.toDateString();
    const programsForDate = grouped.get(dateKey);
    if (programsForDate) {
      programsForDate.push(program);
    } else {
      grouped.set(dateKey, [program]);
    }
  }

  for (const programsForDate of grouped.values()) {
    programsForDate.sort((a, b) => b.startTime.getTime() - a.startTime.getTime());
  }

  return grouped;
};

export const formatCatchUpDateLabel = (
  date: Date,
  today = new Date(),
): string => {
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);

  if (date.toDateString() === today.toDateString()) return 'Danas';
  if (date.toDateString() === yesterday.toDateString()) return 'Juče';

  return date.toLocaleDateString('sr-Latn-RS', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  });
};
