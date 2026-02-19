import { describe, expect, it } from 'vitest';
import type { PlayerChannel, Program } from '@lumen/types';
import { resolveCatchUpEmptyStateReason } from './catchUpEmptyState';

const buildProgram = (overrides: Partial<Program>): Program => ({
  id: overrides.id ?? 'program-1',
  title: overrides.title ?? 'Program',
  description: overrides.description ?? '',
  startTime: overrides.startTime ?? new Date('2026-02-19T09:00:00.000Z'),
  endTime: overrides.endTime ?? new Date('2026-02-19T10:00:00.000Z'),
  category: overrides.category ?? 'show',
  hasCatchUp: overrides.hasCatchUp ?? false,
});

const buildChannelSnapshot = (
  overrides: Partial<Pick<PlayerChannel, 'hasCatchUp' | 'catchUpDays' | 'epg'>> = {}
): Pick<PlayerChannel, 'hasCatchUp' | 'catchUpDays' | 'epg'> => ({
  hasCatchUp: overrides.hasCatchUp ?? true,
  catchUpDays: overrides.catchUpDays ?? 7,
  epg: overrides.epg ?? [],
});

describe('resolveCatchUpEmptyStateReason', () => {
  it('explains when catch-up is disabled for channel/package', () => {
    const reason = resolveCatchUpEmptyStateReason(
      buildChannelSnapshot({ hasCatchUp: false, catchUpDays: 0 }),
      new Date('2026-02-19T12:00:00.000Z')
    );

    expect(reason.title).toBe('TV Unazad nije podržan');
  });

  it('explains when EPG metadata is missing', () => {
    const reason = resolveCatchUpEmptyStateReason(
      buildChannelSnapshot({ epg: [] }),
      new Date('2026-02-19T12:00:00.000Z')
    );

    expect(reason.title).toBe('Nema EPG podataka');
  });

  it('explains when past programs exist but provider did not expose archives', () => {
    const reason = resolveCatchUpEmptyStateReason(
      buildChannelSnapshot({
        epg: [
          buildProgram({
            id: 'past-no-archive',
            hasCatchUp: false,
            startTime: new Date('2026-02-19T07:00:00.000Z'),
            endTime: new Date('2026-02-19T08:00:00.000Z'),
          }),
        ],
      }),
      new Date('2026-02-19T12:00:00.000Z')
    );

    expect(reason.title).toBe('Snimci nisu dostupni');
  });
});
