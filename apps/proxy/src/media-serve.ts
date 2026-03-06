import type { CatchUpGatewayTransportMode } from "./catchup-gateway-contracts.js";
import {
  buildProxyUrlForAbsoluteUrl,
  isProxyTargetUrl,
  parseProxyTargetUrl,
} from "./proxy-url.js";

const LOCAL_PROXY_PROGRAM_ID_PARAM = "__lumenProgramId";
const LOCAL_PROXY_STREAM_ID_PARAM = "__lumenStreamId";
const LOCAL_PROXY_START_PARAM = "__lumenStart";
const LOCAL_PROXY_DURATION_PARAM = "__lumenDuration";
const LOCAL_PROXY_TRANSPORT_PARAM = "__lumenTransport";
const LOCAL_PROXY_FALLBACK_REASON_PARAM = "__lumenFallbackReason";
const PROXY_REMUX_TRANSPORT_HINT = "remux-hls";

const absolutizeUrl = (value: string, requestOrigin: string): string => {
  try {
    return new URL(value, requestOrigin).toString();
  } catch {
    return value;
  }
};

const decorateProxyCatchUpUrl = (
  url: string,
  metadata: {
    programId: string;
    streamId: number;
    startTimestamp: number;
    durationSeconds: number;
    transportHint?: string;
    fallbackReason?: string | null;
  },
): string => {
  if (!isProxyTargetUrl(url)) {
    return url;
  }

  const parsed = new URL(url);
  parsed.searchParams.set(LOCAL_PROXY_PROGRAM_ID_PARAM, metadata.programId);
  parsed.searchParams.set(LOCAL_PROXY_STREAM_ID_PARAM, String(metadata.streamId));
  parsed.searchParams.set(LOCAL_PROXY_START_PARAM, String(metadata.startTimestamp));
  parsed.searchParams.set(LOCAL_PROXY_DURATION_PARAM, String(metadata.durationSeconds));
  if (metadata.transportHint) {
    parsed.searchParams.set(LOCAL_PROXY_TRANSPORT_PARAM, metadata.transportHint);
  }
  if (metadata.fallbackReason) {
    parsed.searchParams.set(LOCAL_PROXY_FALLBACK_REASON_PARAM, metadata.fallbackReason);
  }
  return parsed.toString();
};

export const resolveGatewayPlayback = ({
  selectedCandidateUrl,
  requestOrigin,
  transportMode,
  programId,
  streamId,
  startTimestamp,
  durationSeconds,
  fallbackReason,
}: {
  selectedCandidateUrl: string;
  requestOrigin: string;
  transportMode: CatchUpGatewayTransportMode;
  programId: string;
  streamId: number;
  startTimestamp: number;
  durationSeconds: number;
  fallbackReason: string | null;
}): {
  playbackUrl: string;
  upstreamPreparationUrl: URL | null;
} => {
  if (transportMode === "provider-direct") {
    return {
      playbackUrl: absolutizeUrl(selectedCandidateUrl, requestOrigin),
      upstreamPreparationUrl: null,
    };
  }

  const proxiedUrl = isProxyTargetUrl(selectedCandidateUrl)
    ? absolutizeUrl(selectedCandidateUrl, requestOrigin)
    : buildProxyUrlForAbsoluteUrl(selectedCandidateUrl, requestOrigin);
  const playbackUrl = decorateProxyCatchUpUrl(proxiedUrl, {
    programId,
    streamId,
    startTimestamp,
    durationSeconds,
    transportHint: transportMode === "proxy-remuxed" ? PROXY_REMUX_TRANSPORT_HINT : undefined,
    fallbackReason,
  });

  return {
    playbackUrl,
    upstreamPreparationUrl: transportMode === "proxy-remuxed"
      ? (parseProxyTargetUrl(playbackUrl)?.upstreamUrl ?? null)
      : null,
  };
};
