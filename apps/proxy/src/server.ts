import http from "node:http";
import { Readable } from "node:stream";
import type { ReadableStream } from "node:stream/web";
import { createCatchUpGateway } from "./catchup-gateway.js";
import type { CatchUpGatewayResolveRequest } from "./catchup-gateway-contracts.js";
import {
  isCatchUpRequestUrl,
  parseCatchUpRequestMetadata,
  normalizeCachedSegment,
  normalizeCatchUpRequest,
  NormalizedSegmentCache,
  type ProxyLogger,
} from "./catchup-normalizer.js";
import {
  CatchUpRemuxSessionCache,
  createCatchUpRemuxFeatureGate,
  createRemuxedCatchUpManifest,
  parseCatchUpRemuxAssetRequest,
  resolveCatchUpRemuxAsset,
  shouldUseCatchUpRemux,
} from "./catchup-remuxer.js";
import {
  XUI_PROXY_BASE_PATH,
  buildProxyPathForAbsoluteUrl,
  type ParsedProxyRequest,
  parseProxyRequest,
} from "./proxy-url.js";

const port = Number(process.env.PORT ?? 8788);
const NORMALIZED_SEGMENT_PATH_PATTERN = /^\/xui-api\/__normalized__\/segment\/([^/]+)\.ts$/i;
const hopByHopResponseHeaders = new Set([
  "connection",
  "content-encoding",
  "content-length",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
]);
const requestHeadersToDrop = new Set([
  "connection",
  "content-length",
  "host",
  "origin",
  "referer",
]);

const segmentCache = new NormalizedSegmentCache();
const remuxSessionCache = new CatchUpRemuxSessionCache();
const remuxFeatureGate = createCatchUpRemuxFeatureGate();

const logger: ProxyLogger = {
  info: (eventName, payload) => {
    console.info("[lumen-proxy]", {
      event: eventName,
      severity: "info",
      timestamp: new Date().toISOString(),
      ...payload,
    });
  },
  warn: (eventName, payload) => {
    console.warn("[lumen-proxy]", {
      event: eventName,
      severity: "warn",
      timestamp: new Date().toISOString(),
      ...payload,
    });
  },
  error: (eventName, payload) => {
    console.error("[lumen-proxy]", {
      event: eventName,
      severity: "error",
      timestamp: new Date().toISOString(),
      ...payload,
    });
  },
};
const catchUpGateway = createCatchUpGateway({
  logger,
  remuxSessionCache,
});

const addCorsHeaders = (response: http.ServerResponse): void => {
  response.setHeader("access-control-allow-origin", "*");
  response.setHeader("access-control-allow-methods", "GET,HEAD,POST,PUT,PATCH,DELETE,OPTIONS");
  response.setHeader("access-control-allow-headers", "*");
  response.setHeader("access-control-expose-headers", "*");
  response.setHeader("cache-control", "no-store");
};

const sendJson = (response: http.ServerResponse, statusCode: number, payload: unknown): void => {
  addCorsHeaders(response);
  response.writeHead(statusCode, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(payload));
};

const collectRequestBody = async (request: http.IncomingMessage): Promise<Buffer | undefined> => {
  const method = request.method ?? "GET";
  if (method === "GET" || method === "HEAD") {
    return undefined;
  }

  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  return chunks.length > 0 ? Buffer.concat(chunks) : undefined;
};

const buildUpstreamRequestHeaders = (request: http.IncomingMessage): Headers => {
  const headers = new Headers();

  for (const [name, value] of Object.entries(request.headers)) {
    if (requestHeadersToDrop.has(name.toLowerCase()) || typeof value === "undefined") {
      continue;
    }

    if (Array.isArray(value)) {
      for (const entry of value) {
        headers.append(name, entry);
      }
      continue;
    }

    headers.set(name, value);
  }

  return headers;
};

const rewriteHlsManifestBody = (
  manifestBody: string,
  upstreamManifestUrl: URL,
): string => {
  const lines = manifestBody.replace(/\r\n/g, "\n").split("\n");
  return lines.map((line) => {
    const trimmed = line.trim();
    if (trimmed.length === 0) {
      return line;
    }

    if (!trimmed.startsWith("#")) {
      return buildProxyPathForAbsoluteUrl(new URL(trimmed, upstreamManifestUrl).toString());
    }

    return line.replace(/URI="([^"]+)"/g, (_match, rawUri: string) => {
      const resolved = new URL(rawUri, upstreamManifestUrl).toString();
      return `URI="${buildProxyPathForAbsoluteUrl(resolved)}"`;
    });
  }).join("\n");
};

