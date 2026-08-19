import { describe, expect, it } from "vitest";
import { createProxyServer } from "./server.js";
import {
  SSO_CLOCK_SKEW_SECONDS,
  SSO_DEFAULT_TOKEN_TTL_SECONDS,
  SSO_MAX_TOKEN_TTL_SECONDS,
  SSO_TOKEN_PREFIX,
  createIpRateLimiter,
  createSsoReplayCache,
  decryptSsoToken,
  mintSsoToken,
  parseSsoSecret,
} from "./sso.js";

const TEST_SECRET_HEX = "a".repeat(64);
const TEST_KEY = parseSsoSecret(TEST_SECRET_HEX)!;
const OTHER_KEY = parseSsoSecret("b".repeat(64))!;
const NOW_SECONDS = 1_780_000_000;
const ANALYTICS_FIELDS = {
  subject: "c".repeat(64),
  sessionId: "11111111-1111-4111-8111-111111111111",
  ingestUrl: "https://exyu.tv/api/internal/player-analytics/ingest",
  replayUrl: "https://exyu.tv/api/internal/player-analytics/replay",
};

const mintTestToken = (overrides: Partial<Parameters<typeof mintSsoToken>[1]> = {}): string => (
  mintSsoToken(TEST_KEY, {
    username: "viewer@example.com",
    password: "xtream-pass",
    nowSeconds: NOW_SECONDS,
    ...overrides,
  })
);

describe("parseSsoSecret", () => {
  it("accepts exactly 64 hex chars and rejects everything else", () => {
    expect(parseSsoSecret(TEST_SECRET_HEX)).toBeInstanceOf(Buffer);
    expect(parseSsoSecret(` ${TEST_SECRET_HEX} `)).toBeInstanceOf(Buffer);
    expect(parseSsoSecret(undefined)).toBeNull();
    expect(parseSsoSecret("")).toBeNull();
    expect(parseSsoSecret("a".repeat(63))).toBeNull();
    expect(parseSsoSecret("a".repeat(65))).toBeNull();
    expect(parseSsoSecret(`${"a".repeat(63)}z`)).toBeNull();
  });
});

describe("mintSsoToken / decryptSsoToken", () => {
  it("round-trips credentials", () => {
    const token = mintTestToken();
    expect(token.startsWith(SSO_TOKEN_PREFIX)).toBe(true);

    const result = decryptSsoToken(token, TEST_KEY, NOW_SECONDS);
    expect(result).toMatchObject({
      ok: true,
      payload: {
        username: "viewer@example.com",
        password: "xtream-pass",
        accessMode: "full",
        issuedAtSeconds: NOW_SECONDS,
        expiresAtSeconds: NOW_SECONDS + SSO_DEFAULT_TOKEN_TTL_SECONDS,
      },
    });
  });

  it("round-trips info-only access and rejects unknown access modes", () => {
    expect(decryptSsoToken(
      mintTestToken({ accessMode: "info_only" }),
      TEST_KEY,
      NOW_SECONDS,
    )).toMatchObject({ ok: true, payload: { accessMode: "info_only" } });

    expect(decryptSsoToken(
      mintTestToken({ accessMode: "admin" as "full" }),
      TEST_KEY,
      NOW_SECONDS,
    )).toEqual({ ok: false, error: "invalid_payload" });
  });

  it("keeps legacy tokens compatible and strictly validates optional analytics fields", () => {
    const legacy = decryptSsoToken(mintTestToken(), TEST_KEY, NOW_SECONDS);
    expect(legacy.ok && legacy.payload.analytics).toBeUndefined();

    const withAnalytics = decryptSsoToken(
      mintTestToken({ analytics: ANALYTICS_FIELDS }),
      TEST_KEY,
      NOW_SECONDS,
    );
    expect(withAnalytics).toMatchObject({ ok: true, payload: { analytics: ANALYTICS_FIELDS } });

    const invalid = mintTestToken({
      analytics: { ...ANALYTICS_FIELDS, subject: "viewer@example.com" },
    });
    expect(decryptSsoToken(invalid, TEST_KEY, NOW_SECONDS)).toEqual({
      ok: false,
      error: "invalid_payload",
    });
  });

  it("rejects a token decrypted with the wrong key", () => {
    const result = decryptSsoToken(mintTestToken(), OTHER_KEY, NOW_SECONDS);
    expect(result).toEqual({ ok: false, error: "bad_signature" });
  });

  it("rejects a tampered token", () => {
    const token = mintTestToken();
    const raw = Buffer.from(token.slice(SSO_TOKEN_PREFIX.length), "base64url");
    raw[raw.length - 1] ^= 0xff;
    const tampered = `${SSO_TOKEN_PREFIX}${raw.toString("base64url")}`;

    expect(decryptSsoToken(tampered, TEST_KEY, NOW_SECONDS)).toEqual({
      ok: false,
      error: "bad_signature",
    });
  });

  it("rejects malformed tokens", () => {
    expect(decryptSsoToken("", TEST_KEY, NOW_SECONDS)).toEqual({ ok: false, error: "malformed" });
    expect(decryptSsoToken("not-a-token", TEST_KEY, NOW_SECONDS)).toEqual({ ok: false, error: "malformed" });
    expect(decryptSsoToken(`${SSO_TOKEN_PREFIX}AAAA`, TEST_KEY, NOW_SECONDS)).toEqual({
      ok: false,
      error: "malformed",
    });
    expect(decryptSsoToken(`${SSO_TOKEN_PREFIX}${"A".repeat(4096)}`, TEST_KEY, NOW_SECONDS)).toEqual({
      ok: false,
      error: "malformed",
    });
  });

  it("expires tokens after their TTL plus skew", () => {
    const token = mintTestToken();
    const stillValidAt = NOW_SECONDS + SSO_DEFAULT_TOKEN_TTL_SECONDS + SSO_CLOCK_SKEW_SECONDS;
    expect(decryptSsoToken(token, TEST_KEY, stillValidAt).ok).toBe(true);
    expect(decryptSsoToken(token, TEST_KEY, stillValidAt + 1)).toEqual({
      ok: false,
      error: "expired",
    });
  });

  it("tolerates clock skew for freshly minted tokens but rejects far-future ones", () => {
    const skewedToken = mintTestToken({ nowSeconds: NOW_SECONDS + SSO_CLOCK_SKEW_SECONDS });
    expect(decryptSsoToken(skewedToken, TEST_KEY, NOW_SECONDS).ok).toBe(true);

    const futureToken = mintTestToken({ nowSeconds: NOW_SECONDS + SSO_CLOCK_SKEW_SECONDS + 1 });
    expect(decryptSsoToken(futureToken, TEST_KEY, NOW_SECONDS)).toEqual({
      ok: false,
      error: "not_yet_valid",
    });
  });

  it("rejects payloads with an oversized TTL", () => {
    const token = mintTestToken({ ttlSeconds: SSO_MAX_TOKEN_TTL_SECONDS + 1 });
    expect(decryptSsoToken(token, TEST_KEY, NOW_SECONDS)).toEqual({
      ok: false,
      error: "invalid_payload",
    });
  });
});

