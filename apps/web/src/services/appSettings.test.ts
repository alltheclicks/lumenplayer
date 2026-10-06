// Characterization tests (P4 step 1b): pin settings normalization and theme
// application before the module splits into a portable part (@lumen/storage)
// and a web-only DOM part.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const fixtures = vi.hoisted(() => ({
  records: new Map<string, unknown>(),
  hasStorage: true,
}));

vi.mock('@/services/storage', () => ({
  getAppStorage: () => (fixtures.hasStorage
    ? {
      get: async (key: string) => fixtures.records.get(key) ?? null,
      set: async (key: string, value: unknown) => {
        fixtures.records.set(key, value);
      },
    }
    : null),
}));

import {
  applyThemePreference,
  getDefaultAppSettings,
  initializeThemePreference,
  loadAppSettings,
  saveAppSettings,
  type AppSettings,
} from './appSettings';

const DEFAULTS: AppSettings = {
  theme: 'dark',
  language: 'en',
  player: {
    autoplay: true,
    liveChannelStartMode: 'autoplay',
    defaultVolume: 80,
    preferNativeHls: false,
  },
};

const installDom = (prefersDark: boolean) => {
  const classes = new Set<string>();
  const local = new Map<string, string>();
  vi.stubGlobal('document', {
    documentElement: {
      classList: {
        toggle: (name: string, force: boolean) => {
          if (force) classes.add(name);
          else classes.delete(name);
        },
      },
    },
  });
  vi.stubGlobal('window', {
    matchMedia: () => ({ matches: prefersDark }),
    localStorage: {
      getItem: (key: string) => local.get(key) ?? null,
      setItem: (key: string, value: string) => {
        local.set(key, value);
      },
    },
  });
  return { classes, local };
};

beforeEach(() => {
  fixtures.records.clear();
  fixtures.hasStorage = true;
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('loadAppSettings', () => {
  it('returns the defaults without storage', async () => {
    fixtures.hasStorage = false;

    await expect(loadAppSettings()).resolves.toEqual(DEFAULTS);
    expect(getDefaultAppSettings()).toEqual(DEFAULTS);
  });

  it.each([
    ['nothing stored', null],
    ['a non-object', 'dark'],
  ])('returns the defaults for %s', async (_label, stored) => {
    fixtures.records.set('app_settings', stored);

    await expect(loadAppSettings()).resolves.toEqual(DEFAULTS);
  });

  it('normalizes unknown enum values and clamps/rounds the volume', async () => {
    fixtures.records.set('app_settings', {
      theme: 'sepia',
      language: 'de',
      player: { liveChannelStartMode: 'never', defaultVolume: 140.6 },
    });

    await expect(loadAppSettings()).resolves.toEqual({
      ...DEFAULTS,
      player: { ...DEFAULTS.player, defaultVolume: 100 },
    });
  });

  it('keeps valid stored values', async () => {
    const stored: AppSettings = {
      theme: 'system',
      language: 'sr',
      player: { autoplay: false, liveChannelStartMode: 'manual', defaultVolume: 35, preferNativeHls: true },
    };
    fixtures.records.set('app_settings', stored);

    await expect(loadAppSettings()).resolves.toEqual(stored);
  });

  it('clamps negative volume to 0', async () => {
    fixtures.records.set('app_settings', { player: { defaultVolume: -3 } });

    expect((await loadAppSettings()).player.defaultVolume).toBe(0);
  });

  it('applies the loaded theme to the document', async () => {
    const dom = installDom(true);
    fixtures.records.set('app_settings', { theme: 'light' });

    await loadAppSettings();

    expect([...dom.classes]).toEqual(['light']);
  });
});

describe('saveAppSettings', () => {
  it('stores normalized settings, mirrors the theme to localStorage and applies it', async () => {
    const dom = installDom(true);

    await saveAppSettings({ ...DEFAULTS, theme: 'light', player: { ...DEFAULTS.player, defaultVolume: 12.4 } });

    expect(fixtures.records.get('app_settings')).toEqual({
      ...DEFAULTS,
      theme: 'light',
      player: { ...DEFAULTS.player, defaultVolume: 12 },
    });
    expect(dom.local.get('theme_preference')).toBe('light');
    expect([...dom.classes]).toEqual(['light']);
  });
});

describe('theme preference', () => {
  it.each([
    ['dark', true, 'dark'],
    ['light', true, 'light'],
    ['system', true, 'dark'],
    ['system', false, 'light'],
  ] as const)('%s with prefers-dark=%s renders %s', (theme, prefersDark, expected) => {
    const dom = installDom(prefersDark);

    applyThemePreference(theme);

    expect([...dom.classes]).toEqual([expected]);
  });

  it('initializes from the mirrored localStorage value, defaulting to dark', () => {
    const dom = installDom(false);
    initializeThemePreference();
    expect([...dom.classes]).toEqual(['dark']);

    dom.local.set('theme_preference', 'system');
    initializeThemePreference();
    expect([...dom.classes]).toEqual(['light']);
  });

  it('is a no-op without a document', () => {
    expect(() => applyThemePreference('light')).not.toThrow();
  });
});
