import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { VitePWA } from "vite-plugin-pwa";
import type * as Http from "node:http";
import * as httpNode from "node:http";
import * as httpsNode from "node:https";
import { resolveXtreamDevProxyRequest } from "./src/config/xtreamDevProxyPath";

const pwaWorkboxMode = process.env.LUMEN_PWA_SW_MODE === "production" ? "production" : "development";
const XTREAM_DEV_PROXY_BASE_PATH = "/xui-api";
const PROXY_UPSTREAM_TIMEOUT_MS = 10_000;
const RETRYABLE_TRANSPORT_ERRORS = new Set(["ECONNRESET", "ETIMEDOUT", "ECONNREFUSED", "EAI_AGAIN", "EPIPE", "EHOSTUNREACH"]);
const RETRYABLE_HTTP_METHODS = new Set(["GET", "HEAD"]);
const PROXY_RETRY_BACKOFF_MS = 300;
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

const rewriteProxyLocationHeader = (locationHeader: string, upstreamUrl: URL): string => {
  if (locationHeader.startsWith(`${XTREAM_DEV_PROXY_BASE_PATH}/`)) {
    return locationHeader;
  }

  try {
    const resolvedLocation = new URL(locationHeader, upstreamUrl);
    if (resolvedLocation.protocol !== "http:" && resolvedLocation.protocol !== "https:") {
      return locationHeader;
    }

    const encodedTarget = encodeURIComponent(resolvedLocation.origin.replace(/\/+$/, ""));
    return `${XTREAM_DEV_PROXY_BASE_PATH}/${encodedTarget}${resolvedLocation.pathname}${resolvedLocation.search}${resolvedLocation.hash}`;
  } catch {
    return locationHeader;
  }
};

const buildProxyRequestHeaders = (
  headers: Http.IncomingHttpHeaders,
  upstreamHost: string,
): Http.OutgoingHttpHeaders => {
  const nextHeaders: Http.OutgoingHttpHeaders = {};

  for (const [headerName, headerValue] of Object.entries(headers)) {
    if (typeof headerValue === "undefined") {
      continue;
    }

    const normalizedHeaderName = headerName.toLowerCase();
    if (
      normalizedHeaderName === "host" ||
      normalizedHeaderName === "forwarded" ||
      normalizedHeaderName.startsWith("x-forwarded-") ||
      HOP_BY_HOP_HEADERS.has(normalizedHeaderName)
    ) {
      continue;
    }

    nextHeaders[headerName] = headerValue;
  }

  nextHeaders.host = upstreamHost;
  return nextHeaders;
};

const proxyLog = (tag: string, method: string, url: string, detail: string) => {
  const ts = new Date().toISOString().slice(11, 23);
  console.log(`[${ts}] proxy ${tag}  ${method} ${url}  ${detail}`);
};