describe("createSsoReplayCache", () => {
  it("accepts a jti once and rejects replays", () => {
    const cache = createSsoReplayCache();
    expect(cache.checkAndRemember("jti-1", NOW_SECONDS + 60, NOW_SECONDS)).toBe(true);
    expect(cache.checkAndRemember("jti-1", NOW_SECONDS + 60, NOW_SECONDS)).toBe(false);
    expect(cache.checkAndRemember("jti-2", NOW_SECONDS + 60, NOW_SECONDS)).toBe(true);
  });

  it("sweeps expired entries when saturated instead of growing unbounded", () => {
    const cache = createSsoReplayCache(2);
    expect(cache.checkAndRemember("jti-1", NOW_SECONDS + 10, NOW_SECONDS)).toBe(true);
    expect(cache.checkAndRemember("jti-2", NOW_SECONDS + 10, NOW_SECONDS)).toBe(true);

    const later = NOW_SECONDS + 10 + SSO_CLOCK_SKEW_SECONDS + 1;
    expect(cache.checkAndRemember("jti-3", later + 60, later)).toBe(true);
    expect(cache.size()).toBeLessThanOrEqual(2);
  });

  it("evicts the oldest live entry when saturated with unexpired tokens", () => {
    const cache = createSsoReplayCache(2);
    cache.checkAndRemember("jti-1", NOW_SECONDS + 300, NOW_SECONDS);
    cache.checkAndRemember("jti-2", NOW_SECONDS + 300, NOW_SECONDS);
    expect(cache.checkAndRemember("jti-3", NOW_SECONDS + 300, NOW_SECONDS)).toBe(true);
    expect(cache.size()).toBe(2);
  });
});

describe("createIpRateLimiter", () => {
  it("enforces the per-window budget and resets on a new window", () => {
    const limiter = createIpRateLimiter({ limitPerWindow: 2, windowMs: 60_000 });
    expect(limiter.consume("1.2.3.4", 0)).toBe(true);
    expect(limiter.consume("1.2.3.4", 1_000)).toBe(true);
    expect(limiter.consume("1.2.3.4", 2_000)).toBe(false);
    expect(limiter.consume("5.6.7.8", 2_000)).toBe(true);
    expect(limiter.consume("1.2.3.4", 61_000)).toBe(true);
  });
});

