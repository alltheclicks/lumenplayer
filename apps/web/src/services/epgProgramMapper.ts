import type { Program, XtreamEPGItem } from '@lumen/types';

const BASE64_PATTERN = /^[A-Za-z0-9+/_-]+={0,2}$/;

const HTML_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  ndash: '–',
  mdash: '—',
  hellip: '…',
  lsquo: '‘',
  rsquo: '’',
  ldquo: '“',
  rdquo: '”',
};

const CP1252_EXTENDED_MAP = new Map<string, number>([
  ['\u20AC', 0x80], // €
  ['\u201A', 0x82], // ‚
  ['\u0192', 0x83], // ƒ
  ['\u201E', 0x84], // „
  ['\u2026', 0x85], // …
  ['\u2020', 0x86], // †
  ['\u2021', 0x87], // ‡
  ['\u02C6', 0x88], // ˆ
  ['\u2030', 0x89], // ‰
  ['\u0160', 0x8A], // Š
  ['\u2039', 0x8B], // ‹
  ['\u0152', 0x8C], // Œ
  ['\u017D', 0x8E], // Ž
  ['\u2018', 0x91], // ‘
  ['\u2019', 0x92], // ’
  ['\u201C', 0x93], // “
  ['\u201D', 0x94], // ”
  ['\u2022', 0x95], // •
  ['\u2013', 0x96], // –
  ['\u2014', 0x97], // —
  ['\u02DC', 0x98], // ˜
  ['\u2122', 0x99], // ™
  ['\u0161', 0x9A], // š
  ['\u203A', 0x9B], // ›
  ['\u0153', 0x9C], // œ
  ['\u017E', 0x9E], // ž
  ['\u0178', 0x9F], // Ÿ
]);

const normalizeWhitespace = (value: string): string => value.replace(/\s+/g, ' ').trim();

const normalizeBase64Value = (value: string): string => {
  const withoutWhitespace = value.replace(/\s+/g, '');
  const normalized = withoutWhitespace
    .replace(/-/g, '+')
    .replace(/_/g, '/');

  const paddingRemainder = normalized.length % 4;
  if (paddingRemainder === 0) {
    return normalized;
  }

  return `${normalized}${'='.repeat(4 - paddingRemainder)}`;
};

const decodeHtmlEntities = (value: string): string => (
  value.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (_, entity: string) => {
    if (entity.startsWith('#x') || entity.startsWith('#X')) {
      const codePoint = Number.parseInt(entity.slice(2), 16);
      return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : `&${entity};`;
    }

    if (entity.startsWith('#')) {
      const codePoint = Number.parseInt(entity.slice(1), 10);
      return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : `&${entity};`;
    }

    const normalizedEntity = entity.toLowerCase();
    return HTML_ENTITIES[normalizedEntity] ?? `&${entity};`;
  })
);

const hasMojibakeMarkers = (value: string): boolean => /[ÃâÐÑ�]/.test(value);

const hasDisallowedControlChars = (value: string): boolean => (
  Array.from(value).some((char) => {
    const codePoint = char.codePointAt(0);
    if (codePoint === undefined) {
      return false;
    }

    return (
      (codePoint >= 0x00 && codePoint <= 0x08) ||
      codePoint === 0x0b ||
      codePoint === 0x0c ||
      (codePoint >= 0x0e && codePoint <= 0x1f)
    );
  })
);

const encodeAsCp1252Bytes = (value: string): Uint8Array | null => {
  const bytes: number[] = [];

  for (const char of value) {
    const codePoint = char.codePointAt(0);
    if (codePoint === undefined) {
      continue;
    }

    if (codePoint <= 0xff) {
      bytes.push(codePoint);
      continue;
    }

    const mappedByte = CP1252_EXTENDED_MAP.get(char);
    if (mappedByte !== undefined) {
      bytes.push(mappedByte);
      continue;
    }

    return null;
  }

  return Uint8Array.from(bytes);
};

