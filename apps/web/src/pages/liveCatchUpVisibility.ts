import type { PlayerChannel } from '@lumen/types';

export const shouldShowLiveCatchUpSection = (
  channel: Pick<PlayerChannel, 'hasCatchUp'> | null,
  catchUpDayCount: number
): boolean => {
  if (catchUpDayCount > 0) {
    return true;
  }

  return Boolean(channel?.hasCatchUp);
};

export const hasLiveCatchUpEntries = (catchUpDayCount: number): boolean => (
  catchUpDayCount > 0
);
