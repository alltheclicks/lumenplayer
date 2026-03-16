import { createHash } from "node:crypto";
import { buildCatchUpAssetKey } from "./asset-key.js";
import { AssetStore } from "./asset-store.js";
import {
  getCatchUpRemuxFallbackReason,
  selectCatchUpRemuxCandidate,
  type CatchUpRemuxController,
} from "./catchup-remux.js";
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
const LOCAL_PROXY_PROGRAM_ID_PARAM = "__lumenProgramId";
const LOCAL_PROXY_STREAM_ID_PARAM = "__lumenStreamId";
const LOCAL_PROXY_START_PARAM = "__lumenStart";
const LOCAL_PROXY_DURATION_PARAM = "__lumenDuration";
const LOCAL_PROXY_TRANSPORT_PARAM = "__lumenTransport";
const LOCAL_PROXY_FALLBACK_REASON_PARAM = "__lumenFallbackReason";
const PROVIDER_DIRECT_DISABLED_HOSTS = new Set([
  "smart.mediaking.fi",
  "serv2.mediaking.fi",
  "edge6.castcdn.net",
  "79.137.99.121",
]);

const dedupeUrls = (urls: readonly string[]): string[] => {
  const deduplicated: string[] = [];
  const seen = new Set<string>();

  for (const url of urls) {
    const trimmed = url.trim();
    if (!trimmed || seen.has(trimmed)) {
      continue;
    }

    seen.add(trimmed);
    deduplicated.push(trimmed);
  }

  return deduplicated;
};

const flattenSourceCandidates = (request: CatchUpGatewayResolveRequest): string[] => dedupeUrls([
  ...request.sourceCandidates.queryUrls,
  ...request.sourceCandidates.redirectUrls,
  ...request.sourceCandidates.legacyUrls,
]);