const proxyLocationHeader = (location: string, requestUrl: URL): string => {
  const resolved = new URL(location);
  const encodedTarget = encodeURIComponent(`${resolved.protocol}//${resolved.host}`);
  const proxied = new URL(requestUrl.toString());
  proxied.pathname = `${XUI_PROXY_BASE_PATH}/${encodedTarget}${resolved.pathname}`;
  proxied.search = resolved.search;
  proxied.hash = "";
  return proxied.toString();
};

const copyUpstreamHeaders = (
  upstreamResponse: Response,
  response: http.ServerResponse,
  options: {
    requestUrl: URL;
    upstreamUrl: URL;
  },
): void => {
  for (const [name, value] of upstreamResponse.headers.entries()) {
    if (hopByHopResponseHeaders.has(name.toLowerCase())) {
      continue;
    }

    if (name.toLowerCase() === "location") {
      try {
        const nextLocation = new URL(value, options.upstreamUrl.toString()).toString();
        response.setHeader(name, proxyLocationHeader(nextLocation, options.requestUrl));
      } catch {
        response.setHeader(name, value);
      }
      continue;
    }

    response.setHeader(name, value);
  }
};

const pipeFetchResponse = async (
  upstreamResponse: Response,
  response: http.ServerResponse,
  options: {
    requestMethod: string;
    requestUrl: URL;
    upstreamUrl: URL;
  },
): Promise<void> => {
  addCorsHeaders(response);
  copyUpstreamHeaders(upstreamResponse, response, options);
  response.statusCode = upstreamResponse.status;
  response.statusMessage = upstreamResponse.statusText;

  if (options.requestMethod === "HEAD" || upstreamResponse.body === null) {
    response.end();
    return;
  }

  Readable.fromWeb(upstreamResponse.body as unknown as ReadableStream).pipe(response);
};

const proxyPassThroughRequest = async (
  request: http.IncomingMessage,
  response: http.ServerResponse,
  parsedRequest: ParsedProxyRequest,
): Promise<void> => {
  const method = request.method ?? "GET";
  const requestBody = await collectRequestBody(request);
  const upstreamResponse = await fetch(parsedRequest.upstreamUrl, {
    method,
    headers: buildUpstreamRequestHeaders(request),
    body: requestBody ? new Uint8Array(requestBody) : undefined,
    redirect: "manual",
  });

  const upstreamContentType = upstreamResponse.headers.get("content-type")?.toLowerCase() ?? "";
  const shouldRewriteManifest = (
    upstreamResponse.ok &&
    upstreamResponse.status < 300 &&
    (
      parsedRequest.upstreamUrl.pathname.toLowerCase().endsWith(".m3u8") ||
      upstreamContentType.includes("mpegurl")
    )
  );

  if (shouldRewriteManifest) {
    const manifestBody = await upstreamResponse.text();
    if (manifestBody.trimStart().startsWith("#EXTM3U")) {
      addCorsHeaders(response);
      copyUpstreamHeaders(new Response(null, {
        status: upstreamResponse.status,
        statusText: upstreamResponse.statusText,
        headers: upstreamResponse.headers,
      }), response, {
        requestUrl: parsedRequest.requestUrl,
        upstreamUrl: parsedRequest.upstreamUrl,
      });
      response.writeHead(upstreamResponse.status, {
        "content-type": "application/vnd.apple.mpegurl; charset=utf-8",
      });
      response.end(rewriteHlsManifestBody(manifestBody, parsedRequest.upstreamUrl));
      return;
    }
  }

  await pipeFetchResponse(upstreamResponse, response, {
    requestMethod: method,
    requestUrl: parsedRequest.requestUrl,
    upstreamUrl: parsedRequest.upstreamUrl,
  });
};

