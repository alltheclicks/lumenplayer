import { describe, expect, it } from 'vitest';
import type { Program } from '@lumen/types';
import {
  canStartLiveTimeshift,
  isLiveTimeshiftActivationKey,
  resolveLiveTimeshiftAvailableDurationSeconds,
  resolveLiveTimeshiftPositionSeconds,
} from './liveTimeshift';

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
    const afterProgramEnd = new Date('2026-02-20T12:00:00.000Z').getTime();
    const beforeTwoMinutes = new Date('2026-02-20T10:01:00.000Z').getTime();

    expect(canStartLiveTimeshift(true, program, afterProgramEnd)).toBe(true);
    expect(canStartLiveTimeshift(false, program)).toBe(false);
    expect(canStartLiveTimeshift(true, null)).toBe(false);
    expect(canStartLiveTimeshift(true, buildProgram({ hasCatchUp: false }), afterProgramEnd)).toBe(false);
    expect(
      canStartLiveTimeshift(true, buildProgram({ hasCatchUp: false }), afterProgramEnd, {
        allowWithoutCurrentProgramArchive: true,
      })
    ).toBe(true);
    expect(canStartLiveTimeshift(true, program, beforeTwoMinutes)).toBe(false);
    expect(canStartLiveTimeshift(true, buildProgram({
      endTime: new Date('2026-02-20T10:00:00.000Z'),
    }), afterProgramEnd)).toBe(false);
  });

  it('resolves timeshift position from live-bar ratio with clamping', () => {
    const program = buildProgram();
    const afterProgramEnd = new Date('2026-02-20T12:00:00.000Z').getTime();
    const halfElapsed = new Date('2026-02-20T10:30:00.000Z').getTime();

    expect(resolveLiveTimeshiftPositionSeconds(program, 0, afterProgramEnd)).toBe(0);
    expect(resolveLiveTimeshiftPositionSeconds(program, 0.5, afterProgramEnd)).toBe(1800);
    expect(resolveLiveTimeshiftPositionSeconds(program, 1, afterProgramEnd)).toBe(3600);
    expect(resolveLiveTimeshiftPositionSeconds(program, -0.2, afterProgramEnd)).toBe(0);
    expect(resolveLiveTimeshiftPositionSeconds(program, 1.5, afterProgramEnd)).toBe(3600);
    expect(resolveLiveTimeshiftPositionSeconds(program, 1, halfElapsed)).toBe(1710);
  });

  it('exposes currently available archive window for in-progress program', () => {
    const program = buildProgram();
    const inProgress = new Date('2026-02-20T10:15:00.000Z').getTime();
    const beforeStart = new Date('2026-02-20T09:55:00.000Z').getTime();
    const afterProgramEnd = new Date('2026-02-20T12:00:00.000Z').getTime();

    expect(resolveLiveTimeshiftAvailableDurationSeconds(program, beforeStart)).toBe(0);
    expect(resolveLiveTimeshiftAvailableDurationSeconds(program, inProgress)).toBe(810);
    expect(resolveLiveTimeshiftAvailableDurationSeconds(program, afterProgramEnd)).toBe(3600);
  });

  it('detects keyboard keys that activate live-bar timeshift', () => {
    expect(isLiveTimeshiftActivationKey('Enter')).toBe(true);
    expect(isLiveTimeshiftActivationKey(' ')).toBe(true);
    expect(isLiveTimeshiftActivationKey('Spacebar')).toBe(true);
    expect(isLiveTimeshiftActivationKey('Escape')).toBe(false);
  });
});
