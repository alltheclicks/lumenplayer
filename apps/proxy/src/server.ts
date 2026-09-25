import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from "fastify";
import { once } from "node:events";
import { Writable } from "node:stream";
import { gzipSync, gunzipSync } from "node:zlib";
import { createCatchUpGateway } from "./catchup-gateway.js";
import {
  createCatchUpRemuxController,
  type CatchUpRemuxController,
} from "./catchup-remux.js";
import {
  isCatchUpGatewayResolveRequest,
  type CatchUpGatewayResolveRequest,
} from "./catchup-gateway-contracts.js";
import { createDefaultServerPolicy } from "./server-registry.js";
import { redactSensitiveText, sanitizeLogRecord } from "./privacy-redaction.js";
import {
  SSO_TOKEN_MAX_LENGTH,
  createIpRateLimiter,
  createSsoReplayCache,
  decryptSsoToken,
  parseSsoSecret,
} from "./sso.js";
import {
  PLAYER_ANALYTICS_COOKIE_NAME,
  PLAYER_ANALYTICS_MAX_BATCH_BYTES,
  PLAYER_ANALYTICS_MAX_REPLAY_BYTES,
  PLAYER_ANALYTICS_MAX_REPLAY_UNCOMPRESSED_BYTES,
  analyticsDestinationsMatchEnvironment,
  bindPlayerAnalyticsBatch,
  isPlayerAnalyticsUuid,
  mintPlayerAnalyticsBinding,
  parsePlayerAnalyticsBinding,
  readCookie,
  sanitizePlayerAnalyticsValue,
  serializePlayerAnalyticsCookie,
} from "./player-analytics.js";

const XTREAM_PROXY_BASE_PATH = "/xui-api";
const XTREAM_HLS_ROOT_PATH = "/hlsr/";
const XTREAM_STREAMING_ROOT_PATH = "/streaming/";
const XTREAM_TIMESHIFT_ROOT_PATH = "/timeshift/";
const XTREAM_TIMESHIFT_HLS_ROOT_PATH = "/timeshift_hls/";
const MPEG_TS_PACKET_SIZE = 188;
const MPEG_TS_SYNC_BYTE = 0x47;
const MAX_TRANSPORT_STREAM_SYNC_SCAN_BYTES = MPEG_TS_PACKET_SIZE * 20;
const RETRYABLE_METHODS = new Set(["GET", "HEAD"]);
const REDIRECT_STATUS_CODES = new Set([301, 302, 307, 308]);
const HLS_MANIFEST_CONTENT_TYPES = new Set([
  "application/vnd.apple.mpegurl",
  "application/x-mpegurl",
]);
const MPEG_TS_CONTENT_TYPES = new Set([
  "video/mp2t",
  "video/MP2T".toLowerCase(),
]);
const MEDIAKING_CATCHUP_HOSTS = [
  "mediaking.fi",
  "castcdn.net",
];
const MEDIAKING_CATCHUP_EXACT_HOSTS = new Set([
  "79.137.99.121",
]);
const HOP_BY_HOP_HEADERS = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
]);
const FETCH_DECODED_BODY_HEADERS = new Set([
  "content-encoding",
  "content-length",
]);
const OBSERVE_DEFAULT_BODY_LIMIT_BYTES = 16 * 1024;
const OBSERVE_DEFAULT_MAX_EVENTS_PER_REQUEST = 10;
const OBSERVE_DEFAULT_RATE_LIMIT_PER_MINUTE = 120;
const OBSERVE_RATE_LIMIT_WINDOW_MS = 60_000;
const OBSERVE_MAX_RATE_LIMIT_CLIENTS = 2_048;
const OBSERVE_MAX_EVENT_PROPERTIES = 32;
const OBSERVE_MAX_NESTING_DEPTH = 6;
const OBSERVE_MAX_ARRAY_ITEMS = 50;
const OBSERVE_MAX_STRING_LENGTH = 4_096;
const OBSERVE_EVENT_NAME_PATTERN = /^[a-zA-Z0-9._:-]+$/;
const OBSERVE_SEVERITIES = new Set(["info", "warn", "error"]);

export type ProxyErrorCode = "missing_target" | "blocked_host" | "upstream_timeout" | "transport_error";

export interface ProxyServerOptions {
  allowedHosts?: string[];
  timeoutMs?: number;
  retryCount?: number;
  sweepIntervalMs?: number;
  fetchImpl?: typeof fetch;
  logger?: boolean;
  env?: NodeJS.ProcessEnv;
  remuxController?: CatchUpRemuxController;
  observeBodyLimitBytes?: number;
  observeMaxEventsPerRequest?: number;
  observeRateLimitPerMinute?: number;
  observeNow?: () => number;
  /** Number of reverse-proxy hops Fastify may trust when resolving request.ip. */
  trustProxyHops?: number;
  /**
   * Explicit CORS origin allowlist (e.g. the Cast receiver origin). Empty =>
   * wildcard `*` (default, unchanged). (M1.3-e)
   */
  allowedCorsOrigins?: string[];
}

type ObserveRateLimitState = {
  count: number;
  windowStartedAt: number;
};

type ParsedTarget = {
  baseUrl: URL;
  host: string;
};

type ProxyHandlerRequest = FastifyRequest<{
  Params: {
    encodedTarget: string;
    "*": string;
  };
}>;

const trimTrailingSlash = (value: string): string => value.trim().replace(/\/+$/, "");

const parseNonNegativeInteger = (value: string | undefined, fallback: number): number => {
  const parsed = Number.parseInt(value ?? "", 10);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return fallback;
  }
  return parsed;
};

const parsePositiveInteger = (value: string | undefined, fallback: number): number => {
  const parsed = Number.parseInt(value ?? "", 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return parsed;
};

const isPlainObject = (value: unknown): value is Record<string, unknown> => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
};

const isBoundedObserveValue = (value: unknown, depth = 0): boolean => {
  if (depth > OBSERVE_MAX_NESTING_DEPTH) {
    return false;
  }
  if (value === null || typeof value === "boolean") {
    return true;
  }
  if (typeof value === "number") {
    return Number.isFinite(value);
  }
  if (typeof value === "string") {
    return value.length <= OBSERVE_MAX_STRING_LENGTH;
  }
  if (Array.isArray(value)) {
    return value.length <= OBSERVE_MAX_ARRAY_ITEMS
      && value.every((entry) => isBoundedObserveValue(entry, depth + 1));
  }
  if (!isPlainObject(value)) {
    return false;
  }

  const entries = Object.entries(value);
  return entries.length <= OBSERVE_MAX_EVENT_PROPERTIES
    && entries.every(([key, entry]) => (
      key.length > 0
      && key.length <= 128
      && isBoundedObserveValue(entry, depth + 1)
    ));
};

const isValidObserveEvent = (value: unknown): value is Record<string, unknown> => {
  if (!isPlainObject(value) || !isBoundedObserveValue(value)) {
    return false;
  }
  if (
    typeof value.event !== "string"
    || value.event.length === 0
    || value.event.length > 128
    || !OBSERVE_EVENT_NAME_PATTERN.test(value.event)
  ) {
    return false;
  }
  if (
    value.severity !== undefined
    && (typeof value.severity !== "string" || !OBSERVE_SEVERITIES.has(value.severity))
  ) {
    return false;
  }
  return value.timestamp === undefined || (
    typeof value.timestamp === "string"
    && value.timestamp.length > 0
    && value.timestamp.length <= 64
  );
};

const extractObserveEvents = (
  body: unknown,
  maxEventsPerRequest: number,
): Record<string, unknown>[] | null => {
  if (!isPlainObject(body) || !isBoundedObserveValue(body)) {
    return null;
  }

  const events = Array.isArray(body.events) ? body.events : [body];
  if (
    events.length === 0
    || events.length > maxEventsPerRequest
    || !events.every(isValidObserveEvent)
  ) {
    return null;
  }
  return events;
};

const isHttpProtocol = (protocol: string): boolean => protocol === "http:" || protocol === "https:";

const normalizeAllowedHostEntry = (value: string): string => value.trim().toLowerCase();

export const parseAllowedHosts = (value: string | undefined): string[] => {
  if (!value) {
    return [];
  }

  return value
    .split(",")
    .map(normalizeAllowedHostEntry)
    .filter(Boolean);
};