const repairMojibake = (value: string): string => {
  if (!hasMojibakeMarkers(value)) {
    return value;
  }

  const bytes = encodeAsCp1252Bytes(value);
  if (!bytes) {
    return value;
  }

  const repaired = new TextDecoder('utf-8', { fatal: false }).decode(bytes).trim();
  if (!repaired) {
    return value;
  }

  const originalMarkers = (value.match(/[ÃâÐÑ�]/g) ?? []).length;
  const repairedMarkers = (repaired.match(/[ÃâÐÑ�]/g) ?? []).length;
  return repairedMarkers < originalMarkers ? repaired : value;
};

const tryDecodeBase64ToUtf8 = (value: string): string | null => {
  const trimmed = value.trim();
  const normalized = normalizeBase64Value(trimmed);

  if (
    normalized.length < 8 ||
    !BASE64_PATTERN.test(normalized) ||
    typeof globalThis.atob !== 'function'
  ) {
    return null;
  }

  try {
    const binary = globalThis.atob(normalized);
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    const decoded = new TextDecoder('utf-8', { fatal: false }).decode(bytes).trim();
    if (!decoded || hasDisallowedControlChars(decoded)) {
      return null;
    }

    return decoded;
  } catch {
    return null;
  }
};

const decodeUnicodeEscapes = (value: string): string => {
  if (!/\\u[0-9a-fA-F]{4}|\\x[0-9a-fA-F]{2}|\\[nrt]/.test(value)) {
    return value;
  }

  return value
    .replace(/\\u([0-9a-fA-F]{4})/g, (_, hex: string) => String.fromCharCode(Number.parseInt(hex, 16)))
    .replace(/\\x([0-9a-fA-F]{2})/g, (_, hex: string) => String.fromCharCode(Number.parseInt(hex, 16)))
    .replace(/\\n/g, '\n')
    .replace(/\\r/g, '\r')
    .replace(/\\t/g, '\t');
};

const tryDecodePercentEncoded = (value: string): string => {
  if (!/%[0-9a-fA-F]{2}/.test(value)) {
    return value;
  }

  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
};

export const normalizeEpgText = (value: string | null | undefined, fallback = ''): string => {
  const initial = typeof value === 'string' ? value.trim() : '';
  if (!initial) {
    return fallback;
  }

  const base64Decoded = tryDecodeBase64ToUtf8(initial);
  const htmlDecoded = decodeHtmlEntities(base64Decoded ?? initial);
  const unescapedText = decodeUnicodeEscapes(htmlDecoded);
  const decodedPercentText = tryDecodePercentEncoded(unescapedText);
  const repairedText = repairMojibake(decodedPercentText);
  const normalized = normalizeWhitespace(repairedText);

  return normalized || fallback;
};

export const parseEpgTimestamp = (timestamp: string, fallback: string): Date => {
  const numericTimestamp = Number(timestamp);
  if (Number.isFinite(numericTimestamp) && numericTimestamp > 0) {
    return new Date(numericTimestamp * 1000);
  }

  const normalizedDate = fallback.replace(' ', 'T');
  const parsedTimestamp = Date.parse(normalizedDate);
  if (!Number.isNaN(parsedTimestamp)) {
    return new Date(parsedTimestamp);
  }

  return new Date();
};

export const mapXtreamEpgItemToProgram = (item: XtreamEPGItem, index: number): Program => {
  const startTime = parseEpgTimestamp(item.start_timestamp, item.start);
  const endTime = parseEpgTimestamp(item.stop_timestamp, item.end);
  const hasArchive = Number(item.has_archive) === 1;

  return {
    id: item.id || item.epg_id || `${item.channel_id}-${index}`,
    title: normalizeEpgText(item.title, 'Untitled Program'),
    description: normalizeEpgText(item.description, ''),
    startTime,
    endTime,
    category: 'show',
    hasCatchUp: hasArchive,
  };
};
