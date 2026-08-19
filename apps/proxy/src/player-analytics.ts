import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

export const PLAYER_ANALYTICS_COOKIE_NAME = "lumen_player_analytics";
export const PLAYER_ANALYTICS_COOKIE_TTL_SECONDS = 24 * 60 * 60;
export const PLAYER_ANALYTICS_MAX_BATCH_BYTES = 256 * 1024;
export const PLAYER_ANALYTICS_MAX_REPLAY_BYTES = 5 * 1024 * 1024;
export const PLAYER_ANALYTICS_MAX_REPLAY_UNCOMPRESSED_BYTES = 20 * 1024 * 1024;

const BINDING_PREFIX = "pa1.";
const IV_LENGTH_BYTES = 12;
const AUTH_TAG_LENGTH_BYTES = 16;
const REDACTED = "[REDACTED]";
const MAX_DEPTH = 10;
const MAX_OBJECT_KEYS = 200;
const MAX_ARRAY_ITEMS = 500;
const MAX_STRING_LENGTH = 20_000;

const SENSITIVE_KEY_PATTERN = /(?:password|passwd|pwd|credential|authorization|cookie|secret|api[_-]?key|access[_-]?token|refresh[_-]?token|id[_-]?token|sso[_-]?token|stream[_-]?url|source[_-]?url|playback[_-]?url|manifest[_-]?url|request[_-]?headers?|response[_-]?headers?)/i;

