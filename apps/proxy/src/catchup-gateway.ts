import { createHash } from "node:crypto";
import { buildCatchUpAssetKey } from "./asset-key.js";
import { AssetStore } from "./asset-store.js";
import type {
  CatchUpGatewayChannelCapabilityRecord,
  CatchUpGatewayResolveRequest,
  CatchUpGatewayResolveResponse,
  CatchUpGatewayTransportMode,
} from "./catchup-gateway-contracts.js";
import { HotPathCache } from "./hot-path-cache.js";
import { buildProxyUrlForAbsoluteUrl, isProxyTargetUrl, parseProxyTargetUrl } from "./proxy-url.js";
import { createDefaultServerPolicy, type GatewayLogger, ServerRegistry } from "./server-registry.js";

const DEFAULT_REQUEST_ORIGIN = "http://localhost";

const firstCandidateUrl = (request: CatchUpGatewayResolveRequest): string | null => (
  request.sourceCandidates.redirectUrls[0] ??
  request.sourceCandidates.queryUrls[0] ??
  request.sourceCandidates.legacyUrls[0] ??
  null
);

const deriveServerUrl = (request: CatchUpGatewayResolveRequest): string => {
  const explicitServerUrl = request.serverUrl?.trim();
  if (explicitServerUrl) {
    return explicitServerUrl;
  }

  const candidateUrl = firstCandidateUrl(request);
  if (!candidateUrl) {
    return "unknown-server";
  }

  const parsedProxy = parseProxyTargetUrl(candidateUrl);
  return parsedProxy?.upstreamUrl.origin ?? "unknown-server";
};

const normalizeChannelCapability = (
  request: CatchUpGatewayResolveRequest,
): CatchUpGatewayChannelCapabilityRecord => ({
  channelId: request.channelId,
  hasCatchup: request.channelCapability?.hasCatchup ?? true,
  archiveWindowHours: Math.max(0, Number(request.channelCapability?.archiveWindowHours ?? 0)),
  epgCoverageState: (
    request.channelCapability?.epgCoverageState === "partial" ||
    request.channelCapability?.epgCoverageState === "missing"
  )
    ? request.channelCapability.epgCoverageState
    : "available",
  preferredModeHint: (
    request.channelCapability?.preferredModeHint === "provider-direct" ||
    request.channelCapability?.preferredModeHint === "proxy-normalized" ||
    request.channelCapability?.preferredModeHint === "proxy-remuxed"
  )
    ? request.channelCapability.preferredModeHint
    : undefined,
});

const resolveRequestOrigin = (requestBaseUrl: string): string => {
  try {
    return new URL(requestBaseUrl).origin;
  } catch {
    return DEFAULT_REQUEST_ORIGIN;
  }
};

const isModeAllowed = (
  mode: CatchUpGatewayTransportMode,
  allowedModes: CatchUpGatewayTransportMode[],
): boolean => allowedModes.includes(mode);

const selectTransportMode = ({
  request,
  channelCapability,
  allowedModes,
}: {
  request: CatchUpGatewayResolveRequest;
  channelCapability: CatchUpGatewayChannelCapabilityRecord;
  allowedModes: CatchUpGatewayTransportMode[];
}): CatchUpGatewayTransportMode => {
  const debugMode = request.debugOverride?.enabled === true
    ? request.debugOverride.transportMode
    : undefined;
  if (debugMode && isModeAllowed(debugMode, allowedModes)) {
    return debugMode;
  }

  const preferredMode = channelCapability.preferredModeHint;
  if (preferredMode && isModeAllowed(preferredMode, allowedModes)) {
    return preferredMode;
  }

  if (isModeAllowed("provider-direct", allowedModes)) {
    return "provider-direct";
  }

  if (isModeAllowed("proxy-normalized", allowedModes)) {
    return "proxy-normalized";
  }

  return "proxy-remuxed";
};

const appendTransportHint = (
  playbackUrl: string,
  transportMode: CatchUpGatewayTransportMode,
): string => {
  if (transportMode === "provider-direct") {
    return playbackUrl;
  }

  const parsed = new URL(playbackUrl, DEFAULT_REQUEST_ORIGIN);
  parsed.searchParams.set(
    "__lumenTransport",
    transportMode === "proxy-remuxed" ? "remux-hls" : "normalized",
  );
  return parsed.toString();
};

const buildPlaybackUrl = ({
  selectedCandidateUrl,
  transportMode,
  requestOrigin,
}: {
  selectedCandidateUrl: string;
  transportMode: CatchUpGatewayTransportMode;
  requestOrigin: string;
}): string => {
  if (transportMode === "provider-direct") {
    return selectedCandidateUrl;
  }

  const proxyUrl = isProxyTargetUrl(selectedCandidateUrl)
    ? selectedCandidateUrl
    : buildProxyUrlForAbsoluteUrl(selectedCandidateUrl, requestOrigin);

  return appendTransportHint(proxyUrl, transportMode);
};

const buildSourceSignature = (candidateUrl: string | null): string => {
  if (!candidateUrl) {
    return "no-source";
  }

  const parsed = parseProxyTargetUrl(candidateUrl);
  const fingerprint = parsed?.upstreamUrl.toString() ?? candidateUrl;
  return createHash("sha1").update(fingerprint).digest("hex").slice(0, 12);
};

export interface CatchUpGatewayResolveOptions {
  request: CatchUpGatewayResolveRequest;
  requestBaseUrl: string;
}

export interface CatchUpGateway {
  resolve: (options: CatchUpGatewayResolveOptions) => Promise<CatchUpGatewayResolveResponse>;
  sweep: () => void;
}

