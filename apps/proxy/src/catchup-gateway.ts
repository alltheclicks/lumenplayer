import { AssetClassifier } from "./asset-classifier.js";
import { buildCatchUpAssetKey } from "./asset-key.js";
import { ArchiveDiscovery } from "./archive-discovery.js";
import { AssetStore } from "./asset-store.js";
import { createRemuxedCatchUpManifest, CatchUpRemuxSessionCache } from "./catchup-remuxer.js";
import type { ProxyLogger } from "./catchup-normalizer.js";
import type {
  CatchUpGatewayChannelCapabilityRecord,
  CatchUpGatewayResolveRequest,
  CatchUpGatewayResolveResponse,
  CatchUpGatewayServerPolicy,
  CatchUpGatewayTransportMode,
} from "./catchup-gateway-contracts.js";
import { HotPathCache } from "./hot-path-cache.js";
import { resolveGatewayPlayback } from "./media-serve.js";
import { PreparationCoordinator } from "./preparation-coordinator.js";
import { ProgramWindowIndex } from "./program-window-index.js";
import { parseProxyTargetUrl } from "./proxy-url.js";
import { ServerRegistry, createDefaultServerPolicy } from "./server-registry.js";

const DEFAULT_GLOBAL_CONCURRENCY = 4;

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
    return requestBaseUrl;
  }
};

export interface CatchUpGatewayResolveOptions {
  request: CatchUpGatewayResolveRequest;
  requestBaseUrl: string;
  requestHeaders: Headers;
}

export interface CatchUpGateway {
  resolve: (options: CatchUpGatewayResolveOptions) => Promise<CatchUpGatewayResolveResponse>;
  sweep: () => void;
}

