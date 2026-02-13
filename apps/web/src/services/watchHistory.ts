import { WatchHistoryStorage, WebStorageAdapter } from "@lumen/storage";
import type { WatchHistoryEntry } from "@lumen/types";

let watchHistoryStorage: WatchHistoryStorage | null = null;

const getWatchHistoryStorage = (): WatchHistoryStorage | null => {
  if (typeof window === "undefined") {
    return null;
  }

  if (!watchHistoryStorage) {
    watchHistoryStorage = new WatchHistoryStorage(
      new WebStorageAdapter(window.localStorage),
    );
  }

  return watchHistoryStorage;
};

export const addWatchHistoryEntry = async (
  entry: WatchHistoryEntry,
): Promise<void> => {
  const storage = getWatchHistoryStorage();
  if (!storage) {
    return;
  }

  await storage.add(entry);
};