// M1.3-e: CORS origin allowlist parsing. Origins keep their scheme but are
// trimmed and lower-cased so the request `Origin` header can be matched
// exactly. An empty/unset value means "wildcard" (the prior behavior).
export const parseAllowedCorsOrigins = (value: string | undefined): string[] => {
  if (!value) {
    return [];
  }

  return value
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
};

/**
 * Resolves the value for `access-control-allow-origin`:
 * - no allowlist configured -> "*" (unchanged default, lets any sender/Cast
 *   device fetch segments)
 * - request Origin is in the allowlist -> echo that exact origin
 * - request Origin missing/not allowed -> first configured origin (so a
 *   configured Cast receiver origin still receives a valid, non-wildcard header)
 */
export const resolveCorsAllowOrigin = (
  requestOrigin: string | undefined,
  allowedCorsOrigins: string[],
): string => {
  if (allowedCorsOrigins.length === 0) {
    return "*";
  }

  const normalizedRequestOrigin = requestOrigin?.trim().toLowerCase();
  if (normalizedRequestOrigin && allowedCorsOrigins.includes(normalizedRequestOrigin)) {
    return requestOrigin as string;
  }

  return allowedCorsOrigins[0];
};

export const isHostAllowed = (host: string, allowedHosts: string[]): boolean => {
  const normalizedHost = host.trim().toLowerCase();
  if (!normalizedHost) {
    return false;
  }

  return allowedHosts.some((candidate) => {
    if (candidate === "*") {
      return true;
    }
    if (candidate.startsWith("*.")) {
      const suffix = candidate.slice(2);
      return normalizedHost === suffix || normalizedHost.endsWith(`.${suffix}`);
    }
    return normalizedHost === candidate;
  });
};

const parseEncodedTarget = (encodedTarget: string): ParsedTarget | null => {
  const decoded = decodeURIComponent(encodedTarget).trim();
  if (!decoded) {
    return null;
  }

  const normalizedTarget = trimTrailingSlash(decoded);
  let baseUrl: URL;
  try {
    baseUrl = new URL(normalizedTarget);
  } catch {
    return null;
  }

  if (!isHttpProtocol(baseUrl.protocol)) {
    return null;
  }

  return {
    baseUrl,
    host: baseUrl.hostname.toLowerCase(),
  };
};

const buildUpstreamUrl = (baseUrl: URL, suffixPath: string, search: string): URL => {
  const nextUrl = new URL(baseUrl.toString());
  const normalizedSuffixPath = suffixPath.trim().replace(/^\/+/, "");

  if (normalizedSuffixPath.length > 0) {
    const basePath = nextUrl.pathname.replace(/\/+$/, "");
    nextUrl.pathname = `${basePath}/${normalizedSuffixPath}`.replace(/\/{2,}/g, "/");
  }

  nextUrl.search = search;
  nextUrl.hash = "";
  return nextUrl;
};

const isHlsManifestResponse = (upstreamUrl: URL, headers: Headers): boolean => {
  const contentType = headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() ?? "";
  return upstreamUrl.pathname.toLowerCase().endsWith(".m3u8") || HLS_MANIFEST_CONTENT_TYPES.has(contentType);
};

const isMpegTsResponse = (headers: Headers): boolean => {
  const contentType = headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() ?? "";
  return MPEG_TS_CONTENT_TYPES.has(contentType);
};

const isMediaKingCatchUpHost = (host: string): boolean => {
  const normalizedHost = host.trim().toLowerCase();
  return (
    MEDIAKING_CATCHUP_EXACT_HOSTS.has(normalizedHost) ||
    MEDIAKING_CATCHUP_HOSTS.some((knownHost) => (
      normalizedHost === knownHost || normalizedHost.endsWith(`.${knownHost}`)
    ))
  );
};

const isMediaKingTimeshiftManifest = (upstreamUrl: URL): boolean => {
  const pathname = upstreamUrl.pathname.toLowerCase();
  return (
    isMediaKingCatchUpHost(upstreamUrl.hostname) &&
    (pathname === "/streaming/timeshift.php" || pathname === "/streaming/timeshift_hls.php")
  );
};

const isMediaKingTimeshiftSegment = (upstreamUrl: URL): boolean => {
  const pathname = upstreamUrl.pathname.toLowerCase();
  const segment = upstreamUrl.searchParams.get("seg")?.trim().toLowerCase() ?? "";
  return (
    isMediaKingCatchUpHost(upstreamUrl.hostname) &&
    (pathname === "/streaming/timeshift.php" || pathname === "/streaming/timeshift_hls.php") &&
    /^\d+_\d+\.ts$/.test(segment)
  );
};

const findTransportStreamSyncOffset = (body: Uint8Array): number => {
  const scanLength = Math.min(body.length, MAX_TRANSPORT_STREAM_SYNC_SCAN_BYTES);

  for (let offset = 0; offset < scanLength; offset += 1) {
    if (body[offset] !== MPEG_TS_SYNC_BYTE) {
      continue;
    }

    let syncMatches = 0;
    for (
      let packetOffset = offset;
      packetOffset < body.length && syncMatches < 3;
      packetOffset += MPEG_TS_PACKET_SIZE
    ) {
      if (body[packetOffset] !== MPEG_TS_SYNC_BYTE) {
        break;
      }
      syncMatches += 1;
    }

    if (syncMatches >= 2) {
      return offset;
    }
  }

  return 0;
};

const concatUint8Arrays = (chunks: Uint8Array[], totalLength: number): Uint8Array => {
  if (chunks.length === 1 && chunks[0]?.byteLength === totalLength) {
    return chunks[0];
  }

  const output = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return output;
};

const writeRawChunk = async (
  raw: FastifyReply["raw"],
  chunk: Uint8Array,
): Promise<void> => {
  if (chunk.byteLength === 0 || raw.destroyed) {
    return;
  }

  const buffer = Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength);
  if (!raw.write(buffer)) {
    await once(raw, "drain");
  }
};

const parseContentLength = (headers: Headers): number | null => {
  const value = Number.parseInt(headers.get("content-length") ?? "", 10);
  return Number.isFinite(value) && value >= 0 ? value : null;
};

const streamTransportSegmentWithLeadingJunkStripped = async ({
  reply,
  statusCode,
  headers,
  body,
  allowOrigin = "*",
}: {
  reply: FastifyReply;
  statusCode: number;
  headers: Headers;
  body: ReadableStream<Uint8Array>;
  allowOrigin?: string;
}): Promise<void> => {
  const reader = body.getReader();
  const prefixChunks: Uint8Array[] = [];
  let prefixLength = 0;
  let pendingRemainder: Uint8Array | null = null;
  let upstreamDone = false;

  while (prefixLength < MAX_TRANSPORT_STREAM_SYNC_SCAN_BYTES && !upstreamDone) {
    const read = await reader.read();
    if (read.done) {
      upstreamDone = true;
      break;
    }

    const chunk = read.value;
    const remainingPrefixBytes = MAX_TRANSPORT_STREAM_SYNC_SCAN_BYTES - prefixLength;
    if (chunk.byteLength > remainingPrefixBytes) {
      prefixChunks.push(chunk.subarray(0, remainingPrefixBytes));
      prefixLength += remainingPrefixBytes;
      pendingRemainder = chunk.subarray(remainingPrefixBytes);
      break;
    }

    prefixChunks.push(chunk);
    prefixLength += chunk.byteLength;
  }

  const prefix = concatUint8Arrays(prefixChunks, prefixLength);
  const syncOffset = findTransportStreamSyncOffset(prefix);
  const contentLength = parseContentLength(headers);

  reply.hijack();
  reply.raw.statusCode = statusCode;
  applyUpstreamHeadersToRawResponse(reply, headers, allowOrigin);
  if (contentLength !== null) {
    reply.raw.setHeader("content-length", String(Math.max(0, contentLength - syncOffset)));
  }

  await writeRawChunk(reply.raw, prefix.subarray(syncOffset));
  if (pendingRemainder) {
    await writeRawChunk(reply.raw, pendingRemainder);
  }

  while (!upstreamDone) {
    const read = await reader.read();
    if (read.done) {
      upstreamDone = true;
      break;
    }
    await writeRawChunk(reply.raw, read.value);
  }

  if (!reply.raw.destroyed) {
    reply.raw.end();
  }
};

