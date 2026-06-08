import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  M3U_PLAYLIST_STORAGE_KEY,
  XTREAM_CREDENTIALS_STORAGE_KEY,
  hasConfiguredPlaybackSource,
} from './routeGuard';

const createLocalStorageMock = (initial: Record<string, string> = {}) => {
  const store = new Map<string, string>(Object.entries(initial));
  return {
    getItem: (key: string): string | null => store.get(key) ?? null,
    setItem: (key: string, value: string): void => {
      store.set(key, value);
    },
    removeItem: (key: string): void => {
      store.delete(key);
    },
    clear: (): void => {
      store.clear();
    },
  };
};

const stubWindowWithStorage = (initial: Record<string, string>): void => {
  vi.stubGlobal('window', { localStorage: createLocalStorageMock(initial) });
};

describe('routeGuard.hasConfiguredPlaybackSource', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns false when no playback source is stored', () => {
    stubWindowWithStorage({});
    expect(hasConfiguredPlaybackSource()).toBe(false);
  });

  it('returns true when Xtream credentials are stored', () => {
    stubWindowWithStorage({
      [XTREAM_CREDENTIALS_STORAGE_KEY]: JSON.stringify({
        server: 'http://example.test:8080',
        username: 'u',
        password: 'p',
      }),
    });
    expect(hasConfiguredPlaybackSource()).toBe(true);
  });

  it('returns true when an M3U playlist is stored', () => {
    stubWindowWithStorage({
      [M3U_PLAYLIST_STORAGE_KEY]: JSON.stringify({ channels: [{ id: '1' }] }),
    });
    expect(hasConfiguredPlaybackSource()).toBe(true);
  });

  it('treats null/empty JSON payloads as not configured', () => {
    stubWindowWithStorage({
      [XTREAM_CREDENTIALS_STORAGE_KEY]: 'null',
      [M3U_PLAYLIST_STORAGE_KEY]: '""',
    });
    expect(hasConfiguredPlaybackSource()).toBe(false);
  });

  it('treats malformed JSON as not configured (does not throw)', () => {
    stubWindowWithStorage({
      [XTREAM_CREDENTIALS_STORAGE_KEY]: '{not-json',
    });
    expect(hasConfiguredPlaybackSource()).toBe(false);
  });
});
