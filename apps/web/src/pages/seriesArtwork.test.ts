import { describe, expect, it } from 'vitest';
import { resolveSeriesArtworkUrl, resolveSeriesBackdropUrl } from '@/pages/seriesArtwork';

describe('seriesArtwork', () => {
  it('uses fallback artwork fields when cover is missing', () => {
    expect(
      resolveSeriesArtworkUrl({
        cover: '',
        cover_big: 'https:\\/\\/cdn.example.com\\/show-cover.jpg',
      })
    ).toBe('https://cdn.example.com/show-cover.jpg');
  });

  it('ignores provider placeholder values and picks next valid field', () => {
    expect(
      resolveSeriesArtworkUrl({
        cover: 'null',
        cover_big: 'N/A',
        movie_image: 'https://cdn.example.com/show-poster.png',
      })
    ).toBe('https://cdn.example.com/show-poster.png');
  });

  it('reads backdrop URL from array-like payloads', () => {
    expect(
      resolveSeriesBackdropUrl({
        backdrop_path: ['https://cdn.example.com/backdrop.jpg'],
      })
    ).toBe('https://cdn.example.com/backdrop.jpg');

    expect(
      resolveSeriesBackdropUrl({
        backdrop_path: '["https://cdn.example.com/backdrop-2.jpg"]',
      })
    ).toBe('https://cdn.example.com/backdrop-2.jpg');
  });

  it('extracts artwork from JSON object payloads and quoted URLs', () => {
    expect(
      resolveSeriesArtworkUrl({
        cover: '{"url":"https:\\/\\/cdn.example.com\\/show-cover-3.jpg"}',
      })
    ).toBe('https://cdn.example.com/show-cover-3.jpg');

    expect(
      resolveSeriesArtworkUrl({
        cover: '"https://cdn.example.com/show-cover-4.jpg"',
      })
    ).toBe('https://cdn.example.com/show-cover-4.jpg');
  });

  it('falls back to poster artwork when backdrop field is unavailable', () => {
    expect(
      resolveSeriesBackdropUrl({
        cover_big: 'https://cdn.example.com/fallback-backdrop.jpg',
      })
    ).toBe('https://cdn.example.com/fallback-backdrop.jpg');
  });
});