const isPlaylistUriLine = (line: string): boolean => {
  const trimmedLine = line.trim();
  return trimmedLine.length > 0 && !trimmedLine.startsWith("#");
};

const isMediaKingSegmentUri = (line: string, segmentIndex: number): boolean => (
  new RegExp(`[?&]seg=${segmentIndex}_\\d+\\.ts(?:$|[&#])`).test(line)
);

const addMediaKingCatchUpDiscontinuity = (manifestBody: string, upstreamUrl: URL): string => {
  if (!isMediaKingTimeshiftManifest(upstreamUrl) || manifestBody.includes("#EXT-X-DISCONTINUITY")) {
    return manifestBody;
  }

  const lines = manifestBody.split(/\r?\n/);
  const output: string[] = [];
  let sawFirstArchiveSegment = false;
  let inserted = false;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (!inserted && sawFirstArchiveSegment && line.trim().startsWith("#EXTINF")) {
      const nextUri = lines.slice(index + 1).find(isPlaylistUriLine) ?? "";
      if (isMediaKingSegmentUri(nextUri, 1)) {
        output.push("#EXT-X-DISCONTINUITY");
        inserted = true;
      }
    }

    output.push(line);

    if (isPlaylistUriLine(line) && isMediaKingSegmentUri(line, 0)) {
      sawFirstArchiveSegment = true;
    }
  }

  return inserted ? output.join("\n") : manifestBody;
};

