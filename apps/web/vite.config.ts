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

      const resolvedProxyRequest = resolveXtreamDevProxyRequest(requestUrl);
      const target = resolvedProxyRequest.target ?? defaultTarget;
      if (!target) {
        response.statusCode = 502;
        response.end("Missing proxy target.");
        return;
      }

      let upstreamBaseUrl: URL;
      try {
        upstreamBaseUrl = new URL(target);
      } catch {
        response.statusCode = 502;
        response.end("Invalid proxy target.");
        return;
      }

      const rewrittenPath = resolvedProxyRequest.rewrittenPath || "/";
      const upstreamUrl = new URL(rewrittenPath, `${upstreamBaseUrl.origin}/`);
      const upstreamTransport = upstreamUrl.protocol === "https:" ? httpsNode : httpNode;
      const upstreamRequest = upstreamTransport.request(
        {
          protocol: upstreamUrl.protocol,
          hostname: upstreamUrl.hostname,
          port: upstreamUrl.port || (upstreamUrl.protocol === "https:" ? 443 : 80),
          method: request.method,
          path: `${upstreamUrl.pathname}${upstreamUrl.search}`,
          headers: buildProxyRequestHeaders(request.headers, upstreamUrl.host),
          rejectUnauthorized: false,
        },
        (upstreamResponse) => {
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

          response.writeHead(upstreamResponse.statusCode ?? 502, responseHeaders);
          upstreamResponse.pipe(response);
        },
      );

      upstreamRequest.on("error", () => {
        if (!response.headersSent) {
          response.statusCode = 502;
          response.end("Proxy request failed.");
          return;
        }

        response.end();
      });

      request.on("aborted", () => {
        upstreamRequest.destroy();
      });

      request.pipe(upstreamRequest);
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