export const createCatchUpGateway = (options: {
  logger: GatewayLogger;
  env?: NodeJS.ProcessEnv;
}): CatchUpGateway => {
  const defaultPolicy = createDefaultServerPolicy(options.env);
  const serverRegistry = new ServerRegistry(defaultPolicy, options.logger);
  const assetStore = new AssetStore();
  const hotPathCache = new HotPathCache<boolean>(defaultPolicy.prewarmWindowSeconds * 1000);

  return {
    resolve: async ({ request, requestBaseUrl }) => {
      const nowMs = Date.now();
      const serverUrl = deriveServerUrl(request);
      const { record: server } = serverRegistry.resolve(serverUrl, nowMs);
      const policy = server.policy;
      const channelCapability = normalizeChannelCapability(request);

      if (!policy.catchupGatewayEnabled || channelCapability.hasCatchup === false) {
        return {
          serverId: server.id,
          channelId: request.channelId,
          programId: request.programId,
          assetKey: "",
          transportMode: "proxy-normalized",
          playbackUrl: "",
          assetState: "failed",
          fallbackReason: !policy.catchupGatewayEnabled ? "gateway-disabled" : "channel-no-catchup",
          hotStart: false,
        };
      }

      const platform = request.platform?.trim() || "web";
      if (
        request.debugOverride?.enabled !== true &&
        !policy.enabledPlatforms.includes(platform)
      ) {
        return {
          serverId: server.id,
          channelId: request.channelId,
          programId: request.programId,
          assetKey: "",
          transportMode: "proxy-normalized",
          playbackUrl: "",
          assetState: "failed",
          fallbackReason: "platform-disabled",
          hotStart: false,
        };
      }

      const selectedCandidateUrl = firstCandidateUrl(request);
      if (!selectedCandidateUrl) {
        return {
          serverId: server.id,
          channelId: request.channelId,
          programId: request.programId,
          assetKey: "",
          transportMode: "proxy-normalized",
          playbackUrl: "",
          assetState: "failed",
          fallbackReason: "no-source-candidate",
          hotStart: false,
        };
      }

      const transportMode = selectTransportMode({
        request,
        channelCapability,
        allowedModes: policy.allowedModes,
      });
      const sourceSignature = buildSourceSignature(selectedCandidateUrl);
      const assetKey = buildCatchUpAssetKey({
        serverId: server.id,
        channelId: request.channelId,
        programStart: request.startTimestamp,
        programEnd: request.startTimestamp + Math.max(1, Math.floor(request.durationSeconds)),
        sourceSignature,
      });

      const cachedAsset = assetStore.get(assetKey, nowMs);
      if (cachedAsset) {
        assetStore.touch(assetKey, nowMs);
        hotPathCache.set(assetKey, true, policy.prewarmWindowSeconds * 1000, nowMs);
        hotPathCache.set(`${server.id}:${request.channelId}`, true, policy.prewarmWindowSeconds * 1000, nowMs);
        options.logger.info("gateway.asset_cache_hit", {
          serverId: server.id,
          channelId: request.channelId,
          programId: request.programId,
          assetKey,
          transportMode: cachedAsset.transportMode,
        });
        options.logger.info("gateway.asset_resolved", {
          serverId: server.id,
          channelId: request.channelId,
          programId: request.programId,
          assetKey,
          transportMode: cachedAsset.transportMode,
          assetState: cachedAsset.assetState,
          hotStart: true,
          fallbackReason: cachedAsset.fallbackReason,
        });
        return {
          serverId: server.id,
          channelId: request.channelId,
          programId: request.programId,
          assetKey,
          transportMode: cachedAsset.transportMode,
          playbackUrl: cachedAsset.playbackUrl,
          assetState: cachedAsset.assetState,
          fallbackReason: cachedAsset.fallbackReason,
          hotStart: true,
        };
      }

      options.logger.info("gateway.asset_cache_miss", {
        serverId: server.id,
        channelId: request.channelId,
        programId: request.programId,
        assetKey,
      });

      const playbackUrl = buildPlaybackUrl({
        selectedCandidateUrl,
        transportMode,
        requestOrigin: resolveRequestOrigin(requestBaseUrl),
      });
      const fallbackReason = transportMode === "provider-direct"
        ? null
        : transportMode === "proxy-remuxed"
          ? "gateway-remux"
          : "gateway-normalized";

      assetStore.upsert({
        assetKey,
        serverId: server.id,
        channelId: request.channelId,
        programId: request.programId,
        sourceSignature,
        transportMode,
        playbackUrl,
        assetState: "ready",
        fallbackReason,
        errorMessage: null,
      }, policy.cacheTtlMs, nowMs);

      hotPathCache.set(assetKey, true, policy.prewarmWindowSeconds * 1000, nowMs);
      hotPathCache.set(`${server.id}:${request.channelId}`, true, policy.prewarmWindowSeconds * 1000, nowMs);

      options.logger.info("gateway.asset_resolved", {
        serverId: server.id,
        channelId: request.channelId,
        programId: request.programId,
        assetKey,
        transportMode,
        assetState: "ready",
        hotStart: false,
        fallbackReason,
      });

      return {
        serverId: server.id,
        channelId: request.channelId,
        programId: request.programId,
        assetKey,
        transportMode,
        playbackUrl,
        assetState: "ready",
        fallbackReason,
        hotStart: false,
      };
    },
    sweep: () => {
      assetStore.sweep();
      hotPathCache.sweep();
    },
  };
};