const rewriteHlsManifestBody = (manifestBody: string, encodedTarget: string, upstreamUrl: URL): string => {
  const normalizedEncodedTarget = encodeURIComponent(encodedTarget);
  const rewriteAbsoluteAssetUrl = (rawUrl: string): string => {
    try {
      const parsed = new URL(rawUrl);
      return `${XTREAM_PROXY_BASE_PATH}/${encodeURIComponent(parsed.origin)}${parsed.pathname}${parsed.search}`;
    } catch {
      return rawUrl;
    }
  };

  const rewrittenManifestBody = manifestBody
    .replace(/(^|["'\n\r])(https?:\/\/[^"'\s]+\/(?:hlsr|streaming|timeshift_hls|timeshift)\/[^"'\s]*)/g, (
      _match,
      prefix: string,
      rawUrl: string,
    ) => `${prefix}${rewriteAbsoluteAssetUrl(rawUrl)}`)
    .replace(/(^|["'\n\r])\/hlsr\//g, (_match, prefix: string) => (
      `${prefix}${XTREAM_PROXY_BASE_PATH}/${normalizedEncodedTarget}${XTREAM_HLS_ROOT_PATH}`
    ))
    .replace(/(^|["'\n\r])\/streaming\//g, (_match, prefix: string) => (
      `${prefix}${XTREAM_PROXY_BASE_PATH}/${normalizedEncodedTarget}${XTREAM_STREAMING_ROOT_PATH}`
    ))
    .replace(/(^|["'\n\r])\/timeshift_hls\//g, (_match, prefix: string) => (
      `${prefix}${XTREAM_PROXY_BASE_PATH}/${normalizedEncodedTarget}${XTREAM_TIMESHIFT_HLS_ROOT_PATH}`
    ))
    .replace(/(^|["'\n\r])\/timeshift\//g, (_match, prefix: string) => (
      `${prefix}${XTREAM_PROXY_BASE_PATH}/${normalizedEncodedTarget}${XTREAM_TIMESHIFT_ROOT_PATH}`
    ));

  return addMediaKingCatchUpDiscontinuity(rewrittenManifestBody, upstreamUrl);
};

const buildForwardHeaders = (requestHeaders: Record<string, string | string[] | undefined>): Headers => {
  const headers = new Headers();

  for (const [headerName, headerValue] of Object.entries(requestHeaders)) {
    const normalizedName = headerName.toLowerCase();
    if (
      normalizedName === "host" ||
      normalizedName === "accept-encoding" ||
      HOP_BY_HOP_HEADERS.has(normalizedName) ||
      headerValue == null
    ) {
      continue;
    }

    if (Array.isArray(headerValue)) {
      headers.set(headerName, headerValue.join(", "));
      continue;
    }

    headers.set(headerName, headerValue);
  }

  headers.set("accept-encoding", "identity");
  return headers;
};

const applyCorsHeaders = (
  reply: FastifyReply,
  allowedMethods = "GET,HEAD,OPTIONS",
): void => {
  reply.header("access-control-allow-origin", "*");
  reply.header("access-control-allow-methods", allowedMethods);
  reply.header("access-control-allow-headers", "*");
  reply.header("access-control-expose-headers", "*");
};

const applyUpstreamHeaders = (reply: FastifyReply, headers: Headers, rewrittenLocation?: string): void => {
  for (const [headerName, headerValue] of headers.entries()) {
    const normalizedName = headerName.toLowerCase();
    if (HOP_BY_HOP_HEADERS.has(normalizedName) || FETCH_DECODED_BODY_HEADERS.has(normalizedName)) {
      continue;
    }
    if (normalizedName === "location" && rewrittenLocation) {
      reply.header(headerName, rewrittenLocation);
      continue;
    }
    reply.header(headerName, headerValue);
  }
};

const applyUpstreamHeadersToRawResponse = (
  reply: FastifyReply,
  headers: Headers,
  allowOrigin = "*",
  rewrittenLocation?: string,
): void => {
  // Hijacked (streamed) responses bypass the onSend hook, so the resolved CORS
  // origin must be applied directly here — this is the path the Cast receiver
  // device uses to fetch HLS segments. (M1.3-e)
  reply.raw.setHeader("access-control-allow-origin", allowOrigin);
  if (allowOrigin !== "*") {
    reply.raw.setHeader("vary", "Origin");
  }
  reply.raw.setHeader("access-control-allow-methods", "GET,HEAD,OPTIONS");
  reply.raw.setHeader("access-control-allow-headers", "*");
  reply.raw.setHeader("access-control-expose-headers", "*");

  for (const [headerName, headerValue] of headers.entries()) {
    const normalizedName = headerName.toLowerCase();
    if (HOP_BY_HOP_HEADERS.has(normalizedName) || FETCH_DECODED_BODY_HEADERS.has(normalizedName)) {
      continue;
    }
    if (normalizedName === "location" && rewrittenLocation) {
      reply.raw.setHeader(headerName, rewrittenLocation);
      continue;
    }
    reply.raw.setHeader(headerName, headerValue);
  }
};

const isAbortError = (error: unknown): boolean => (
  typeof error === "object" &&
  error !== null &&
  "name" in error &&
  (error as { name: string }).name === "AbortError"
);

const toErrorMessage = (error: unknown, fallback: string): string => {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }
  return fallback;
};

const toProxyErrorStatusCode = (errorCode: ProxyErrorCode): number => {
  switch (errorCode) {
    case "missing_target":
      return 400;
    case "blocked_host":
      return 403;
    case "upstream_timeout":
      return 504;
    case "transport_error":
      return 502;
    default:
      return 500;
  }
};

const sendProxyError = (
  reply: FastifyReply,
  errorCode: ProxyErrorCode,
  message: string,
): FastifyReply => (
  reply
    .code(toProxyErrorStatusCode(errorCode))
    .type("application/json; charset=utf-8")
    .send({
      error: errorCode,
      message,
    })
);

const sendRemuxError = (
  reply: FastifyReply,
  statusCode: number,
  message: string,
): FastifyReply => (
  reply
    .code(statusCode)
    .type("application/json; charset=utf-8")
    .send({
      error: "remux_unavailable",
      message,
    })
);

const rewriteRedirectLocation = (
  locationValue: string,
  upstreamUrl: URL,
  allowedHosts: string[],
): { value: string } | { errorCode: ProxyErrorCode; message: string } => {
  let resolvedLocation: URL;
  try {
    resolvedLocation = new URL(locationValue, upstreamUrl);
  } catch {
    return {
      errorCode: "transport_error",
      message: "Invalid upstream redirect location.",
    };
  }

  if (!isHttpProtocol(resolvedLocation.protocol)) {
    return {
      errorCode: "transport_error",
      message: "Unsupported upstream redirect protocol.",
    };
  }

  if (!isHostAllowed(resolvedLocation.hostname, allowedHosts)) {
    return {
      errorCode: "blocked_host",
      message: "Redirect host is not allowed by proxy policy.",
    };
  }

  const encodedTarget = encodeURIComponent(`${resolvedLocation.protocol}//${resolvedLocation.host}`);
  return {
    value: `${XTREAM_PROXY_BASE_PATH}/${encodedTarget}${resolvedLocation.pathname}${resolvedLocation.search}`,
  };
};

const createRequestLoggerPayload = (
  request: FastifyRequest,
  upstreamUrl: URL,
  durationMs: number,
  payload: Record<string, unknown>,
): Record<string, unknown> => sanitizeLogRecord({
  event: "xtream_proxy_request",
  method: request.method,
  path: request.url,
  upstreamHost: upstreamUrl.host,
  durationMs,
  ...payload,
});

const applyPrivateResponseHeaders = (reply: FastifyReply): void => {
  reply.header("cache-control", "no-store");
  reply.header("pragma", "no-cache");
  reply.header("expires", "0");
  reply.header("referrer-policy", "no-referrer");
  reply.header("x-content-type-options", "nosniff");
};

// Existing SSO/analytics routes preserve their Cloudflare-aware client key.
// New observability limits use Fastify request.ip with an explicit trusted-hop
// count so arbitrary forwarding headers are never trusted by default.
const resolveClientKey = (request: FastifyRequest): string => {
  const cfConnectingIp = request.headers["cf-connecting-ip"];
  const forwardedFor = request.headers["x-forwarded-for"];
  const forwardedClient = (Array.isArray(forwardedFor) ? forwardedFor[0] : forwardedFor)
    ?.split(",")[0]
    ?.trim();

  return (typeof cfConnectingIp === "string" && cfConnectingIp.trim())
    || forwardedClient
    || request.ip;
};

const isAllowedBrowserOrigin = (
  request: FastifyRequest,
  allowedCorsOrigins: string[],
): boolean => {
  const requestOrigin = request.headers.origin?.trim().toLowerCase();
  return allowedCorsOrigins.length === 0
    || Boolean(requestOrigin && allowedCorsOrigins.includes(requestOrigin));
};

// Browsers omit Origin on same-origin GETs. Only the read-only configuration
// endpoint may use Fetch Metadata plus a trusted referrer instead; POST routes
// keep their existing Origin checks and every config read still needs a binding.
const isAllowedAnalyticsConfigRequest = (
  request: FastifyRequest,
  allowedCorsOrigins: string[],
): boolean => {
  if (isAllowedBrowserOrigin(request, allowedCorsOrigins)) return true;
  if (
    request.headers.origin !== undefined
    || request.headers['sec-fetch-site'] !== 'same-origin'
    || typeof request.headers.referer !== 'string'
  ) return false;
  try {
    return allowedCorsOrigins.includes(new URL(request.headers.referer).origin.toLowerCase());
  } catch {
    return false;
  }
};

const isObserveRoute = (request: FastifyRequest): boolean => (
  request.url.split("?", 1)[0] === "/observe"
);

const isCatchUpRequestUrl = (upstreamUrl: URL): boolean => {
  const pathname = upstreamUrl.pathname.toLowerCase();
  return (
    pathname.startsWith("/timeshift/") ||
    pathname.startsWith("/timeshift_hls/") ||
    pathname === "/streaming/timeshift.php" ||
    pathname === "/streaming/timeshift_hls.php"
  );
};

// The provider-side MP2->AAC shadow endpoint (timeshift_shadow.php) builds an
// fMP4 HLS manifest by re-muxing every archive minute of a program. A COLD build
// of a multi-hour program can take well over the default 10s upstream budget
// before it serves the manifest (the server caches the result, so subsequent
// hits are fast). Give shadow manifest requests a much longer timeout so the
// cold build can finish instead of aborting and forcing the legacy fallback.
const isShadowRemuxRequestUrl = (upstreamUrl: URL): boolean => (
  upstreamUrl.pathname.toLowerCase() === "/streaming/timeshift_shadow.php"
);

const isRemuxPlaybackHint = (upstreamUrl: URL): boolean => (
  upstreamUrl.searchParams.get("__lumenTransport") === "remux-hls"
);

const buildRequestBaseUrl = (request: FastifyRequest): string => {
  const host = request.headers.host ?? "localhost";
  return `${request.protocol}://${host}${request.url}`;
};

const sendRemuxDisabledError = (
  reply: FastifyReply,
  message = "Catch-up remux/transcode playback is disabled by the no-media-processing runtime policy.",
): FastifyReply => (
  reply
    .code(410)
    .type("application/json; charset=utf-8")
    .send({
      error: "remux_disabled",
      message,
    })
);

const buildRemuxAssetResponse = async ({
  request,
  reply,
}: {
  request: FastifyRequest;
  reply: FastifyReply;
}): Promise<void> => {
  applyCorsHeaders(reply);

  if (request.method === "OPTIONS") {
    reply.code(204).send();
    return;
  }

  sendRemuxDisabledError(reply);
};

export const createProxyServer = (options: ProxyServerOptions = {}): FastifyInstance => {
  const env = options.env ?? process.env;
  const allowedHosts = (
    options.allowedHosts ??
    parseAllowedHosts(env.XTREAM_PROXY_ALLOWED_HOSTS)
  ).map(normalizeAllowedHostEntry);
  const timeoutMs = options.timeoutMs ?? parseNonNegativeInteger(env.XTREAM_PROXY_TIMEOUT_MS, 10_000);
  // Cold shadow remux builds (timeshift_shadow.php) can take much longer than a
  // normal upstream request; give them a dedicated, larger budget.
  const shadowRemuxTimeoutMs = parseNonNegativeInteger(
    env.XTREAM_PROXY_SHADOW_TIMEOUT_MS,
    90_000,
  );
  const retryCount = options.retryCount ?? parseNonNegativeInteger(env.XTREAM_PROXY_RETRY_COUNT, 1);
  const sweepIntervalMs = options.sweepIntervalMs ?? parseNonNegativeInteger(
    env.LUMEN_CATCHUP_GATEWAY_SWEEP_INTERVAL_MS,
    60_000,
  );
  const remuxPerServerConcurrency = Math.max(
    1,
    parseNonNegativeInteger(env.LUMEN_CATCHUP_GATEWAY_PER_SERVER_CONCURRENCY, 2),
  );
  const remuxPlaybackRequestsAllowed = createDefaultServerPolicy(env).allowedModes.includes("proxy-remuxed");
  const allowedCorsOrigins = (
    options.allowedCorsOrigins ??
    parseAllowedCorsOrigins(env.XTREAM_PROXY_ALLOWED_CORS_ORIGINS)
  )
    .map((origin) => origin.trim().toLowerCase())
    .filter(Boolean);
  const ssoSecret = parseSsoSecret(env.PLAYER_SSO_SECRET);
  const ssoRateLimitPerMinute = parseNonNegativeInteger(env.LUMEN_SSO_RATE_LIMIT_PER_MINUTE, 10);
  const analyticsIngestSecret = env.PLAYER_ANALYTICS_INGEST_SECRET?.trim() ?? "";
  const analyticsIngestUrl = env.PLAYER_ANALYTICS_INGEST_URL?.trim();
  const analyticsReplayUrl = env.PLAYER_ANALYTICS_REPLAY_URL?.trim();
  const analyticsForwardingEnabled = Boolean(
    ssoSecret &&
    analyticsIngestSecret.length >= 32 &&
    analyticsIngestUrl &&
    analyticsReplayUrl
  );
  const analyticsRateLimitPerMinute = parseNonNegativeInteger(
    env.LUMEN_PLAYER_ANALYTICS_RATE_LIMIT_PER_MINUTE,
    240,
  );
  const analyticsReplayRateLimitPerMinute = parseNonNegativeInteger(
    env.LUMEN_PLAYER_REPLAY_RATE_LIMIT_PER_MINUTE,
    20,
  );
  const observeBodyLimitBytes = Math.min(65_536, Math.max(
    1_024,
    Math.floor(
      options.observeBodyLimitBytes
      ?? parsePositiveInteger(env.LUMEN_OBSERVE_BODY_LIMIT_BYTES, OBSERVE_DEFAULT_BODY_LIMIT_BYTES),
    ),
  ));
  const observeMaxEventsPerRequest = Math.min(50, Math.max(
    1,
    Math.floor(
      options.observeMaxEventsPerRequest
      ?? parsePositiveInteger(
        env.LUMEN_OBSERVE_MAX_EVENTS_PER_REQUEST,
        OBSERVE_DEFAULT_MAX_EVENTS_PER_REQUEST,
      ),
    ),
  ));
  const observeRateLimitPerMinute = Math.max(
    1,
    Math.floor(
      options.observeRateLimitPerMinute
      ?? parsePositiveInteger(
        env.LUMEN_OBSERVE_RATE_LIMIT_PER_MINUTE,
        OBSERVE_DEFAULT_RATE_LIMIT_PER_MINUTE,
      ),
    ),
  );
  const observeNow = options.observeNow ?? Date.now;
  const observeRateLimitByClient = new Map<string, ObserveRateLimitState>();
  const trustProxyHops = Math.max(
    0,
    Math.floor(
      options.trustProxyHops
      ?? parseNonNegativeInteger(env.LUMEN_TRUST_PROXY_HOPS, 1),
    ),
  );
  const fetchImpl = options.fetchImpl ?? fetch;

  const app = Fastify({
    logger: options.logger ?? true,
    // Fastify 5.12+ rejects numeric-only trust. The EXYU front proxy is the
    // local nginx; trust its loopback peer explicitly, never a direct client.
    trustProxy: trustProxyHops > 0
      ? (address, hop) => hop < trustProxyHops && (
        address === '::1' || address.startsWith('127.') || address.startsWith('::ffff:127.')
      )
      : false,
    // Request URLs may contain provider query/path credentials. Operational
    // events are logged explicitly below after privacy redaction instead.
    disableRequestLogging: true,
  });
  app.addContentTypeParser(
    ["application/gzip", "application/octet-stream"],
    { parseAs: "buffer", bodyLimit: PLAYER_ANALYTICS_MAX_REPLAY_BYTES },
    (_request, body, done) => done(null, body),
  );
  const remuxController = options.remuxController ?? createCatchUpRemuxController({
    logger: {
      info: (event, payload) => app.log.info(sanitizeLogRecord({ event, ...payload })),
      warn: (event, payload) => app.log.warn(sanitizeLogRecord({ event, ...payload })),
      error: (event, payload) => app.log.error(sanitizeLogRecord({ event, ...payload })),
    },
    env,
  });
  const catchUpGateway = createCatchUpGateway({
    logger: {
      info: (event, payload) => app.log.info(sanitizeLogRecord({ event, ...payload })),
      warn: (event, payload) => app.log.warn(sanitizeLogRecord({ event, ...payload })),
      error: (event, payload) => app.log.error(sanitizeLogRecord({ event, ...payload })),
    },
    remuxController,
    env,
  });
  const consumeObserveRateLimit = (
    clientKey: string,
    eventCount: number,
  ): { allowed: boolean; retryAfterSeconds: number } => {
    const nowMs = observeNow();
    let state = observeRateLimitByClient.get(clientKey);
    if (state && nowMs - state.windowStartedAt >= OBSERVE_RATE_LIMIT_WINDOW_MS) {
      observeRateLimitByClient.delete(clientKey);
      state = undefined;
    }

    if (!state) {
      if (observeRateLimitByClient.size >= OBSERVE_MAX_RATE_LIMIT_CLIENTS) {
        for (const [key, candidate] of observeRateLimitByClient) {
          if (nowMs - candidate.windowStartedAt >= OBSERVE_RATE_LIMIT_WINDOW_MS) {
            observeRateLimitByClient.delete(key);
          }
        }
      }
      if (observeRateLimitByClient.size >= OBSERVE_MAX_RATE_LIMIT_CLIENTS) {
        const oldest = observeRateLimitByClient.keys().next();
        if (!oldest.done) {
          observeRateLimitByClient.delete(oldest.value);
        }
      }
      state = {
        count: 0,
        windowStartedAt: nowMs,
      };
      observeRateLimitByClient.set(clientKey, state);
    }

    const retryAfterSeconds = Math.max(
      1,
      Math.ceil((state.windowStartedAt + OBSERVE_RATE_LIMIT_WINDOW_MS - nowMs) / 1_000),
    );
    if (state.count + eventCount > observeRateLimitPerMinute) {
      return { allowed: false, retryAfterSeconds };
    }

    state.count += eventCount;
    return { allowed: true, retryAfterSeconds };
  };
  const sweepTimer = sweepIntervalMs > 0
    ? setInterval(() => {
      catchUpGateway.sweep();
    }, sweepIntervalMs)
    : null;

  if (sweepTimer) {
    sweepTimer.unref?.();
  }

  app.addHook("onClose", async () => {
    if (sweepTimer) {
      clearInterval(sweepTimer);
    }
    await remuxController.close();
  });

  // M1.3-e: when an explicit CORS origin allowlist is configured, narrow the
  // wildcard `access-control-allow-origin` set by applyCorsHeaders down to the
  // resolved origin for every non-hijacked response. Hijacked (streamed)
  // responses are handled directly in applyUpstreamHeadersToRawResponse.
  if (allowedCorsOrigins.length > 0) {
    app.addHook("onSend", async (request, reply, payload) => {
      if (isObserveRoute(request) && !isAllowedBrowserOrigin(request, allowedCorsOrigins)) {
        reply.removeHeader("access-control-allow-origin");
        reply.header("vary", "Origin");
        return payload;
      }
      const resolvedOrigin = resolveCorsAllowOrigin(request.headers.origin, allowedCorsOrigins);
      reply.header("access-control-allow-origin", resolvedOrigin);
      reply.header("vary", "Origin");
      return payload;
    });
  }

  const handleProxyRequest = async (
    request: ProxyHandlerRequest,
    reply: FastifyReply,
  ): Promise<void> => {
    applyCorsHeaders(reply);

    if (request.method === "OPTIONS") {
      reply.code(204).send();
      return;
    }

    // Resolved CORS origin for the streamed (hijacked) response paths, which
    // bypass the onSend hook. (M1.3-e)
    const corsAllowOrigin = resolveCorsAllowOrigin(request.headers.origin, allowedCorsOrigins);

    const parsedTarget = parseEncodedTarget(request.params.encodedTarget);
    if (!parsedTarget) {
      sendProxyError(reply, "missing_target", "Missing or invalid proxy target.");
      return;
    }

    if (!isHostAllowed(parsedTarget.host, allowedHosts)) {
      request.log.warn({
        event: "xtream_proxy_request",
        kind: "proxy_error",
        errorCode: "blocked_host",
        requestedHost: parsedTarget.host,
      });
      sendProxyError(reply, "blocked_host", "Target host is not allowed by proxy policy.");
      return;
    }

    const requestUrl = new URL(request.raw.url ?? "/", "http://lumen-proxy.local");
    const suffixPath = request.params["*"] ?? "";
    const upstreamUrl = buildUpstreamUrl(parsedTarget.baseUrl, suffixPath, requestUrl.search);
    const requestHeaders = buildForwardHeaders(request.headers);
    const requestMethod = request.method.toUpperCase();

    if (isCatchUpRequestUrl(upstreamUrl) && isRemuxPlaybackHint(upstreamUrl)) {
      request.log.warn({
        event: "catchup.remux_disabled",
        upstreamUrl: redactSensitiveText(upstreamUrl.toString()),
      });
      sendRemuxDisabledError(reply);
      return;
    }

    if (
      RETRYABLE_METHODS.has(requestMethod) &&
      isCatchUpRequestUrl(upstreamUrl) &&
      remuxPlaybackRequestsAllowed &&
      remuxController.isRemuxPlaybackRequest(upstreamUrl)
    ) {
      try {
        const manifest = await remuxController.getManifest({
          upstreamUrl,
          serverKey: parsedTarget.host,
          perServerConcurrency: remuxPerServerConcurrency,
        });
        reply.code(200).type(manifest.contentType);
        if (requestMethod === "HEAD") {
          reply.send();
          return;
        }
        reply.send(manifest.body);
      } catch (error) {
        request.log.warn({
          event: "catchup.remux_manifest_failed",
          upstreamUrl: redactSensitiveText(upstreamUrl.toString()),
          message: redactSensitiveText(toErrorMessage(error, "Catch-up remux manifest is unavailable.")),
        });
        sendRemuxError(reply, 502, toErrorMessage(error, "Catch-up remux manifest is unavailable."));
      }
      return;
    }

    const maxAttempts = RETRYABLE_METHODS.has(requestMethod) ? retryCount + 1 : 1;
    const startedAt = performance.now();
    const effectiveTimeoutMs = isShadowRemuxRequestUrl(upstreamUrl)
      ? shadowRemuxTimeoutMs
      : timeoutMs;

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      const abortController = new AbortController();
      const timeoutHandle = setTimeout(() => {
        abortController.abort();
      }, effectiveTimeoutMs);
      let responseFinished = false;
      const handleResponseFinish = () => {
        responseFinished = true;
      };
      const handleClientClose = () => {
        if (!responseFinished && !abortController.signal.aborted) {
          abortController.abort();
        }
      };
      reply.raw.once("finish", handleResponseFinish);
      reply.raw.once("close", handleClientClose);

      try {
        const upstreamResponse = await fetchImpl(upstreamUrl.toString(), {
          method: requestMethod,
          headers: requestHeaders,
          redirect: "manual",
          signal: abortController.signal,
        });

        clearTimeout(timeoutHandle);
        const durationMs = Number((performance.now() - startedAt).toFixed(2));

        if (REDIRECT_STATUS_CODES.has(upstreamResponse.status)) {
          const redirectLocation = upstreamResponse.headers.get("location");
          if (!redirectLocation) {
            sendProxyError(reply, "transport_error", "Upstream redirect response is missing location header.");
            return;
          }

          const rewrittenLocation = rewriteRedirectLocation(redirectLocation, upstreamUrl, allowedHosts);
          if ("errorCode" in rewrittenLocation) {
            sendProxyError(reply, rewrittenLocation.errorCode, rewrittenLocation.message);
            return;
          }

          applyUpstreamHeaders(reply, upstreamResponse.headers, rewrittenLocation.value);
          reply.code(upstreamResponse.status).send();
          request.log.info(createRequestLoggerPayload(request, upstreamUrl, durationMs, {
            kind: "success",
            upstreamStatus: upstreamResponse.status,
            attempt,
            redirected: true,
          }));
          return;
        }

        if (requestMethod === "GET" && isHlsManifestResponse(upstreamUrl, upstreamResponse.headers)) {
          const manifestBody = await upstreamResponse.text();
          const rewrittenManifestBody = rewriteHlsManifestBody(manifestBody, request.params.encodedTarget, upstreamUrl);
          applyUpstreamHeaders(reply, upstreamResponse.headers);
          reply.removeHeader("content-length");
          reply.code(upstreamResponse.status).type(
            upstreamResponse.headers.get("content-type") ?? "application/vnd.apple.mpegurl",
          );
          reply.send(rewrittenManifestBody);
        } else if (
          requestMethod === "GET" &&
          isMediaKingTimeshiftSegment(upstreamUrl) &&
          isMpegTsResponse(upstreamResponse.headers) &&
          upstreamResponse.body
        ) {
          await streamTransportSegmentWithLeadingJunkStripped({
            reply,
            statusCode: upstreamResponse.status,
            headers: upstreamResponse.headers,
            body: upstreamResponse.body,
            allowOrigin: corsAllowOrigin,
          });
        } else if (upstreamResponse.body) {
          reply.hijack();
          reply.raw.statusCode = upstreamResponse.status;
          applyUpstreamHeadersToRawResponse(reply, upstreamResponse.headers, corsAllowOrigin);
          await upstreamResponse.body.pipeTo(Writable.toWeb(reply.raw));
        } else {
          applyUpstreamHeaders(reply, upstreamResponse.headers);
          reply.code(upstreamResponse.status).send();
        }

        const outcomeKind = upstreamResponse.status >= 400 ? "upstream_error" : "success";
        const logMethod = upstreamResponse.status >= 400 ? "warn" : "info";
        request.log[logMethod](createRequestLoggerPayload(request, upstreamUrl, durationMs, {
          kind: outcomeKind,
          upstreamStatus: upstreamResponse.status,
          attempt,
        }));
        return;
      } catch (error) {
        clearTimeout(timeoutHandle);
        if (reply.raw.headersSent || reply.sent) {
          reply.raw.destroy(error instanceof Error ? error : undefined);
          return;
        }

        const errorCode: ProxyErrorCode = isAbortError(error) ? "upstream_timeout" : "transport_error";
        const shouldRetry = attempt < maxAttempts;
        const durationMs = Number((performance.now() - startedAt).toFixed(2));
        request.log.warn(createRequestLoggerPayload(request, upstreamUrl, durationMs, {
          kind: "proxy_error",
          errorCode,
          attempt,
          retrying: shouldRetry,
          message: toErrorMessage(error, "Unknown proxy transport error."),
        }));

        if (shouldRetry) {
          continue;
        }

        sendProxyError(
          reply,
          errorCode,
          errorCode === "upstream_timeout"
            ? `Upstream request timed out after ${effectiveTimeoutMs}ms.`
            : "Failed to reach upstream target.",
        );
        return;
      } finally {
        clearTimeout(timeoutHandle);
        reply.raw.off("finish", handleResponseFinish);
        reply.raw.off("close", handleClientClose);
      }
    }
  };

  app.get("/health", async () => ({
    ok: true,
    service: "@lumen/proxy",
  }));

  // Client observability beacon sink. The web client POSTs structured
  // playback/cast events here when VITE_OBSERVABILITY_BEACON_URL is set, so
  // production playback problems (catch-up startup stalls, repeated segments,
  // 403/429 bursts) land in the proxy log where we can read them live.
  app.options("/observe", async (request, reply) => {
    applyCorsHeaders(reply, "OPTIONS,POST");
    applyPrivateResponseHeaders(reply);
    if (!isAllowedBrowserOrigin(request, allowedCorsOrigins)) {
      reply.code(403).send();
      return;
    }
    reply.code(204).send();
  });

  app.post("/observe", { bodyLimit: observeBodyLimitBytes }, async (request, reply) => {
    applyCorsHeaders(reply, "OPTIONS,POST");
    applyPrivateResponseHeaders(reply);
    if (!isAllowedBrowserOrigin(request, allowedCorsOrigins)) {
      reply.code(403).send({ error: "forbidden_origin" });
      return;
    }

    const events = extractObserveEvents(request.body, observeMaxEventsPerRequest);
    if (!events) {
      reply
        .code(400)
        .type("application/json; charset=utf-8")
        .send({
          error: "invalid_observe_request",
          message: "Observability payload must contain one bounded event or events array.",
        });
      return;
    }

    const rateLimit = consumeObserveRateLimit(request.ip, events.length);
    if (!rateLimit.allowed) {
      reply
        .header("retry-after", String(rateLimit.retryAfterSeconds))
        .code(429)
        .type("application/json; charset=utf-8")
        .send({ error: "observe_rate_limited" });
      return;
    }

    for (const event of events) {
      const sanitizedEvent = sanitizeLogRecord(event);
      app.log.info({ event: "client_observe", client: sanitizedEvent });
    }
    reply.code(204).send();
  });

  // Player SSO token exchange (exyu.tv -> player.exyu.tv). The SPA lands on
  // /sso#token=<t> and POSTs the token here; we decrypt it with the shared
  // PLAYER_SSO_SECRET and hand back the Xtream credentials. Inert (404) unless
  // the secret is configured, so non-EXYU deployments are unaffected.
  const ssoReplayCache = createSsoReplayCache();
  const ssoRateLimiter = createIpRateLimiter({ limitPerWindow: ssoRateLimitPerMinute });

  app.options("/sso/exchange", async (_request, reply) => {
    applyCorsHeaders(reply, "OPTIONS,POST");
    applyPrivateResponseHeaders(reply);
    reply.code(204).send();
  });

  app.post("/sso/exchange", { bodyLimit: 4096 }, async (request, reply) => {
    applyCorsHeaders(reply, "OPTIONS,POST");
    applyPrivateResponseHeaders(reply);
    reply.type("application/json; charset=utf-8");

    const rejectExchange = (statusCode: number, errorCode: string): void => {
      request.log.warn({ event: "sso_exchange", outcome: "rejected", errorCode });
      reply.code(statusCode).send({ error: errorCode });
    };

    if (!ssoSecret) {
      rejectExchange(404, "sso_disabled");
      return;
    }

    // Browser cross-site calls are rejected outright when an origin allowlist
    // is configured; requests without an Origin header (curl, server-to-server)
    // still have to present a valid token, which is the real gate.
    if (!isAllowedBrowserOrigin(request, allowedCorsOrigins)) {
      rejectExchange(403, "forbidden_origin");
      return;
    }

    // The proxy binds to loopback behind nginx, so request.ip is always
    // 127.0.0.1; the forwarding headers nginx/Cloudflare set carry the real
    // client address for per-client rate limiting.
    if (!ssoRateLimiter.consume(resolveClientKey(request), Date.now())) {
      rejectExchange(429, "rate_limited");
      return;
    }

    const body = request.body as Record<string, unknown> | null | undefined;
    const token = body?.token;
    if (typeof token !== "string" || token.length === 0 || token.length > SSO_TOKEN_MAX_LENGTH) {
      rejectExchange(400, "invalid_request");
      return;
    }

    const result = decryptSsoToken(token, ssoSecret, Math.floor(Date.now() / 1000));
    if (!result.ok) {
      rejectExchange(result.error === "malformed" ? 400 : 401, result.error);
      return;
    }

    const { payload } = result;
    if (!ssoReplayCache.checkAndRemember(payload.jti, payload.expiresAtSeconds, Math.floor(Date.now() / 1000))) {
      rejectExchange(401, "replayed");
      return;
    }

    // Never log the token or the credentials it carries.
    request.log.info({ event: "sso_exchange", outcome: "ok" });
    const analytics = payload.analytics && analyticsForwardingEnabled && analyticsDestinationsMatchEnvironment(
      payload.analytics,
      analyticsIngestUrl,
      analyticsReplayUrl,
    )
      ? payload.analytics
      : null;
    if (analytics && ssoSecret) {
      const binding = mintPlayerAnalyticsBinding(
        ssoSecret,
        analytics,
        Math.floor(Date.now() / 1000),
      );
      reply.header("set-cookie", serializePlayerAnalyticsCookie(binding, true));
    }
    reply.code(200).send({
      username: payload.username,
      password: payload.password,
      accessMode: payload.accessMode,
      ...(analytics ? {
        analytics: {
          subject: analytics.subject,
          sessionId: analytics.sessionId,
          ingestUrl: "/player-analytics/ingest",
          replayUrl: "/player-analytics/replay",
        },
      } : {}),
    });
  });

  const analyticsRateLimiter = createIpRateLimiter({ limitPerWindow: analyticsRateLimitPerMinute });
  const analyticsReplayRateLimiter = createIpRateLimiter({
    limitPerWindow: analyticsReplayRateLimitPerMinute,
  });

  const resolveAnalyticsBinding = (request: FastifyRequest) => {
    if (!ssoSecret) return null;
    return parsePlayerAnalyticsBinding(
      readCookie(request.headers.cookie, PLAYER_ANALYTICS_COOKIE_NAME),
      ssoSecret,
      Math.floor(Date.now() / 1000),
    );
  };

  const forwardPlayerAnalytics = async (
    destination: string,
    body: BodyInit,
    headers: Record<string, string>,
  ): Promise<Response> => {
    let lastError: unknown;
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5_000);
      try {
        const response = await fetchImpl(destination, {
          method: "POST",
          body,
          headers: {
            authorization: `Bearer ${analyticsIngestSecret}`,
            ...headers,
          },
          signal: controller.signal,
        });
        if (response.status < 500 || attempt === 2) {
          await response.body?.cancel();
          return response;
        }
        await response.body?.cancel();
        lastError = new Error(`upstream_${response.status}`);
      } catch (error) {
        lastError = error;
        if (attempt === 2) throw error;
      } finally {
        clearTimeout(timeout);
      }
    }
    throw lastError instanceof Error ? lastError : new Error("analytics_forward_failed");
  };

  let analyticsInFlight = 0;
  let analyticsReplayInFlight = 0;

  app.get("/player-analytics/config", async (request, reply) => {
    applyCorsHeaders(reply, "GET,OPTIONS");
    applyPrivateResponseHeaders(reply);
    if (!analyticsForwardingEnabled || !analyticsIngestUrl || !analyticsReplayUrl) {
      reply.code(404).send({ error: "analytics_disabled" });
      return;
    }
    if (!isAllowedAnalyticsConfigRequest(request, allowedCorsOrigins)) {
      reply.code(403).send({ error: "forbidden_origin" });
      return;
    }
    if (!analyticsRateLimiter.consume(resolveClientKey(request), Date.now())) {
      reply.code(429).send({ error: "rate_limited" });
      return;
    }
    const binding = resolveAnalyticsBinding(request);
    if (!binding) {
      reply.code(401).send({ error: "analytics_session_required" });
      return;
    }
    reply.code(200).send({
      subject: binding.subject,
      sessionId: binding.sessionId,
      ingestUrl: "/player-analytics/ingest",
      replayUrl: "/player-analytics/replay",
    });
  });

  app.options("/player-analytics/ingest", async (request, reply) => {
    applyCorsHeaders(reply, "OPTIONS,POST");
    applyPrivateResponseHeaders(reply);
    if (!isAllowedBrowserOrigin(request, allowedCorsOrigins)) {
      reply.code(403).send();
      return;
    }
    reply.code(204).send();
  });

  app.post("/player-analytics/ingest", { bodyLimit: PLAYER_ANALYTICS_MAX_BATCH_BYTES }, async (request, reply) => {
    applyCorsHeaders(reply, "OPTIONS,POST");
    applyPrivateResponseHeaders(reply);
    if (!analyticsForwardingEnabled || !analyticsIngestUrl) {
      reply.code(404).send({ error: "analytics_disabled" });
      return;
    }
    if (!isAllowedBrowserOrigin(request, allowedCorsOrigins)) {
      reply.code(403).send({ error: "forbidden_origin" });
      return;
    }
    if (!analyticsRateLimiter.consume(resolveClientKey(request), Date.now())) {
      reply.code(429).send({ error: "rate_limited" });
      return;
    }
    if (analyticsInFlight >= 32) {
      reply.code(503).send({ error: "analytics_busy" });
      return;
    }
    const binding = resolveAnalyticsBinding(request);
    if (!binding) {
      reply.code(401).send({ error: "analytics_session_required" });
      return;
    }
    const batch = bindPlayerAnalyticsBatch(request.body, binding);
    if (!batch) {
      reply.code(400).send({ error: "invalid_batch" });
      return;
    }
    const serialized = JSON.stringify(batch);
    if (Buffer.byteLength(serialized, "utf8") > PLAYER_ANALYTICS_MAX_BATCH_BYTES) {
      reply.code(413).send({ error: "payload_too_large" });
      return;
    }
    const events = Array.isArray(batch.events) ? batch.events.length : 0;
    const crashes = Array.isArray(batch.crashes) ? batch.crashes.length : 0;
    const feedback = Array.isArray(batch.feedback) ? batch.feedback.length : 0;
    const startedAt = performance.now();
    analyticsInFlight += 1;
    try {
      const upstream = await forwardPlayerAnalytics(analyticsIngestUrl, serialized, {
        "content-type": "application/json",
      });
      const latencyMs = Math.round(performance.now() - startedAt);
      request.log.info({
        event: "player_analytics_forward",
        sessionId: binding.sessionId,
        events,
        crashes,
        feedback,
        outcome: upstream.ok ? "ok" : "rejected",
        statusCode: upstream.status,
        latencyMs,
      });
      if (!upstream.ok) {
        reply.code(upstream.status >= 400 && upstream.status < 500 ? upstream.status : 502)
          .send({ error: "analytics_upstream_rejected" });
        return;
      }
      reply.code(202).send({ ok: true });
    } catch (error) {
      request.log.warn({
        event: "player_analytics_forward",
        sessionId: binding.sessionId,
        events,
        crashes,
        feedback,
        outcome: "failed",
        latencyMs: Math.round(performance.now() - startedAt),
        errorClass: error instanceof Error ? error.name : "UnknownError",
      });
      reply.code(502).send({ error: "analytics_unavailable" });
    } finally {
      analyticsInFlight -= 1;
    }
  });

  app.options("/player-analytics/replay", async (request, reply) => {
    applyCorsHeaders(reply, "OPTIONS,POST");
    applyPrivateResponseHeaders(reply);
    if (!isAllowedBrowserOrigin(request, allowedCorsOrigins)) {
      reply.code(403).send();
      return;
    }
    reply.code(204).send();
  });

  app.post("/player-analytics/replay", { bodyLimit: PLAYER_ANALYTICS_MAX_REPLAY_BYTES }, async (request, reply) => {
    applyCorsHeaders(reply, "OPTIONS,POST");
    applyPrivateResponseHeaders(reply);
    if (!analyticsForwardingEnabled || !analyticsReplayUrl) {
      reply.code(404).send({ error: "analytics_disabled" });
      return;
    }
    if (!isAllowedBrowserOrigin(request, allowedCorsOrigins)) {
      reply.code(403).send({ error: "forbidden_origin" });
      return;
    }
    if (!analyticsReplayRateLimiter.consume(resolveClientKey(request), Date.now())) {
      reply.code(429).send({ error: "rate_limited" });
      return;
    }
    if (analyticsReplayInFlight >= 4) {
      reply.code(503).send({ error: "replay_busy" });
      return;
    }
    const binding = resolveAnalyticsBinding(request);
    if (!binding) {
      reply.code(401).send({ error: "analytics_session_required" });
      return;
    }
    const replayId = request.headers["x-player-replay-id"];
    const trigger = request.headers["x-player-replay-trigger"];
    if (
      !isPlayerAnalyticsUuid(replayId) ||
      typeof trigger !== "string" ||
      !new Set(["crash", "feedback", "diagnostic", "sample"]).has(trigger)
    ) {
      reply.code(400).send({ error: "invalid_replay_metadata" });
      return;
    }
    const raw = Buffer.isBuffer(request.body) ? request.body : Buffer.from([]);
    if (raw.length === 0 || raw.length > PLAYER_ANALYTICS_MAX_REPLAY_BYTES) {
      reply.code(413).send({ error: "payload_too_large" });
      return;
    }
    let replayEvents: unknown;
    try {
      const decoded = request.headers["content-encoding"] === "gzip"
        ? gunzipSync(raw, { maxOutputLength: PLAYER_ANALYTICS_MAX_REPLAY_UNCOMPRESSED_BYTES })
        : raw;
      if (decoded.length > PLAYER_ANALYTICS_MAX_REPLAY_UNCOMPRESSED_BYTES) {
        throw new Error("replay_too_large");
      }
      replayEvents = JSON.parse(decoded.toString("utf8"));
    } catch {
      reply.code(400).send({ error: "invalid_replay" });
      return;
    }
    if (!Array.isArray(replayEvents)) {
      reply.code(400).send({ error: "invalid_replay" });
      return;
    }
    const sanitized = sanitizePlayerAnalyticsValue(replayEvents);
    const compressed = gzipSync(Buffer.from(JSON.stringify(sanitized), "utf8"), { level: 6 });
    if (compressed.length > PLAYER_ANALYTICS_MAX_REPLAY_BYTES) {
      reply.code(413).send({ error: "replay_too_large" });
      return;
    }
    const startedAt = performance.now();
    analyticsReplayInFlight += 1;
    try {
      const upstream = await forwardPlayerAnalytics(analyticsReplayUrl, compressed, {
        "content-type": "application/gzip",
        "content-encoding": "gzip",
        "x-player-replay-id": replayId,
        "x-player-session-id": binding.sessionId,
        "x-player-analytics-subject": binding.subject,
        "x-player-replay-trigger": trigger,
        "x-player-redaction-version": "1",
        "x-player-replay-event-count": String(replayEvents.length),
        ...(typeof request.headers["x-player-replay-started-at"] === "string"
          ? { "x-player-replay-started-at": request.headers["x-player-replay-started-at"] }
          : {}),
        ...(typeof request.headers["x-player-replay-ended-at"] === "string"
          ? { "x-player-replay-ended-at": request.headers["x-player-replay-ended-at"] }
          : {}),
      });
      request.log.info({
        event: "player_replay_forward",
        sessionId: binding.sessionId,
        replayId,
        eventCount: replayEvents.length,
        byteSize: compressed.length,
        outcome: upstream.ok ? "ok" : "rejected",
        statusCode: upstream.status,
        latencyMs: Math.round(performance.now() - startedAt),
      });
      if (!upstream.ok) {
        reply.code(upstream.status >= 400 && upstream.status < 500 ? upstream.status : 502)
          .send({ error: "replay_upstream_rejected" });
        return;
      }
      reply.code(202).send({ ok: true, replayId });
    } catch (error) {
      request.log.warn({
        event: "player_replay_forward",
        sessionId: binding.sessionId,
        replayId,
        eventCount: replayEvents.length,
        byteSize: compressed.length,
        outcome: "failed",
        latencyMs: Math.round(performance.now() - startedAt),
        errorClass: error instanceof Error ? error.name : "UnknownError",
      });
      reply.code(502).send({ error: "replay_unavailable" });
    } finally {
      analyticsReplayInFlight -= 1;
    }
  });

  app.options("/catchup-gateway/resolve", async (_request, reply) => {
    applyCorsHeaders(reply, "GET,HEAD,OPTIONS,POST");
    reply.code(204).send();
  });

  app.post<{ Body: CatchUpGatewayResolveRequest }>(
    "/catchup-gateway/resolve",
    async (request, reply) => {
      applyCorsHeaders(reply, "GET,HEAD,OPTIONS,POST");
      if (!isCatchUpGatewayResolveRequest(request.body)) {
        reply
          .code(400)
          .type("application/json; charset=utf-8")
          .send({
            error: "invalid_resolve_request",
            message: "Invalid catch-up gateway resolve request.",
          });
        return;
      }

      const response = await catchUpGateway.resolve({
        request: request.body,
        requestBaseUrl: buildRequestBaseUrl(request),
      });

      reply
        .code(200)
        .type("application/json; charset=utf-8")
        .send(response);
    },
  );

  app.all(
    "/xui-api/__remux__/session/:sessionId/init.mp4",
    async (request, reply) => {
      applyCorsHeaders(reply);
      await buildRemuxAssetResponse({
        request,
        reply,
      });
    },
  );

  app.all(
    "/xui-api/__remux__/session/:sessionId/segment/:index.m4s",
    async (request, reply) => {
      applyCorsHeaders(reply);
      await buildRemuxAssetResponse({
        request,
        reply,
      });
    },
  );

  app.all(`${XTREAM_PROXY_BASE_PATH}`, async (_request, reply) => {
    applyCorsHeaders(reply);
    sendProxyError(reply, "missing_target", "Missing proxy target.");
  });

  app.all(`${XTREAM_PROXY_BASE_PATH}/`, async (_request, reply) => {
    applyCorsHeaders(reply);
    sendProxyError(reply, "missing_target", "Missing proxy target.");
  });

  app.all<{ Params: { encodedTarget: string } }>(
    `${XTREAM_PROXY_BASE_PATH}/:encodedTarget`,
    async (request, reply) => handleProxyRequest(request as ProxyHandlerRequest, reply),
  );
  app.all<{ Params: { encodedTarget: string; "*": string } }>(
    `${XTREAM_PROXY_BASE_PATH}/:encodedTarget/*`,
    async (request, reply) => handleProxyRequest(request as ProxyHandlerRequest, reply),
  );

  return app;
};

export const startProxyServer = async (): Promise<FastifyInstance> => {
  const app = createProxyServer();
  const host = process.env.HOST?.trim() || "0.0.0.0";
  const port = parseNonNegativeInteger(process.env.PORT, 8788);

  await app.listen({ host, port });
  app.log.info({
    event: "xtream_proxy_started",
    host,
    port,
  });

  return app;
};
