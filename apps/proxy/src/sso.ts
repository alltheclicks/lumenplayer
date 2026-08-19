import { createCipheriv, createDecipheriv, randomBytes, randomUUID } from "node:crypto";
import {
  parsePlayerAnalyticsTokenFields,
  type PlayerAnalyticsTokenFields,
} from "./player-analytics.js";

// Player SSO token exchange (exyu.tv -> player.exyu.tv hand-off).
//
// exyu.tv mints a short-lived AES-256-GCM token carrying the viewer's Xtream
// credentials and redirects the browser to `/sso#token=<t>`. The SPA POSTs the
// token to `/sso/exchange` on this proxy, which decrypts it with the shared
// `PLAYER_SSO_SECRET` and returns the credentials. The token format must stay
// in lockstep with the minting side (exyu-tv-nextjs `api/player-sso`).
//
// Wire format: "lps1." + base64url(iv[12] || authTag[16] || ciphertext)
// Plaintext:   JSON {"u": username, "p": password, "mode": "full" | "info_only",
//                    "iat": s, "exp": s, "jti": uuid}

export const SSO_TOKEN_PREFIX = "lps1.";
export const SSO_TOKEN_MAX_LENGTH = 2048;

const SSO_KEY_LENGTH_BYTES = 32;
const SSO_IV_LENGTH_BYTES = 12;
const SSO_AUTH_TAG_LENGTH_BYTES = 16;

export const SSO_DEFAULT_TOKEN_TTL_SECONDS = 60;
export const SSO_MAX_TOKEN_TTL_SECONDS = 300;
export const SSO_CLOCK_SKEW_SECONDS = 30;

export type SsoTokenErrorCode =
  | "malformed"
  | "bad_signature"
  | "invalid_payload"
  | "expired"
  | "not_yet_valid";

export interface SsoTokenPayload {
  username: string;
  password: string;
  accessMode: "full" | "info_only";
  issuedAtSeconds: number;
  expiresAtSeconds: number;
  jti: string;
  analytics?: PlayerAnalyticsTokenFields;
}

export type SsoTokenResult =
  | { ok: true; payload: SsoTokenPayload }
  | { ok: false; error: SsoTokenErrorCode };

export const parseSsoSecret = (value: string | undefined): Buffer | null => {
  const normalized = value?.trim() ?? "";
  if (!/^[0-9a-fA-F]{64}$/.test(normalized)) {
    return null;
  }

  const key = Buffer.from(normalized, "hex");
  return key.length === SSO_KEY_LENGTH_BYTES ? key : null;
};

export const mintSsoToken = (
  key: Buffer,
  options: {
    username: string;
    password: string;
    nowSeconds: number;
    ttlSeconds?: number;
    jti?: string;
    accessMode?: "full" | "info_only";
    analytics?: PlayerAnalyticsTokenFields;
  },
): string => {
  const issuedAtSeconds = Math.floor(options.nowSeconds);
  const ttlSeconds = options.ttlSeconds ?? SSO_DEFAULT_TOKEN_TTL_SECONDS;
  const payload = JSON.stringify({
    u: options.username,
    p: options.password,
    mode: options.accessMode ?? "full",
    iat: issuedAtSeconds,
    exp: issuedAtSeconds + ttlSeconds,
    jti: options.jti ?? randomUUID(),
    ...(options.analytics ? { analytics: options.analytics } : {}),
  });

  const iv = randomBytes(SSO_IV_LENGTH_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(payload, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return `${SSO_TOKEN_PREFIX}${Buffer.concat([iv, authTag, ciphertext]).toString("base64url")}`;
};

const parsePayload = (plaintext: string, nowSeconds: number): SsoTokenResult => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(plaintext);
  } catch {
    return { ok: false, error: "invalid_payload" };
  }

  if (typeof parsed !== "object" || parsed === null) {
    return { ok: false, error: "invalid_payload" };
  }

  const record = parsed as Record<string, unknown>;
  const username = record.u;
  const password = record.p;
  const issuedAtSeconds = record.iat;
  const expiresAtSeconds = record.exp;
  const jti = record.jti;
  const accessMode = record.mode === undefined ? "full" : record.mode;
  const analytics = record.analytics === undefined
    ? undefined
    : parsePlayerAnalyticsTokenFields(record.analytics);

  if (
    typeof username !== "string" || username.length === 0 ||
    typeof password !== "string" || password.length === 0 ||
    typeof issuedAtSeconds !== "number" || !Number.isFinite(issuedAtSeconds) ||
    typeof expiresAtSeconds !== "number" || !Number.isFinite(expiresAtSeconds) ||
    typeof jti !== "string" || jti.length === 0 || jti.length > 128 ||
    (accessMode !== "full" && accessMode !== "info_only") ||
    (record.analytics !== undefined && !analytics)
  ) {
    return { ok: false, error: "invalid_payload" };
  }

  if (expiresAtSeconds - issuedAtSeconds > SSO_MAX_TOKEN_TTL_SECONDS) {
    return { ok: false, error: "invalid_payload" };
  }

  if (issuedAtSeconds > nowSeconds + SSO_CLOCK_SKEW_SECONDS) {
    return { ok: false, error: "not_yet_valid" };
  }

  if (expiresAtSeconds < nowSeconds - SSO_CLOCK_SKEW_SECONDS) {
    return { ok: false, error: "expired" };
  }

  return {
    ok: true,
    payload: {
      username,
      password,
      accessMode,
      issuedAtSeconds,
      expiresAtSeconds,
      jti,
      ...(analytics ? { analytics } : {}),
    },
  };
};

