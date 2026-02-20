import { describe, expect, it } from 'vitest';
import type { Program } from '@lumen/types';
import { canStartLiveTimeshift, resolveLiveTimeshiftPositionSeconds } from './liveTimeshift';

const buildProgram = (overrides: Partial<Program> = {}): Program => ({
  id: 'program-1',
  title: 'Program',
  description: '',
  startTime: new Date('2026-02-20T10:00:00.000Z'),
  endTime: new Date('2026-02-20T11:00:00.000Z'),
  category: 'live',
  hasCatchUp: true,
  ...overrides,
});

describe('liveTimeshift', () => {
  it('allows live timeshift only when catch-up is available and current program is valid', () => {
    const program = buildProgram();

    expect(canStartLiveTimeshift(true, program)).toBe(true);
    expect(canStartLiveTimeshift(false, program)).toBe(false);
    expect(canStartLiveTimeshift(true, null)).toBe(false);
    expect(canStartLiveTimeshift(true, buildProgram({
      endTime: new Date('2026-02-20T10:00:00.000Z'),
    }))).toBe(false);
  });

  it('resolves timeshift position from live-bar ratio with clamping', () => {
    const program = buildProgram();

    expect(resolveLiveTimeshiftPositionSeconds(program, 0)).toBe(0);
    expect(resolveLiveTimeshiftPositionSeconds(program, 0.5)).toBe(1800);
    expect(resolveLiveTimeshiftPositionSeconds(program, 1)).toBe(3600);
    expect(resolveLiveTimeshiftPositionSeconds(program, -0.2)).toBe(0);
    expect(resolveLiveTimeshiftPositionSeconds(program, 1.5)).toBe(3600);
  });
});
