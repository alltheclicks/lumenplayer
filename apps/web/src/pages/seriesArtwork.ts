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

const OBJECT_CANDIDATE_KEYS = [
  'url',
  'src',
  'path',
  'image',
  'cover',
  'cover_big',
  'movie_image',
  'poster',
  'backdrop',
  'backdrop_path',
] as const;

const normalizeArtworkCandidate = (value: string): string => {
  const normalized = value
    .replace(/\\\//g, '/')
    .replace(/&amp;/gi, '&')
    .trim()
    .replace(/^['"]+|['"]+$/g, '');

  if (normalized.startsWith('//')) {
    return `https:${normalized}`;
  }

  return normalized;
};

const isValidArtworkCandidate = (value: string): boolean => {
  const normalized = value.trim().toLowerCase();
  if (EMPTY_ARTWORK_VALUES.has(normalized)) {
    return false;
  }

  return !normalized.startsWith('{') && !normalized.startsWith('[');
};

const toStringCandidates = (value: unknown): string[] => {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) {
      return [];
    }

    if (
      (trimmed.startsWith('[') && trimmed.endsWith(']')) ||
      (trimmed.startsWith('{') && trimmed.endsWith('}')) ||
      (trimmed.startsWith('"') && trimmed.endsWith('"'))
    ) {
      try {
        const parsed = JSON.parse(trimmed);
        const parsedCandidates = toStringCandidates(parsed);
        if (parsedCandidates.length > 0) {
          return parsedCandidates;
        }
      } catch {
        // Keep raw string candidate when provider returns malformed JSON-ish values.
      }
    }

    return [trimmed];
  }

  if (Array.isArray(value)) {
    return value.flatMap((entry) => toStringCandidates(entry));
  }

  if (value && typeof value === 'object') {
    const objectValue = value as Record<string, unknown>;
    const prioritizedCandidates = OBJECT_CANDIDATE_KEYS.flatMap((key) => toStringCandidates(objectValue[key]));
    if (prioritizedCandidates.length > 0) {
      return prioritizedCandidates;
    }

    return Object.values(objectValue).flatMap((entry) => toStringCandidates(entry));
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
): string => {
  const backdrop = resolveArtworkFromKeys(source, SERIES_BACKDROP_KEYS);
  if (backdrop.length > 0) {
    return backdrop;
  }

  return resolveArtworkFromKeys(source, SERIES_ARTWORK_KEYS);
};
