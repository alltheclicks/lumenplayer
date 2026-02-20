import { describe, expect, it } from 'vitest';
import { hasLiveCatchUpEntries, shouldShowLiveCatchUpSection } from './liveCatchUpVisibility';

describe('liveCatchUpVisibility', () => {
  it('shows TV Unazad section when channel supports catch-up even without entries', () => {
    expect(shouldShowLiveCatchUpSection({ hasCatchUp: true }, 0)).toBe(true);
  });

  it('does not show TV Unazad section when channel has no catch-up and no entries', () => {
    expect(shouldShowLiveCatchUpSection({ hasCatchUp: false }, 0)).toBe(false);
  });

  it('shows TV Unazad section when entries exist regardless of channel flag', () => {
    expect(shouldShowLiveCatchUpSection({ hasCatchUp: false }, 2)).toBe(true);
    expect(shouldShowLiveCatchUpSection(null, 1)).toBe(true);
  });

  it('reports whether catch-up entries exist', () => {
    expect(hasLiveCatchUpEntries(0)).toBe(false);
    expect(hasLiveCatchUpEntries(3)).toBe(true);
  });
});
