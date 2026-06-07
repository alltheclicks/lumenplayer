import { describe, expect, it } from 'vitest';
import { XTREAM_SERVER_URL, isServerConfigured } from '@/config/xtream';
import { resolveConfiguredXtreamCredentials } from './xtreamCredentials';

describe('resolveConfiguredXtreamCredentials', () => {
  it('keeps the configured Xtream server authoritative over provider server_info redirects', () => {
    const credentials = {
      server: 'http://smart.mediaking.fi:8080',
      username: 'user',
      password: 'pass',
    };

    const resolved = resolveConfiguredXtreamCredentials(credentials);

    if (isServerConfigured()) {
      expect(resolved).toEqual({
        ...credentials,
        server: XTREAM_SERVER_URL,
      });
      return;
    }

    expect(resolved).toBe(credentials);
  });
});
