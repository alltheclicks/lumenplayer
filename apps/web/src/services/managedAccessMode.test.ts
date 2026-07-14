import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  MANAGED_ACCESS_MODE_STORAGE_KEY,
  clearManagedAccessMode,
  loadManagedAccessMode,
  saveManagedAccessMode,
} from './managedAccessMode';

const createStorage = () => {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); },
  };
};

afterEach(() => vi.unstubAllGlobals());

describe('managed access mode', () => {
  it('defaults invalid or absent storage to full access', () => {
    const localStorage = createStorage();
    localStorage.setItem(MANAGED_ACCESS_MODE_STORAGE_KEY, JSON.stringify('admin'));
    vi.stubGlobal('window', { localStorage });
    expect(loadManagedAccessMode()).toBe('full');
  });

  it('persists and clears info-only access', () => {
    const localStorage = createStorage();
    vi.stubGlobal('window', { localStorage });
    saveManagedAccessMode('info_only');
    expect(loadManagedAccessMode()).toBe('info_only');
    clearManagedAccessMode();
    expect(loadManagedAccessMode()).toBe('full');
  });
});
