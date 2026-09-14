import { describe, expect, it } from 'vitest';
import { isSsoAccountRejected, ssoFailureDescription } from './ssoFailure';

describe('SSO failure recovery', () => {
  it('does not restore a cached account after an explicit rejection', () => {
    expect(isSsoAccountRejected('sso_xtream_auth_failed')).toBe(true);
    expect(isSsoAccountRejected('sso_xtream_subscription_inactive')).toBe(true);
    expect(isSsoAccountRejected('sso_exchange_failed_502')).toBe(false);
  });
  it('distinguishes rate limiting and service failure from expired links', () => {
    expect(ssoFailureDescription('sso_exchange_failed_429', 'token_exchange')).toContain('Sačekajte');
    expect(ssoFailureDescription('sso_exchange_failed_502', 'token_exchange')).not.toContain('istekao');
    expect(ssoFailureDescription('sso_exchange_failed_401', 'token_exchange')).toContain('novi link');
  });
});