const createXtreamDevProxyPlugin = (defaultTarget: string) => ({
  name: "xtream-dev-dynamic-proxy",
  configureServer(server: { middlewares: { use: (...args: unknown[]) => void } }) {
    server.middlewares.use((
      request: Http.IncomingMessage,
      response: Http.ServerResponse,
      next: () => void,
    ) => {
      const requestUrl = request.url;
      if (!requestUrl || !requestUrl.startsWith(`${XTREAM_DEV_PROXY_BASE_PATH}/`)) {
        next();
        return;
      }

      const httpMethod = (request.method ?? "GET").toUpperCase();

      const resolvedProxyRequest = resolveXtreamDevProxyRequest(requestUrl);
      const target = resolvedProxyRequest.target ?? defaultTarget;
      if (!target) {
        proxyLog("proxy_error", httpMethod, requestUrl, "missing target");
        response.statusCode = 502;
        response.setHeader("X-Proxy-Error", "missing_target");
        response.end("Missing proxy target.");
        return;
      }

      let upstreamBaseUrl: URL;
      try {
        upstreamBaseUrl = new URL(target);
      } catch {
        proxyLog("proxy_error", httpMethod, requestUrl, `invalid target: ${target}`);
        response.statusCode = 502;
        response.setHeader("X-Proxy-Error", "invalid_target");
        response.end("Invalid proxy target.");
        return;
      }

      const rewrittenPath = resolvedProxyRequest.rewrittenPath || "/";
      const upstreamUrl = new URL(rewrittenPath, `${upstreamBaseUrl.origin}/`);
      const upstreamPath = `${upstreamUrl.pathname}${upstreamUrl.search}`;
      const isRetryable = RETRYABLE_HTTP_METHODS.has(httpMethod);

      const executeUpstreamRequest = (isRetry: boolean) => {
        const upstreamTransport = upstreamUrl.protocol === "https:" ? httpsNode : httpNode;
        const upstreamRequest = upstreamTransport.request(
          {
            protocol: upstreamUrl.protocol,
            hostname: upstreamUrl.hostname,
            port: upstreamUrl.port || (upstreamUrl.protocol === "https:" ? 443 : 80),
            method: httpMethod,
            path: upstreamPath,
            headers: buildProxyRequestHeaders(request.headers, upstreamUrl.host),
            rejectUnauthorized: false,
            timeout: PROXY_UPSTREAM_TIMEOUT_MS,
          },
          (upstreamResponse) => {
            clearTimeout(socketTimeoutId);
            const statusCode = upstreamResponse.statusCode ?? 502;
            const responseHeaders: Http.OutgoingHttpHeaders = {
              ...upstreamResponse.headers,
            };

            if (typeof upstreamResponse.headers.location === "string") {
              responseHeaders.location = rewriteProxyLocationHeader(
                upstreamResponse.headers.location,
                upstreamUrl,
              );
            } else if (Array.isArray(upstreamResponse.headers.location)) {
              responseHeaders.location = upstreamResponse.headers.location.map((value) => (
                rewriteProxyLocationHeader(value, upstreamUrl)
              ));
            }

            if (statusCode >= 400) {
              proxyLog("upstream_error", httpMethod, requestUrl, `HTTP ${statusCode} from ${upstreamUrl.host}`);
              responseHeaders["X-Proxy-Upstream-Status"] = String(statusCode);
            }

            response.writeHead(statusCode, responseHeaders);
            upstreamResponse.pipe(response);
          },
        );

        const socketTimeoutId = setTimeout(() => {
          upstreamRequest.destroy();
          if (!response.headersSent) {
            proxyLog("proxy_timeout", httpMethod, requestUrl, `${PROXY_UPSTREAM_TIMEOUT_MS}ms to ${upstreamUrl.host}`);
            response.statusCode = 504;
            response.setHeader("X-Proxy-Error", "upstream_timeout");
            response.end("Upstream request timed out.");
          }
        }, PROXY_UPSTREAM_TIMEOUT_MS);

        upstreamRequest.on("error", (err: NodeJS.ErrnoException) => {
          clearTimeout(socketTimeoutId);
          const errCode = err.code ?? "UNKNOWN";

          if (!isRetry && isRetryable && RETRYABLE_TRANSPORT_ERRORS.has(errCode)) {
            proxyLog("proxy_retry", httpMethod, requestUrl, `${errCode} from ${upstreamUrl.host}, retrying in ${PROXY_RETRY_BACKOFF_MS}ms`);
            setTimeout(() => {
              executeUpstreamRequest(true);
            }, PROXY_RETRY_BACKOFF_MS);
            return;
          }

          if (!response.headersSent) {
            proxyLog("proxy_error", httpMethod, requestUrl, `${errCode} from ${upstreamUrl.host}${isRetry ? " (retry)" : ""}`);
            response.statusCode = 502;
            response.setHeader("X-Proxy-Error", `transport_${errCode.toLowerCase()}`);
            response.end(`Proxy request failed: ${errCode}`);
            return;
          }

          response.end();
        });

        request.on("aborted", () => {
          clearTimeout(socketTimeoutId);
          upstreamRequest.destroy();
        });

        request.pipe(upstreamRequest);
      };

      executeUpstreamRequest(false);
    });
  },
});

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const xtreamServerTarget = env.VITE_XTREAM_SERVER?.trim().replace(/\/+$/, "");
  const plugins = [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: [
        "favicon.svg",
        "apple-touch-icon.png",
        "pwa-192x192.png",
        "pwa-512x512.png",
        "pwa-maskable-512x512.png",
        "apple-splash-1179x2556.png",
        "apple-splash-1290x2796.png",
        "apple-splash-1536x2048.png",
        "apple-splash-1668x2388.png",
      ],
      manifest: {
        name: "IPTV Player",
        short_name: "IPTV",
        description: "Watch live TV channels",
        theme_color: "#3B82F6",
        background_color: "#0a0a0a",
        display: "standalone",
        orientation: "portrait",
        start_url: "/",
        scope: "/",
        icons: [
          {
            src: "pwa-192x192.png",
            sizes: "192x192",
            type: "image/png",
          },
          {
            src: "pwa-512x512.png",
            sizes: "512x512",
            type: "image/png",
          },
          {
            src: "pwa-maskable-512x512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable",
          },
        ],
      },
      workbox: {
        mode: pwaWorkboxMode,
        importScripts: ["sw-push-handlers.js"],
        globPatterns: ["**/*.{js,css,html,ico,png,svg,woff,woff2}"],
        runtimeCaching: [
          {
            urlPattern: ({ request }) => request.mode === "navigate",
            handler: "NetworkFirst",
            options: {
              cacheName: "page-cache",
              networkTimeoutSeconds: 3,
              precacheFallback: {
                fallbackURL: "/offline.html",
              },
            },
          },
        ],
      },
    }),
  ];

  if (xtreamServerTarget) {
    plugins.unshift(createXtreamDevProxyPlugin(xtreamServerTarget));
  }

  return {
    server: {
      host: "::",
      port: 8080,
    },
    plugins,
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "./src"),
      },
    },
  };
});
