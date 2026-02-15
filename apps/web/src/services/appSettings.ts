import { getAppStorage } from '@/services/storage';

const SETTINGS_STORAGE_KEY = 'app_settings';
const THEME_STORAGE_KEY = 'theme_preference';

export type ThemePreference = 'dark' | 'light' | 'system';
export type LanguagePreference = 'en' | 'sr';

export interface AppSettings {
  theme: ThemePreference;
  language: LanguagePreference;
  player: {
    autoplay: boolean;
    defaultVolume: number;
    preferNativeHls: boolean;
  };
}

const DEFAULT_SETTINGS: AppSettings = {
  theme: 'dark',
  language: 'en',
  player: {
    autoplay: true,
    defaultVolume: 80,
    preferNativeHls: false,
  },
};

const clampVolume = (value: number): number => Math.max(0, Math.min(100, Math.round(value)));

const normalizeTheme = (value: unknown): ThemePreference => (
  value === 'light' || value === 'system' ? value : 'dark'
);

const normalizeLanguage = (value: unknown): LanguagePreference => (
  value === 'sr' ? 'sr' : 'en'
);

const normalizeSettings = (value: unknown): AppSettings => {
  if (!value || typeof value !== 'object') {
    return DEFAULT_SETTINGS;
  }

  const raw = value as Partial<AppSettings>;
  return {
    theme: normalizeTheme(raw.theme),
    language: normalizeLanguage(raw.language),
    player: {
      autoplay: raw.player?.autoplay ?? DEFAULT_SETTINGS.player.autoplay,
      defaultVolume: clampVolume(raw.player?.defaultVolume ?? DEFAULT_SETTINGS.player.defaultVolume),
      preferNativeHls: raw.player?.preferNativeHls ?? DEFAULT_SETTINGS.player.preferNativeHls,
    },
  };
};

const prefersDarkTheme = (): boolean => {
  if (typeof window === 'undefined') {
    return true;
  }

  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? true;
};

export const applyThemePreference = (theme: ThemePreference): void => {
  if (typeof document === 'undefined') {
    return;
  }

  const root = document.documentElement;
  const useDark = theme === 'dark' || (theme === 'system' && prefersDarkTheme());
  root.classList.toggle('dark', useDark);
};

export const initializeThemePreference = (): void => {
  if (typeof window === 'undefined') {
    return;
  }

  const rawTheme = window.localStorage.getItem(THEME_STORAGE_KEY);
  const theme = normalizeTheme(rawTheme);
  applyThemePreference(theme);
};

export const getDefaultAppSettings = (): AppSettings => DEFAULT_SETTINGS;

export const loadAppSettings = async (): Promise<AppSettings> => {
  const storage = getAppStorage();
  if (!storage) {
    return DEFAULT_SETTINGS;
  }

  const storedSettings = await storage.get<unknown>(SETTINGS_STORAGE_KEY);
  const settings = normalizeSettings(storedSettings);
  applyThemePreference(settings.theme);
  return settings;
};

export const saveAppSettings = async (settings: AppSettings): Promise<void> => {
  const normalized = normalizeSettings(settings);
  const storage = getAppStorage();

  if (storage) {
    await storage.set(SETTINGS_STORAGE_KEY, normalized);
  }

  if (typeof window !== 'undefined') {
    window.localStorage.setItem(THEME_STORAGE_KEY, normalized.theme);
  }

  applyThemePreference(normalized.theme);
};
