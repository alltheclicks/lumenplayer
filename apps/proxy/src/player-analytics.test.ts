import { gunzipSync, gzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { createProxyServer } from './server.js';
import { mintSsoToken, parseSsoSecret } from './sso.js';
import {
  PLAYER_ANALYTICS_COOKIE_NAME,
  analyticsDestinationsMatchEnvironment,
  bindPlayerAnalyticsBatch,
  mintPlayerAnalyticsBinding,
  parsePlayerAnalyticsBinding,
  parsePlayerAnalyticsTokenFields,
  sanitizePlayerAnalyticsValue,
} from './player-analytics.js';

const SSO_SECRET = 'a'.repeat(64);
const INGEST_SECRET = 'analytics-secret-that-is-longer-than-32-characters';
const SUBJECT = 'b'.repeat(64);
const SESSION_ID = '11111111-1111-4111-8111-111111111111';
const REPLAY_ID = '22222222-2222-4222-8222-222222222222';
const INGEST_URL = 'https://exyu.tv/api/internal/player-analytics/ingest';
const REPLAY_URL = 'https://exyu.tv/api/internal/player-analytics/replay';

const analyticsFields = {
  subject: SUBJECT,
  sessionId: SESSION_ID,
  ingestUrl: INGEST_URL,
  replayUrl: REPLAY_URL,
};

describe('player analytics security primitives', () => {
  it('strictly validates the optional SSO analytics contract and destinations', () => {
    expect(parsePlayerAnalyticsTokenFields(analyticsFields)).toEqual(analyticsFields);
    expect(parsePlayerAnalyticsTokenFields({ ...analyticsFields, subject: 'viewer@example.com' })).toBeNull();
    expect(parsePlayerAnalyticsTokenFields({ ...analyticsFields, sessionId: 'session-1' })).toBeNull();
    expect(parsePlayerAnalyticsTokenFields({ ...analyticsFields, ingestUrl: 'http://exyu.tv/ingest' })).toBeNull();
    expect(parsePlayerAnalyticsTokenFields({ ...analyticsFields, replayUrl: 'javascript:alert(1)' })).toBeNull();
    expect(analyticsDestinationsMatchEnvironment(analyticsFields, INGEST_URL, REPLAY_URL)).toBe(true);
    expect(analyticsDestinationsMatchEnvironment(analyticsFields, 'https://evil.example/ingest', REPLAY_URL)).toBe(false);
  });

  it('encrypts, authenticates and expires the browser binding', () => {
    const key = parseSsoSecret(SSO_SECRET)!;
    const binding = mintPlayerAnalyticsBinding(key, analyticsFields, 1_000, 60);
    expect(parsePlayerAnalyticsBinding(binding, key, 1_059)).toMatchObject({
      subject: SUBJECT,
      sessionId: SESSION_ID,
    });
    expect(parsePlayerAnalyticsBinding(binding, key, 1_061)).toBeNull();
    const encoded = binding.slice('pa1.'.length);
    const tamperedBytes = Buffer.from(encoded, 'base64url');
    tamperedBytes[tamperedBytes.length - 1] ^= 0xff;
    const tampered = `pa1.${tamperedBytes.toString('base64url')}`;
    expect(parsePlayerAnalyticsBinding(tampered, key, 1_001)).toBeNull();
  });

  it('redacts nested credentials, media URLs, headers and replay custom events', () => {
    const sanitized = sanitizePlayerAnalyticsValue({
      searchText: 'sportski kanali',
      password: 'plain-password',
      nested: [{
        requestHeaders: { authorization: 'Bearer abc.def' },
        sourceUrl: 'https://provider.example/live/viewer/pass/123.m3u8',
        customEvent: 'failed /stream/viewer/pass/123.ts?token=edge-secret',
      }],
    });
    const serialized = JSON.stringify(sanitized);
    expect(serialized).toContain('sportski kanali');
    expect(serialized).not.toContain('plain-password');
    expect(serialized).not.toContain('viewer/pass');
    expect(serialized).not.toContain('edge-secret');
    expect(serialized).not.toContain('abc.def');
  });

  it('overwrites browser-supplied identity and session values', () => {
    const bound = bindPlayerAnalyticsBatch({
      schemaVersion: 1,
      identity: { analyticsSubject: 'c'.repeat(64) },
      session: { id: '33333333-3333-4333-8333-333333333333', status: 'active' },
      events: [],
    }, {
      subject: SUBJECT,
      sessionId: SESSION_ID,
      expiresAtSeconds: 2_000,
    });
    expect(bound?.identity).toEqual({ analyticsSubject: SUBJECT });
    expect(bound?.session).toMatchObject({ id: SESSION_ID, status: 'active' });
  });
});

describe('player analytics proxy forwarding', () => {
  const createServer = (
    forwarded: Array<{ url: string; init: RequestInit }>,
    envOverrides: NodeJS.ProcessEnv = {},
  ) => createProxyServer({
    allowedHosts: ['*'],
    allowedCorsOrigins: ['https://player.exyu.tv'],
    logger: false,
    sweepIntervalMs: 0,
    env: {
      PLAYER_SSO_SECRET: SSO_SECRET,
      PLAYER_ANALYTICS_INGEST_SECRET: INGEST_SECRET,
      PLAYER_ANALYTICS_INGEST_URL: INGEST_URL,
      PLAYER_ANALYTICS_REPLAY_URL: REPLAY_URL,
      ...envOverrides,
    },
    fetchImpl: async (input, init) => {
      forwarded.push({ url: String(input), init: init ?? {} });
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    },
  });

  const establishBinding = async (app: ReturnType<typeof createProxyServer>): Promise<string> => {
    const token = mintSsoToken(parseSsoSecret(SSO_SECRET)!, {
      username: 'viewer@example.com',
      password: 'xtream-pass',
      nowSeconds: Math.floor(Date.now() / 1_000),
      analytics: analyticsFields,
    });
    const exchange = await app.inject({
      method: 'POST',
      url: '/sso/exchange',
      headers: { origin: 'https://player.exyu.tv' },
      payload: { token },
    });
    expect(exchange.statusCode).toBe(200);
    expect(exchange.json()).toMatchObject({
      analytics: {
        subject: SUBJECT,
        sessionId: SESSION_ID,
        ingestUrl: '/player-analytics/ingest',
        replayUrl: '/player-analytics/replay',
      },
    });
    expect(exchange.headers['set-cookie']).toContain(`${PLAYER_ANALYTICS_COOKIE_NAME}=`);
    return String(exchange.headers['set-cookie']).split(';')[0]!;
  };

  it('requires the SSO binding and forwards a redacted, server-bound batch', async () => {
    const forwarded: Array<{ url: string; init: RequestInit }> = [];
    const app = createServer(forwarded);
    const cookie = await establishBinding(app);

    const missingConfigBinding = await app.inject({
      method: 'GET',
      url: '/player-analytics/config',
      headers: { origin: 'https://player.exyu.tv' },
    });
    expect(missingConfigBinding.statusCode).toBe(401);
    const forbiddenConfigOrigin = await app.inject({
      method: 'GET',
      url: '/player-analytics/config',
      headers: { origin: 'https://evil.example', cookie },
    });
    expect(forbiddenConfigOrigin.statusCode).toBe(403);
    const restoredConfig = await app.inject({
      method: 'GET',
      url: '/player-analytics/config',
      headers: { origin: 'https://player.exyu.tv', cookie },
    });
    expect(restoredConfig.statusCode).toBe(200);
    expect(restoredConfig.json()).toEqual({
      subject: SUBJECT,
      sessionId: SESSION_ID,
      ingestUrl: '/player-analytics/ingest',
      replayUrl: '/player-analytics/replay',
    });

    const unauthorized = await app.inject({
      method: 'POST',
      url: '/player-analytics/ingest',
      headers: { origin: 'https://player.exyu.tv' },
      payload: { schemaVersion: 1 },
    });
    expect(unauthorized.statusCode).toBe(401);

    const response = await app.inject({
      method: 'POST',
      url: '/player-analytics/ingest',
      headers: {
        origin: 'https://player.exyu.tv',
        cookie,
      },
      payload: {
        schemaVersion: 1,
        identity: { analyticsSubject: 'c'.repeat(64) },
        session: { id: '33333333-3333-4333-8333-333333333333', status: 'active' },
        events: [{
          id: '44444444-4444-4444-8444-444444444444',
          occurredAt: new Date().toISOString(),
          name: 'search.changed',
          properties: {
            searchText: 'sportski kanali',
            sourceUrl: 'https://provider.example/live/viewer/pass/1.m3u8',
          },
        }],
      },
    });
    expect(response.statusCode).toBe(202);
    expect(forwarded).toHaveLength(1);
    expect(forwarded[0]?.url).toBe(INGEST_URL);
    expect(new Headers(forwarded[0]?.init.headers).get('authorization')).toBe(`Bearer ${INGEST_SECRET}`);
    const body = JSON.parse(String(forwarded[0]?.init.body)) as Record<string, unknown>;
    expect(body.identity).toEqual({ analyticsSubject: SUBJECT });
    expect(body.session).toMatchObject({ id: SESSION_ID });
    const serialized = JSON.stringify(body);
    expect(serialized).toContain('sportski kanali');
    expect(serialized).not.toContain('viewer/pass');
    await app.close();
  });

  it('decompresses, redacts and re-compresses replay data before forwarding', async () => {
    const forwarded: Array<{ url: string; init: RequestInit }> = [];
    const app = createServer(forwarded);
    const cookie = await establishBinding(app);
    forwarded.length = 0;

    const replay = gzipSync(Buffer.from(JSON.stringify([{
      timestamp: Date.now(),
      type: 5,
      data: {
        tag: 'search',
        payload: 'sportski kanali',
        password: 'should-never-leave',
        message: 'failed /live/viewer/pass/1.m3u8',
      },
    }])));
    const response = await app.inject({
      method: 'POST',
      url: '/player-analytics/replay',
      headers: {
        origin: 'https://player.exyu.tv',
        cookie,
        'content-type': 'application/gzip',
        'content-encoding': 'gzip',
        'x-player-replay-id': REPLAY_ID,
        'x-player-replay-trigger': 'feedback',
      },
      payload: replay,
    });
    expect(response.statusCode).toBe(202);
    expect(forwarded).toHaveLength(1);
    expect(forwarded[0]?.url).toBe(REPLAY_URL);
    const forwardedBody = Buffer.from(await new Response(forwarded[0]?.init.body).arrayBuffer());
    const decoded = gunzipSync(forwardedBody).toString('utf8');
    expect(decoded).toContain('sportski kanali');
    expect(decoded).not.toContain('should-never-leave');
    expect(decoded).not.toContain('viewer/pass');
    const headers = new Headers(forwarded[0]?.init.headers);
    expect(headers.get('x-player-session-id')).toBe(SESSION_ID);
    expect(headers.get('x-player-analytics-subject')).toBe(SUBJECT);
    await app.close();
  });

  it('enforces request size and per-client rate limits before forwarding', async () => {
    const forwarded: Array<{ url: string; init: RequestInit }> = [];
    const app = createServer(forwarded, { LUMEN_PLAYER_ANALYTICS_RATE_LIMIT_PER_MINUTE: '1' });
    const cookie = await establishBinding(app);
    const headers = { origin: 'https://player.exyu.tv', cookie };
    const payload = {
      schemaVersion: 1,
      session: { id: SESSION_ID, status: 'active' },
      events: [],
    };
    const first = await app.inject({ method: 'POST', url: '/player-analytics/ingest', headers, payload });
    const second = await app.inject({ method: 'POST', url: '/player-analytics/ingest', headers, payload });
    expect(first.statusCode).toBe(202);
    expect(second.statusCode).toBe(429);
    await app.close();

    const sizeApp = createServer([]);
    const sizeCookie = await establishBinding(sizeApp);
    const oversized = await sizeApp.inject({
      method: 'POST',
      url: '/player-analytics/ingest',
      headers: {
        origin: 'https://player.exyu.tv',
        cookie: sizeCookie,
        'content-type': 'application/json',
      },
      payload: JSON.stringify({ ...payload, padding: 'x'.repeat(300_000) }),
    });
    expect(oversized.statusCode).toBe(413);
    await sizeApp.close();
  });
});
