import { describe, expect, it } from 'vitest';
import type { Program } from '@lumen/types';
import {
  formatCatchUpDateLabel,
  groupArchivedCatchUpProgramsByDate,
} from './catchUpProgramList';

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
}): Program => ({
  id,
  title: id,
  description: '',
  startTime: new Date(start),
  endTime: new Date(end),
  category: '',
  hasCatchUp,
});

describe('groupArchivedCatchUpProgramsByDate', () => {
  it('keeps only finished archived programs and sorts each day newest first', () => {
    const older = buildProgram({
      id: 'older',
      start: '2026-08-18T08:00:00+02:00',
      end: '2026-08-18T09:00:00+02:00',
    });
    const newer = buildProgram({
      id: 'newer',
      start: '2026-08-18T10:00:00+02:00',
      end: '2026-08-18T11:00:00+02:00',
    });
    const unavailable = buildProgram({
      id: 'unavailable',
      start: '2026-08-18T12:00:00+02:00',
      end: '2026-08-18T13:00:00+02:00',
      hasCatchUp: false,
    });
    const stillLive = buildProgram({
      id: 'still-live',
      start: '2026-08-18T14:00:00+02:00',
      end: '2026-08-18T16:00:00+02:00',
    });
    const invalidDate = buildProgram({
      id: 'invalid-date',
      start: '2026-08-18T17:00:00+02:00',
      end: 'invalid',
    });

    const grouped = groupArchivedCatchUpProgramsByDate(
      [older, stillLive, unavailable, newer, invalidDate],
      new Date('2026-08-18T15:00:00+02:00'),
    );

    expect(Array.from(grouped.values()).flat().map((program) => program.id)).toEqual([
      'newer',
      'older',
    ]);
  });
});

describe('formatCatchUpDateLabel', () => {
  it('uses relative labels for today and yesterday', () => {
    const today = new Date('2026-08-19T15:00:00+02:00');

    expect(formatCatchUpDateLabel(new Date('2026-08-19T08:00:00+02:00'), today)).toBe('Danas');
    expect(formatCatchUpDateLabel(new Date('2026-08-18T08:00:00+02:00'), today)).toBe('Juče');
  });
});
