import { createHash } from "node:crypto";
import {
  type CatchUpGatewayChannelCapabilityRecord,
  type CatchUpGatewayResolveRequest,
  type CatchUpGatewayServerPolicy,
  type CatchUpGatewayTransportMode,
} from "./catchup-gateway-contracts.js";
import { parseProxyTargetUrl } from "./proxy-url.js";

export interface AssetClassification {
  sourceSignature: string;
  transportMode: CatchUpGatewayTransportMode;
  selectedCandidateUrl: string;
  fallbackReason: string | null;
}

const dedupeUrls = (urls: readonly string[]): string[] => {
  const uniqueUrls: string[] = [];
  const seen = new Set<string>();

  for (const url of urls) {
    const trimmed = url.trim();
    if (!trimmed || seen.has(trimmed)) {
      continue;
    }

    seen.add(trimmed);
    uniqueUrls.push(trimmed);
  }

  return uniqueUrls;
};

const flattenCandidates = (request: CatchUpGatewayResolveRequest): string[] => dedupeUrls([
  ...request.sourceCandidates.redirectUrls,
  ...request.sourceCandidates.queryUrls,
  ...request.sourceCandidates.legacyUrls,
]);

const buildSourceSignature = (urls: readonly string[]): string => {
  const normalized = urls.map((url) => {
    const parsedProxy = parseProxyTargetUrl(url);
    return parsedProxy?.upstreamUrl.toString() ?? url;
  });

  return createHash("sha1")
    .update(JSON.stringify(normalized))
    .digest("hex")
    .slice(0, 16);
};

const firstProxyCandidate = (urls: readonly string[]): string | null => (
  urls.find((url) => Boolean(parseProxyTargetUrl(url)?.encodedTarget)) ?? null
);

const firstDirectCandidate = (urls: readonly string[]): string | null => (
  urls.find((url) => !parseProxyTargetUrl(url)?.encodedTarget) ?? null
);

const isAllowedMode = (
  allowedModes: readonly CatchUpGatewayTransportMode[],
  mode: CatchUpGatewayTransportMode,
): boolean => allowedModes.includes(mode);

export class AssetClassifier {
  classify(args: {
    request: CatchUpGatewayResolveRequest;
    policy: CatchUpGatewayServerPolicy;
    channelCapability: CatchUpGatewayChannelCapabilityRecord;
    hotChannelMode?: CatchUpGatewayTransportMode | null;
  }): AssetClassification {
    const orderedCandidates = flattenCandidates(args.request);
    if (orderedCandidates.length === 0) {
      throw new Error("Gateway resolve request has no source candidates.");
    }

    const proxyCandidate = firstProxyCandidate(orderedCandidates);
    const directCandidate = firstDirectCandidate(orderedCandidates);
    const preferredMode = (
      args.request.debugOverride?.transportMode ??
      args.channelCapability.preferredModeHint ??
      args.hotChannelMode ??
      null
    );

    let transportMode: CatchUpGatewayTransportMode | null = null;
    let fallbackReason: string | null = null;

    if (preferredMode && isAllowedMode(args.policy.allowedModes, preferredMode)) {
      transportMode = preferredMode;
      fallbackReason = args.request.debugOverride?.transportMode
        ? "debug-override"
        : (
          args.channelCapability.preferredModeHint
            ? "preferred-mode-hint"
            : "hot-path-mode"
        );
    } else if (proxyCandidate && isAllowedMode(args.policy.allowedModes, "proxy-normalized")) {
      transportMode = "proxy-normalized";
    } else if (directCandidate && isAllowedMode(args.policy.allowedModes, "provider-direct")) {
      transportMode = "provider-direct";
    } else if (proxyCandidate && isAllowedMode(args.policy.allowedModes, "proxy-remuxed")) {
      transportMode = "proxy-remuxed";
      fallbackReason = "normalized-unavailable";
    } else if (directCandidate && isAllowedMode(args.policy.allowedModes, "proxy-normalized")) {
      transportMode = "proxy-normalized";
      fallbackReason = "proxy-enforced";
    }

    if (!transportMode) {
      throw new Error("No allowed catch-up gateway transport mode for the current request.");
    }

    return {
      sourceSignature: buildSourceSignature(orderedCandidates),
      transportMode,
      selectedCandidateUrl: (
        transportMode === "provider-direct"
          ? (directCandidate ?? orderedCandidates[0] ?? "")
          : (proxyCandidate ?? directCandidate ?? orderedCandidates[0] ?? "")
      ),
      fallbackReason,
    };
  }
}