export const decryptSsoToken = (
  token: string,
  key: Buffer,
  nowSeconds: number,
): SsoTokenResult => {
  if (
    typeof token !== "string" ||
    token.length > SSO_TOKEN_MAX_LENGTH ||
    !token.startsWith(SSO_TOKEN_PREFIX)
  ) {
    return { ok: false, error: "malformed" };
  }

  let raw: Buffer;
  try {
    raw = Buffer.from(token.slice(SSO_TOKEN_PREFIX.length), "base64url");
  } catch {
    return { ok: false, error: "malformed" };
  }

  if (raw.length <= SSO_IV_LENGTH_BYTES + SSO_AUTH_TAG_LENGTH_BYTES) {
    return { ok: false, error: "malformed" };
  }

  const iv = raw.subarray(0, SSO_IV_LENGTH_BYTES);
  const authTag = raw.subarray(SSO_IV_LENGTH_BYTES, SSO_IV_LENGTH_BYTES + SSO_AUTH_TAG_LENGTH_BYTES);
  const ciphertext = raw.subarray(SSO_IV_LENGTH_BYTES + SSO_AUTH_TAG_LENGTH_BYTES);

  let plaintext: string;
  try {
    const decipher = createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(authTag);
    plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
  } catch {
    // GCM auth-tag mismatch: wrong key or tampered token.
    return { ok: false, error: "bad_signature" };
  }

  return parsePayload(plaintext, nowSeconds);
};

export interface SsoReplayCache {
  /** Returns false when the jti was already redeemed. */
  checkAndRemember(jti: string, expiresAtSeconds: number, nowSeconds: number): boolean;
  size(): number;
}

export const createSsoReplayCache = (maxEntries = 10_000): SsoReplayCache => {
  const redeemed = new Map<string, number>();

  const sweep = (nowSeconds: number): void => {
    for (const [jti, expiresAtSeconds] of redeemed) {
      if (expiresAtSeconds + SSO_CLOCK_SKEW_SECONDS < nowSeconds) {
        redeemed.delete(jti);
      }
    }
  };

  return {
    checkAndRemember: (jti, expiresAtSeconds, nowSeconds) => {
      if (redeemed.has(jti)) {
        return false;
      }

      if (redeemed.size >= maxEntries) {
        sweep(nowSeconds);
      }
      while (redeemed.size >= maxEntries) {
        // Still saturated after the sweep: drop the oldest insertions. Tokens
        // are minted with a <=300s TTL, so this only matters under abuse.
        const oldest = redeemed.keys().next();
        if (oldest.done) {
          break;
        }
        redeemed.delete(oldest.value);
      }

      redeemed.set(jti, expiresAtSeconds);
      return true;
    },
    size: () => redeemed.size,
  };
};

export interface IpRateLimiter {
  /** Returns false when the client exceeded its per-window budget. */
  consume(clientKey: string, nowMs: number): boolean;
}

export const createIpRateLimiter = (options: {
  limitPerWindow: number;
  windowMs?: number;
  maxClients?: number;
}): IpRateLimiter => {
  const windowMs = options.windowMs ?? 60_000;
  const maxClients = options.maxClients ?? 10_000;
  const clients = new Map<string, { windowStartMs: number; count: number }>();

  return {
    consume: (clientKey, nowMs) => {
      const existing = clients.get(clientKey);
      if (!existing || nowMs - existing.windowStartMs >= windowMs) {
        if (!existing && clients.size >= maxClients) {
          for (const [key, entry] of clients) {
            if (nowMs - entry.windowStartMs >= windowMs) {
              clients.delete(key);
            }
          }
          if (clients.size >= maxClients) {
            // Fail closed for brand-new clients while saturated.
            return false;
          }
        }
        clients.set(clientKey, { windowStartMs: nowMs, count: 1 });
        return options.limitPerWindow >= 1;
      }

      existing.count += 1;
      return existing.count <= options.limitPerWindow;
    },
  };
};
