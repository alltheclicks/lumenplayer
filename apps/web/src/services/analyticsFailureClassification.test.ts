import { describe, expect, it } from 'vitest';
import { isExtensionException, shouldCaptureStructuredFailure } from './analyticsFailureClassification';

describe('crash attribution', () => {
  it('keeps expected access denials out of crash counts while retaining server failures', () => {
    for (const errorCode of ['sso_xtream_subscription_inactive', 'sso_xtream_auth_failed', 'sso_exchange_failed_401', 'sso_exchange_failed_429']) {
      expect(shouldCaptureStructuredFailure('sso.landing_failed', 'error', { errorCode })).toBe(false);
    }
    expect(shouldCaptureStructuredFailure('sso.landing_failed', 'error', { errorCode: 'sso_exchange_failed_502' })).toBe(true);
    expect(shouldCaptureStructuredFailure('playback.error', 'error', { terminal: true, fatal: true })).toBe(true);
  });
  it('requires extension-only evidence and preserves mixed app exceptions', () => {
    expect(isExtensionException(null, 'Error\n at f (chrome-extension://example/200.js:1:2)')).toBe(true);
    expect(isExtensionException('moz-extension://example/code.js')).toBe(true);
    expect(isExtensionException(null, 'Error\n at f (chrome-extension://example/code.js:1:2)\n at app (https://player.exyu.tv/assets/app.js:1:2)')).toBe(false);
    expect(isExtensionException(null, 'TypeError: missing value')).toBe(false);
  });
});
