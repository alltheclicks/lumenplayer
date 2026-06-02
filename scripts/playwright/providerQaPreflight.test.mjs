import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  STORAGE_CREDENTIALS_KEY,
  buildPlayerApiUrl,
  redactProviderValue,
  resolveProviderCredentials,
  runProviderQaPreflight,
} from './providerQaPreflight.mjs';

const jsonResponse = (body, options = {}) => new Response(JSON.stringify(body), {
  status: options.status ?? 200,
  statusText: options.statusText,
});

describe('provider QA preflight', () => {
  it('redacts provider credentials from URLs and nested values', () => {
    const redacted = redactProviderValue({
      api: 'https://server.test/player_api.php?username=user1&password=pass1&token=abc123',
      stream: 'https://server.test/live/user1/pass1/123.ts',
      timeshift: 'https://server.test/timeshift_hls/user1/pass1/120/2026-01-01/123.ts',
      basicAuth: 'https://user1:pass1@server.test/player_api.php',
    }, ['user1', 'pass1']);

    expect(JSON.stringify(redacted)).not.toContain('user1');
    expect(JSON.stringify(redacted)).not.toContain('pass1');
    expect(redacted.api).toContain('username=<redacted>');
    expect(redacted.api).toContain('password=<redacted>');
    expect(redacted.stream).toContain('/live/<redacted>/<redacted>/');
    expect(redacted.timeshift).toContain('/timeshift_hls/<redacted>/<redacted>/');
    expect(redacted.basicAuth).toContain('://<redacted>:<redacted>@');
  });

  it('builds the Xtream player API URL with optional action', () => {
    expect(buildPlayerApiUrl({
      server: 'https://server.test',
      username: 'user1',
      password: 'pass1',
    }, 'get_live_streams').toString()).toBe(
      'https://server.test/player_api.php?username=user1&password=pass1&action=get_live_streams'
    );
  });

  it('uses complete environment credentials before storage state', () => {
    const resolved = resolveProviderCredentials({
      VITE_XTREAM_SERVER: 'https://server.test/',
      E2E_XUI_USERNAME: 'user1',
      E2E_XUI_PASSWORD: 'pass1',
    });

    expect(resolved).toEqual({
      source: 'env',
      credentials: {
        server: 'https://server.test',
        username: 'user1',
        password: 'pass1',
      },
    });
  });

  it('loads credentials from Playwright storage state when env is incomplete', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'lumen-provider-preflight-'));
    const storageStatePath = 'storage-state.json';
    writeFileSync(join(cwd, storageStatePath), JSON.stringify({
      origins: [{
        origin: 'http://localhost:8080',
        localStorage: [{
          name: STORAGE_CREDENTIALS_KEY,
          value: JSON.stringify({
            server: 'https://storage.test/',
            username: 'storage-user',
            password: 'storage-pass',
          }),
        }],
      }],
    }), 'utf-8');

    const resolved = resolveProviderCredentials({}, { cwd, storageStatePath });

    expect(resolved).toEqual({
      source: 'storage-state',
      storageStatePath,
      credentials: {
        server: 'https://storage.test',
        username: 'storage-user',
        password: 'storage-pass',
      },
    });
  });

  it('passes when auth succeeds and the live catalog is non-empty', async () => {
    const requests = [];
    const result = await runProviderQaPreflight({
      credentials: {
        server: 'https://server.test',
        username: 'user1',
        password: 'pass1',
      },
      fetchImpl: async (url) => {
        requests.push(url.toString());
        return requests.length === 1
          ? jsonResponse({ user_info: { auth: 1 } })
          : jsonResponse([{ stream_id: 101, name: 'News' }]);
      },
    });

    expect(result.ok).toBe(true);
    expect(result.auth).toMatchObject({ ok: true, status: 200, reason: null });
    expect(result.liveCatalog).toMatchObject({
      ok: true,
      status: 200,
      itemCount: 1,
      reason: null,
    });
    expect(requests[1]).toContain('action=get_live_streams');
    expect(result.requests.authUrl).not.toContain('user1');
    expect(result.requests.liveCatalogUrl).not.toContain('pass1');
  });

  it('fails fast before live catalog when auth is rejected', async () => {
    let calls = 0;
    const result = await runProviderQaPreflight({
      credentials: {
        server: 'https://server.test',
        username: 'user1',
        password: 'pass1',
      },
      fetchImpl: async () => {
        calls += 1;
        return jsonResponse({ user_info: { auth: 0 } });
      },
    });

    expect(calls).toBe(1);
    expect(result.ok).toBe(false);
    expect(result.auth).toMatchObject({ ok: false, status: 200, reason: 'auth_0' });
    expect(result.liveCatalog).toMatchObject({ ok: false, status: null, itemCount: 0 });
  });

  it('requires a non-empty live catalog after auth succeeds', async () => {
    const result = await runProviderQaPreflight({
      credentials: {
        server: 'https://server.test',
        username: 'user1',
        password: 'pass1',
      },
      fetchImpl: async (url) => (
        url.toString().includes('action=get_live_streams')
          ? jsonResponse([])
          : jsonResponse({ user_info: { auth: 1 } })
      ),
    });

    expect(result.ok).toBe(false);
    expect(result.auth.ok).toBe(true);
    expect(result.liveCatalog).toMatchObject({
      ok: false,
      status: 200,
      itemCount: 0,
      reason: 'empty_catalog',
    });
  });
});
