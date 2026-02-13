import { VersionedStorage, WebStorageAdapter } from "@lumen/storage";
import type { StorageAdapter, XtreamCredentials } from "@lumen/types";

const STORAGE_NAMESPACE = "lumen-web";
const STORAGE_VERSION = 1;
const FAVORITES_KEY = "favorites";
const CREDENTIALS_KEY = "xtream_credentials";

let storage: StorageAdapter | null = null;

const getStorage = (): StorageAdapter | null => {
  if (typeof window === "undefined") {
    return null;
  }

  if (!storage) {
    storage = new VersionedStorage(
      new WebStorageAdapter(window.localStorage),
      STORAGE_NAMESPACE,
      STORAGE_VERSION,
    );
  }

  return storage;
};

export const getAppStorage = (): StorageAdapter | null => getStorage();

export const loadStoredFavorites = async (): Promise<string[]> => {
  const adapter = getStorage();
  if (!adapter) {
    return [];
  }

  return (await adapter.get<string[]>(FAVORITES_KEY)) ?? [];
};

export const saveStoredFavorites = async (favorites: string[]): Promise<void> => {
  const adapter = getStorage();
  if (!adapter) {
    return;
  }

  await adapter.set(FAVORITES_KEY, favorites);
};

export const saveStoredCredentials = async (
  credentials: XtreamCredentials,
): Promise<void> => {
  const adapter = getStorage();
  if (!adapter) {
    return;
  }

  await adapter.set(CREDENTIALS_KEY, credentials);
};

export const loadStoredCredentials = async (): Promise<XtreamCredentials | null> => {
  const adapter = getStorage();
  if (!adapter) {
    return null;
  }

  return adapter.get<XtreamCredentials>(CREDENTIALS_KEY);
};

export const clearStoredCredentials = async (): Promise<void> => {
  const adapter = getStorage();
  if (!adapter) {
    return;
  }

  await adapter.remove(CREDENTIALS_KEY);
};
