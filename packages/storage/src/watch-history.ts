import type { StorageAdapter, WatchHistoryEntry } from "@lumen/types";

const HISTORY_KEY = "watch-history";
const MAX_ENTRIES = 100;

export class WatchHistoryStorage {
  private storage: StorageAdapter;

  constructor(storage: StorageAdapter) {
    this.storage = storage;
  }

  async getAll(): Promise<WatchHistoryEntry[]> {
    return (await this.storage.get<WatchHistoryEntry[]>(HISTORY_KEY)) ?? [];
  }

  async add(entry: WatchHistoryEntry): Promise<void> {
    const entries = await this.getAll();

    const existingIndex = entries.findIndex(
      (e) => e.channelId === entry.channelId,
    );
    if (existingIndex !== -1) {
      entries.splice(existingIndex, 1);
    }

    entries.unshift(entry);

    if (entries.length > MAX_ENTRIES) {
      entries.length = MAX_ENTRIES;
    }

    await this.storage.set(HISTORY_KEY, entries);
  }

  async remove(channelId: string): Promise<void> {
    const entries = await this.getAll();
    const filtered = entries.filter((e) => e.channelId !== channelId);
    await this.storage.set(HISTORY_KEY, filtered);
  }

  async clear(): Promise<void> {
    await this.storage.remove(HISTORY_KEY);
  }
}