const TEXT_REDACTIONS: Array<[RegExp, string]> = [
  [/(\b(?:username|user|password|passwd|pwd|token|access_token|refresh_token|id_token|auth|authorization|api_?key|secret)=)[^&#\s"']*/gi, "$1[REDACTED]"],
  [/(\bBearer\s+)[A-Za-z0-9._~+/-]+=*/gi, "$1[REDACTED]"],
  [/(\/(?:live|movie|series|timeshift|stream)\/)([^/\s?#]+)\/([^/\s?#]+)(\/)/gi, "$1[REDACTED]/[REDACTED]$4"],
  [/(https?:\/\/)([^/@\s:]+):([^/@\s]+)@/gi, "$1[REDACTED]:[REDACTED]@"],
];

export interface PlayerAnalyticsTokenFields {
  subject: string;
  sessionId: string;
  ingestUrl: string;
  replayUrl: string;
}

export interface PlayerAnalyticsBinding {
  subject: string;
  sessionId: string;
  expiresAtSeconds: number;
}

export const isPlayerAnalyticsSubject = (value: unknown): value is string => (
  typeof value === "string" && /^[a-f0-9]{64}$/.test(value)
);

export const isPlayerAnalyticsUuid = (value: unknown): value is string => (
  typeof value === "string" &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
);

const parseHttpsUrl = (value: unknown): string | null => {
  if (typeof value !== "string" || value.length > 2_048) {
    return null;
  }
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || url.hash) {
      return null;
    }
    return url.toString();
  } catch {
    return null;
  }
};

export const parsePlayerAnalyticsTokenFields = (
  value: unknown,
): PlayerAnalyticsTokenFields | null => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  const record = value as Record<string, unknown>;
  const ingestUrl = parseHttpsUrl(record.ingestUrl);
  const replayUrl = parseHttpsUrl(record.replayUrl);
  if (
    !isPlayerAnalyticsSubject(record.subject) ||
    !isPlayerAnalyticsUuid(record.sessionId) ||
    !ingestUrl ||
    !replayUrl
  ) {
    return null;
  }
  return {
    subject: record.subject,
    sessionId: record.sessionId,
    ingestUrl,
    replayUrl,
  };
};

export const analyticsDestinationsMatchEnvironment = (
  analytics: PlayerAnalyticsTokenFields,
  ingestUrl: string | undefined,
  replayUrl: string | undefined,
): boolean => {
  const configuredIngest = parseHttpsUrl(ingestUrl);
  const configuredReplay = parseHttpsUrl(replayUrl);
  return Boolean(
    configuredIngest &&
    configuredReplay &&
    analytics.ingestUrl === configuredIngest &&
    analytics.replayUrl === configuredReplay
  );
};

export const mintPlayerAnalyticsBinding = (
  key: Buffer,
  analytics: Pick<PlayerAnalyticsTokenFields, "subject" | "sessionId">,
  nowSeconds: number,
  ttlSeconds = PLAYER_ANALYTICS_COOKIE_TTL_SECONDS,
): string => {
  const iv = randomBytes(IV_LENGTH_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const plaintext = JSON.stringify({
    sub: analytics.subject,
    sid: analytics.sessionId,
    exp: Math.floor(nowSeconds) + ttlSeconds,
  });
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return `${BINDING_PREFIX}${Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString("base64url")}`;
};

export const parsePlayerAnalyticsBinding = (
  value: string | undefined,
  key: Buffer,
  nowSeconds: number,
): PlayerAnalyticsBinding | null => {
  if (!value?.startsWith(BINDING_PREFIX) || value.length > 1_024) {
    return null;
  }
  let raw: Buffer;
  try {
    raw = Buffer.from(value.slice(BINDING_PREFIX.length), "base64url");
  } catch {
    return null;
  }
  if (raw.length <= IV_LENGTH_BYTES + AUTH_TAG_LENGTH_BYTES) {
    return null;
  }
  try {
    const decipher = createDecipheriv("aes-256-gcm", key, raw.subarray(0, IV_LENGTH_BYTES));
    decipher.setAuthTag(raw.subarray(IV_LENGTH_BYTES, IV_LENGTH_BYTES + AUTH_TAG_LENGTH_BYTES));
    const plaintext = Buffer.concat([
      decipher.update(raw.subarray(IV_LENGTH_BYTES + AUTH_TAG_LENGTH_BYTES)),
      decipher.final(),
    ]).toString("utf8");
    const parsed = JSON.parse(plaintext) as Record<string, unknown>;
    if (
      !isPlayerAnalyticsSubject(parsed.sub) ||
      !isPlayerAnalyticsUuid(parsed.sid) ||
      typeof parsed.exp !== "number" ||
      !Number.isFinite(parsed.exp) ||
      parsed.exp < nowSeconds
    ) {
      return null;
    }
    return {
      subject: parsed.sub,
      sessionId: parsed.sid,
      expiresAtSeconds: parsed.exp,
    };
  } catch {
    return null;
  }
};

export const readCookie = (cookieHeader: string | undefined, name: string): string | undefined => {
  for (const part of (cookieHeader ?? "").split(";")) {
    const separator = part.indexOf("=");
    if (separator < 0 || part.slice(0, separator).trim() !== name) {
      continue;
    }
    return part.slice(separator + 1).trim();
  }
  return undefined;
};

export const serializePlayerAnalyticsCookie = (value: string, secure = true): string => (
  `${PLAYER_ANALYTICS_COOKIE_NAME}=${value}; Max-Age=${PLAYER_ANALYTICS_COOKIE_TTL_SECONDS}; Path=/player-analytics; HttpOnly; SameSite=Strict${secure ? "; Secure" : ""}`
);

export const redactPlayerAnalyticsText = (value: string): string => {
  let sanitized = value.slice(0, MAX_STRING_LENGTH);
  for (const [pattern, replacement] of TEXT_REDACTIONS) {
    sanitized = sanitized.replace(pattern, replacement);
  }
  return sanitized;
};

export const sanitizePlayerAnalyticsValue = (value: unknown, depth = 0): unknown => {
  if (depth > MAX_DEPTH) return "[TRUNCATED]";
  if (value === null || typeof value === "boolean" || typeof value === "number") return value;
  if (typeof value === "string") return redactPlayerAnalyticsText(value);
  if (Array.isArray(value)) {
    return value
      .slice(0, MAX_ARRAY_ITEMS)
      .map((entry) => sanitizePlayerAnalyticsValue(entry, depth + 1));
  }
  if (typeof value === "object") {
    const output: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value).slice(0, MAX_OBJECT_KEYS)) {
      output[key] = SENSITIVE_KEY_PATTERN.test(key)
        ? REDACTED
        : sanitizePlayerAnalyticsValue(entry, depth + 1);
    }
    return output;
  }
  return String(value);
};

export const bindPlayerAnalyticsBatch = (
  value: unknown,
  binding: PlayerAnalyticsBinding,
): Record<string, unknown> | null => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  const sanitized = sanitizePlayerAnalyticsValue(value) as Record<string, unknown>;
  const session = typeof sanitized.session === "object" && sanitized.session !== null && !Array.isArray(sanitized.session)
    ? sanitized.session as Record<string, unknown>
    : {};
  return {
    ...sanitized,
    schemaVersion: 1,
    identity: { analyticsSubject: binding.subject },
    session: { ...session, id: binding.sessionId },
    events: Array.isArray(sanitized.events) ? sanitized.events.slice(0, 100) : [],
    crashes: Array.isArray(sanitized.crashes) ? sanitized.crashes.slice(0, 10) : [],
    feedback: Array.isArray(sanitized.feedback) ? sanitized.feedback.slice(0, 10) : [],
  };
};
