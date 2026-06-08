// Synchronous credential presence check for the route guard (M1.2-b).
//
// The app's StorageAdapter API is async, but on web it is a thin wrapper over
// localStorage (VersionedStorage -> WebStorageAdapter). Reading the namespaced
// keys synchronously lets <RequireAuth> decide on the first render with no
// loading flash and no redirect bounce. The key format mirrors
// `VersionedStorage` (`${namespace}:v${version}:${key}`) used in services/storage.ts.

const STORAGE_NAMESPACE = 'lumen-web';
const STORAGE_VERSION = 1;
const PREFIX = `${STORAGE_NAMESPACE}:v${STORAGE_VERSION}:`;

export const XTREAM_CREDENTIALS_STORAGE_KEY = `${PREFIX}xtream_credentials`;
export const M3U_PLAYLIST_STORAGE_KEY = `${PREFIX}m3u_playlist`;

const hasNonEmptyStoredValue = (key: string): boolean => {
  if (typeof window === 'undefined' || !window.localStorage) {
    // Treat SSR / no-storage environments as "configured" so we never trap the
    // user on /login when storage is genuinely unavailable.
    return true;
  }

  try {
    const raw = window.localStorage.getItem(key);
    if (raw === null || raw.length === 0) {
      return false;
    }
    // Stored values are JSON; reject empty/null payloads defensively.
    const parsed = JSON.parse(raw) as unknown;
    return parsed !== null && parsed !== undefined && parsed !== '';
  } catch {
    return false;
  }
};

/**
 * Returns true when the user has any usable playback source configured
 * (an Xtream account or an imported M3U playlist).
 */
export const hasConfiguredPlaybackSource = (): boolean => (
  hasNonEmptyStoredValue(XTREAM_CREDENTIALS_STORAGE_KEY) ||
  hasNonEmptyStoredValue(M3U_PLAYLIST_STORAGE_KEY)
);
