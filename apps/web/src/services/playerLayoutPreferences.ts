import { getAppStorage } from '@/services/storage';

const LAYOUT_STORAGE_KEY = 'player_layout';
const LAYOUT_LOCAL_STORAGE_KEY = 'lumen-web:v1:player_layout';

export type PanelWidthPreference = 'normal' | 'wide';
export type GuidePanelSizePreference = 'normal' | 'expanded';

export interface PlayerLayoutPreferences {
  categorySidebarWidth: PanelWidthPreference;
  channelListWidth: PanelWidthPreference;
  guidePanelSize: GuidePanelSizePreference;
}

const DEFAULT_LAYOUT_PREFERENCES: PlayerLayoutPreferences = {
  categorySidebarWidth: 'normal',
  channelListWidth: 'normal',
  guidePanelSize: 'normal',
};

const normalizePanelWidth = (value: unknown): PanelWidthPreference => (
  value === 'wide' ? 'wide' : 'normal'
);

const normalizeGuidePanelSize = (value: unknown): GuidePanelSizePreference => (
  value === 'expanded' ? 'expanded' : 'normal'
);

const normalizeLayoutPreferences = (value: unknown): PlayerLayoutPreferences => {
  if (!value || typeof value !== 'object') {
    return DEFAULT_LAYOUT_PREFERENCES;
  }

  const raw = value as Partial<PlayerLayoutPreferences>;
  return {
    categorySidebarWidth: normalizePanelWidth(raw.categorySidebarWidth),
    channelListWidth: normalizePanelWidth(raw.channelListWidth),
    guidePanelSize: normalizeGuidePanelSize(raw.guidePanelSize),
  };
};

export const getDefaultPlayerLayoutPreferences = (): PlayerLayoutPreferences => (
  DEFAULT_LAYOUT_PREFERENCES
);

// Synchronous read so the first render uses the stored layout without a flash.
export const loadPlayerLayoutPreferences = (): PlayerLayoutPreferences => {
  if (typeof window === 'undefined') {
    return DEFAULT_LAYOUT_PREFERENCES;
  }

  try {
    const raw = window.localStorage.getItem(LAYOUT_LOCAL_STORAGE_KEY);
    return normalizeLayoutPreferences(raw ? JSON.parse(raw) : null);
  } catch {
    return DEFAULT_LAYOUT_PREFERENCES;
  }
};

export const savePlayerLayoutPreferences = (
  preferences: PlayerLayoutPreferences,
): void => {
  const normalized = normalizeLayoutPreferences(preferences);
  const storage = getAppStorage();
  if (storage) {
    void storage.set(LAYOUT_STORAGE_KEY, normalized);
    return;
  }

  if (typeof window !== 'undefined') {
    window.localStorage.setItem(LAYOUT_LOCAL_STORAGE_KEY, JSON.stringify(normalized));
  }
};
