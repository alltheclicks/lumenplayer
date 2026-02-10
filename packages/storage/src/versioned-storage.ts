import type { StorageAdapter } from "@lumen/types";

export class VersionedStorage implements StorageAdapter {
  private delegate: StorageAdapter;
  private prefix: string;

  constructor(delegate: StorageAdapter, namespace = "lumen", version = 1) {
    this.delegate = delegate;
    this.prefix = `${namespace}:v${version}:`;
  }

  async get<T>(key: string): Promise<T | null> {
    return this.delegate.get<T>(this.prefix + key);
  }

  async set<T>(key: string, value: T): Promise<void> {
    return this.delegate.set(this.prefix + key, value);
  }

  async remove(key: string): Promise<void> {
    return this.delegate.remove(this.prefix + key);
  }

  async clear(): Promise<void> {
    return this.delegate.clear();
  }
}
