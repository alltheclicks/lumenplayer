import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { VitePWA } from "vite-plugin-pwa";
import type { IncomingMessage, ServerResponse } from "node:http";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";

const pwaWorkboxMode = process.env.LUMEN_PWA_SW_MODE === "production" ? "production" : "development";
const XTREAM_DEV_PROXY_BASE_PATH = "/xui-api";
const LOCAL_PROXY_FALLBACK_TARGET = "http://localhost";
const trimTrailingSlash = (value: string): string => value.trim().replace(/\/+$/, "");

type ParsedProxyRequest = {
  target: string;
  prefix: string;
};

const parseProxyRequest = (requestPath: string): ParsedProxyRequest | null => {
  const pathname = extractPathname(requestPath);

  const plainMatch = pathname.match(
    new RegExp(`^${XTREAM_DEV_PROXY_BASE_PATH}/(https?:\\/\\/[^/?#]+)`),
  );
  if (plainMatch?.[1]) {
    return {
      target: trimTrailingSlash(plainMatch[1]),
      prefix: `${XTREAM_DEV_PROXY_BASE_PATH}/${plainMatch[1]}`,
    };
  }

  const encodedMatch = pathname.match(new RegExp(`^${XTREAM_DEV_PROXY_BASE_PATH}/([^/?#]+)`));
  if (!encodedMatch?.[1]) {
    return null;
  }

  try {
    const decodedTarget = trimTrailingSlash(decodeURIComponent(encodedMatch[1]));
    if (decodedTarget.startsWith("http://") || decodedTarget.startsWith("https://")) {
      return {
        target: decodedTarget,
        prefix: `${XTREAM_DEV_PROXY_BASE_PATH}/${encodedMatch[1]}`,
      };
    }
  } catch {
    // Ignore malformed encoded targets and fall back to default proxy target.
  }

  return null;
};

const buildProxiedRedirectLocation = (
  locationHeader: string,
  fallbackTarget: string,
): string | null => {
  const normalizedLocation = locationHeader.trim();
  if (!normalizedLocation || normalizedLocation.startsWith(XTREAM_DEV_PROXY_BASE_PATH)) {
    return null;
  }

  const normalizedFallbackTarget = trimTrailingSlash(fallbackTarget);
  if (!normalizedFallbackTarget) {
    return null;
  }

  try {
    const resolvedTargetUrl = new URL(normalizedLocation, `${normalizedFallbackTarget}/`);
    if (resolvedTargetUrl.protocol !== "http:" && resolvedTargetUrl.protocol !== "https:") {
      return null;
    }

    const targetBase = `${resolvedTargetUrl.protocol}//${resolvedTargetUrl.host}`;
    const encodedTarget = encodeURIComponent(trimTrailingSlash(targetBase));
    return `${XTREAM_DEV_PROXY_BASE_PATH}/${encodedTarget}${resolvedTargetUrl.pathname}${resolvedTargetUrl.search}`;
  } catch {
    return null;
  }
};

const extractPathname = (requestPath: string): string => {
  try {
    return new URL(requestPath, "http://localhost").pathname;
  } catch {
    return requestPath.split("?")[0] || requestPath;
  }
};

const extractPathnameAndSearch = (requestPath: string): {
  pathname: string;
  search: string;
} => {
  try {
    const parsedUrl = new URL(requestPath, "http://localhost");
    return {
      pathname: parsedUrl.pathname,
      search: parsedUrl.search,
    };
  } catch {
    const [pathnamePart, searchPart] = requestPath.split("?");
    return {
      pathname: pathnamePart || "/",
      search: searchPart ? `?${searchPart}` : "",
    };
  }
};

