export type ManagedAccessMode = 'full' | 'info_only';

export const MANAGED_ACCESS_MODE_STORAGE_KEY = 'lumen-web:v1:managed_access_mode';

const isManagedAccessMode = (value: unknown): value is ManagedAccessMode => (
  value === 'full' || value === 'info_only'
);

export const loadManagedAccessMode = (): ManagedAccessMode => {
  if (typeof window === 'undefined' || !window.localStorage) return 'full';
  try {
    const parsed = JSON.parse(window.localStorage.getItem(MANAGED_ACCESS_MODE_STORAGE_KEY) || 'null');
    return isManagedAccessMode(parsed) ? parsed : 'full';
  } catch {
    return 'full';
  }
};

export const saveManagedAccessMode = (mode: ManagedAccessMode): void => {
  if (typeof window === 'undefined' || !window.localStorage) return;
  window.localStorage.setItem(MANAGED_ACCESS_MODE_STORAGE_KEY, JSON.stringify(mode));
};

export const clearManagedAccessMode = (): void => {
  if (typeof window === 'undefined' || !window.localStorage) return;
  window.localStorage.removeItem(MANAGED_ACCESS_MODE_STORAGE_KEY);
};

export const isInfoOnlyAccess = (): boolean => loadManagedAccessMode() === 'info_only';
