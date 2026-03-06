import { describe, expect, it } from 'vitest';
import type { Program } from '@lumen/types';
import { resolveNextCatchUpProgram } from './catchUpAutoAdvance';

const buildProgram = (
  id: string,
  startIso: string,
  endIso: string,
): Program => ({
  id,
  title: id,
  description: id,
  startTime: new Date(startIso),
  endTime: new Date(endIso),
  category: 'test',
  hasCatchUp: true,
});

describe('resolveNextCatchUpProgram', () => {
  it('returns the next program in chronological order', () => {
    const programs: Program[] = [
      buildProgram('p3', '2026-03-01T14:00:00.000Z', '2026-03-01T15:00:00.000Z'),
      buildProgram('p1', '2026-03-01T12:00:00.000Z', '2026-03-01T13:00:00.000Z'),
      buildProgram('p2', '2026-03-01T13:00:00.000Z', '2026-03-01T14:00:00.000Z'),
    ];

    expect(resolveNextCatchUpProgram(programs, 'p1')?.id).toBe('p2');
    expect(resolveNextCatchUpProgram(programs, 'p2')?.id).toBe('p3');
  });

  it('returns null when active program is the latest available one', () => {
    const programs: Program[] = [
      buildProgram('p1', '2026-03-01T12:00:00.000Z', '2026-03-01T13:00:00.000Z'),
      buildProgram('p2', '2026-03-01T13:00:00.000Z', '2026-03-01T14:00:00.000Z'),
    ];

    expect(resolveNextCatchUpProgram(programs, 'p2')).toBeNull();
  });

  it('returns null when active program id is missing or unknown', () => {
    const programs: Program[] = [
      buildProgram('p1', '2026-03-01T12:00:00.000Z', '2026-03-01T13:00:00.000Z'),
    ];

    expect(resolveNextCatchUpProgram(programs, undefined)).toBeNull();
    expect(resolveNextCatchUpProgram(programs, 'missing')).toBeNull();
  });
});

