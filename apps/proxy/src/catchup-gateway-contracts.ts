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

export interface CatchUpGatewayProgramWindowRecord {
  channelId: string;
  programId: string;
  programStart: number;
  programEnd: number;
  assetKey?: string;
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
