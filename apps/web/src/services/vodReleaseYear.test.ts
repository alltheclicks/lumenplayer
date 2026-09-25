import { describe, expect, it } from 'vitest';
import { resolveVodReleaseYear } from './vodReleaseYear';

describe('film release years', () => {
  it('uses the release year rather than a catalog insertion timestamp', () => {
    const film = { name: 'Ptice koje ne polete (1997)', added: '1546300800' };
    expect(resolveVodReleaseYear(film)).toBe('1997');
    expect(resolveVodReleaseYear({ name: 'Opasni trag (1984)' })).toBe('1984');
    expect(resolveVodReleaseYear({ name: 'Apsolutnih sto (2001)' })).toBe('2001');
  });
  it('prefers explicit release metadata and omits unknown years', () => {
    expect(resolveVodReleaseYear({ name: '1917', release_date: '2019-12-25' })).toBe('2019');
    expect(resolveVodReleaseYear({ name: '1917' })).toBeUndefined();
    expect(resolveVodReleaseYear({ name: 'Film', year: '1546300800' })).toBeUndefined();
  });
});