const parseGatewayResolveRequest = (value: unknown): CatchUpGatewayResolveRequest | null => {
  if (!value || typeof value !== "object") {
    return null;
  }

  const candidate = value as Record<string, unknown>;
  const channelId = typeof candidate.channelId === "string" ? candidate.channelId.trim() : "";
  const programId = typeof candidate.programId === "string" ? candidate.programId.trim() : "";
  const streamId = Number(candidate.streamId);
  const startTimestamp = Number(candidate.startTimestamp);
  const durationSeconds = Number(candidate.durationSeconds);
  const sourceCandidates = candidate.sourceCandidates;

  if (
    !channelId ||
    !programId ||
    !Number.isFinite(streamId) ||
    !Number.isFinite(startTimestamp) ||
    !Number.isFinite(durationSeconds) ||
    !sourceCandidates ||
    typeof sourceCandidates !== "object"
  ) {
    return null;
  }

  const sourceCandidateRecord = sourceCandidates as Record<string, unknown>;
  const readStringArray = (entry: unknown): string[] => Array.isArray(entry)
    ? entry.filter((item): item is string => typeof item === "string")
    : [];

  return {
    platform: typeof candidate.platform === "string" ? candidate.platform : undefined,
    serverUrl: typeof candidate.serverUrl === "string" ? candidate.serverUrl : null,
    channelId,
    programId,
    streamId: Math.floor(streamId),
    startTimestamp: Math.floor(startTimestamp),
    durationSeconds: Math.max(1, Math.floor(durationSeconds)),
    sourceCandidates: {
      redirectUrls: readStringArray(sourceCandidateRecord.redirectUrls),
      queryUrls: readStringArray(sourceCandidateRecord.queryUrls),
      legacyUrls: readStringArray(sourceCandidateRecord.legacyUrls),
    },
    channelCapability: (
      candidate.channelCapability &&
      typeof candidate.channelCapability === "object"
    )
      ? candidate.channelCapability as CatchUpGatewayResolveRequest["channelCapability"]
      : null,
    debugOverride: (
      candidate.debugOverride &&
      typeof candidate.debugOverride === "object"
    )
      ? candidate.debugOverride as CatchUpGatewayResolveRequest["debugOverride"]
      : null,
  };
};

