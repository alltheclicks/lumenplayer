import type {
  CatchUpGatewayAssetState,
  CatchUpGatewayTransportMode,
} from "./catchup-gateway-contracts.js";

export interface AssetRecord {
  assetKey: string;
  serverId: string;
  channelId: string;
  programId: string;
  sourceSignature: string;
  transportMode: CatchUpGatewayTransportMode;
  playbackUrl: string;
  assetState: CatchUpGatewayAssetState;
  fallbackReason: string | null;
  errorMessage: string | null;
  createdAtMs: number;
  updatedAtMs: number;
  lastAccessAtMs: number;
  expiresAtMs: number;
}

export class AssetStore {
  private readonly assets = new Map<string, AssetRecord>();

  get(assetKey: string, nowMs = Date.now()): AssetRecord | null {
    const record = this.assets.get(assetKey);
    if (!record) {
      return null;
    }

    if (record.expiresAtMs <= nowMs) {
      this.assets.delete(assetKey);
      return null;
    }

    return record;
  }

  touch(assetKey: string, nowMs = Date.now()): AssetRecord | null {
    const record = this.get(assetKey, nowMs);
    if (!record) {
      return null;
    }

    const nextRecord: AssetRecord = {
      ...record,
      updatedAtMs: nowMs,
      lastAccessAtMs: nowMs,
    };
    this.assets.set(assetKey, nextRecord);
    return nextRecord;
  }

  upsert(
    record: Omit<AssetRecord, "createdAtMs" | "updatedAtMs" | "lastAccessAtMs" | "expiresAtMs">,
    ttlMs: number,
    nowMs = Date.now(),
  ): AssetRecord {
    const existing = this.get(record.assetKey, nowMs);
    const nextRecord: AssetRecord = {
      ...record,
      createdAtMs: existing?.createdAtMs ?? nowMs,
      updatedAtMs: nowMs,
      lastAccessAtMs: nowMs,
      expiresAtMs: nowMs + Math.max(1, ttlMs),
    };
    this.assets.set(record.assetKey, nextRecord);
    return nextRecord;
  }

  sweep(nowMs = Date.now()): void {
    for (const [assetKey, record] of this.assets.entries()) {
      if (record.expiresAtMs <= nowMs) {
        this.assets.delete(assetKey);
      }
    }
  }
}