const firstCandidateUrl = (request: CatchUpGatewayResolveRequest): string | null => (
  request.sourceCandidates.queryUrls[0] ??
  request.sourceCandidates.redirectUrls[0] ??
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

const isProviderDirectDisabledServer = (serverUrl: string): boolean => {
  try {
    const parsed = new URL(serverUrl.includes("://") ? serverUrl : `http://${serverUrl}`);
    return PROVIDER_DIRECT_DISABLED_HOSTS.has(parsed.hostname.toLowerCase());
  } catch {
    return PROVIDER_DIRECT_DISABLED_HOSTS.has(serverUrl.trim().toLowerCase());
  }
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

const absolutizeUrl = (value: string, requestOrigin: string): string => {
  try {
    return new URL(value, requestOrigin).toString();
  } catch {
    return value;
  }
};

const buildSourceSignature = (candidateUrls: readonly string[]): string => {
  const normalized = candidateUrls.map((url) => {
    const parsedProxy = parseProxyTargetUrl(url);
    return parsedProxy?.upstreamUrl.toString() ?? url;
  });

  return createHash("sha1")
    .update(JSON.stringify(normalized))
    .digest("hex")
    .slice(0, 16);
};

const decorateProxyPlaybackUrl = ({
  playbackUrl,
  transportMode,
  programId,
  streamId,
  startTimestamp,
  durationSeconds,
  fallbackReason,
}: {
  playbackUrl: string;
  transportMode: CatchUpGatewayTransportMode;
  programId: string;
  streamId: number;
  startTimestamp: number;
  durationSeconds: number;
  fallbackReason: string | null;
}): string => {
  if (!isProxyTargetUrl(playbackUrl)) {
    return playbackUrl;
  }

  const parsed = new URL(playbackUrl);
  parsed.searchParams.set(LOCAL_PROXY_PROGRAM_ID_PARAM, programId);
  parsed.searchParams.set(LOCAL_PROXY_STREAM_ID_PARAM, String(streamId));
  parsed.searchParams.set(LOCAL_PROXY_START_PARAM, String(startTimestamp));
  parsed.searchParams.set(LOCAL_PROXY_DURATION_PARAM, String(durationSeconds));
  parsed.searchParams.set(
    LOCAL_PROXY_TRANSPORT_PARAM,
    transportMode === "proxy-remuxed" ? "remux-hls" : "normalized",
  );
  if (fallbackReason) {
    parsed.searchParams.set(LOCAL_PROXY_FALLBACK_REASON_PARAM, fallbackReason);
  } else {
    parsed.searchParams.delete(LOCAL_PROXY_FALLBACK_REASON_PARAM);
  }
  return parsed.toString();
};

const buildPlaybackUrl = ({
  selectedCandidateUrl,
  transportMode,
  requestOrigin,
  programId,
  streamId,
  startTimestamp,
  durationSeconds,
  fallbackReason,
}: {
  selectedCandidateUrl: string;
  transportMode: CatchUpGatewayTransportMode;
  requestOrigin: string;
  programId: string;
  streamId: number;
  startTimestamp: number;
  durationSeconds: number;
  fallbackReason: string | null;
}): string => {
  if (transportMode === "provider-direct") {
    const directCandidate = parseProxyTargetUrl(selectedCandidateUrl)?.upstreamUrl.toString() ?? selectedCandidateUrl;
    return absolutizeUrl(directCandidate, requestOrigin);
  }

  const proxiedUrl = isProxyTargetUrl(selectedCandidateUrl)
    ? absolutizeUrl(selectedCandidateUrl, requestOrigin)
    : buildProxyUrlForAbsoluteUrl(selectedCandidateUrl, requestOrigin);

  return decorateProxyPlaybackUrl({
    playbackUrl: proxiedUrl,
    transportMode,
    programId,
    streamId,
    startTimestamp,
    durationSeconds,
    fallbackReason,
  });
};

const resolveRemuxUpstreamUrl = (playbackUrl: string): URL => {
  const proxied = parseProxyTargetUrl(playbackUrl);
  if (proxied?.upstreamUrl) {
    return proxied.upstreamUrl;
  }

  return new URL(playbackUrl);
};

const resolveRemuxFallbackReason = (
  remuxFailureReason: string | null,
): string => remuxFailureReason ?? "gateway-normalized";

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
  remuxController: CatchUpRemuxController;
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

      const orderedCandidates = flattenSourceCandidates(request);
      const selectedNonRemuxCandidateUrl = firstCandidateUrl(request);
      if (!selectedNonRemuxCandidateUrl || orderedCandidates.length === 0) {
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

      const sourceSignature = buildSourceSignature(orderedCandidates);
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

      const requestOrigin = resolveRequestOrigin(requestBaseUrl);
      const debugMode = request.debugOverride?.enabled === true
        ? request.debugOverride.transportMode
        : undefined;
      const providerDirectAllowedForServer = !isProviderDirectDisabledServer(serverUrl);
      const remuxCandidateUrl = selectCatchUpRemuxCandidate(request.sourceCandidates);
      const canUseRemux = (
        remuxCandidateUrl !== null &&
        isModeAllowed("proxy-remuxed", policy.allowedModes) &&
        (
          debugMode === "proxy-remuxed" ||
          (
            debugMode === undefined &&
            options.remuxController.matchesFeatureGate({
              request,
              candidateUrl: remuxCandidateUrl,
            })
          )
        )
      );
      let resolvedTransportMode: CatchUpGatewayTransportMode | null = null;
      let playbackUrl = "";
      let fallbackReason: string | null = null;

      if (canUseRemux && remuxCandidateUrl) {
        const remuxPlaybackUrl = buildPlaybackUrl({
          selectedCandidateUrl: remuxCandidateUrl,
          transportMode: "proxy-remuxed",
          requestOrigin,
          programId: request.programId,
          streamId: request.streamId,
          startTimestamp: request.startTimestamp,
          durationSeconds: request.durationSeconds,
          fallbackReason: "gateway-remux",
        });

        try {
          await options.remuxController.prepareSession({
            upstreamUrl: resolveRemuxUpstreamUrl(remuxPlaybackUrl),
            serverKey: server.id,
            perServerConcurrency: policy.perServerConcurrency,
          });
          resolvedTransportMode = "proxy-remuxed";
          playbackUrl = remuxPlaybackUrl;
          fallbackReason = "gateway-remux";
        } catch (error) {
          fallbackReason = getCatchUpRemuxFallbackReason(error);
          options.logger.warn("gateway.remux_downgraded", {
            serverId: server.id,
            channelId: request.channelId,
            programId: request.programId,
            assetKey,
            selectedCandidateUrl: remuxCandidateUrl,
            fallbackReason,
            message: error instanceof Error ? error.message : "Catch-up remux bootstrap failed.",
          });
        }
      }

      if (
        !resolvedTransportMode &&
        providerDirectAllowedForServer &&
        debugMode === "provider-direct" &&
        isModeAllowed("provider-direct", policy.allowedModes)
      ) {
        resolvedTransportMode = "provider-direct";
        playbackUrl = buildPlaybackUrl({
          selectedCandidateUrl: selectedNonRemuxCandidateUrl,
          transportMode: "provider-direct",
          requestOrigin,
          programId: request.programId,
          streamId: request.streamId,
          startTimestamp: request.startTimestamp,
          durationSeconds: request.durationSeconds,
          fallbackReason,
        });
      }

      if (
        !resolvedTransportMode &&
        isModeAllowed("proxy-normalized", policy.allowedModes)
      ) {
        resolvedTransportMode = "proxy-normalized";
        const normalizedFallbackReason = resolveRemuxFallbackReason(fallbackReason);
        playbackUrl = buildPlaybackUrl({
          selectedCandidateUrl: selectedNonRemuxCandidateUrl,
          transportMode: "proxy-normalized",
          requestOrigin,
          programId: request.programId,
          streamId: request.streamId,
          startTimestamp: request.startTimestamp,
          durationSeconds: request.durationSeconds,
          fallbackReason: normalizedFallbackReason,
        });
        fallbackReason = normalizedFallbackReason;
      }

      if (
        !resolvedTransportMode &&
        providerDirectAllowedForServer &&
        isModeAllowed("provider-direct", policy.allowedModes)
      ) {
        resolvedTransportMode = "provider-direct";
        playbackUrl = buildPlaybackUrl({
          selectedCandidateUrl: selectedNonRemuxCandidateUrl,
          transportMode: "provider-direct",
          requestOrigin,
          programId: request.programId,
          streamId: request.streamId,
          startTimestamp: request.startTimestamp,
          durationSeconds: request.durationSeconds,
          fallbackReason,
        });
      }

      if (!resolvedTransportMode) {
        return {
          serverId: server.id,
          channelId: request.channelId,
          programId: request.programId,
          assetKey,
          transportMode: "proxy-normalized",
          playbackUrl: "",
          assetState: "failed",
          fallbackReason: fallbackReason ?? "gateway-unavailable",
          hotStart: false,
        };
      }

      assetStore.upsert({
        assetKey,
        serverId: server.id,
        channelId: request.channelId,
        programId: request.programId,
        sourceSignature,
        transportMode: resolvedTransportMode,
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
        transportMode: resolvedTransportMode,
        assetState: "ready",
        hotStart: false,
        fallbackReason,
      });

      return {
        serverId: server.id,
        channelId: request.channelId,
        programId: request.programId,
        assetKey,
        transportMode: resolvedTransportMode,
        playbackUrl,
        assetState: "ready",
        fallbackReason,
        hotStart: false,
      };
    },
    sweep: () => {
      assetStore.sweep();
      hotPathCache.sweep();
      options.remuxController.sweep();
    },
  };
};
