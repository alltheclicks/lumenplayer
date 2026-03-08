import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from "fastify";
import { Writable } from "node:stream";
import { createCatchUpGateway } from "./catchup-gateway.js";
import {
  createCatchUpRemuxController,
  type CatchUpRemuxAssetRequest,
  type CatchUpRemuxController,
} from "./catchup-remux.js";
import {
  isCatchUpGatewayResolveRequest,
  type CatchUpGatewayResolveRequest,
} from "./catchup-gateway-contracts.js";

const XTREAM_PROXY_BASE_PATH = "/xui-api";
const RETRYABLE_METHODS = new Set(["GET", "HEAD"]);
const REDIRECT_STATUS_CODES = new Set([301, 302, 307, 308]);
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
}

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

const buildForwardHeaders = (requestHeaders: Record<string, string | string[] | undefined>): Headers => {
  const headers = new Headers();

  for (const [headerName, headerValue] of Object.entries(requestHeaders)) {
    const normalizedName = headerName.toLowerCase();
    if (normalizedName === "host" || HOP_BY_HOP_HEADERS.has(normalizedName) || headerValue == null) {
      continue;
    }

    if (Array.isArray(headerValue)) {
      headers.set(headerName, headerValue.join(", "));
      continue;
    }

    headers.set(headerName, headerValue);
  }

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
    if (HOP_BY_HOP_HEADERS.has(normalizedName)) {
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
  rewrittenLocation?: string,
): void => {
  for (const [headerName, headerValue] of headers.entries()) {
    const normalizedName = headerName.toLowerCase();
    if (HOP_BY_HOP_HEADERS.has(normalizedName)) {
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
): Record<string, unknown> => ({
  event: "xtream_proxy_request",
  method: request.method,
  path: request.url,
  upstreamHost: upstreamUrl.host,
  durationMs,
  ...payload,
});

const isCatchUpRequestUrl = (upstreamUrl: URL): boolean => {
  const pathname = upstreamUrl.pathname.toLowerCase();
  return pathname.startsWith("/timeshift/") || pathname === "/streaming/timeshift.php";
};

const buildRequestBaseUrl = (request: FastifyRequest): string => {
  const host = request.headers.host ?? "localhost";
  return `${request.protocol}://${host}${request.url}`;
};

const buildRemuxAssetResponse = async ({
  request,
  reply,
  remuxController,
  assetRequest,
}: {
  request: FastifyRequest;
  reply: FastifyReply;
  remuxController: CatchUpRemuxController;
  assetRequest: CatchUpRemuxAssetRequest;
}): Promise<void> => {
  applyCorsHeaders(reply);

  if (request.method === "OPTIONS") {
    reply.code(204).send();
    return;
  }

  try {
    const assetBody = await remuxController.getAsset(assetRequest);
    reply.code(200).type("video/mp4");
    if (request.method === "HEAD") {
      reply.send();
      return;
    }
    reply.send(assetBody);
  } catch (error) {
    const message = toErrorMessage(error, "Remux asset is unavailable.");
    sendRemuxError(reply, 502, message);
  }
};

export const createProxyServer = (options: ProxyServerOptions = {}): FastifyInstance => {
  const env = options.env ?? process.env;
  const allowedHosts = (
    options.allowedHosts ??
    parseAllowedHosts(env.XTREAM_PROXY_ALLOWED_HOSTS)
  ).map(normalizeAllowedHostEntry);
  const timeoutMs = options.timeoutMs ?? parseNonNegativeInteger(env.XTREAM_PROXY_TIMEOUT_MS, 10_000);
  const retryCount = options.retryCount ?? parseNonNegativeInteger(env.XTREAM_PROXY_RETRY_COUNT, 1);
  const sweepIntervalMs = options.sweepIntervalMs ?? parseNonNegativeInteger(
    env.LUMEN_CATCHUP_GATEWAY_SWEEP_INTERVAL_MS,
    60_000,
  );
  const remuxPerServerConcurrency = Math.max(
    1,
    parseNonNegativeInteger(env.LUMEN_CATCHUP_GATEWAY_PER_SERVER_CONCURRENCY, 2),
  );
  const fetchImpl = options.fetchImpl ?? fetch;

  const app = Fastify({
    logger: options.logger ?? true,
  });
  const remuxController = options.remuxController ?? createCatchUpRemuxController({
    logger: {
      info: (event, payload) => app.log.info({ event, ...payload }),
      warn: (event, payload) => app.log.warn({ event, ...payload }),
      error: (event, payload) => app.log.error({ event, ...payload }),
    },
    env,
  });
  const catchUpGateway = createCatchUpGateway({
    logger: {
      info: (event, payload) => app.log.info({ event, ...payload }),
      warn: (event, payload) => app.log.warn({ event, ...payload }),
      error: (event, payload) => app.log.error({ event, ...payload }),
    },
    remuxController,
    env,
  });
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

  const handleProxyRequest = async (
    request: ProxyHandlerRequest,
    reply: FastifyReply,
  ): Promise<void> => {
    applyCorsHeaders(reply);

    if (request.method === "OPTIONS") {
      reply.code(204).send();
      return;
    }

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

    if (
      RETRYABLE_METHODS.has(requestMethod) &&
      isCatchUpRequestUrl(upstreamUrl) &&
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
          upstreamUrl: upstreamUrl.toString(),
          message: toErrorMessage(error, "Catch-up remux manifest is unavailable."),
        });
        sendRemuxError(reply, 502, toErrorMessage(error, "Catch-up remux manifest is unavailable."));
      }
      return;
    }

    const maxAttempts = RETRYABLE_METHODS.has(requestMethod) ? retryCount + 1 : 1;
    const startedAt = performance.now();

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      const abortController = new AbortController();
      const timeoutHandle = setTimeout(() => {
        abortController.abort();
      }, timeoutMs);

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

        if (upstreamResponse.body) {
          reply.hijack();
          reply.raw.statusCode = upstreamResponse.status;
          applyUpstreamHeadersToRawResponse(reply, upstreamResponse.headers);
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
            ? `Upstream request timed out after ${timeoutMs}ms.`
            : "Failed to reach upstream target.",
        );
        return;
      }
    }
  };

  app.get("/health", async () => ({
    ok: true,
    service: "@lumen/proxy",
  }));

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
      const assetRequest = remuxController.parseAssetRequest(
        new URL(request.raw.url ?? "/", "http://lumen-proxy.local"),
      );
      if (!assetRequest) {
        sendRemuxError(reply, 404, "Remux asset not found.");
        return;
      }

      await buildRemuxAssetResponse({
        request,
        reply,
        remuxController,
        assetRequest,
      });
    },
  );

  app.all(
    "/xui-api/__remux__/session/:sessionId/segment/:index.m4s",
    async (request, reply) => {
      applyCorsHeaders(reply);
      const assetRequest = remuxController.parseAssetRequest(
        new URL(request.raw.url ?? "/", "http://lumen-proxy.local"),
      );
      if (!assetRequest) {
        sendRemuxError(reply, 404, "Remux asset not found.");
        return;
      }

      await buildRemuxAssetResponse({
        request,
        reply,
        remuxController,
        assetRequest,
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
