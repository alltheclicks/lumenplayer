interface HotPathCacheEntry<TValue> {
  value: TValue;
  expiresAtMs: number;
}

export class HotPathCache<TValue> {
  private readonly entries = new Map<string, HotPathCacheEntry<TValue>>();

  constructor(private readonly defaultTtlMs: number) {}

  get(key: string, nowMs = Date.now()): TValue | null {
    const entry = this.entries.get(key);
    if (!entry) {
      return null;
    }

    if (entry.expiresAtMs <= nowMs) {
      this.entries.delete(key);
      return null;
    }

    return entry.value;
  }

  has(key: string, nowMs = Date.now()): boolean {
    return this.get(key, nowMs) !== null;
  }

  set(key: string, value: TValue, ttlMs = this.defaultTtlMs, nowMs = Date.now()): void {
    this.entries.set(key, {
      value,
      expiresAtMs: nowMs + Math.max(1, ttlMs),
    });
  }

  delete(key: string): void {
    this.entries.delete(key);
  }

  sweep(nowMs = Date.now()): void {
    for (const [key, entry] of this.entries.entries()) {
      if (entry.expiresAtMs <= nowMs) {
        this.entries.delete(key);
      }
    }
  }
}
