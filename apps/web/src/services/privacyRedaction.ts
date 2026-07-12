const REDACTED = '[REDACTED]';
const MAX_DEPTH = 10;
const MAX_COLLECTION_ENTRIES = 500;
const MAX_STRING_LENGTH = 20_000;

const normalizeFieldName = (fieldName: string): string => (
  fieldName
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .toLowerCase()
);

const isSensitiveFieldName = (fieldName: string): boolean => {
  const normalized = normalizeFieldName(fieldName);
  return /(^|_)(password|passwd|pwd|token|secret|authorization|cookie|credentials?|username|email|api_key|stream_url|source_url|playback_url|manifest_url|request_headers?|response_headers?)($|_)/.test(normalized);
};

export const redactSensitiveText = (value: string): string => {
  const redacted = value
    // URL basic-auth credentials.
    .replace(/(https?:\/\/)[^/\s:@"']+:[^@/\s"']+@/gi, `$1${REDACTED}@`)
    // Xtream live/VOD/series and legacy timeshift path credentials.
    .replace(
      /(\/(?:live|movie|series|timeshifts?|timeshift_hls)\/)[^/?#\s"']+\/[^/?#\s"']+/gi,
      `$1${REDACTED}/${REDACTED}`,
    )
    // Query-string credentials and bearer-style provider/session tokens.
    .replace(
      /([?&](?:user(?:name)?|password|passwd|pwd|token|access_token|refresh_token|id_token|auth|authorization|api_?key|secret|session)=)[^&#\s"']*/gi,
      `$1${REDACTED}`,
    )
    // SSO tokens are carried in fragments and must never reach diagnostics.
    .replace(
      /(#(?:token|access_token|refresh_token|id_token)=)[^&\s"']*/gi,
      `$1${REDACTED}`,
    )
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, `Bearer ${REDACTED}`)
    // Email addresses are account identifiers even when no password is present.
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, REDACTED);

  if (redacted.length <= MAX_STRING_LENGTH) {
    return redacted;
  }
  return `${redacted.slice(0, MAX_STRING_LENGTH)}[TRUNCATED]`;
};

const sanitizeValue = (
  value: unknown,
  depth: number,
  seen: WeakSet<object>,
): unknown => {
  if (value === null || typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'string') {
    return redactSensitiveText(value);
  }
  if (typeof value === 'bigint') {
    return value.toString();
  }
  if (typeof value === 'undefined' || typeof value === 'function' || typeof value === 'symbol') {
    return undefined;
  }
  if (typeof value !== 'object') {
    return redactSensitiveText(String(value));
  }
  if (depth >= MAX_DEPTH) {
    return '[TRUNCATED]';
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (seen.has(value)) {
    return '[CIRCULAR]';
  }

  seen.add(value);
  if (Array.isArray(value)) {
    const sanitized = value
      .slice(0, MAX_COLLECTION_ENTRIES)
      .map((entry) => sanitizeValue(entry, depth + 1, seen));
    seen.delete(value);
    return sanitized;
  }

  const output: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value).slice(0, MAX_COLLECTION_ENTRIES)) {
    if (isSensitiveFieldName(key)) {
      output[key] = REDACTED;
      continue;
    }
    const sanitized = sanitizeValue(entry, depth + 1, seen);
    if (sanitized !== undefined) {
      output[key] = sanitized;
    }
  }
  seen.delete(value);
  return output;
};

export const sanitizeTelemetryRecord = (
  value: Record<string, unknown>,
): Record<string, unknown> => (
  sanitizeValue(value, 0, new WeakSet<object>()) as Record<string, unknown>
);
