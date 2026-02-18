import { describe, expect, it } from 'vitest';
import { formatSeriesCountLabel } from '@/pages/seriesCountLabel';

describe('formatSeriesCountLabel', () => {
  it('uses Serbian plural rules for small and large counts', () => {
    expect(formatSeriesCountLabel(0)).toBe('serija');
    expect(formatSeriesCountLabel(1)).toBe('serija');
    expect(formatSeriesCountLabel(2)).toBe('serije');
    expect(formatSeriesCountLabel(4)).toBe('serije');
    expect(formatSeriesCountLabel(5)).toBe('serija');
    expect(formatSeriesCountLabel(11)).toBe('serija');
    expect(formatSeriesCountLabel(12)).toBe('serija');
    expect(formatSeriesCountLabel(14)).toBe('serija');
    expect(formatSeriesCountLabel(21)).toBe('serija');
    expect(formatSeriesCountLabel(22)).toBe('serije');
    expect(formatSeriesCountLabel(24)).toBe('serije');
    expect(formatSeriesCountLabel(25)).toBe('serija');
    expect(formatSeriesCountLabel(101)).toBe('serija');
    expect(formatSeriesCountLabel(102)).toBe('serije');
    expect(formatSeriesCountLabel(112)).toBe('serija');
  });
});

