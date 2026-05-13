import { describe, expect, it } from 'vitest';
import { findCatchUpProgramById, findNextCatchUpProgram } from './catchupProgramNavigation';

const buildProgram = ({
  id,
  start,
  end,
  hasCatchUp = true,
}: {
  id: string;
  start: string;
  end: string;
  hasCatchUp?: boolean;
}) => ({
  id,
  title: id,
  description: '',
  startTime: new Date(start),
  endTime: new Date(end),
  category: null,
  isCurrent: false,
  progress: 0,
  hasCatchUp,
  catchUpId: null,
});

describe('catchupProgramNavigation', () => {
  it('finds the active catch-up program by id', () => {
    const programs = [
      buildProgram({
        id: 'program-1',
        start: '2026-04-03T10:00:00.000Z',
        end: '2026-04-03T10:30:00.000Z',
      }),
      buildProgram({
        id: 'program-2',
        start: '2026-04-03T10:30:00.000Z',
        end: '2026-04-03T11:00:00.000Z',
      }),
    ];

    expect(findCatchUpProgramById(programs, 'program-2')?.id).toBe('program-2');
    expect(findCatchUpProgramById(programs, 'missing')).toBeNull();
  });

  it('returns the next archived catch-up program in chronological order', () => {
    const currentProgram = buildProgram({
      id: 'program-2',
      start: '2026-04-03T10:30:00.000Z',
      end: '2026-04-03T11:00:00.000Z',
    });
    const nextProgram = buildProgram({
      id: 'program-3',
      start: '2026-04-03T11:00:00.000Z',
      end: '2026-04-03T11:30:00.000Z',
    });
    const futureProgram = buildProgram({
      id: 'program-4',
      start: '2026-04-03T11:30:00.000Z',
      end: '2026-04-03T12:00:00.000Z',
    });
    const programs = [
      futureProgram,
      currentProgram,
      buildProgram({
        id: 'program-no-catchup',
        start: '2026-04-03T10:00:00.000Z',
        end: '2026-04-03T10:30:00.000Z',
        hasCatchUp: false,
      }),
      nextProgram,
    ];

    expect(
      findNextCatchUpProgram(programs, currentProgram, new Date('2026-04-03T11:45:00.000Z'))?.id,
    ).toBe('program-3');
    expect(
      findNextCatchUpProgram(programs, nextProgram, new Date('2026-04-03T11:15:00.000Z')),
    ).toBeNull();
  });
});
