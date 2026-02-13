import { WatchHistoryStorage } from "@lumen/storage";
import type { WatchHistoryEntry } from "@lumen/types";
import { getAppStorage } from "@/services/storage";

let watchHistoryStorage: WatchHistoryStorage | null = null;

const getWatchHistoryStorage = (): WatchHistoryStorage | null => {
  const storage = getAppStorage();
  if (!storage) {
    return null;
  }

  if (!watchHistoryStorage) {
    watchHistoryStorage = new WatchHistoryStorage(storage);
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
