import { describe, expect, it } from 'vitest';
import { formatErrorBoundaryMessage } from './errorBoundaryMessage';

describe('formatErrorBoundaryMessage', () => {
  it('uses an Error message when present', () => {
    expect(formatErrorBoundaryMessage(new Error('boom'))).toBe('boom');
  });

  it('uses a non-empty string thrown value', () => {
    expect(formatErrorBoundaryMessage('plain failure')).toBe('plain failure');
  });

  it('falls back to a generic message for empty/unknown values', () => {
    expect(formatErrorBoundaryMessage(new Error(''))).toBe('Došlo je do neočekivane greške.');
    expect(formatErrorBoundaryMessage('   ')).toBe('Došlo je do neočekivane greške.');
    expect(formatErrorBoundaryMessage(null)).toBe('Došlo je do neočekivane greške.');
    expect(formatErrorBoundaryMessage({ weird: true })).toBe('Došlo je do neočekivane greške.');
  });
});