export const createCatchUpGateway = (options: {
  logger: ProxyLogger;
  remuxSessionCache: CatchUpRemuxSessionCache;
  env?: NodeJS.ProcessEnv;
  globalConcurrency?: number;
  prewarmProxyRemuxAsset?: (input: {
    upstreamUrl: URL;
    requestHeaders: Headers;
  }) => Promise<void>;
}): CatchUpGateway => {
  const logger = options.logger;
  const defaultPolicy = createDefaultServerPolicy(options.env);
  const serverRegistry = new ServerRegistry(defaultPolicy, logger);
  const archiveDiscovery = new ArchiveDiscovery();
  const programWindowIndex = new ProgramWindowIndex();
  const assetStore = new AssetStore();
  const hotPathCache = new HotPathCache<boolean>(defaultPolicy.prewarmWindowSeconds * 1000);
  const classifier = new AssetClassifier();
  const preparationCoordinator = new PreparationCoordinator({
    globalConcurrency: Math.max(1, options.globalConcurrency ?? DEFAULT_GLOBAL_CONCURRENCY),
    assetStore,
    hotPathCache,
    logger,
    prewarmProxyRemuxAsset: options.prewarmProxyRemuxAsset ?? (async ({ upstreamUrl, requestHeaders }) => {
      await createRemuxedCatchUpManifest({
        upstreamUrl,
        requestHeaders,
        sessionCache: options.remuxSessionCache,
        logger,
      });
    }),
  });

  const resolve = async ({
    request,
    requestBaseUrl,
    requestHeaders,
  }: CatchUpGatewayResolveOptions): Promise<CatchUpGatewayResolveResponse> => {
    const nowMs = Date.now();
    const serverUrl = deriveServerUrl(request);
    const { record: server } = serverRegistry.resolve(serverUrl, nowMs);
    const policy: CatchUpGatewayServerPolicy = server.policy;
    const channelCapability = normalizeChannelCapability(request);
    archiveDiscovery.upsert(server.id, channelCapability);

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

    const hotChannelKey = `${server.id}:${request.channelId}`;
    const hotStart = hotPathCache.has(hotChannelKey, nowMs);
    const classification = classifier.classify({
      request,
      policy,
      channelCapability,
      hotChannelMode: hotStart && channelCapability.preferredModeHint
        ? channelCapability.preferredModeHint
        : null,
    });
    const assetKey = buildCatchUpAssetKey({
      serverId: server.id,
      channelId: request.channelId,
      programStart: request.startTimestamp,
      programEnd: request.startTimestamp + Math.max(1, Math.floor(request.durationSeconds)),
      sourceSignature: classification.sourceSignature,
    });

    programWindowIndex.upsert(server.id, {
      channelId: request.channelId,
      programId: request.programId,
      programStart: request.startTimestamp,
      programEnd: request.startTimestamp + Math.max(1, Math.floor(request.durationSeconds)),
      assetKey,
    });

    const cachedAsset = assetStore.get(assetKey, nowMs);
    if (cachedAsset) {
      assetStore.touch(assetKey, nowMs);
      hotPathCache.set(assetKey, true, policy.prewarmWindowSeconds * 1000, nowMs);
      hotPathCache.set(hotChannelKey, true, policy.prewarmWindowSeconds * 1000, nowMs);
      logger.info("gateway.asset_cache_hit", {
        serverId: server.id,
        channelId: request.channelId,
        programId: request.programId,
        assetKey,
        transportMode: cachedAsset.transportMode,
      });
      logger.info("gateway.asset_resolved", {
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

    logger.info("gateway.asset_cache_miss", {
      serverId: server.id,
      channelId: request.channelId,
      programId: request.programId,
      assetKey,
    });

    const playback = resolveGatewayPlayback({
      selectedCandidateUrl: classification.selectedCandidateUrl,
      requestOrigin: resolveRequestOrigin(requestBaseUrl),
      transportMode: classification.transportMode,
      programId: request.programId,
      streamId: request.streamId,
      startTimestamp: request.startTimestamp,
      durationSeconds: request.durationSeconds,
      fallbackReason: classification.transportMode === "proxy-remuxed"
        ? (classification.fallbackReason ?? "gateway-remux")
        : classification.fallbackReason,
    });
    const fallbackReason = classification.transportMode === "proxy-remuxed"
      ? (classification.fallbackReason ?? "gateway-remux")
      : classification.fallbackReason;

    assetStore.upsert({
      assetKey,
      serverId: server.id,
      channelId: request.channelId,
      programId: request.programId,
      sourceSignature: classification.sourceSignature,
      transportMode: classification.transportMode,
      playbackUrl: playback.playbackUrl,
      assetState: playback.upstreamPreparationUrl ? "preparing" : "ready",
      fallbackReason,
      errorMessage: null,
    }, policy.cacheTtlMs, nowMs);

    const preparation = preparationCoordinator.ensurePrepared({
      assetKey,
      serverId: server.id,
      channelId: request.channelId,
      programId: request.programId,
      playbackUrl: playback.playbackUrl,
      upstreamPreparationUrl: playback.upstreamPreparationUrl,
      requestHeaders,
      policy,
    });

    const resolvedTransportMode: CatchUpGatewayTransportMode = classification.transportMode;
    hotPathCache.set(hotChannelKey, true, policy.prewarmWindowSeconds * 1000, nowMs);
    if (preparation.assetState === "ready") {
      hotPathCache.set(assetKey, true, policy.prewarmWindowSeconds * 1000, nowMs);
    }

    logger.info("gateway.asset_resolved", {
      serverId: server.id,
      channelId: request.channelId,
      programId: request.programId,
      assetKey,
      transportMode: resolvedTransportMode,
      assetState: preparation.assetState,
      hotStart,
      fallbackReason,
      sharedPreparation: preparation.shared,
    });

    return {
      serverId: server.id,
      channelId: request.channelId,
      programId: request.programId,
      assetKey,
      transportMode: resolvedTransportMode,
      playbackUrl: playback.playbackUrl,
      assetState: preparation.assetState,
      fallbackReason,
      hotStart,
    };
  };

  return {
    resolve,
    sweep: () => {
      assetStore.sweep();
      hotPathCache.sweep();
    },
  };
};
