export type CatchUpGatewayTransportMode =
  | "provider-direct"
  | "proxy-normalized"
  | "proxy-remuxed";

export type CatchUpGatewayAssetState = "ready" | "preparing" | "failed";
export type CatchUpGatewayPrepPolicy = "hybrid" | "lazy" | "eager-startup";
export type CatchUpGatewayEpgCoverageState = "available" | "partial" | "missing";

export interface CatchUpGatewaySourceCandidates {
  redirectUrls: string[];
  queryUrls: string[];
  legacyUrls: string[];
}

export interface CatchUpGatewayServerPolicy {
  catchupGatewayEnabled: boolean;
  enabledPlatforms: string[];
  allowedModes: CatchUpGatewayTransportMode[];
  prepPolicy: CatchUpGatewayPrepPolicy;
  perServerConcurrency: number;
  cacheTtlMs: number;
  prewarmWindowSeconds: number;
}

export interface CatchUpGatewayChannelCapabilityRecord {
  channelId: string;
  hasCatchup: boolean;
  archiveWindowHours: number;
  epgCoverageState: CatchUpGatewayEpgCoverageState;
  preferredModeHint?: CatchUpGatewayTransportMode;
}

export interface CatchUpGatewayResolveRequest {
  platform?: string;
  serverUrl?: string | null;
  channelId: string;
  programId: string;
  streamId: number;
  startTimestamp: number;
  durationSeconds: number;
  sourceCandidates: CatchUpGatewaySourceCandidates;
  channelCapability?: Partial<CatchUpGatewayChannelCapabilityRecord> | null;
  debugOverride?: {
    enabled?: boolean;
    transportMode?: CatchUpGatewayTransportMode;
  } | null;
}

export interface CatchUpGatewayResolveResponse {
  serverId: string;
  channelId: string;
  programId: string;
  assetKey: string;
  transportMode: CatchUpGatewayTransportMode;
  playbackUrl: string;
  assetState: CatchUpGatewayAssetState;
  fallbackReason: string | null;
  hotStart: boolean;
}

const isRecord = (value: unknown): value is Record<string, unknown> => (
  typeof value === "object" &&
  value !== null
);

const isStringArray = (value: unknown): value is string[] => (
  Array.isArray(value) &&
  value.every((entry) => typeof entry === "string")
);

export const isCatchUpGatewayTransportMode = (
  value: unknown,
): value is CatchUpGatewayTransportMode => (
  value === "provider-direct" ||
  value === "proxy-normalized" ||
  value === "proxy-remuxed"
);

export const isCatchUpGatewayAssetState = (
  value: unknown,
): value is CatchUpGatewayAssetState => (
  value === "ready" ||
  value === "preparing" ||
  value === "failed"
);

export const isCatchUpGatewayResolveRequest = (
  value: unknown,
): value is CatchUpGatewayResolveRequest => {
  if (!isRecord(value)) {
    return false;
  }

  if (
    typeof value.channelId !== "string" ||
    typeof value.programId !== "string" ||
    typeof value.streamId !== "number" ||
    !Number.isFinite(value.streamId) ||
    typeof value.startTimestamp !== "number" ||
    !Number.isFinite(value.startTimestamp) ||
    typeof value.durationSeconds !== "number" ||
    !Number.isFinite(value.durationSeconds)
  ) {
    return false;
  }

  if (!isRecord(value.sourceCandidates)) {
    return false;
  }

  if (
    !isStringArray(value.sourceCandidates.redirectUrls) ||
    !isStringArray(value.sourceCandidates.queryUrls) ||
    !isStringArray(value.sourceCandidates.legacyUrls)
  ) {
    return false;
  }

  if (value.platform !== undefined && typeof value.platform !== "string") {
    return false;
  }

  if (value.serverUrl !== undefined && value.serverUrl !== null && typeof value.serverUrl !== "string") {
    return false;
  }

  if (value.debugOverride !== undefined && value.debugOverride !== null) {
    if (!isRecord(value.debugOverride)) {
      return false;
    }

    if (value.debugOverride.enabled !== undefined && typeof value.debugOverride.enabled !== "boolean") {
      return false;
    }

    if (
      value.debugOverride.transportMode !== undefined &&
      !isCatchUpGatewayTransportMode(value.debugOverride.transportMode)
    ) {
      return false;
    }
  }

  return true;
};
