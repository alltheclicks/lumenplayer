import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { VitePWA } from "vite-plugin-pwa";

const pwaWorkboxMode = process.env.LUMEN_PWA_SW_MODE === "production" ? "production" : "development";
const XTREAM_DEV_PROXY_BASE_PATH = "/xui-api";
const LOCAL_PROXY_FALLBACK_TARGET = "http://localhost";
const trimTrailingSlash = (value: string): string => value.trim().replace(/\/+$/, "");

const resolveProxyTargetFromRequestPath = (requestPath: string): string | null => {
  const match = requestPath.match(new RegExp(`^${XTREAM_DEV_PROXY_BASE_PATH}/([^/?#]+)`));
  if (!match || !match[1]) {
    return null;
  }

  try {
    const decodedTarget = decodeURIComponent(match[1]).trim().replace(/\/+$/, "");
    if (decodedTarget.startsWith("http://") || decodedTarget.startsWith("https://")) {
      return decodedTarget;
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

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const xtreamServerTarget = env.VITE_XTREAM_SERVER?.trim().replace(/\/+$/, "");

  return {
    server: {
      host: "::",
      port: 8080,
      proxy: xtreamServerTarget
        ? {
            [XTREAM_DEV_PROXY_BASE_PATH]: {
              target: xtreamServerTarget || LOCAL_PROXY_FALLBACK_TARGET,
              changeOrigin: true,
              secure: false,
              router: (request) => (
                resolveProxyTargetFromRequestPath(request.url || "") ||
                xtreamServerTarget ||
                LOCAL_PROXY_FALLBACK_TARGET
              ),
              configure: (proxy) => {
                proxy.on("proxyRes", (proxyRes, req) => {
                  const statusCode = proxyRes.statusCode ?? 0;
                  if (statusCode < 300 || statusCode >= 400) {
                    return;
                  }

                  const locationHeader = proxyRes.headers.location;
                  if (typeof locationHeader !== "string") {
                    return;
                  }

                  const requestPath = req.url || "";
                  const fallbackTarget = (
                    resolveProxyTargetFromRequestPath(requestPath) ||
                    xtreamServerTarget ||
                    LOCAL_PROXY_FALLBACK_TARGET
                  );
                  const proxiedLocation = buildProxiedRedirectLocation(locationHeader, fallbackTarget);
                  if (!proxiedLocation) {
                    return;
                  }

                  proxyRes.headers.location = proxiedLocation;
                });
              },
              rewrite: (requestPath: string) => (
                requestPath
                  .replace(new RegExp(`^${XTREAM_DEV_PROXY_BASE_PATH}/[^/?#]+`), "")
                  .replace(new RegExp(`^${XTREAM_DEV_PROXY_BASE_PATH}`), "")
              ),
            },
          }
        : undefined,
    },
    plugins: [
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
    ],
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "./src"),
      },
    },
  };
});
