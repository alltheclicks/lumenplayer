const EXPECTED_ACCESS_FAILURES = new Set([
  'sso_xtream_subscription_inactive', 'sso_xtream_auth_failed',
  'sso_exchange_failed_401', 'sso_exchange_failed_403', 'sso_exchange_failed_429',
]);

export const shouldCaptureStructuredFailure = (name: string, severity: string, metadata: Record<string, unknown>): boolean => {
  if (name === 'sso.landing_failed') return !EXPECTED_ACCESS_FAILURES.has(String(metadata.errorCode));
  if (name === 'catalog.error') return severity === 'error';
  return name === 'playback.error' && metadata.terminal === true && metadata.fatal === true;
};

/** Only attribute a global exception to an extension when its origin proves it. */
export const isExtensionException = (filename: unknown, stack?: string): boolean => {
  const extensionUrl = /^(?:chrome|moz|safari-web)-extension:\/\//;
  if (typeof filename === 'string' && extensionUrl.test(filename)) return true;
  const urls = stack?.match(/(?:https?|(?:chrome|moz|safari-web)-extension):\/\/[^\s)]+/g) ?? [];
  return urls.length > 0 && urls.every(url => extensionUrl.test(url));
};