describe("POST /sso/exchange", () => {
  const createSsoServer = (env: NodeJS.ProcessEnv = {}, allowedCorsOrigins: string[] = []) => (
    createProxyServer({
      allowedHosts: ["*"],
      logger: false,
      sweepIntervalMs: 0,
      allowedCorsOrigins,
      env: { PLAYER_SSO_SECRET: TEST_SECRET_HEX, ...env },
    })
  );

  const liveToken = (): string => (
    mintSsoToken(TEST_KEY, {
      username: "viewer@example.com",
      password: "xtream-pass",
      nowSeconds: Math.floor(Date.now() / 1000),
    })
  );

  it("returns 404 sso_disabled when no secret is configured", async () => {
    const app = createProxyServer({
      allowedHosts: ["*"],
      logger: false,
      sweepIntervalMs: 0,
      env: {},
    });

    const response = await app.inject({
      method: "POST",
      url: "/sso/exchange",
      payload: { token: liveToken() },
    });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({ error: "sso_disabled" });
    await app.close();
  });

  it("exchanges a valid token for credentials exactly once", async () => {
    const app = createSsoServer();
    const token = liveToken();

    const first = await app.inject({ method: "POST", url: "/sso/exchange", payload: { token } });
    expect(first.statusCode).toBe(200);
    expect(first.json()).toEqual({
      username: "viewer@example.com",
      password: "xtream-pass",
      accessMode: "full",
    });
    expect(first.headers["cache-control"]).toBe("no-store");
    expect(first.headers.pragma).toBe("no-cache");
    expect(first.headers["referrer-policy"]).toBe("no-referrer");
    expect(first.headers["x-content-type-options"]).toBe("nosniff");

    const replay = await app.inject({ method: "POST", url: "/sso/exchange", payload: { token } });
    expect(replay.statusCode).toBe(401);
    expect(replay.json()).toEqual({ error: "replayed" });
    await app.close();
  });

  it("rejects invalid bodies and undecryptable tokens", async () => {
    const app = createSsoServer();

    const missing = await app.inject({ method: "POST", url: "/sso/exchange", payload: {} });
    expect(missing.statusCode).toBe(400);
    expect(missing.json()).toEqual({ error: "invalid_request" });

    const garbage = await app.inject({
      method: "POST",
      url: "/sso/exchange",
      payload: { token: "lps1.zzzz" },
    });
    expect(garbage.statusCode).toBe(400);
    expect(garbage.json()).toEqual({ error: "malformed" });

    const wrongKeyToken = mintSsoToken(OTHER_KEY, {
      username: "viewer@example.com",
      password: "xtream-pass",
      nowSeconds: Math.floor(Date.now() / 1000),
    });
    const badSignature = await app.inject({
      method: "POST",
      url: "/sso/exchange",
      payload: { token: wrongKeyToken },
    });
    expect(badSignature.statusCode).toBe(401);
    expect(badSignature.json()).toEqual({ error: "bad_signature" });

    const expired = await app.inject({
      method: "POST",
      url: "/sso/exchange",
      payload: {
        token: mintSsoToken(TEST_KEY, {
          username: "viewer@example.com",
          password: "xtream-pass",
          nowSeconds: Math.floor(Date.now() / 1000) - 600,
        }),
      },
    });
    expect(expired.statusCode).toBe(401);
    expect(expired.json()).toEqual({ error: "expired" });
    await app.close();
  });

  it("rejects cross-origin browser calls when an origin allowlist is configured", async () => {
    const app = createSsoServer({}, ["https://player.exyu.tv"]);

    const forbidden = await app.inject({
      method: "POST",
      url: "/sso/exchange",
      headers: { origin: "https://evil.example" },
      payload: { token: liveToken() },
    });
    expect(forbidden.statusCode).toBe(403);
    expect(forbidden.json()).toEqual({ error: "forbidden_origin" });

    const allowed = await app.inject({
      method: "POST",
      url: "/sso/exchange",
      headers: { origin: "https://player.exyu.tv" },
      payload: { token: liveToken() },
    });
    expect(allowed.statusCode).toBe(200);
    await app.close();
  });

  it("rate limits repeated exchanges per client IP", async () => {
    const app = createSsoServer({ LUMEN_SSO_RATE_LIMIT_PER_MINUTE: "2" });

    const statuses: number[] = [];
    for (let index = 0; index < 3; index += 1) {
      const response = await app.inject({
        method: "POST",
        url: "/sso/exchange",
        payload: { token: liveToken() },
      });
      statuses.push(response.statusCode);
    }

    expect(statuses[0]).toBe(200);
    expect(statuses[1]).toBe(200);
    expect(statuses[2]).toBe(429);

    const limited = await app.inject({
      method: "POST",
      url: "/sso/exchange",
      payload: { token: liveToken() },
    });
    expect(limited.json()).toEqual({ error: "rate_limited" });
    await app.close();
  });

  it("answers the CORS preflight", async () => {
    const app = createSsoServer();
    const response = await app.inject({ method: "OPTIONS", url: "/sso/exchange" });
    expect(response.statusCode).toBe(204);
    expect(response.headers["access-control-allow-methods"]).toBe("OPTIONS,POST");
    await app.close();
  });
});
