import type { StorageAdapter } from "@lumen/types";

export class VersionedStorage implements StorageAdapter {
  private delegate: StorageAdapter;
  private prefix: string;
  private keysIndexKey: string;

  constructor(delegate: StorageAdapter, namespace = "lumen", version = 1) {
    this.delegate = delegate;
    this.prefix = `${namespace}:v${version}:`;
    this.keysIndexKey = `${this.prefix}__keys__`;
  }

  async get<T>(key: string): Promise<T | null> {
    return this.delegate.get<T>(this.prefix + key);
  }

  async set<T>(key: string, value: T): Promise<void> {
    const namespacedKey = this.prefix + key;
    await this.delegate.set(namespacedKey, value);
    await this.addToIndex(namespacedKey);
  }

  async remove(key: string): Promise<void> {
    const namespacedKey = this.prefix + key;
    await this.delegate.remove(namespacedKey);
    await this.removeFromIndex(namespacedKey);
  }

  async clear(): Promise<void> {
    const keys = new Set<string>(await this.readIndex());

    // If adapter supports key listing, sweep all namespaced keys as a safety net.
    if (typeof this.delegate.listKeys === "function") {
      const allKeys = await this.delegate.listKeys();
      for (const key of allKeys) {
        if (key.startsWith(this.prefix) && key !== this.keysIndexKey) {
          keys.add(key);
        }
      }
    }

    for (const key of keys) {
      await this.delegate.remove(key);
    }
    await this.delegate.remove(this.keysIndexKey);
  }

  private async readIndex(): Promise<string[]> {
    const index = await this.delegate.get<string[]>(this.keysIndexKey);
    return Array.isArray(index) ? index : [];
  }

  private async writeIndex(keys: string[]): Promise<void> {
    await this.delegate.set(this.keysIndexKey, keys);
  }

  private async addToIndex(key: string): Promise<void> {
    const keys = await this.readIndex();
    if (!keys.includes(key)) {
      keys.push(key);
      await this.writeIndex(keys);
    }
  }

  private async removeFromIndex(key: string): Promise<void> {
    const keys = await this.readIndex();
    const filtered = keys.filter((existing) => existing !== key);
    if (filtered.length === 0) {
      await this.delegate.remove(this.keysIndexKey);
      return;
    }
    await this.writeIndex(filtered);
  }
}
