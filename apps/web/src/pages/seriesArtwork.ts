const EMPTY_ARTWORK_VALUES = new Set([
  '',
  'null',
  'undefined',
  'n/a',
  'na',
  'none',
  'false',
]);

const SERIES_ARTWORK_KEYS = [
  'cover',
  'cover_big',
  'movie_image',
  'stream_icon',
  'poster',
  'icon',
  'image',
] as const;

const SERIES_BACKDROP_KEYS = [
  'backdrop_path',
  'backdrop',
  'backdrop_url',
] as const;

const normalizeArtworkCandidate = (value: string): string => (
  value.replace(/\\\//g, '/').replace(/&amp;/gi, '&').trim()
);

const isValidArtworkCandidate = (value: string): boolean => {
  const normalized = value.trim().toLowerCase();
  return !EMPTY_ARTWORK_VALUES.has(normalized);
};

const toStringCandidates = (value: unknown): string[] => {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) {
      return [];
    }

    if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
      try {
        const parsed = JSON.parse(trimmed);
        if (Array.isArray(parsed)) {
          return parsed.filter((entry): entry is string => typeof entry === 'string');
        }
      } catch {
        // Keep raw string candidate when provider returns malformed JSON-ish values.
      }
    }

    return [trimmed];
  }

  if (Array.isArray(value)) {
    return value.filter((entry): entry is string => typeof entry === 'string');
  }

  return [];
};

const resolveArtworkFromKeys = (
  source: Record<string, unknown>,
  keys: readonly string[]
): string => {
  for (const key of keys) {
    const candidates = toStringCandidates(source[key]);
    for (const candidate of candidates) {
      const normalized = normalizeArtworkCandidate(candidate);
      if (isValidArtworkCandidate(normalized)) {
        return normalized;
      }
    }
  }

  return '';
};

export const resolveSeriesArtworkUrl = (
  source: Record<string, unknown>
): string => (
  resolveArtworkFromKeys(source, SERIES_ARTWORK_KEYS)
);

export const resolveSeriesBackdropUrl = (
  source: Record<string, unknown>
): string => (
  resolveArtworkFromKeys(source, SERIES_BACKDROP_KEYS)
);