const createXtreamProxyMiddleware = (options: {
  xtreamServerTarget: string;
  proxyDebugEnabled: boolean;
}) => {
  const normalizedDefaultTarget = trimTrailingSlash(options.xtreamServerTarget);

  return (
    request: IncomingMessage,
    response: ServerResponse,
    next: (error?: unknown) => void,
  ): void => {
    const requestUrl = request.url || "";
    const { pathname, search } = extractPathnameAndSearch(requestUrl);
    if (!pathname.startsWith(XTREAM_DEV_PROXY_BASE_PATH)) {
      next();
      return;
    }

    const parsedProxyRequest = parseProxyRequest(requestUrl);
    const targetBase = parsedProxyRequest?.target || normalizedDefaultTarget;
    if (!targetBase) {
      response.statusCode = 502;
      response.end("Xtream dev proxy target is not configured.");
      return;
    }

    const prefix = parsedProxyRequest?.prefix || XTREAM_DEV_PROXY_BASE_PATH;
    let upstreamPathname = pathname.slice(prefix.length);
    if (!upstreamPathname.startsWith("/")) {
      upstreamPathname = `/${upstreamPathname}`;
    }

    const upstreamUrl = new URL(targetBase);
    const upstreamOrigin = `${upstreamUrl.protocol}//${upstreamUrl.host}`;
    const upstreamRequestUrl = new URL(`${upstreamOrigin}${upstreamPathname}${search}`);
    const useHttps = upstreamRequestUrl.protocol === "https:";
    const outgoingRequest = (useHttps ? httpsRequest : httpRequest)(
      {
        protocol: upstreamRequestUrl.protocol,
        hostname: upstreamRequestUrl.hostname,
        port: upstreamRequestUrl.port || (useHttps ? "443" : "80"),
        method: request.method,
        path: `${upstreamRequestUrl.pathname}${upstreamRequestUrl.search}`,
        headers: {
          ...request.headers,
          host: upstreamRequestUrl.host,
        },
        rejectUnauthorized: false,
      },
      (upstreamResponse) => {
        const statusCode = upstreamResponse.statusCode ?? 502;
        const responseHeaders = { ...upstreamResponse.headers };
        const locationHeader = responseHeaders.location;
        if (typeof locationHeader === "string" && statusCode >= 300 && statusCode < 400) {
          const proxiedLocation = buildProxiedRedirectLocation(locationHeader, upstreamOrigin);
          if (proxiedLocation) {
            responseHeaders.location = proxiedLocation;
          }
        }

        if (options.proxyDebugEnabled) {
          console.log("[xui-proxy:upstream]", {
            requestUrl,
            targetBase,
            upstreamRequestUrl: upstreamRequestUrl.toString(),
            statusCode,
            upstreamLocation: typeof locationHeader === "string" ? locationHeader : undefined,
            proxiedLocation: responseHeaders.location,
          });
        }

        response.writeHead(statusCode, responseHeaders);
        upstreamResponse.pipe(response);
      },
    );

    outgoingRequest.on("error", (error) => {
      if (options.proxyDebugEnabled) {
        console.error("[xui-proxy:error]", {
          requestUrl,
          targetBase,
          message: error.message,
        });
      }
      if (!response.headersSent) {
        response.statusCode = 502;
      }
      response.end("Bad Gateway");
    });

    request.pipe(outgoingRequest);
  };
};

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const xtreamServerTarget = env.VITE_XTREAM_SERVER?.trim().replace(/\/+$/, "");
  const proxyDebugEnabled = process.env.LUMEN_PROXY_DEBUG === "1";

  return {
    server: {
      host: "::",
      port: 8080,
    },
    plugins: [
      react(),
      {
        name: "xtream-dev-dynamic-proxy",
        configureServer(server) {
          if (!xtreamServerTarget) {
            return;
          }
          server.middlewares.use(
            createXtreamProxyMiddleware({
              xtreamServerTarget: xtreamServerTarget || LOCAL_PROXY_FALLBACK_TARGET,
              proxyDebugEnabled,
            }),
          );
        },
      },
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
    ],
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "./src"),
      },
    },
  };
});