const handleGatewayResolveRequest = async (
  request: http.IncomingMessage,
  response: http.ServerResponse,
  requestUrl: URL,
): Promise<boolean> => {
  if (requestUrl.pathname !== "/catchup-gateway/resolve") {
    return false;
  }

  if ((request.method ?? "GET") !== "POST") {
    sendJson(response, 405, { error: "Method not allowed." });
    return true;
  }

  const requestBody = await collectRequestBody(request);
  let parsedBody: unknown;
  try {
    parsedBody = requestBody ? JSON.parse(requestBody.toString("utf-8")) : null;
  } catch {
    sendJson(response, 400, { error: "Invalid JSON payload." });
    return true;
  }

  const gatewayRequest = parseGatewayResolveRequest(parsedBody);
  if (!gatewayRequest) {
    sendJson(response, 400, { error: "Invalid catch-up gateway resolve payload." });
    return true;
  }

  const result = await catchUpGateway.resolve({
    request: gatewayRequest,
    requestBaseUrl: new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`).toString(),
    requestHeaders: buildUpstreamRequestHeaders(request),
  });
  sendJson(response, 200, result);
  return true;
};

const handleNormalizedSegmentRequest = async (
  request: http.IncomingMessage,
  response: http.ServerResponse,
  requestUrl: URL,
): Promise<boolean> => {
  const match = requestUrl.pathname.match(NORMALIZED_SEGMENT_PATH_PATTERN);
  if (!match || !match[1]) {
    return false;
  }

  const record = segmentCache.get(match[1]);
  if (!record) {
    sendJson(response, 404, { error: "Normalized segment not found or expired." });
    return true;
  }

  try {
    const cleanedBuffer = await normalizeCachedSegment(
      record,
      buildUpstreamRequestHeaders(request),
      segmentCache,
      logger,
    );

    addCorsHeaders(response);
    response.writeHead(200, { "content-type": "video/mp2t" });
    if ((request.method ?? "GET") === "HEAD") {
      response.end();
      return true;
    }

    response.end(cleanedBuffer);
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Segment normalization failed.";
    sendJson(response, 502, { error: message });
    return true;
  }
};

const handleRemuxAssetRequest = async (
  request: http.IncomingMessage,
  response: http.ServerResponse,
  requestUrl: URL,
): Promise<boolean> => {
  const remuxAsset = parseCatchUpRemuxAssetRequest(requestUrl);
  if (!remuxAsset) {
    return false;
  }

  try {
    const body = await resolveCatchUpRemuxAsset({
      sessionCache: remuxSessionCache,
      sessionId: remuxAsset.sessionId,
      kind: remuxAsset.kind,
      segmentIndex: remuxAsset.segmentIndex,
      logger,
    });

    addCorsHeaders(response);
    response.writeHead(200, { "content-type": "video/mp4" });
    if ((request.method ?? "GET") === "HEAD") {
      response.end();
      return true;
    }

    response.end(body);
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Remux asset is unavailable.";
    sendJson(response, 502, { error: message });
    return true;
  }
};

const handleProxyRequest = async (
  request: http.IncomingMessage,
  response: http.ServerResponse,
): Promise<void> => {
  const requestUrl = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);

  if ((request.method ?? "GET") === "OPTIONS") {
    addCorsHeaders(response);
    response.writeHead(204);
    response.end();
    return;
  }

  if (requestUrl.pathname === "/healthz") {
    sendJson(response, 200, { ok: true });
    return;
  }

  if (await handleGatewayResolveRequest(request, response, requestUrl)) {
    return;
  }

  if (await handleRemuxAssetRequest(request, response, requestUrl)) {
    return;
  }

  if (await handleNormalizedSegmentRequest(request, response, requestUrl)) {
    return;
  }

  const parsedRequest = parseProxyRequest(requestUrl);
  if (!parsedRequest) {
    sendJson(response, 404, { error: "Not found." });
    return;
  }

  if (
    (request.method ?? "GET") === "GET" &&
    isCatchUpRequestUrl(parsedRequest.upstreamUrl)
  ) {
    if (shouldUseCatchUpRemux(parsedRequest.upstreamUrl, remuxFeatureGate)) {
      try {
        const remuxed = await createRemuxedCatchUpManifest({
          upstreamUrl: parsedRequest.upstreamUrl,
          requestHeaders: buildUpstreamRequestHeaders(request),
          sessionCache: remuxSessionCache,
          logger,
        });

        addCorsHeaders(response);
        response.writeHead(200, { "content-type": remuxed.contentType });
        response.end(remuxed.body);
        return;
      } catch (error) {
        const metadata = parseCatchUpRequestMetadata(parsedRequest.upstreamUrl);
        const message = error instanceof Error ? error.message : "Catch-up remux fallback failed.";
        logger.warn("catchup.remux_bypass", {
          streamId: metadata.streamId,
          programId: metadata.programId,
          start: metadata.start,
          duration: metadata.duration,
          finalHost: null,
          errorCode: "REMUX_BYPASS",
          message,
        });
      }
    }

    try {
      const normalized = await normalizeCatchUpRequest({
        upstreamUrl: parsedRequest.upstreamUrl,
        requestHeaders: buildUpstreamRequestHeaders(request),
        segmentCache,
        logger,
      });

      if (normalized.kind === "manifest") {
        addCorsHeaders(response);
        response.writeHead(200, { "content-type": normalized.contentType });
        response.end(normalized.body);
        return;
      }

      if (normalized.kind === "transport-stream") {
        addCorsHeaders(response);
        response.writeHead(200, { "content-type": normalized.contentType });
        response.end(normalized.body);
        return;
      }

      await pipeFetchResponse(normalized.response, response, {
        requestMethod: request.method ?? "GET",
        requestUrl,
        upstreamUrl: parsedRequest.upstreamUrl,
      });
      return;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Catch-up normalization failed.";
      logger.error("catchup.normalize_failure", {
        streamId: null,
        programId: null,
        start: null,
        duration: null,
        segmentIndex: null,
        syncOffsetBytes: null,
        upstreamExtinf: null,
        normalizedDuration: null,
        finalHost: null,
        errorCode: "NORMALIZE_EXCEPTION",
        message,
      });
      sendJson(response, 502, { error: message });
      return;
    }
  }

  await proxyPassThroughRequest(request, response, parsedRequest);
};

export const createProxyServer = (): http.Server => {
  const server = http.createServer((request, response) => {
    void handleProxyRequest(request, response).catch((error) => {
      const message = error instanceof Error ? error.message : "Unknown server error";
      sendJson(response, 500, { error: message });
    });
  });

  server.on("close", () => {
    segmentCache.sweep();
    remuxSessionCache.sweep();
    catchUpGateway.sweep();
  });

  return server;
};

if (process.env.NODE_ENV !== "test") {
  createProxyServer().listen(port, () => {
    console.log(`[proxy] listening on http://localhost:${port}`);
  });
}
